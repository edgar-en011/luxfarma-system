/** Precisión de precios unitarios (costo / venta). Totales de comprobante siguen en 2 decimales. */
export const PRECIO_MAX_DECIMALES = 6

export function parsePrecio(raw) {
  if (raw === '' || raw == null) return 0
  const n = Number(String(raw).trim().replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

/** Muestra el precio tal cual cabe en JS, sin forzar 2 decimales (0.578 se queda 0.578). */
export function formatPrecioUnitario(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return '0'
  return x.toLocaleString('en-US', {
    useGrouping: false,
    maximumFractionDigits: PRECIO_MAX_DECIMALES,
  })
}

export function formatSolesUnitario(n) {
  return `S/ ${formatPrecioUnitario(n)}`
}
