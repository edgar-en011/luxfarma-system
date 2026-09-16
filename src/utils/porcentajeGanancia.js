/**
 * % de ganancia sobre el COSTO (no sobre el precio de venta).
 *
 *   ganancia   = precio_venta − precio_compra
 *   porcentaje = (ganancia / precio_compra) × 100
 *
 * Devuelve null si falta el costo, es 0 (bonificación) o falta el precio
 * de venta — el caller muestra "—" para no fingir un 0% engañoso.
 */
export function porcentajeGanancia(precioVenta, precioCompra) {
  const venta = Number(precioVenta)
  const compra = Number(precioCompra)
  if (!Number.isFinite(venta) || !Number.isFinite(compra)) return null
  if (compra <= 0 || venta <= 0) return null
  return ((venta - compra) / compra) * 100
}

/** Texto para UI: `103.610%` o `—`. */
export function formatearPorcentajeGanancia(precioVenta, precioCompra) {
  const pct = porcentajeGanancia(precioVenta, precioCompra)
  if (pct == null) return '—'
  return `${pct.toFixed(3)}%`
}
