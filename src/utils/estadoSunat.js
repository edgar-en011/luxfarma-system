/**
 * Única fuente de verdad del estado SUNAT de un comprobante.
 *
 * El panel del Dashboard y el listado de AdminSunat leen la MISMA tabla
 * (comprobantes_sunat) y clasifican con las MISMAS funciones de acá, así los números
 * no pueden divergir. ventas.estado_sunat es una copia denormalizada que puede quedar
 * atrás; no se usa para contar.
 */

import { diasHastaFecha, fechaCalendarioPE } from './fechas';
import { DIAS_ALERTA_PLAZO_CERCANO, DIAS_PLAZO_LEGAL_RESUMEN, DIAS_SIN_CONFIRMAR } from './plazosSunatBoleta';

/** Salió hacia Nubefact. ACEPTADO/SIN_CONFIRMAR/RECHAZADO son residuos del modelo viejo. */
const ESTADOS_ENVIADOS = new Set(['ENVIADO', 'ACEPTADO', 'SIN_CONFIRMAR', 'RECHAZADO']);
/** Falló el envío (no salió o hay que reintentar). */
const ESTADOS_ERROR = new Set(['ERROR', 'REQUIERE_REVISION']);

export function normalizarEstadoSunat(estado) {
  return String(estado ?? '').trim().toUpperCase();
}

/** Días calendario Perú desde la emisión (0 = hoy). */
export function diasCalendarioTranscurridos(createdAt, ref = new Date()) {
  const iso = fechaCalendarioPE(createdAt);
  if (!iso) return null;
  const hasta = diasHastaFecha(iso, ref);
  if (hasta == null) return null;
  return -hasta;
}

/** 'ok' | 'error' | 'pendiente' — solo el eje de envío, no el de validación SUNAT. */
export function clasificarEstadoSunat(estado) {
  const e = normalizarEstadoSunat(estado);
  if (ESTADOS_ENVIADOS.has(e)) return 'ok';
  if (ESTADOS_ERROR.has(e)) return 'error';
  return 'pendiente';
}

export function claseBadgeEstadoSunat(estado) {
  const bucket = clasificarEstadoSunat(estado);
  if (bucket === 'ok') return 'asu-badge-verde';
  if (bucket === 'error') return 'asu-badge-estado-error';
  return 'asu-badge-estado-pendiente';
}

export function etiquetaEstadoEnvio(estado) {
  const e = normalizarEstadoSunat(estado);
  if (e === 'SIN_CONFIRMAR' || e === 'ACEPTADO' || e === 'RECHAZADO') return 'ENVIADO';
  if (e === 'REQUIERE_REVISION') return 'REQUIERE REVISIÓN';
  if (e === 'POR_CONFIRMAR') return 'POR CONFIRMAR';
  return e || 'PENDIENTE';
}

/** Timeout u otro "no sé si se creó": hay que consultar, no reenviar a ciegas. */
export function esEnvioPorConfirmar(fila) {
  if (normalizarEstadoSunat(fila?.estado_envio) === 'POR_CONFIRMAR') return true;
  return String(fila?.mensaje_error || '').includes('Consultar antes de reenviar');
}

export function etiquetaFiltroSunat(filtro) {
  if (!filtro || filtro === 'todos') return 'Todos';
  if (filtro === 'SIN_CONFIRMAR') return 'SIN CONFIRMAR';
  if (filtro === 'ACEPTADO') return 'ACEPTADO';
  if (filtro === 'RECHAZADO') return 'RECHAZADO';
  if (filtro === 'POR_CONFIRMAR') return 'POR CONFIRMAR';
  return etiquetaEstadoEnvio(filtro);
}

/** NO EXISTE = SUNAT aún no lo tiene (resumen diario), no un rechazo del CPE. */
function esRechazoValidacion(fila) {
  if (normalizarEstadoSunat(fila?.estado_envio) === 'RECHAZADO') return true;
  const msg = String(fila?.mensaje_error || '').toUpperCase();
  if (msg.includes('NO EXISTE')) return false;
  return msg.includes('RECHAZ');
}

/** Validación SUNAT (columna aparte del envío). */
export function estadoValidacionSunat(fila, ref = new Date()) {
  if (fila?.aceptada_por_sunat === true) return 'ACEPTADA';
  if (esRechazoValidacion(fila)) return 'RECHAZADA';
  if (esSinConfirmarSunat(fila, ref)) return 'SIN_CONFIRMAR';
  return 'PENDIENTE';
}

export function etiquetaValidacionSunat(fila, ref = new Date()) {
  const v = estadoValidacionSunat(fila, ref);
  if (v === 'ACEPTADA') return 'Aceptada';
  if (v === 'RECHAZADA') return 'Rechazada';
  if (v === 'SIN_CONFIRMAR') return 'SIN CONFIRMAR';
  return '—';
}

