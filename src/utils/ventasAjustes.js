import { supabase } from '../supabaseClient';
import { anularComprobanteNubefact, nubefactCredencialesOk } from './nubefactService';
import { assertEscritura } from './supaWrite';

// Extrae el número de correlativo (integer en la BD) de lo que el usuario escribió en
// el buscador de comprobantes, aceptando "72601", "B001-72601", "B001-00072601" u
// "00072601" — todos deben resolver al mismo correlativo. Corta por el ÚLTIMO "-" (la
// serie siempre va antes, el correlativo después) antes de quitar los caracteres no
// numéricos: si se hiciera al revés (quitar todo lo no-numérico del string completo),
// los dígitos de la serie (ej. "001" de "B001") se mezclarían con los del correlativo.
// Number() ya descarta los ceros a la izquierda de la parte numérica resultante.
export function parsearCorrelativoBusqueda(texto) {
  const t = texto.trim();
  if (!t) return null;
  const parteNumerica = t.includes('-') ? t.slice(t.lastIndexOf('-') + 1) : t;
  const soloDigitos = parteNumerica.replace(/[^0-9]/g, '');
  if (!soloDigitos) return null;
  return Number(soloDigitos);
}

// Resuelve el factor real de una línea de venta:
// - Si venta_detalle.factor ya viene guardado (ventas posteriores al fix que agregó esta
//   columna), es el dato REAL usado en la venta — se usa tal cual, sin reconstruir nada.
// - Si es null (ventas anteriores al fix), se reconstruye con la configuración ACTUAL de
//   producto_formas_venta para ese producto+modo_venta — es una ESTIMACIÓN, porque esa
//   configuración pudo cambiar desde la fecha real de la venta. `reconstruido:true` le
//   avisa al caller que este valor no es 100% confiable.
// - Si ni siquiera se encuentra esa forma de venta hoy (se descontinuó esa presentación),
//   cae a factor=1 con `encontrado:false` para que el caller escale la advertencia.
async function resolverFactorItem(item) {
  if (item.factor != null) {
    return { factor: Number(item.factor) || 1, reconstruido: false, encontrado: true };
  }
  const { data: formas } = await supabase
    .from('producto_formas_venta')
    .select('factor, unidades_medida(nombre)')
    .eq('id_producto', item.id_producto)
    .eq('activo', true);
  const forma = (formas || []).find(f => (f.unidades_medida?.nombre || '').toUpperCase() === (item.modo_venta || '').toUpperCase());
  if (forma) {
    return { factor: Number(forma.factor) || 1, reconstruido: true, encontrado: true };
  }
  return { factor: 1, reconstruido: true, encontrado: false };
}

// Diagnóstico de solo lectura (sin tocar stock/kardex) para mostrar, ANTES de confirmar la
// anulación, un aviso cuando alguna línea de la venta es anterior al fix de factor/id_medida
// en venta_detalle. anularVenta() en sí NO bloquea nada por su cuenta — la responsabilidad
// de exigir que el usuario lea este aviso antes de continuar es de la pantalla que llama
// (AdminVentas.jsx / MisVentas.jsx), típicamente con un checkbox "Entiendo" que habilite
// recién ahí el botón de confirmar.
export async function precheckAnulacion({ venta }) {
  const { data: detalles } = await supabase
    .from('venta_detalle')
    .select('id_producto, cantidad, modo_venta, factor, productos(descripcion)')
    .eq('id_venta', venta.id_venta);

  const avisos = [];
  for (const item of (detalles || [])) {
    if (item.factor != null) continue; // dato real guardado, no hace falta avisar
    const { factor, encontrado } = await resolverFactorItem(item);
    const nombre = item.productos?.descripcion || `Producto #${item.id_producto}`;
    avisos.push(
      encontrado
        ? `"${nombre}" (${item.modo_venta}): se devolverá con el factor ACTUAL configurado (×${factor}). Si la configuración de esta forma de venta cambió desde la fecha de la venta, el stock devuelto podría no ser exacto.`
        : `"${nombre}" (${item.modo_venta}): no se encontró la configuración de esa forma de venta — se devolverá 1:1 (factor ×1). Verifica manualmente el stock de este producto después de anular.`
    );
  }

  if (avisos.length === 0) return { requiereAviso: false, mensaje: null };

  return {
    requiereAviso: true,
    mensaje: `Esta venta es anterior a una corrección del sistema y no guardó el factor de conversión real de algunas líneas:\n\n${avisos.join('\n\n')}`,
  };
}

