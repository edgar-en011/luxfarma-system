import { supabase } from '../supabaseClient';
import {
  obtenerVentasPendientes,
  marcarSincronizada,
  incrementarIntentos,
  persistirCamposVentaPendiente,
  limpiarSincronizadas,
  ensureOfflineReady,
} from './offlineQueue';
import { insertarNotifConDedup } from './notificacionesService';
import { esComprobanteSunat, procesarEmisionSunat, reintentarComprobantesSunat } from '../services/comprobantesSunat';
import { armarPayloadSincronizacion, nuevoUuidVenta, uuidVentaValido } from './ventaUuid';
import { registrarVentaEnServidor } from './registrarVentaServidor';

const MAX_INTENTOS = 5;

async function asegurarUuidPersistido(venta) {
  if (uuidVentaValido(venta.uuid_venta)) return venta.uuid_venta;
  const uuid = nuevoUuidVenta();
  venta.uuid_venta = uuid;
  if (venta.id_local != null) {
    await persistirCamposVentaPendiente(venta.id_local, { uuid_venta: uuid });
  }
  return uuid;
}

async function resolverTurnoSync(venta) {
  let idTurno = venta.turno?.id_turno || null;
  if (!idTurno) {
    const { data: turnoActivo } = await supabase
      .from('caja_turnos')
      .select('id_turno, id_sucursal')
      .eq('id_usuario_vendedor', venta.id_usuario)
      .eq('estado', 'ABIERTO')
      .maybeSingle();
    if (turnoActivo) idTurno = turnoActivo.id_turno;
  }
  if (!idTurno) throw new Error('No hay turno abierto para sincronizar esta venta.');
  return idTurno;
}

/**
 * Una sola RPC atómica: venta + cliente + detalle + pagos + stock + kardex.
 * Si el uuid ya existe (corte después del commit y antes de marcar local),
 * Postgres no reinserta ni redescuenta stock.
 */
export async function procesarVenta(venta) {
  const {
    id_local,
    tipoComprobante,
    total,
    carrito,
    metodoPago,
    mixtoData,
    id_sucursal,
    cliente,
  } = venta;

  await asegurarUuidPersistido(venta);
  const idTurno = await resolverTurnoSync(venta);
  const payload = armarPayloadSincronizacion(venta, { idTurno });

  const row = await registrarVentaEnServidor(payload);

  const idVenta = row.id_venta;
  const serie = row.serie || venta.serie;
  const correlativoReal = row.correlativo;
  const faltantesLista = Array.isArray(row.faltantes) ? row.faltantes : [];
  const faltantesPorProducto = {};
  for (const f of faltantesLista) {
    if (f?.id_producto != null) faltantesPorProducto[f.id_producto] = Number(f.faltante) || 0;
  }

  // Alertas solo en el primer commit (ya_existia = reintento: no repetir notificación).
  if (!row.ya_existia) {
    for (const f of faltantesLista) {
      const nombre = f.nombre || `Producto #${f.id_producto}`;
      await insertarNotifConDedup({
        usuario_id: null,
        tipo: 'warning',
        categoria: 'Inventario',
        mensaje: `Sobreventa offline: "${nombre}" quedó con stock insuficiente al sincronizar ${serie}-${String(correlativoReal).padStart(8, '0')}. Faltaron ${f.faltante} ud(s) base; saldo actual ${f.saldo}. Revisa Kardex / toma de inventario.`,
        accion_label: 'Ver Kardex',
        accion_url: '/kardex',
        claveDedup: `sync:faltante:${idVenta}:${f.id_producto}`,
        horasDedup: 72,
      });
    }
  }

  // SUNAT queda fuera de la transacción (API externa). Es idempotente por id_venta.
  if (esComprobanteSunat(tipoComprobante)) {
    try {
      await procesarEmisionSunat({
        id_venta: idVenta,
        id_sucursal,
        tipoComprobante,
        carrito,
        cliente: cliente
          ? {
              dni: tipoComprobante !== 'Factura' ? (cliente.docInput || '') : '',
              ruc: tipoComprobante === 'Factura' ? (cliente.docInput || '') : '',
              nombres: cliente.nombres || '',
              apellidos: cliente.apellidos || '',
              razon_social: cliente.razonSocial || cliente.nombreRazonSocial || '',
              direccion: cliente.direccion || '',
              nro_doc: cliente.docInput || '',
            }
          : null,
        total,
        metodoPago,
        mixtoData,
      });
    } catch (errSunat) {
      console.error('[SyncEngine] Error emitiendo SUNAT (venta ya sincronizada):', errSunat);
    }
  }

  await marcarSincronizada(id_local, idVenta);

  return {
    id_local,
    id_venta: idVenta,
    serie,
    correlativo: correlativoReal,
    yaExistia: !!row.ya_existia,
    tieneFaltante: faltantesLista.length > 0,
    faltantes: faltantesPorProducto,
  };
}

// Guard de re-entrancia a nivel de MÓDULO (no un state/ref de React) — sincronizarCola
// se dispara desde un useEffect atado a isOnline en POS.jsx; si la conexión parpadea
// rápido (offline/online/offline en menos de lo que tarda una sincronización) o si en el
// futuro se agrega un botón manual de "Sincronizar ahora", dos llamadas concurrentes
// leerían la MISMA cola pendiente de IndexedDB y procesarían cada venta pendiente dos
// veces — el mismo bug de fondo que el doble clic en Cobrar, aplicado al camino offline.
let sincronizandoEnCurso = false;

// ─── Sincronizar TODA la cola pendiente ──────────────────────
export async function sincronizarCola(onProgreso) {
  if (sincronizandoEnCurso) return { sincronizadas: 0, errores: 0 };
  sincronizandoEnCurso = true;
  try {
    await ensureOfflineReady();
    const pendientes = await obtenerVentasPendientes();
    if (pendientes.length === 0) {
      await reintentarComprobantesSunat();
      return { sincronizadas: 0, errores: 0, conFaltante: 0 };
    }

    let sincronizadas = 0;
    let errores = 0;
    let conFaltante = 0;

    for (const venta of pendientes) {
      if ((venta.intentos || 0) >= MAX_INTENTOS) {
        errores++;
        continue;
      }

      try {
        const resultado = await procesarVenta(venta);
        sincronizadas++;
        if (resultado.tieneFaltante) conFaltante++;
        onProgreso?.({ tipo: resultado.tieneFaltante ? 'ok_con_faltante' : 'ok', ...resultado });
      } catch (err) {
        errores++;
        await incrementarIntentos(venta.id_local, err?.message || String(err));
        onProgreso?.({ tipo: 'error', id_local: venta.id_local, error: err.message });
        console.error(`[SyncEngine] Error al sincronizar venta local #${venta.id_local}:`, err);
      }
    }

    if (sincronizadas > 0) await limpiarSincronizadas();

    try {
      await reintentarComprobantesSunat();
    } catch (errSunat) {
      console.error('[SyncEngine] Error reintentando comprobantes SUNAT:', errSunat);
    }

    return { sincronizadas, errores, conFaltante };
  } finally {
    sincronizandoEnCurso = false;
  }
}