/**
 * Costo Promedio Ponderado (CPP) de lotes y del costo de catálogo.
 * La RPC registrar_compra aplica la misma fórmula en Postgres (NUMERIC exacto).
 */
import { PRECIO_MAX_DECIMALES } from './precioExacto.js';

export function redondearCosto(n) {
  const f = 10 ** PRECIO_MAX_DECIMALES;
  return Math.round((Number(n) || 0) * f) / f;
}

/** Bonificación explícita o costo 0.00 (regalo). Un costo real de 0.10 SÍ promedia. */
export function lineaCompraEsBonificacion(item) {
  if (item?.bonificacion === true) return true;
  return (Number(item?.costo_unitario) || 0) <= 0;
}

export function costoPromedioPonderadoLote({
  stockActual = 0,
  costoActual = 0,
  cantidadNueva = 0,
  costoNueva = 0,
  bonificacion = false,
} = {}) {
  const stock = Number(stockActual) || 0;
  const qty = Number(cantidadNueva) || 0;
  const costoOld = Number(costoActual) || 0;
  const costoNew = Number(costoNueva) || 0;
  if (qty <= 0) return redondearCosto(costoOld);
  if (bonificacion || costoNew <= 0) return redondearCosto(costoOld);
  if (stock <= 0) return redondearCosto(costoNew);
  return redondearCosto((stock * costoOld + qty * costoNew) / (stock + qty));
}

/** Promedio de todo el stock VIGENTE del producto (todos los lotes / sucursales). */
export function costoPromedioPonderadoProducto(lotes = []) {
  let num = 0;
  let den = 0;
  for (const lote of lotes) {
    if (String(lote?.estado || 'VIGENTE').toUpperCase() !== 'VIGENTE') continue;
    const qty = Number(lote.cantidad_actual) || 0;
    if (qty <= 0) continue;
    num += qty * (Number(lote.costo_unitario_lote) || 0);
    den += qty;
  }
  if (den <= 0) return 0;
  return redondearCosto(num / den);
}
