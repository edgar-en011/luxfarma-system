import { supabase } from '../supabaseClient';
import {
  emitirComprobante,
  consultarEstado,
  medioPagoNubefact,
  TIPO_COMPROBANTE_NUBEFACT,
} from './nubefactService';
import {
  diasCalendarioTranscurridos,
  fechaEmisionComprobante,
  normalizarEstadoSunat,
  resolverEstadoTrasConsulta,
} from '../utils/estadoSunat';
import {
  MAX_CONSULTAS_SUNAT_POR_CICLO,
  MAX_INTENTOS_GENERAR_NUBEFACT,
  PAUSA_ENTRE_CONSULTAS_NUBEFACT_MS,
} from '../utils/plazosSunatBoleta';

/** Pausa entre un reintento y el siguiente en el mismo ciclo (no martillar Nubefact). */
const PAUSA_ENTRE_REINTENTOS_MS = 1500;

/** Timeout u otro "no sé si se creó": consultar antes de volver a generar. */
export const ESTADO_POR_CONFIRMAR = 'POR_CONFIRMAR';
export const MENSAJE_TIMEOUT_CONSULTAR = 'Timeout: no se sabe si Nubefact lo guardó. Consultar antes de reenviar.';

/**
 * Estados que el ciclo automático puede volver a emitir (tras consultar).
 * REQUIERE_REVISION ya no genera: solo se consulta (ciclo de verificación).
 */
export const ESTADOS_REINTENTO_SUNAT = ['PENDIENTE', 'ERROR', ESTADO_POR_CONFIRMAR];

/** Un fallo claro de Nubefact (payload, auth, etc.) queda en ERROR. */
export function estadoEnvioTrasFalloNubefact() {
  return 'ERROR';
}

function esErrorNubefactYaExiste(res) {
  if (Number(res?.codigo) === 23) return true;
  return /ya existe/i.test(String(res?.error || ''));
}

function esErrorNubefactNoExiste(res) {
  if (res?.ok) return false;
  if (Number(res?.codigo) === 24) return true;
  const t = String(res?.error || '').toLowerCase();
  return t.includes('no existe') || t.includes('no fue enviado');
}

function esTimeoutNubefact(res) {
  return Boolean(res?.timeout) || /timeout/i.test(String(res?.error || ''));
}

export function tipoNubefactDesdeVenta(tipoComprobante) {
  const t = String(tipoComprobante || '').toUpperCase();
  if (t === 'FACTURA' || t === '01' || t === '1') return TIPO_COMPROBANTE_NUBEFACT.FACTURA;
  if (t === 'BOLETA' || t === '03' || t === '2') return TIPO_COMPROBANTE_NUBEFACT.BOLETA;
  return null;
}

export function esComprobanteSunat(tipoComprobante) {
  return tipoNubefactDesdeVenta(tipoComprobante) != null;
}

async function reservarCorrelativo(idSucursal, tipoComprobante) {
  const { data, error } = await supabase.rpc('reservar_siguiente_correlativo', {
    p_id_sucursal: Number(idSucursal),
    p_tipo_comprobante: Number(tipoComprobante),
  });
  if (error) {
    return { ok: false, error: error.message || 'No se pudo reservar el correlativo SUNAT.' };
  }
  const row = typeof data === 'string' ? JSON.parse(data) : (data || {});
  if (!row.ok) {
    return {
      ok: false,
      sinSerie: row.error === 'NO_SERIE',
      error: row.error === 'NO_SERIE'
        ? 'No hay serie configurada para esta sucursal'
        : (row.error || 'No hay serie configurada para esta sucursal'),
    };
  }
  return { ok: true, serie: row.serie, numero: Number(row.numero) };
}

async function upsertComprobante(payload) {
  const ahora = new Date().toISOString();
  const fila = { ...payload, fecha_actualizacion: ahora };
  const { data: existente, error: errSel } = await supabase
    .from('comprobantes_sunat')
    .select('id, intentos')
    .eq('id_venta', payload.id_venta)
    .maybeSingle();
  if (errSel) return { ok: false, error: errSel.message, data: null };

  if (existente?.id) {
    const { data, error } = await supabase
      .from('comprobantes_sunat')
      .update(fila)
      .eq('id', existente.id)
      .select()
      .maybeSingle();
    if (error) return { ok: false, error: error.message, data: null };
    return { ok: true, data };
  }

  const { data, error } = await supabase
    .from('comprobantes_sunat')
    .insert(fila)
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message, data: null };
  return { ok: true, data };
}

