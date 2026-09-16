// hoyLocal()/fechaLocalStr() — antes varias pantallas usaban
// new Date().toISOString().split('T')[0] para "la fecha de hoy", que convierte a UTC
// antes de cortar la fecha. Para Perú (UTC-5) eso rompe entre las 7:00pm y 11:59pm hora
// local: toISOString() ya reporta el día SIGUIENTE, mientras "hoy" local sigue siendo
// hoy. fechaLocalStr() arma la fecha con los componentes locales del Date (getFullYear/
// getMonth/getDate), igual al criterio que ya usaba AdminVentas.jsx.
export function fechaLocalStr(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export const hoyLocal = () => fechaLocalStr(new Date());

/** Desde/Hasta local para chips de historial y Ganancias. */
export function rangoFechasRapido(filtroRapido, ref = new Date()) {
  const hoy = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  let desde = hoy;
  let hasta = hoy;
  if (filtroRapido === 'Ayer') {
    desde = new Date(hoy);
    desde.setDate(hoy.getDate() - 1);
    hasta = new Date(desde);
  } else if (filtroRapido === 'Esta semana') {
    desde = new Date(hoy);
    desde.setDate(hoy.getDate() - 6);
    hasta = new Date(hoy);
  } else if (filtroRapido === 'Este mes') {
    desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    hasta = new Date(hoy);
  } else if (filtroRapido === 'Mes pasado') {
    desde = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
    hasta = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
  }
  return { fechaDesde: fechaLocalStr(desde), fechaHasta: fechaLocalStr(hasta) };
}

// Fechas DATE de Postgres llegan como 'YYYY-MM-DD'. new Date('YYYY-MM-DD') las interpreta
// como UTC medianoche → en Perú (UTC-5) toLocaleDateString muestra el día ANTERIOR.
// Estos helpers parsean el string en calendario local, sin pasar por UTC.
export function parseFechaISO(fecha) {
  if (!fecha) return null;
  const s = String(fecha).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]), iso: s };
}

/** Días desde "hoy" local hasta la fecha (negativo = ya pasó). */
export function diasHastaFecha(fecha, ref = new Date()) {
  const p = parseFechaISO(fecha);
  if (!p) return null;
  const target = new Date(p.y, p.m - 1, p.d);
  const base = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  return Math.round((target - base) / 86400000);
}

/** Formato dd/mm/yyyy sin desfase UTC. */
export function formatearFechaPE(fecha) {
  const p = parseFechaISO(fecha);
  if (!p) return '—';
  return `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${p.y}`;
}

/**
 * Fecha calendario razonable (permite pasadas: corrección de tipografía en lotes).
 * No usa el tope "año >= hoy" de SmartDateInput esFechaVencimiento.
 */
export function esFechaCalendarioValida(fecha) {
  const p = parseFechaISO(fecha);
  if (!p) return false;
  const dt = new Date(p.y, p.m - 1, p.d);
  if (dt.getFullYear() !== p.y || dt.getMonth() !== p.m - 1 || dt.getDate() !== p.d) return false;
  const anioAhora = new Date().getFullYear();
  if (p.y < 2000 || p.y > anioAhora + 30) return false;
  return true;
}

/** Etiqueta de hora 0–23 → "12am", "3am", "12pm", "3pm" (eje X / tooltips de gráficos). */
export function formatHora12AmPm(hora0a23) {
  const h = Math.floor(((Number(hora0a23) % 24) + 24) % 24);
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${suffix}`;
}

const TZ_PE = 'America/Lima';

/**
 * Día calendario Perú (YYYY-MM-DD) a partir de un timestamp ISO / Date.
 * No usa toISOString().slice — eso desplaza el día cerca de medianoche UTC.
 */
export function fechaCalendarioPE(createdAt) {
  if (!createdAt) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ_PE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(createdAt));
}

/** Hora 0–23 en zona Perú a partir de un timestamp. */
export function horaLocalPE(createdAt) {
  if (!createdAt) return 0;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ_PE,
    hour: 'numeric',
    hour12: false,
  }).formatToParts(new Date(createdAt));
  const raw = Number(parts.find((p) => p.type === 'hour')?.value);
  if (!Number.isFinite(raw)) return 0;
  return raw === 24 ? 0 : raw;
}

/** Bounds ISO UTC para consultar un rango de fechas calendario Perú (YYYY-MM-DD). */
export function boundsISOPeru(fechaDesde, fechaHasta) {
  const inicio = new Date(`${fechaDesde}T00:00:00-05:00`);
  const fin = new Date(`${fechaHasta}T23:59:59.999-05:00`);
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) {
    return { start: null, end: null };
  }
  return { start: inicio.toISOString(), end: fin.toISOString() };
}

export const NOMBRES_MES_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export const DIAS_SEMANA_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

/** Cantidad de días del mes (mes 1–12). */
export function diasEnMes(anio, mes1a12) {
  return new Date(anio, mes1a12, 0).getDate();
}

/** Etiqueta larga es-PE sin pasar por UTC: "viernes, 6 de marzo de 2026". */
export function formatearFechaLargaPE(yyyyMmDd) {
  const p = parseFechaISO(yyyyMmDd);
  if (!p) return '—';
  const d = new Date(p.y, p.m - 1, p.d);
  return d.toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