// Anula una venta: devuelve el stock vendido al lote más próximo a vencer del
// producto+sucursal (mismo criterio FIFO-por-vencimiento que ya usaba
// AdminVentas.jsx), registra movimientos de kardex tipo ENTRADA como respaldo del
// ajuste, marca la venta como ANULADO y objeta el comprobante contra Nubefact (si hay
// token configurado). Extraída de AdminVentas.jsx para que la pantalla de Vendedor
// (MisVentas.jsx) reutilice exactamente la misma lógica de stock/kardex, en vez de
// duplicarla.
export async function anularVenta({ venta, motivo }) {
  try {
    // Optimistic lock: el UPDATE solo afecta la fila si estado_anulacion todavía NO es
    // 'ANULADO' (NULL cuenta como "no anulada", igual que el resto del sistema la trata
    // con !== 'ANULADO'). Se hace ANTES de tocar stock/kardex — si dos sesiones admin
    // anulan la misma venta casi al mismo tiempo, la segunda debe abortar acá, no
    // después de ya haber devuelto el stock por segunda vez.
    const { data: filaBloqueada, error: errLock } = await supabase
      .from('ventas')
      .update({
        estado_anulacion: 'ANULADO',
        estado_sunat: 'ANULADO',
        motivo_anulacion: motivo,
        anulado_at: new Date().toISOString(),
      })
      .eq('id_venta', venta.id_venta)
      .or('estado_anulacion.is.null,estado_anulacion.neq.ANULADO')
      .select('id_venta');
    if (errLock) throw errLock;
    if (!filaBloqueada || filaBloqueada.length === 0) {
      return { ok: false, error: new Error('Esta venta ya fue anulada.') };
    }

    const { data: detalles } = await supabase
      .from('venta_detalle')
      .select('id_producto, cantidad, modo_venta, factor, id_medida, precio_unitario, subtotal')
      .eq('id_venta', venta.id_venta);

    // Resuelve el factor real (o reconstruido) de cada línea UNA sola vez — se reutiliza
    // tanto para devolver el stock como para el movimiento de kardex, así ambos quedan
    // siempre alineados entre sí (antes el kardex usaba item.cantidad directo, sin
    // multiplicar por factor, quedando desalineado del cambio real en el lote).
    const detallesConFactor = await Promise.all((detalles || []).map(async item => {
      const { factor } = await resolverFactorItem(item);
      return { ...item, cantidadDevolver: item.cantidad * factor };
    }));

    for (const item of detallesConFactor) {
      const { data: lotes } = await supabase
        .from('inventario_lotes')
        .select('id_lote, cantidad_actual, estado')
        .eq('id_producto', item.id_producto)
        .eq('id_sucursal', venta.id_sucursal)
        .order('fecha_vencimiento', { ascending: true })
        .limit(1);

      if (lotes && lotes.length > 0) {
        const lote = lotes[0];
        const { data: loteUpd, error: errLote } = await supabase.from('inventario_lotes').update({
          cantidad_actual: lote.cantidad_actual + item.cantidadDevolver,
          estado: 'VIGENTE',
        }).eq('id_lote', lote.id_lote).select('id_lote');
        assertEscritura(
          loteUpd,
          errLote,
          `No se pudo devolver stock al lote #${lote.id_lote} (producto #${item.id_producto}).`
        );
      }
    }

    const kardexMovimientos = await Promise.all(detallesConFactor.map(async item => {
      const { data: lotes } = await supabase
        .from('inventario_lotes')
        .select('cantidad_actual, id_lote')
        .eq('id_producto', item.id_producto)
        .eq('id_sucursal', venta.id_sucursal)
        .order('fecha_vencimiento', { ascending: true })
        .limit(1);

      const saldoActual = lotes?.[0]?.cantidad_actual ?? 0;

      return {
        id_sucursal: venta.id_sucursal,
        id_producto: item.id_producto,
        tipo: 'ENTRADA',
        cantidad: item.cantidadDevolver,
        saldo: saldoActual,
        id_lote: lotes?.[0]?.id_lote || null,
        id_usuario: venta.id_usuario_vendedor,
        observacion: `Anulación de venta ${venta.serie}-${venta.correlativo}: ${motivo}`,
      };
    }));
    if (kardexMovimientos.length > 0) {
      const { data: kardexIns, error: errKardex } = await supabase
        .from('kardex_movimientos')
        .insert(kardexMovimientos)
        .select();
      assertEscritura(kardexIns, errKardex, 'No se registraron los movimientos de kardex de la anulación.');
      if (kardexIns.length !== kardexMovimientos.length) {
        throw new Error(`Kardex incompleto: se esperaban ${kardexMovimientos.length} movimientos y se guardaron ${kardexIns.length}.`);
      }
    }

    if (await nubefactCredencialesOk()) {
      try {
        const { data: sunat } = await supabase
          .from('comprobantes_sunat')
          .select('serie, numero, tipo_comprobante')
          .eq('id_venta', venta.id_venta)
          .maybeSingle();
        const serieAnular = sunat?.serie || venta.serie;
        const numeroAnular = sunat?.numero || venta.correlativo;
        await anularComprobanteNubefact({
          serie: serieAnular,
          numero: numeroAnular,
          correlativo: numeroAnular,
          tipo_comprobante: sunat?.tipo_comprobante ?? venta.tipo_comprobante,
          motivo,
        });
      } catch (errNubefact) {
        console.warn('[Nubefact] No se pudo enviar anulación a SUNAT:', errNubefact);
      }
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}