export function claseBadgeValidacionSunat(fila, ref = new Date()) {
  const v = estadoValidacionSunat(fila, ref);
  if (v === 'ACEPTADA') return 'asu-badge-verde';
  if (v === 'RECHAZADA') return 'asu-badge-estado-error';
  if (v === 'SIN_CONFIRMAR') {
    const dias = diasCalendarioTranscurridos(fechaEmisionComprobante(fila), ref);
    return dias != null && dias >= DIAS_PLAZO_LEGAL_RESUMEN
      ? 'asu-badge-estado-error'
      : 'asu-badge-estado-sin-confirmar';
  }
  return 'asu-badge-estado-pendiente';
}

export function esSinConfirmarSunat(fila, ref = new Date()) {
  if (fila?.aceptada_por_sunat === true) return false;
  const envio = normalizarEstadoSunat(fila?.estado_envio);
  if (!ESTADOS_ENVIADOS.has(envio)) return false;
  if (esRechazoValidacion(fila)) return false;
  const dias = diasCalendarioTranscurridos(fechaEmisionComprobante(fila), ref);
  return dias != null && dias >= DIAS_SIN_CONFIRMAR;
}

export function diasEntreCalendario(desde, hasta) {
  const a = fechaCalendarioPE(desde);
  const b = fechaCalendarioPE(hasta);
  if (!a || !b) return null;
  const pa = parseFechaLocal(a);
  const pb = parseFechaLocal(b);
  if (!pa || !pb) return null;
  return Math.round((pb - pa) / 86400000);
}

function parseFechaLocal(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).slice(0, 10));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function diasRestantesPlazoResumen(fila, ref = new Date()) {
  const dias = diasCalendarioTranscurridos(fechaEmisionComprobante(fila), ref);
  if (dias == null) return null;
  return DIAS_PLAZO_LEGAL_RESUMEN - dias;
}

function textoCantidadDias(n) {
  return `${n} día${n === 1 ? '' : 's'}`;
}

export function textoDiasComprobanteSunat(fila, ref = new Date()) {
  const emision = fechaEmisionComprobante(fila);
  if (fila?.aceptada_por_sunat === true) {
    const fin = fila.fecha_aceptacion || fila.fecha_actualizacion || null;
    const tardó = diasEntreCalendario(emision, fin);
    if (tardó == null) return 'Aceptada';
    if (tardó <= 0) return 'Aceptada el mismo día';
    return `Aceptada en ${textoCantidadDias(tardó)}`;
  }
  if (esRechazoValidacion(fila)) return '—';
  const dias = diasCalendarioTranscurridos(emision, ref);
  if (dias == null) return '—';
  const quedan = DIAS_PLAZO_LEGAL_RESUMEN - dias;
  if (quedan <= 0) {
    const hace = -quedan;
    if (hace <= 0) return 'Plazo vencido';
    return `Plazo vencido (hace ${textoCantidadDias(hace)})`;
  }
  const transcurridos = dias <= 0 ? 'Hoy' : textoCantidadDias(dias);
  return `${transcurridos} · quedan ${quedan}`;
}

export function claseDiasComprobanteSunat(fila, ref = new Date()) {
  if (fila?.aceptada_por_sunat === true) return 'asu-dias-aceptada';
  if (esRechazoValidacion(fila)) return '';
  const quedan = diasRestantesPlazoResumen(fila, ref);
  if (quedan == null) return '';
  if (quedan <= 0) return 'asu-dias-vencido';
  if (quedan <= DIAS_ALERTA_PLAZO_CERCANO) return 'asu-dias-urgente';
  return '';
}

export function filaPasaFiltroSunat(fila, filtro) {
  if (!filtro || filtro === 'todos') return true;
  if (filtro === 'SIN_CONFIRMAR') return esSinConfirmarSunat(fila);
  if (filtro === 'ACEPTADO') return fila?.aceptada_por_sunat === true;
  if (filtro === 'RECHAZADO') return estadoValidacionSunat(fila) === 'RECHAZADA';
  if (filtro === 'ENVIADO') return clasificarEstadoSunat(fila?.estado_envio) === 'ok';
  if (filtro === 'POR_CONFIRMAR') return esEnvioPorConfirmar(fila);
  return normalizarEstadoSunat(fila?.estado_envio) === normalizarEstadoSunat(filtro);
}