async function actualizarEstadoVenta(idVenta, estadoSunat) {
  if (!idVenta) return;
  await supabase.from('ventas').update({ estado_sunat: estadoSunat }).eq('id_venta', idVenta);
}

async function leerComprobantePorVenta(idVenta) {
  const { data } = await supabase
    .from('comprobantes_sunat')
    .select('id, serie, numero, intentos, estado_envio, mensaje_error, aceptada_por_sunat, enlace_pdf, enlace_xml, key_nubefact')
    .eq('id_venta', idVenta)
    .maybeSingle();
  return data || null;
}

async function persistirEstadoEnvio(payload) {
  const r = await upsertComprobante(payload);
  if (r.ok) return r;
  if (payload.estado_envio === ESTADO_POR_CONFIRMAR && /estado_envio|check constraint/i.test(r.error || '')) {
    return upsertComprobante({
      ...payload,
      estado_envio: 'ERROR',
      mensaje_error: payload.mensaje_error || MENSAJE_TIMEOUT_CONSULTAR,
    });
  }
  return r;
}

async function persistirExtrasEmitidos(idVenta, data) {
  const d = data || {};
  const ahora = new Date().toISOString();
  if (d.aceptada_por_sunat) {
    const extraAcept = await supabase
      .from('comprobantes_sunat')
      .update({ fecha_aceptacion: ahora })
      .eq('id_venta', idVenta)
      .is('fecha_aceptacion', null);
    if (extraAcept.error) {
      console.warn('[SUNAT] fecha_aceptacion (migración pendiente):', extraAcept.error.message);
    }
  }
  if (d.cadena_qr || d.codigo_hash || d.enlace) {
    const extra = await supabase
      .from('comprobantes_sunat')
      .update({
        cadena_qr: d.cadena_qr || null,
        codigo_hash: d.codigo_hash || null,
        enlace: d.enlace || d.enlace_pdf || null,
      })
      .eq('id_venta', idVenta);
    if (extra.error) {
      console.warn('[SUNAT] columnas QR/hash no disponibles (migración pendiente):', extra.error.message);
    }
  }
}

async function persistirComoEnviado({ id_venta, id_sucursal, tipo, serie, numero, intentos, data }) {
  const d = data || {};
  const aceptada = Boolean(d.aceptada_por_sunat);
  const ahora = new Date().toISOString();
  const guardado = await persistirEstadoEnvio({
    id_venta,
    id_sucursal,
    tipo_comprobante: tipo,
    serie,
    numero,
    key_nubefact: d.key_nubefact || null,
    enlace_pdf: d.enlace_pdf || null,
    enlace_xml: d.enlace_xml || null,
    aceptada_por_sunat: aceptada,
    estado_envio: 'ENVIADO',
    mensaje_error: null,
    intentos,
    fecha_envio: ahora,
  });
  await actualizarEstadoVenta(id_venta, aceptada ? 'ACEPTADO' : 'ENVIADO');
  await persistirExtrasEmitidos(id_venta, d);
  return {
    ok: true,
    aviso: null,
    estado_envio: 'ENVIADO',
    enlace_pdf: d.enlace_pdf || null,
    registro: guardado.data,
    serie,
    numero,
    cadena_qr: d.cadena_qr || null,
    codigo_hash: d.codigo_hash || null,
    enlace: d.enlace || d.enlace_pdf || null,
    codigo_barras: d.codigo_barras || null,
  };
}

/**
 * Reserva correlativo SUNAT (si falta), emite en Nubefact y persiste comprobantes_sunat.
 * Si ya hay serie/número, consulta antes de volver a generar.
 * Nunca lanza. No revierte la venta.
 */
