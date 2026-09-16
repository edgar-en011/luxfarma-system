import { supabase } from '../supabaseClient';
import { calcularProductosStockBajo, cargarIdsProductosConMovimiento } from './stockBajo';
import { diasHastaFecha } from './fechas';
import { estaPorVencer } from './umbralesVencimiento';

/**
 * Alertas operativas para Mi Caja (Vendedor / Admin con turno).
 * Filtrado a una sucursal. Distinto de AdminAlertas: sin compra ni retiro.
 *
 * @returns {Promise<Array<{
 *   tipo: 'stock'|'vencido',
 *   producto: string,
 *   titulo: string,
 *   detalle: string,
 *   badge: string,
 *   id_producto: number,
 *   accion: 'ticket'|null
 * }>>}
 */
export async function cargarAlertasMiCaja(idSucursal) {
  if (idSucursal == null) return [];

  const { data: lotes, error: errLotes } = await supabase
    .from('inventario_lotes')
    .select('id_lote, id_producto, id_sucursal, cantidad_actual, estado, fecha_vencimiento, nro_lote')
    .eq('id_sucursal', idSucursal)
    .in('estado', ['VIGENTE', 'VENCIDO', 'AGOTADO']);
  if (errLotes) throw errLotes;

  const idsProducto = [...new Set((lotes || []).map((l) => l.id_producto).filter((id) => id != null))];
  if (idsProducto.length === 0) return [];

  const { data: productos, error: errProd } = await supabase
    .from('productos')
    .select('id_producto, descripcion, stock_minimo')
    .in('id_producto', idsProducto)
    .eq('activo', 1);
  if (errProd) throw errProd;

  const alertas = [];
  const productosPorId = new Map((productos || []).map((p) => [Number(p.id_producto), p]));
  const idsMovimiento = await cargarIdsProductosConMovimiento();
  const stockBajo = calcularProductosStockBajo(productos, lotes, idsMovimiento);

  for (const item of stockBajo) {
    const nombre = item.producto?.descripcion || `Producto #${item.id_producto}`;
    const sinStock = item.stockTotal <= 0;
    alertas.push({
      tipo: 'stock',
      producto: nombre,
      titulo: sinStock ? 'Sin stock' : 'Stock bajo',
      detalle: sinStock
        ? 'Sin unidades disponibles en tu sucursal.'
        : `Quedan ${item.stockTotal} und. (mínimo ${item.umbral}).`,
      badge: sinStock ? 'SIN STOCK' : 'BAJO',
      id_producto: item.id_producto,
      accion: 'ticket',
    });
  }

  // 2) Por vencer: 60 / 30 / 15 / 5 / 1 + ya vencido
  for (const lote of lotes || []) {
    if (lote.estado !== 'VIGENTE') continue;
    if (Number(lote.cantidad_actual) <= 0) continue;
    const dias = diasHastaFecha(lote.fecha_vencimiento);
    if (!estaPorVencer(dias)) continue;
    const prod = productosPorId.get(Number(lote.id_producto));
    if (!prod) continue;
    alertas.push({
      tipo: 'vencido',
      producto: prod.descripcion || `Producto #${lote.id_producto}`,
      titulo: 'Por vencer pronto',
      detalle: `Lote ${lote.nro_lote || '—'} · Vence en ${dias} día${dias === 1 ? '' : 's'} · ${Number(lote.cantidad_actual)} und.`,
      badge: `${dias}d`,
      id_producto: lote.id_producto,
      accion: null,
    });
  }

  // Prioridad: sin/bajo stock primero, luego por vencer (menos días primero)
  alertas.sort((a, b) => {
    if (a.tipo !== b.tipo) return a.tipo === 'stock' ? -1 : 1;
    if (a.tipo === 'vencido') {
      const da = parseInt(a.badge, 10) || 99;
      const db = parseInt(b.badge, 10) || 99;
      return da - db;
    }
    return a.producto.localeCompare(b.producto, 'es');
  });

  return alertas.slice(0, 25);
}
