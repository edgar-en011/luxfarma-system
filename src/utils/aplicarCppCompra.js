/**
 * Aplica CPP sobre lotes y producto_precios usando el stock ANTERIOR a la compra.
 * Complementa a registrar_compra (hoy en producción aún pisa el costo con la última línea
 * hasta ejecutar sql/migracion_cpp_compras.sql). Si la RPC ya calcula CPP, este paso
 * escribe el mismo número.
 */
import {
  costoPromedioPonderadoLote,
  costoPromedioPonderadoProducto,
  lineaCompraEsBonificacion,
  redondearCosto,
} from './costoPromedioPonderado.js';

/** Tras un CPP nuevo, alinea p_compra de cada forma (unidad = CPP, caja = CPP × factor). */
export async function sincronizarPCompraFormas(supabase, idProducto, costoUnidad) {
  const cpp = Number(costoUnidad) || 0;
  const { data: formas, error } = await supabase
    .from('producto_formas_venta')
    .select('id_forma, factor')
    .eq('id_producto', idProducto)
    .eq('activo', true);
  if (error) throw new Error(error.message);
  for (const f of formas || []) {
    const factor = Number(f.factor) || 1;
    const { error: errUp } = await supabase
      .from('producto_formas_venta')
      .update({ p_compra: redondearCosto(cpp * factor) })
      .eq('id_forma', f.id_forma);
    if (errUp) throw new Error(errUp.message);
  }
}

function claveLote(idProducto, idSucursal, nroLote) {
  return JSON.stringify([Number(idProducto), Number(idSucursal), String(nroLote)]);
}

function lotesDeProducto(running, idProducto) {
  const lotes = [];
  for (const [clave, st] of running) {
    const [id] = JSON.parse(clave);
    if (Number(id) !== Number(idProducto) || (Number(st.cantidad) || 0) <= 0) continue;
    lotes.push({
      cantidad_actual: st.cantidad,
      costo_unitario_lote: st.costo,
      estado: 'VIGENTE',
    });
  }
  return lotes;
}

export async function snapshotLotesParaCpp(supabase, payload) {
  const running = new Map();
  const productIds = [...new Set((payload.items || []).map((i) => Number(i.id_producto)).filter(Boolean))];
  if (!productIds.length) return running;
  const { data: lotes, error } = await supabase
    .from('inventario_lotes')
    .select('id_producto, id_sucursal, nro_lote, cantidad_actual, costo_unitario_lote')
    .in('id_producto', productIds);
  if (error) throw new Error(error.message);
  for (const lote of lotes || []) {
    running.set(claveLote(lote.id_producto, lote.id_sucursal, lote.nro_lote), {
      cantidad: Number(lote.cantidad_actual) || 0,
      costo: Number(lote.costo_unitario_lote) || 0,
    });
  }
  return running;
}

export function simularCppCompra(payload, snapshot) {
  const idSucursal = Number(payload.id_sucursal);
  const running = new Map();
  for (const [clave, st] of snapshot) {
    running.set(clave, { ...st });
  }
  const finalPorLote = new Map();
  for (const item of payload.items || []) {
    const idProducto = Number(item.id_producto);
    const nroLote = String(item.nro_lote || '');
    const clave = claveLote(idProducto, idSucursal, nroLote);
    const prev = running.get(clave) || { cantidad: 0, costo: 0 };
    const bonif = lineaCompraEsBonificacion(item);
    let costoNuevo;
    if (bonif && prev.cantidad <= 0) {
      costoNuevo = costoPromedioPonderadoProducto(lotesDeProducto(running, idProducto));
    } else {
      costoNuevo = costoPromedioPonderadoLote({
        stockActual: prev.cantidad,
        costoActual: prev.costo,
        cantidadNueva: item.cantidad,
        costoNueva: item.costo_unitario,
        bonificacion: bonif,
      });
    }
    running.set(clave, {
      cantidad: prev.cantidad + (Number(item.cantidad) || 0),
      costo: costoNuevo,
    });
    finalPorLote.set(clave, { idProducto, nroLote, costo: costoNuevo });
  }
  return { running, touched: [...finalPorLote.values()] };
}

export async function aplicarCostoPromedioPonderadoCompra(supabase, payload, snapshot) {
  const idSucursal = Number(payload.id_sucursal);
  const { running, touched } = simularCppCompra(payload, snapshot);
  for (const t of touched) {
    const { error } = await supabase
      .from('inventario_lotes')
      .update({ costo_unitario_lote: t.costo })
      .eq('id_producto', t.idProducto)
      .eq('id_sucursal', idSucursal)
      .eq('nro_lote', t.nroLote);
    if (error) throw new Error(error.message);
  }

  const productIds = [...new Set(touched.map((t) => t.idProducto))];
  for (const idProducto of productIds) {
    const cpp = costoPromedioPonderadoProducto(lotesDeProducto(running, idProducto));
    const { data: pp, error: errPp } = await supabase
      .from('producto_precios')
      .select('precio_venta')
      .eq('id_producto', idProducto)
      .limit(1)
      .maybeSingle();
    if (errPp) throw new Error(errPp.message);
    const pventa = Number(pp?.precio_venta) || 0;
    const { error: errUp } = await supabase
      .from('producto_precios')
      .update({
        costo: cpp,
        ganancia: Math.round((pventa - cpp) * 10000) / 10000,
      })
      .eq('id_producto', idProducto);
    if (errUp) throw new Error(errUp.message);
    await sincronizarPCompraFormas(supabase, idProducto, cpp);
  }
}