export async function procesarEmisionSunat({
  id_venta,
  id_sucursal,
  tipoComprobante,
  carrito,
  cliente,
  total,
  metodoPago,
  mixtoData,
  serieSunat,
  numeroSunat,
  intentosPrevios = 0,
}) {
  const tipo = tipoNubefactDesdeVenta(tipoComprobante);
  if (!tipo || !id_venta || !id_sucursal) {
    return { ok: false, error: 'Datos de venta incompletos para SUNAT.', aviso: null };
  }

  let serie = serieSunat;
  let numero = numeroSunat;
  try {
    const existente = await leerComprobantePorVenta(id_venta);
    if (!serie) serie = existente?.serie || null;
    if (!numero) numero = existente?.numero ?? null;
    const intentosHechos = Number(existente?.intentos ?? intentosPrevios ?? 0) || 0;
    const reutilizaNumero = Boolean(serie && numero);

    if (!reutilizaNumero) {
      const reserva = await reservarCorrelativo(id_sucursal, tipo);
      if (!reserva.ok) {
        const aviso = reserva.sinSerie
          ? 'No hay serie configurada para esta sucursal'
          : reserva.error;
        const guardado = await persistirEstadoEnvio({
          id_venta,
          id_sucursal,
          tipo_comprobante: tipo,
          serie: null,
          numero: null,
          estado_envio: 'PENDIENTE',
          mensaje_error: aviso,
          intentos: intentosHechos,
        });
        await actualizarEstadoVenta(id_venta, 'PENDIENTE');
        return {
          ok: false,
          error: aviso,
          aviso: `${aviso}. Comprobante pendiente de enviar a SUNAT.`,
          sinSerie: Boolean(reserva.sinSerie),
          estado_envio: 'PENDIENTE',
          registro: guardado.data,
        };
      }
      serie = reserva.serie;
      numero = reserva.numero;
    }

    if (reutilizaNumero) {
      console.log('[SUNAT] consulta previa a generar', { etiqueta: `${serie}-${numero}` });
      const consulta = await consultarEstado(tipo, serie, numero);
      if (consulta.ok) {
        console.log('[SUNAT] ya existía en Nubefact; no se reenvía', { etiqueta: `${serie}-${numero}` });
        return persistirComoEnviado({
          id_venta,
          id_sucursal,
          tipo,
          serie,
          numero,
          intentos: intentosHechos,
          data: consulta.data,
        });
      }
      if (!esErrorNubefactNoExiste(consulta)) {
        const mensaje = consulta.error || MENSAJE_TIMEOUT_CONSULTAR;
        const guardado = await persistirEstadoEnvio({
          id_venta,
          id_sucursal,
          tipo_comprobante: tipo,
          serie,
          numero,
          estado_envio: ESTADO_POR_CONFIRMAR,
          mensaje_error: mensaje,
          intentos: intentosHechos,
        });
        await actualizarEstadoVenta(id_venta, 'PENDIENTE');
        return {
          ok: false,
          error: mensaje,
          aviso: 'Hay que confirmar si Nubefact ya tiene el comprobante antes de reenviar.',
          estado_envio: ESTADO_POR_CONFIRMAR,
          registro: guardado.data,
          serie,
          numero,
        };
      }
    }

    if (intentosHechos >= MAX_INTENTOS_GENERAR_NUBEFACT) {
      const aviso = `Tope de ${MAX_INTENTOS_GENERAR_NUBEFACT} envíos a Nubefact. Revisión manual.`;
      const guardado = await persistirEstadoEnvio({
        id_venta,
        id_sucursal,
        tipo_comprobante: tipo,
        serie,
        numero,
        estado_envio: 'REQUIERE_REVISION',
        mensaje_error: aviso,
        intentos: intentosHechos,
      });
      await actualizarEstadoVenta(id_venta, 'REQUIERE_REVISION');
      return {
        ok: false,
        error: aviso,
        aviso,
        estado_envio: 'REQUIERE_REVISION',
        registro: guardado.data,
        serie,
        numero,
      };
    }

    const resultado = await emitirComprobante({
      tipo_comprobante: tipo,
      serie,
      numero,
      carrito,
      cliente,
      total,
      metodoPago,
      mixtoData,
      medio_de_pago: medioPagoNubefact(metodoPago, mixtoData),
    });

    const intentos = intentosHechos + 1;

    if (resultado.ok) {
      return persistirComoEnviado({
        id_venta,
        id_sucursal,
        tipo,
        serie,
        numero,
        intentos,
        data: resultado.data,
      });
    }

    if (esErrorNubefactYaExiste(resultado)) {
      console.log('[SUNAT] Error 23: ya existe; no se reintenta generar', { etiqueta: `${serie}-${numero}` });
      const consulta = await consultarEstado(tipo, serie, numero);
      return persistirComoEnviado({
        id_venta,
        id_sucursal,
        tipo,
        serie,
        numero,
        intentos,
        data: consulta.ok ? consulta.data : (resultado.data || {}),
      });
    }

    if (esTimeoutNubefact(resultado)) {
      const guardado = await persistirEstadoEnvio({
        id_venta,
        id_sucursal,
        tipo_comprobante: tipo,
        serie,
        numero,
        estado_envio: ESTADO_POR_CONFIRMAR,
        mensaje_error: MENSAJE_TIMEOUT_CONSULTAR,
        intentos,
        fecha_envio: new Date().toISOString(),
      });
      await actualizarEstadoVenta(id_venta, 'PENDIENTE');
      return {
        ok: false,
        error: MENSAJE_TIMEOUT_CONSULTAR,
        aviso: 'Timeout: hay que consultar a Nubefact antes de reenviar.',
        estado_envio: ESTADO_POR_CONFIRMAR,
        registro: guardado.data,
        serie,
        numero,
      };
    }

    const estado_envio = estadoEnvioTrasFalloNubefact();
    const guardado = await persistirEstadoEnvio({
      id_venta,
      id_sucursal,
      tipo_comprobante: tipo,
      serie,
      numero,
      estado_envio,
      mensaje_error: resultado.error || 'Error al enviar a Nubefact',
      intentos,
      fecha_envio: new Date().toISOString(),
    });
    await actualizarEstadoVenta(id_venta, 'ERROR');
    return {
      ok: false,
      error: resultado.error,
      aviso: 'Comprobante pendiente de enviar a SUNAT',
      estado_envio,
      registro: guardado.data,
      serie,
      numero,
    };
  } catch (err) {
    if (serie && numero) {
      await persistirEstadoEnvio({
        id_venta,
        id_sucursal,
        tipo_comprobante: tipo,
        serie,
        numero,
        estado_envio: ESTADO_POR_CONFIRMAR,
        mensaje_error: MENSAJE_TIMEOUT_CONSULTAR,
        intentos: intentosPrevios,
      });
    }
    return {
      ok: false,
      error: err?.message || 'Error al procesar el comprobante SUNAT.',
      aviso: 'Comprobante pendiente de enviar a SUNAT',
      estado_envio: serie && numero ? ESTADO_POR_CONFIRMAR : undefined,
      serie,
      numero,
    };
  }
}

