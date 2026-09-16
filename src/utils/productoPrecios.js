/**
 * Normaliza el embed de producto_precios desde PostgREST/Supabase.
 * Con UNIQUE(id_producto) llega como objeto; sin unique llega como array.
 * Usar esto en lecturas de UI para no mostrar S/ 0.00 por acceder a [0] sobre un objeto.
 */
export function filaProductoPrecios(productoPrecios) {
  if (productoPrecios == null) return null;
  return Array.isArray(productoPrecios) ? (productoPrecios[0] ?? null) : productoPrecios;
}

/**
 * Margen de una venta: Σ (subtotal − costo × unidades base).
 * Prefiere venta_detalle.costo_unitario (snapshot al cobrar).
 * Si falta (ventas viejas), cae al costo actual de catálogo.
 */
export function gananciaDesdeDetallesVenta(detalles) {
  return (detalles || []).reduce((acc, d) => {
    const snap = d.costo_unitario;
    const fp = filaProductoPrecios(d.productos?.producto_precios);
    const costoUnit = (snap != null && snap !== '')
      ? Number(snap) || 0
      : Number(fp?.costo || 0);
    const unidadesBase = Number(d.cantidad || 0) * (Number(d.factor) || 1);
    return acc + (Number(d.subtotal || 0) - costoUnit * unidadesBase);
  }, 0);
}