export function esRechazoSunat(data) {
  const raw = data?.raw && typeof data.raw === 'object' ? data.raw : {};
  const texto = [
    data?.sunat_description,
    data?.sunat_note,
    data?.sunat_soap_error,
    raw.sunat_description,
    raw.sunat_note,
    raw.sunat_soap_error,
  ].map((s) => String(s || '').toUpperCase()).join(' ');
  if (texto.includes('RECHAZ') || texto.includes('NO EXISTE')) return true;
  return false;
}

export function mensajeErrorSunat(data) {
  return data?.sunat_description
    || data?.sunat_note
    || data?.sunat_soap_error
    || data?.raw?.sunat_description
    || null;
}

/** Tras consultar: el envío sigue siendo ENVIADO. La validación va en aceptada_por_sunat. */
export function resolverEstadoTrasConsulta({ aceptada, data }) {
  if (aceptada) return { estado: 'ENVIADO', mensaje: null };
  if (esRechazoSunat(data)) {
    return { estado: 'ENVIADO', mensaje: mensajeErrorSunat(data) || 'SUNAT rechazó el comprobante.' };
  }
  return { estado: 'ENVIADO', mensaje: mensajeErrorSunat(data) };
}

export function fechaEmisionComprobante(fila) {
  return fila?.fecha_envio || fila?.ventas?.created_at || null;
}

/** Boletas enviadas que SUNAT no confirmó (2+ días). */
export function clasificarBoletasPendientesSunat(filas, ref = new Date()) {
  const enPlazo = [];
  const porVencer = [];
  const fueraPlazo = [];
  for (const f of filas || []) {
    if (!esSinConfirmarSunat(f, ref)) continue;
    const dias = diasCalendarioTranscurridos(fechaEmisionComprobante(f), ref);
    const quedan = dias == null ? null : DIAS_PLAZO_LEGAL_RESUMEN - dias;
    const item = { ...f, dias, quedan };
    if (dias != null && dias >= DIAS_PLAZO_LEGAL_RESUMEN) fueraPlazo.push(item);
    else if (quedan != null && quedan <= DIAS_ALERTA_PLAZO_CERCANO) porVencer.push(item);
    else enPlazo.push(item);
  }
  return { enPlazo, porVencer, fueraPlazo };
}

export function listarSeriesCortas(filas, max = 4) {
  const labels = (filas || [])
    .map((f) => (f.serie && f.numero != null ? `${f.serie}-${f.numero}` : null))
    .filter(Boolean);
  if (labels.length <= max) return labels.join(', ');
  return `${labels.slice(0, max).join(', ')}…`;
}

/**
 * Cuenta filas de comprobantes_sunat.
 *
 * OJO: son DOS preguntas distintas, no una escala.
 *  - estado_envio → enviados / pendientes / error: ¿salió hacia Nubefact?
 *  - aceptada_por_sunat / plazo → aceptados y sin_confirmar: ¿SUNAT ya lo validó?
 *
 * Una boleta ENVIADA puede ser a la vez "enviada" y "sin confirmar".
 */
export function contarEstadosSunat(filas) {
  const conteo = { enviados: 0, pendientes: 0, error: 0, sin_confirmar: 0, aceptados: 0, total: 0 };
  for (const fila of filas || []) {
    const bucket = clasificarEstadoSunat(fila?.estado_envio);
    if (bucket === 'ok') conteo.enviados += 1;
    else if (bucket === 'error') conteo.error += 1;
    else conteo.pendientes += 1;
    if (esSinConfirmarSunat(fila)) conteo.sin_confirmar += 1;
    if (fila?.aceptada_por_sunat === true) conteo.aceptados += 1;
    conteo.total += 1;
  }
  return conteo;
}

const SELECT_CONTEO = 'id, id_venta, id_sucursal, estado_envio, aceptada_por_sunat, mensaje_error, fecha_envio, ventas!inner(created_at)';

/**
 * El rango se filtra por la fecha de la VENTA (no fecha_envio), para que el panel
 * coincida con el resto de los KPIs del periodo en el Dashboard.
 */
export function construirQueryComprobantesSunat(supabase, { idSucursal = null, desde = null, hasta = null } = {}) {
  let query = supabase.from('comprobantes_sunat').select(SELECT_CONTEO);
  if (idSucursal != null && idSucursal !== 'TODAS' && idSucursal !== 'todas') {
    query = query.eq('id_sucursal', idSucursal);
  }
  if (desde) query = query.gte('ventas.created_at', desde);
  if (hasta) query = query.lte('ventas.created_at', hasta);
  return query;
}

export async function contarComprobantesSunat(supabase, opciones = {}) {
  const { data, error } = await construirQueryComprobantesSunat(supabase, opciones);
  if (error) throw new Error(error.message);
  return contarEstadosSunat(data || []);
}