async function reconstruirDatosVenta(idVenta) {
  const [{ data: venta }, { data: detalle }, { data: pagos }] = await Promise.all([
    supabase
      .from('ventas')
      .select('id_venta, id_sucursal, tipo_comprobante, total, descuento, id_cliente, clientes(nombres, apellidos, nombre_razon_social, nro_doc, tipo_doc, direccion)')
      .eq('id_venta', idVenta)
      .maybeSingle(),
    supabase
      .from('venta_detalle')
      .select('id_producto, cantidad, precio_unitario, subtotal, modo_venta, productos(descripcion)')
      .eq('id_venta', idVenta),
    supabase.from('pagos_venta').select('metodo, monto').eq('id_venta', idVenta),
  ]);

  if (!venta) return null;

  const carrito = (detalle || []).map((d) => ({
    id_producto: d.id_producto,
    cantidad: d.cantidad,
    precio_unitario: d.precio_unitario,
    precio: d.precio_unitario,
    subtotal: d.subtotal,
    modo_venta: d.modo_venta,
    descripcion: d.productos?.descripcion,
  }));

  let metodoPago = 'Efectivo';
  let mixtoData = null;
  if ((pagos || []).length > 1) {
    metodoPago = 'Mixto';
    mixtoData = {
      metodo1: pagos[0]?.metodo || 'Efectivo',
      metodo2: pagos[1]?.metodo || 'Yape',
      monto1: Number(pagos[0]?.monto || 0),
      monto2: Number(pagos[1]?.monto || 0),
    };
  } else if (pagos?.[0]?.metodo) {
    const m = pagos[0].metodo;
    metodoPago = m.charAt(0) + m.slice(1).toLowerCase();
  }

  const cli = venta.clientes || {};
  const tipoDoc = String(cli.tipo_doc || '').toUpperCase();
  const cliente = {
    dni: tipoDoc === 'RUC' ? '' : (cli.nro_doc || ''),
    ruc: tipoDoc === 'RUC' ? (cli.nro_doc || '') : '',
    nombres: cli.nombres || '',
    apellidos: cli.apellidos || '',
    razon_social: cli.nombre_razon_social || '',
    direccion: cli.direccion || '',
    nro_doc: cli.nro_doc || '',
  };

  return {
    venta,
    carrito,
    cliente,
    total: Number(venta.total || 0),
    metodoPago,
    mixtoData,
  };
}

