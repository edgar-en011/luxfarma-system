/**
 * PASO 2 — reset de producción Julcán.
 * Confirmado por el usuario. No toca productos, proveedores,
 * series_correlativos ni configuración Nubefact.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

const PK = {
  comprobantes_sunat: 'id',
  comprobantes_electronicos: 'id',
  kardex_movimientos: 'id_movimiento',
  pagos_venta: 'id_pago',
  venta_detalle: 'id_detalle',
  ventas: 'id_venta',
  pagos_compra: 'id_pago',
  compra_detalle: 'id_detalle',
  compras: 'id_compra',
  producto_codigos_proveedor: 'id',
  clientes: 'id_cliente',
  pedido_proveedor_detalle: 'id_detalle',
  pedidos_proveedor: 'id_pedido',
  inventario_conteos: 'id_conteo',
  inventario_sesiones: 'id_sesion',
  notas_inventario: 'id_nota',
  notificaciones: 'id',
  tickets_soporte: 'id_ticket',
  ventas_perdidas: 'id',
  caja_turnos: 'id_turno',
  inventario_lotes: 'id_lote',
  sucursales: 'id_sucursal',
};

async function count(tabla) {
  const { count: n, error } = await supabase.from(tabla).select('*', { count: 'exact', head: true });
  if (error) return { error: error.message, filas: null };
  return { filas: n ?? 0 };
}

async function descubrirPk(tabla) {
  if (PK[tabla]) return PK[tabla];
  const { data, error } = await supabase.from(tabla).select('*').limit(1);
  if (error || !data?.[0]) return null;
  const keys = Object.keys(data[0]);
  return keys.find((k) => k === 'id' || k.startsWith('id_')) || keys[0];
}

async function deleteAll(tabla) {
  const antes = await count(tabla);
  if (antes.error) return { tabla, ok: false, error: antes.error, antes: null, despues: null };
  if (antes.filas === 0) return { tabla, ok: true, antes: 0, despues: 0, metodo: 'vacia' };

  let pk = await descubrirPk(tabla);
  let total = 0;
  for (let i = 0; i < 40; i++) {
    const { data, error: errSel } = await supabase.from(tabla).select(pk || '*').limit(500);
    if (errSel) {
      const alt = Object.keys((await supabase.from(tabla).select('*').limit(1)).data?.[0] || {});
      pk = alt.find((k) => k === 'id' || k.startsWith('id_')) || alt[0];
      if (!pk) return { tabla, ok: false, error: errSel.message, antes: antes.filas };
      continue;
    }
    if (!data?.length) break;
    if (!pk) pk = Object.keys(data[0]).find((k) => k === 'id' || k.startsWith('id_')) || Object.keys(data[0])[0];
    const ids = data.map((r) => r[pk]).filter((v) => v != null);
    if (!ids.length) return { tabla, ok: false, error: `sin ids (${pk})`, antes: antes.filas };
    const { error } = await supabase.from(tabla).delete().in(pk, ids);
    if (error) return { tabla, ok: false, error: error.message, pk, antes: antes.filas, borradas: total };
    total += ids.length;
  }
  const despues = await count(tabla);
  return {
    tabla,
    ok: !despues.error && despues.filas === 0,
    pk,
    antes: antes.filas,
    despues: despues.filas,
    error: despues.error || (despues.filas === 0 ? null : `quedaron ${despues.filas}`),
  };
}

const log = [];
function report(step) {
  log.push(step);
  console.log(JSON.stringify(step));
}

const ordenBorrado = [
  'comprobantes_sunat',
  'comprobantes_electronicos',
  'kardex_movimientos',
  'pagos_venta',
  'venta_detalle',
  'ventas',
  'pagos_compra',
  'compra_detalle',
  'compras',
  'producto_codigos_proveedor',
  'clientes',
  'pedido_proveedor_detalle',
  'pedidos_proveedor',
  'inventario_conteos',
  'inventario_sesiones',
  'notas_inventario',
  'notificaciones',
  'tickets_soporte',
  'ventas_perdidas',
];

for (const tabla of ordenBorrado) {
  report(await deleteAll(tabla));
}

const cierre = await supabase
  .from('caja_turnos')
  .update({ estado: 'CERRADO', cierre_at: new Date().toISOString() })
  .eq('id_turno', 47)
  .select('id_turno, estado, cierre_at');
report({ accion: 'cerrar_turno_47', ok: !cierre.error, data: cierre.data, error: cierre.error?.message });

report(await deleteAll('caja_turnos'));

const desact = await supabase
  .from('usuarios')
  .update({ activo: false })
  .in('id_usuario', [2, 6])
  .select('id_usuario, nombres, apellidos, activo');
report({ accion: 'desactivar_usuarios', ok: !desact.error, data: desact.data, error: desact.error?.message });

const lote2 = await supabase.from('inventario_lotes').delete().eq('id_lote', 5).select('id_lote');
report({ accion: 'borrar_lote_trujillo', ok: !lote2.error, data: lote2.data, error: lote2.error?.message });

const suc2 = await supabase.from('sucursales').delete().eq('id_sucursal', 2).select('id_sucursal, nombre_comercial');
report({ accion: 'borrar_sucursal_trujillo', ok: !suc2.error, data: suc2.data, error: suc2.error?.message });

const stock0 = await supabase
  .from('inventario_lotes')
  .update({ cantidad_actual: 0, estado: 'AGOTADO' })
  .eq('id_sucursal', 1)
  .gt('id_lote', 0)
  .select('id_lote');
const lotesJulcan = await count('inventario_lotes');
const { data: stockCheck } = await supabase
  .from('inventario_lotes')
  .select('cantidad_actual')
  .eq('id_sucursal', 1)
  .gt('cantidad_actual', 0);
report({
  accion: 'stock_julcan_cero',
  ok: !stock0.error && (stockCheck || []).length === 0,
  filas_actualizadas: (stock0.data || []).length,
  lotes_restantes: lotesJulcan.filas,
  lotes_con_stock: (stockCheck || []).length,
  error: stock0.error?.message,
});

const corr = await supabase
  .from('correlativos_venta_interna')
  .update({ ultimo_numero: 0 })
  .gt('id', 0)
  .select('id, serie, ultimo_numero');
report({ accion: 'reset_correlativos_interna', ok: !corr.error, data: corr.data, error: corr.error?.message });

const verificacionTablas = [
  ...ordenBorrado,
  'caja_turnos',
  'comprobantes_sunat',
  'productos',
  'proveedores',
  'series_correlativos',
  'sucursales',
  'usuarios',
  'inventario_lotes',
  'correlativos_venta_interna',
  'configuracion',
];
const verificacion = {};
for (const t of verificacionTablas) verificacion[t] = await count(t);

const { data: users } = await supabase
  .from('usuarios')
  .select('id_usuario, nombres, apellidos, dni, id_rol, activo, id_sucursal');
const { data: sucs } = await supabase.from('sucursales').select('id_sucursal, nombre_comercial, activo');
const { data: series } = await supabase.from('series_correlativos').select('serie, ultimo_numero, id_sucursal');
const { data: internas } = await supabase.from('correlativos_venta_interna').select('serie, ultimo_numero');

console.log('===VERIFICACION===');
console.log(JSON.stringify({ verificacion, users, sucs, series, internas }, null, 2));
