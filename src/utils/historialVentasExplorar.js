import {
  boundsISOPeru,
  diasEnMes,
  fechaCalendarioPE,
  fechaLocalStr,
  horaLocalPE,
  hoyLocal,
  NOMBRES_MES_ES,
} from './fechas';

export const SELECT_VENTA_LIGERA =
  'id_venta, total, created_at, id_usuario_vendedor, id_sucursal, estado_anulacion';

export const SELECT_VENTA_COMPLETA =
  'id_venta, serie, correlativo, total, created_at, tipo_comprobante, id_sucursal, id_usuario_vendedor, id_turno, id_cliente, estado_sunat, estado_anulacion, pagos_venta(metodo, monto), clientes(nombre_razon_social, nombres, apellidos), venta_detalle(cantidad, subtotal, factor, costo_unitario, productos(producto_precios(costo))), comprobantes_sunat(serie, numero)';

const PAGE = 1000;

/**
 * Trae ventas ligeras de un rango calendario PE, paginando de 1000 en 1000.
 * Filtros opcionales de sucursal/vendedor se aplican en query.
 */
export async function fetchVentasLigeras(supabase, { fechaDesde, fechaHasta, idSucursal = null, idVendedor = null }) {
  const { start, end } = boundsISOPeru(fechaDesde, fechaHasta);
  if (!start || !end) return [];

  const all = [];
  let from = 0;
  for (;;) {
    let q = supabase
      .from('ventas')
      .select(SELECT_VENTA_LIGERA)
      .gte('created_at', start)
      .lte('created_at', end)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (idSucursal != null && idSucursal !== 'todas') q = q.eq('id_sucursal', Number(idSucursal));
    if (idVendedor != null && idVendedor !== 'todos') q = q.eq('id_usuario_vendedor', Number(idVendedor));

    const { data, error } = await q;
    if (error) throw error;
    const chunk = data || [];
    all.push(...chunk);
    if (chunk.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

/** Primera fecha de venta (YYYY-MM-DD PE) o null si no hay registros. */
export async function fetchPrimeraFechaVenta(supabase) {
  const { data, error } = await supabase
    .from('ventas')
    .select('created_at')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.created_at) return null;
  return fechaCalendarioPE(data.created_at);
}

export function esVentaContable(v) {
  return v.estado_anulacion !== 'ANULADO';
}

/** Totales por día calendario PE. Incluye días con 0 si se pasa `diasIso[]`. */
export function agregarPorDia(ventas, diasIso = null) {
  const map = new Map();
  const ensure = (iso) => {
    if (!map.has(iso)) map.set(iso, { fecha: iso, total: 0, operaciones: 0 });
    return map.get(iso);
  };
  if (diasIso) diasIso.forEach((d) => ensure(d));

  for (const v of ventas || []) {
    const dia = fechaCalendarioPE(v.created_at);
    if (!dia) continue;
    if (diasIso && !map.has(dia)) continue;
    const row = ensure(dia);
    if (!esVentaContable(v)) continue;
    row.total += Number(v.total || 0);
    row.operaciones += 1;
  }

  if (diasIso) return diasIso.map((d) => map.get(d));
  return [...map.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/** Lista YYYY-MM-DD de todos los días de un mes (mes 1–12). */
export function listaDiasIsoDelMes(anio, mes1a12) {
  const n = diasEnMes(anio, mes1a12);
  const mm = String(mes1a12).padStart(2, '0');
  return Array.from({ length: n }, (_, i) => `${anio}-${mm}-${String(i + 1).padStart(2, '0')}`);
}

/**
 * Agrega totales por hora (0–23) y vendedor.
 * Retorna { horas: [{ hora, label, ...porVendedorId, total }], vendedores: [{ id, total }] }
 */
export function agregarPorHoraYVendedor(ventas, formatHoraLabel) {
  const horas = Array.from({ length: 24 }, (_, hora) => {
    const row = { hora, label: formatHoraLabel(hora), total: 0 };
    return row;
  });
  const vendMap = new Map();

  for (const v of ventas || []) {
    if (!esVentaContable(v)) continue;
    const h = horaLocalPE(v.created_at);
    const id = v.id_usuario_vendedor;
    const monto = Number(v.total || 0);
    const key = `v_${id}`;
    horas[h][key] = (horas[h][key] || 0) + monto;
    horas[h].total += monto;
    if (!vendMap.has(id)) vendMap.set(id, { id, total: 0 });
    vendMap.get(id).total += monto;
  }

  const vendedores = [...vendMap.values()].sort((a, b) => b.total - a.total);
  return { horas, vendedores };
}

export function agregarPorAnio(ventas) {
  const map = new Map();
  for (const v of ventas || []) {
    if (!esVentaContable(v)) continue;
    const dia = fechaCalendarioPE(v.created_at);
    if (!dia) continue;
    const anio = Number(dia.slice(0, 4));
    if (!map.has(anio)) map.set(anio, { anio, total: 0, operaciones: 0 });
    const row = map.get(anio);
    row.total += Number(v.total || 0);
    row.operaciones += 1;
  }
  return [...map.values()].sort((a, b) => b.anio - a.anio);
}

export function agregarPorMes(ventas, anio) {
  const map = new Map();
  for (let m = 1; m <= 12; m += 1) map.set(m, { mes: m, anio, total: 0, operaciones: 0 });
  for (const v of ventas || []) {
    if (!esVentaContable(v)) continue;
    const dia = fechaCalendarioPE(v.created_at);
    if (!dia || !dia.startsWith(`${anio}-`)) continue;
    const mes = Number(dia.slice(5, 7));
    const row = map.get(mes);
    row.total += Number(v.total || 0);
    row.operaciones += 1;
  }
  return [...map.values()];
}

export function kpisDesdeVentasLigeras(ventas) {
  const activas = (ventas || []).filter(esVentaContable);
  const total = activas.reduce((s, v) => s + Number(v.total || 0), 0);
  const operaciones = activas.length;
  return {
    total,
    operaciones,
    ticketPromedio: operaciones > 0 ? total / operaciones : 0,
  };
}

/** Rango ISO del mes calendario PE. */
export function rangoMes(anio, mes1a12) {
  const mm = String(mes1a12).padStart(2, '0');
  const ultimo = diasEnMes(anio, mes1a12);
  return {
    fechaDesde: `${anio}-${mm}-01`,
    fechaHasta: `${anio}-${mm}-${String(ultimo).padStart(2, '0')}`,
  };
}

export function rangoAnio(anio) {
  return { fechaDesde: `${anio}-01-01`, fechaHasta: `${anio}-12-31` };
}

export function anioMesActualLocal() {
  const hoy = hoyLocal();
  return { anio: Number(hoy.slice(0, 4)), mes: Number(hoy.slice(5, 7)) };
}

export function itemsMesesDesdeAgregado(mesesAgregados) {
  return (mesesAgregados || []).map((m) => ({
    key: m.mes,
    label: NOMBRES_MES_ES[m.mes - 1],
    total: m.total,
    operaciones: m.operaciones,
    mes: m.mes,
    anio: m.anio,
  }));
}

export function itemsAniosDesdeAgregado(aniosAgregados) {
  return (aniosAgregados || []).map((a) => ({
    key: a.anio,
    label: String(a.anio),
    total: a.total,
    operaciones: a.operaciones,
    anio: a.anio,
  }));
}

export { fechaLocalStr, hoyLocal };
