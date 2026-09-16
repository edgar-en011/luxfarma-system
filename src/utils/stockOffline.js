/**
 * Validación de stock offline en UNIDADES BASE (inventario físico).
 * stock_disponible del carrito está en unidades de venta (floor(base / factor));
 * no se debe comparar contra cantidad * factor.
 */

export function unidadesBaseDeLinea(item) {
  if (!item) return 0;
  return (Number(item.cantidad) || 0) * (Number(item.factor) || 1);
}

export function stockBaseDelItem(item) {
  const raw = item?.stock_total;
  if (raw != null && raw !== '') {
    const total = Number(raw);
    if (Number.isFinite(total) && total >= 0) return total;
  }
  const venta = Number(item?.stock_disponible) || 0;
  const factor = Number(item?.factor) || 1;
  return venta * factor;
}

export function reservadoBaseEnCola(pendientesCola, idProducto) {
  return (pendientesCola || []).reduce((suma, venta) => {
    const lineas = (venta.carrito || []).filter((c) => c.id_producto === idProducto);
    return suma + lineas.reduce((s, c) => s + unidadesBaseDeLinea(c), 0);
  }, 0);
}

export function validarStockOfflineItem(item, pendientesCola, carrito = null) {
  const factor = Number(item?.factor) || 1;
  const stockBase = stockBaseDelItem(item);
  const reservadoEnCola = reservadoBaseEnCola(pendientesCola, item.id_producto);
  const hermanos = (carrito && carrito.length)
    ? carrito.filter((c) => Number(c.id_producto) === Number(item.id_producto))
    : [item];
  const necesario = hermanos.reduce((suma, c) => suma + unidadesBaseDeLinea(c), 0);
  const stockVirtual = stockBase - reservadoEnCola;
  const quedanVenta = Math.floor(Math.max(0, stockVirtual) / factor);
  return {
    ok: necesario <= stockVirtual,
    stockBase,
    reservadoEnCola,
    necesario,
    stockVirtual,
    quedanVenta,
    factor,
  };
}

/** Una sola pasada por producto: suma caja + unidades del mismo id. */
export function validarStockOfflineCarrito(carrito, pendientesCola) {
  const vistos = new Set();
  for (const item of carrito || []) {
    const id = Number(item.id_producto);
    if (vistos.has(id)) continue;
    vistos.add(id);
    const chequeo = validarStockOfflineItem(item, pendientesCola, carrito);
    if (!chequeo.ok) return { ok: false, item, chequeo };
  }
  return { ok: true };
}

export function mensajeStockOfflineInsuficiente(item, v) {
  const modo = item.modo_venta || 'unidad(es)';
  return `"${item.producto}" no tiene stock suficiente para vender offline. `
    + `El ticket pide ${v.necesario} uds. base; `
    + `${v.reservadoEnCola > 0 ? `${v.reservadoEnCola} uds. ya están en ventas pendientes. ` : ''}`
    + `Quedan ${Math.max(0, v.stockVirtual)} uds. base (${v.quedanVenta} ${modo} de esta forma).`;
}
