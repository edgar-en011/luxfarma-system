/**
 * Snapshot de costo de catálogo (unidad base) al cobrar.
 * Online: producto_precios en el momento del cobro.
 * Offline: catálogo local — nunca el costo de cuando se sincroniza.
 */
import { supabase } from '../supabaseClient';
import { filaProductoPrecios } from './productoPrecios';
import { obtenerCostosCatalogoLocal } from './offlineStore';

export function costoCatalogoUnidadBase(producto) {
  const fp = filaProductoPrecios(producto?.producto_precios);
  const n = Number(fp?.costo ?? producto?.costo);
  return Number.isFinite(n) ? n : null;
}

export async function estamparCostoSnapshotCarrito(carrito, { isOnline = true } = {}) {
  const lista = carrito || [];
  const ids = [...new Set(lista.map((i) => Number(i.id_producto)).filter(Boolean))];
  const costos = new Map();

  if (isOnline && ids.length) {
    const { data, error } = await supabase
      .from('producto_precios')
      .select('id_producto, costo')
      .in('id_producto', ids);
    if (error) throw new Error(error.message);
    for (const row of data || []) {
      costos.set(Number(row.id_producto), Number(row.costo) || 0);
    }
  } else if (ids.length) {
    const locales = await obtenerCostosCatalogoLocal(ids);
    for (const [id, costo] of locales) costos.set(id, costo);
    for (const item of lista) {
      const id = Number(item.id_producto);
      if (costos.has(id)) continue;
      const ya = item.costo_unitario;
      if (ya != null && ya !== '') {
        costos.set(id, Number(ya) || 0);
        continue;
      }
      const deProd = costoCatalogoUnidadBase(item);
      if (deProd != null) costos.set(id, deProd);
    }
  }

  return lista.map((item) => ({
    ...item,
    costo_unitario: costos.has(Number(item.id_producto))
      ? Number(costos.get(Number(item.id_producto)))
      : (item.costo_unitario ?? null),
  }));
}
