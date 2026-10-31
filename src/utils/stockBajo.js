import { supabase } from '../supabaseClient';
import { loteDisponible, cantidadLote } from './stockLotes.js';

// Criterio único de stock bajo (campana + Alertas + Inventario + Pedidos +
// Mi Caja + Dashboard): stock_minimo si está configurado (> 0); si no, 3.
// Solo productos con movimiento Y al menos un lote (RPC). Un kardex suelto
// de prueba sin lote no alerta; un producto agotado (lotes AGOTADO) sí.
export const UMBRAL_FALLBACK = 3;

const CACHE_MOVIMIENTO_MS = 120_000;
let cacheMovimiento = { at: 0, ids: null, inflight: null };

export function umbralStockBajo(stockMinimo) {
  const n = Number(stockMinimo) || 0;
  return n > 0 ? n : UMBRAL_FALLBACK;
}

function setDeIds(idsConMovimiento) {
  if (idsConMovimiento instanceof Set) return idsConMovimiento;
  return new Set([...(idsConMovimiento || [])].map(Number).filter((n) => Number.isFinite(n)));
}

/**
 * Suma solo lotes VIGENTE. Incluye stock 0 si el producto ya se usó y no
 * tiene vigente. Sin ids de movimiento no alerta (evita el catálogo virgen).
 */
export function calcularProductosStockBajo(productos, lotes, idsConMovimiento) {
  const permitidos = setDeIds(idsConMovimiento);
  if (permitidos.size === 0) return [];

  const mapa = {};
  for (const lote of (lotes || [])) {
    if (!loteDisponible(lote)) continue;
    const id = Number(lote.id_producto);
    if (!permitidos.has(id)) continue;
    const key = `${id}-${lote.id_sucursal ?? ''}`;
    if (!mapa[key]) {
      mapa[key] = { id_producto: lote.id_producto, id_sucursal: lote.id_sucursal ?? null, stockTotal: 0 };
    }
    mapa[key].stockTotal += cantidadLote(lote);
  }

  const productosPorId = new Map((productos || []).map((p) => [Number(p.id_producto), p]));
  const idsConFila = new Set(Object.values(mapa).map((i) => Number(i.id_producto)));

  for (const p of (productos || [])) {
    const id = Number(p.id_producto);
    if (!permitidos.has(id) || idsConFila.has(id)) continue;
    mapa[`${id}-`] = { id_producto: p.id_producto, id_sucursal: null, stockTotal: 0 };
  }

  return Object.values(mapa)
    .map((item) => {
      const producto = productosPorId.get(Number(item.id_producto));
      const umbral = umbralStockBajo(producto?.stock_minimo);
      return { ...item, umbral, producto };
    })
    .filter((item) => permitidos.has(Number(item.id_producto)) && item.stockTotal <= item.umbral);
}

/** Lote más reciente: created_at; si no hay fecha, id_lote (serial). */
function ordenLoteReciente(a, b) {
  const ta = Date.parse(a?.created_at || '') || 0;
  const tb = Date.parse(b?.created_at || '') || 0;
  if (tb !== ta) return tb - ta;
  return (Number(b?.id_lote) || 0) - (Number(a?.id_lote) || 0);
}

/**
 * Sede de un producto sin lote vigente: último lote (cualquier estado/cantidad).
 * Si no hay lotes y hay exactamente una sede activa, esa. Si no, null (omitir).
 */
export function resolverIdSucursalProducto(idProducto, lotes, sucursalesActivas) {
  const id = Number(idProducto);
  if (!Number.isFinite(id)) return null;

  const candidatos = (lotes || []).filter((l) => (
    Number(l.id_producto) === id
    && l.id_sucursal != null
    && l.id_sucursal !== ''
  ));
  if (candidatos.length > 0) {
    const elegido = [...candidatos].sort(ordenLoteReciente)[0];
    const n = Number(elegido.id_sucursal);
    return Number.isFinite(n) ? n : null;
  }

  const activas = (sucursalesActivas || []).filter((s) => s?.id_sucursal != null && s.id_sucursal !== '');
  if (activas.length === 1) {
    const n = Number(activas[0].id_sucursal);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Lotes de respaldo (incluye AGOTADO / 0 und) para resolver sede. */
export async function cargarLotesParaSede(idsProducto) {
  const ids = [...new Set((idsProducto || []).map(Number).filter(Number.isFinite))];
  if (ids.length === 0) return [];

  const intento = await supabase
    .from('inventario_lotes')
    .select('id_producto, id_sucursal, id_lote, created_at')
    .in('id_producto', ids)
    .order('id_lote', { ascending: false });
  if (!intento.error) return intento.data || [];

  const retry = await supabase
    .from('inventario_lotes')
    .select('id_producto, id_sucursal, id_lote')
    .in('id_producto', ids)
    .order('id_lote', { ascending: false });
  if (retry.error) {
    console.warn('lotes para sede:', retry.error.message);
    return [];
  }
  return retry.data || [];
}

/** Distinct en la base (índices + UNION). No baja el kardex al cliente. */
export async function cargarIdsProductosConMovimiento() {
  const ahora = Date.now();
  if (cacheMovimiento.ids && (ahora - cacheMovimiento.at) < CACHE_MOVIMIENTO_MS) {
    return cacheMovimiento.ids;
  }
  if (cacheMovimiento.inflight) return cacheMovimiento.inflight;

  cacheMovimiento.inflight = (async () => {
    const { data, error } = await supabase.rpc('ids_productos_con_movimiento');
    if (error) {
      console.warn('ids_productos_con_movimiento:', error.message);
      cacheMovimiento.inflight = null;
      return new Set();
    }
    const ids = new Set((data || []).map((r) => Number(r.id_producto ?? r)).filter((n) => Number.isFinite(n)));
    cacheMovimiento = { at: Date.now(), ids, inflight: null };
    return ids;
  })();

  return cacheMovimiento.inflight;
}