let reintentoSunatEnCurso = false;

export async function reintentarComprobantesSunat() {
  if (reintentoSunatEnCurso) return { reenviados: 0, errores: 0, omitido: true };
  reintentoSunatEnCurso = true;
  try {
    const { data: filas, error } = await supabase
      .from('comprobantes_sunat')
      .select('id, id_venta, id_sucursal, tipo_comprobante, serie, numero, intentos, estado_envio, mensaje_error')
      .in('estado_envio', ESTADOS_REINTENTO_SUNAT)
      .order('id', { ascending: true });

    if (error) {
      console.error('[SUNAT] No se pudieron leer comprobantes pendientes:', error.message);
      return { reenviados: 0, errores: 0 };
    }

    let reenviados = 0;
    let errores = 0;
    const lista = filas || [];

    for (let i = 0; i < lista.length; i += 1) {
      const fila = lista[i];
      const ctx = await reconstruirDatosVenta(fila.id_venta);
      if (!ctx) {
        errores++;
        continue;
      }
      const res = await procesarEmisionSunat({
        id_venta: fila.id_venta,
        id_sucursal: fila.id_sucursal || ctx.venta.id_sucursal,
        tipoComprobante: fila.tipo_comprobante,
        carrito: ctx.carrito,
        cliente: ctx.cliente,
        total: ctx.total,
        metodoPago: ctx.metodoPago,
        mixtoData: ctx.mixtoData,
        serieSunat: fila.serie,
        numeroSunat: fila.numero,
        intentosPrevios: fila.intentos || 0,
      });
      if (res.ok) reenviados++;
      else errores++;
      if (i < lista.length - 1) {
        await new Promise((r) => setTimeout(r, PAUSA_ENTRE_REINTENTOS_MS));
      }
    }

    return { reenviados, errores };
  } catch (err) {
    console.error('[SUNAT] Error en reintento automático:', err);
    return { reenviados: 0, errores: 0 };
  } finally {
    reintentoSunatEnCurso = false;
  }
}

export const EVT_SUNAT_ESTADOS_ACTUALIZADOS = 'sunat-estados-actualizados';

function avisarPantallaSunat() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVT_SUNAT_ESTADOS_ACTUALIZADOS));
}

export async function consultarYActualizarComprobante(fila) {
  const etiqueta = `${fila?.serie || '?'}-${fila?.numero ?? '?'}`;
  try {
    if (!fila?.serie || fila?.numero == null) {
      return { ok: false, error: 'El comprobante aún no tiene serie/número SUNAT.' };
    }
    const fecha = fechaEmisionComprobante(fila);
    const dias = diasCalendarioTranscurridos(fecha);
    console.log('[SUNAT] consultando', { etiqueta, tipo: fila.tipo_comprobante, fecha, dias, estado_antes: fila.estado_envio });

    const res = await consultarEstado(fila.tipo_comprobante, fila.serie, fila.numero);
    if (!res.ok) {
      console.warn('[SUNAT] Nubefact no respondió OK', { etiqueta, error: res.error, data: res.data });
      return res;
    }

    const d = res.data || {};
    const aceptada = Boolean(d.aceptada_por_sunat);
    const { estado: estadoConsulta, mensaje } = resolverEstadoTrasConsulta({ aceptada, data: d });
    const yaRechazado = normalizarEstadoSunat(fila?.estado_envio) === 'RECHAZADO'
      && fila?.aceptada_por_sunat !== true;
    const preservarRechazo = yaRechazado && !aceptada;
    const estado_envio = preservarRechazo ? fila.estado_envio : estadoConsulta;
    const mensaje_error = preservarRechazo
      ? (fila.mensaje_error || null)
      : (aceptada ? null : mensaje);
    console.log('[SUNAT] respuesta Nubefact', {
      etiqueta,
      aceptada,
      dias,
      estado_envio,
      preservarRechazo,
      sunat_description: d.sunat_description,
      sunat_responsecode: d.sunat_responsecode,
    });

    const ahora = new Date().toISOString();
    const { error: errUp } = await supabase
      .from('comprobantes_sunat')
      .update({
        aceptada_por_sunat: aceptada,
        estado_envio,
        enlace_pdf: d.enlace_pdf || fila.enlace_pdf || null,
        enlace_xml: d.enlace_xml || fila.enlace_xml || null,
        key_nubefact: d.key_nubefact || fila.key_nubefact || null,
        mensaje_error,
        fecha_actualizacion: ahora,
      })
      .eq('id', fila.id);
    if (errUp) {
      console.warn('[SUNAT] UPDATE falló', { etiqueta, estado_envio, error: errUp.message });
      return { ok: false, error: errUp.message };
    }
    if (aceptada && !fila.fecha_aceptacion) {
      const extraAcept = await supabase
        .from('comprobantes_sunat')
        .update({ fecha_aceptacion: ahora })
        .eq('id', fila.id)
        .is('fecha_aceptacion', null);
      if (extraAcept.error) {
        console.warn('[SUNAT] fecha_aceptacion (migración pendiente):', extraAcept.error.message);
      }
    }

    if (!preservarRechazo) {
      await actualizarEstadoVenta(fila.id_venta, aceptada ? 'ACEPTADO' : 'ENVIADO');
    }
    return { ok: true, data: d, estado_envio };
  } catch (err) {
    console.warn('[SUNAT] consultarYActualizar excepción', { etiqueta, error: err?.message || err });
    return { ok: false, error: err?.message || 'Error al consultar estado.' };
  }
}

