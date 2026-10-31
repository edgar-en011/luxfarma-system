import { fechaLocalStr } from './fechas.js';

export function cantidadLote(lote) {
  const cantidad = Number(lote?.cantidad_actual);
  return Number.isFinite(cantidad) ? Math.max(0, cantidad) : 0;
}

export function estadoStockLote(lote, fecha = new Date()) {
  const vence = String(lote?.fecha_vencimiento || '').slice(0, 10);
  if (lote?.estado === 'VENCIDO' || (vence && vence < fechaLocalStr(fecha))) return 'VENCIDO';
  return lote?.estado || null;
}

export function loteDisponible(lote, fecha = new Date()) {
  return estadoStockLote(lote, fecha) === 'VIGENTE' && cantidadLote(lote) > 0;
}

export function resumirStockLotes(lotes = [], fecha = new Date()) {
  return (lotes || []).reduce((resumen, lote) => {
    const estado = estadoStockLote(lote, fecha);
    const cantidad = cantidadLote(lote);
    if (estado === 'VIGENTE') resumen.disponible += cantidad;
    else if (estado === 'VENCIDO') resumen.vencido += cantidad;
    return resumen;
  }, { disponible: 0, vencido: 0 });
}

export function construirActualizacionesStock(productos, lotes, fecha = new Date()) {
  const lotesPorProducto = new Map();
  for (const lote of lotes || []) {
    const id = Number(lote.id_producto);
    if (!Number.isFinite(id)) continue;
    const grupo = lotesPorProducto.get(id) || [];
    grupo.push(lote);
    lotesPorProducto.set(id, grupo);
  }
  return (productos || []).map((producto) => {
    const resumen = resumirStockLotes(lotesPorProducto.get(Number(producto.id_producto)) || [], fecha);
    return { id_producto: producto.id_producto, totalStock: resumen.disponible, stockVencido: resumen.vencido };
  });
}