let verificacionSunatEnCurso = false;

/**
 * Pregunta a Nubefact el estado (no reemite).
 * Incluye ENVIADO pendientes de SUNAT, POR_CONFIRMAR y REQUIERE_REVISION.
 */
export async function verificarEstadosSunatPosteriores() {
  if (verificacionSunatEnCurso) return { consultados: 0, actualizados: 0, omitido: true };
  verificacionSunatEnCurso = true;
  try {
    const { data: filas, error } = await supabase
      .from('comprobantes_sunat')
      .select('id, id_venta, tipo_comprobante, serie, numero, estado_envio, mensaje_error, fecha_envio, aceptada_por_sunat, enlace_pdf, enlace_xml, key_nubefact, ventas(created_at)')
      .eq('aceptada_por_sunat', false)
      .in('estado_envio', ['ENVIADO', 'SIN_CONFIRMAR', ESTADO_POR_CONFIRMAR, 'REQUIERE_REVISION', 'ERROR'])
      .not('serie', 'is', null)
      .not('numero', 'is', null)
      .order('fecha_envio', { ascending: true });

    if (error) {
      console.warn('[SUNAT] ciclo: no se pudieron leer boletas:', error.message);
      return { consultados: 0, actualizados: 0 };
    }

    const candidatas = (filas || [])
      .filter((f) => {
        const e = String(f.estado_envio || '').toUpperCase();
        if (e === ESTADO_POR_CONFIRMAR || e === 'REQUIERE_REVISION') return true;
        if (e === 'ERROR' && String(f.mensaje_error || '').includes('Consultar antes de reenviar')) return true;
        if (Number(f.tipo_comprobante) !== TIPO_COMPROBANTE_NUBEFACT.BOLETA) return false;
        const dias = diasCalendarioTranscurridos(fechaEmisionComprobante(f));
        return dias != null && dias >= 1;
      })
      .slice(0, MAX_CONSULTAS_SUNAT_POR_CICLO);

    console.log('[SUNAT] ciclo verificación', {
      leidas: (filas || []).length,
      candidatas: candidatas.length,
      ids: candidatas.map((f) => `${f.serie}-${f.numero}`),
    });

    let consultados = 0;
    let actualizados = 0;
    for (let i = 0; i < candidatas.length; i += 1) {
      const fila = candidatas[i];
      const res = await consultarYActualizarComprobante(fila);
      consultados += 1;
      if (res.ok && res.estado_envio !== fila.estado_envio) actualizados += 1;
      if (i < candidatas.length - 1) {
        await new Promise((r) => setTimeout(r, PAUSA_ENTRE_CONSULTAS_NUBEFACT_MS));
      }
    }
    console.log('[SUNAT] ciclo listo', { consultados, actualizados });
    if (consultados > 0) avisarPantallaSunat();
    return { consultados, actualizados };
  } catch (err) {
    console.warn('[SUNAT] Error verificando estados posteriores:', err?.message || err);
    return { consultados: 0, actualizados: 0 };
  } finally {
    verificacionSunatEnCurso = false;
  }
}
