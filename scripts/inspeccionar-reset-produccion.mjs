/**
 * Solo lectura: inventario para el reset de producción.
 * No borra ni actualiza nada.
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

async function count(tabla, filtros = {}) {
  let q = supabase.from(tabla).select('*', { count: 'exact', head: true });
  for (const [k, v] of Object.entries(filtros)) {
    if (v === '__not_null') q = q.not(k, 'is', null);
    else q = q.eq(k, v);
  }
  const { count: n, error } = await q;
  if (error) return { tabla, ok: false, error: error.message, filas: null };
  return { tabla, ok: true, filas: n ?? 0 };
}

async function rows(tabla, select, order) {
  let q = supabase.from(tabla).select(select);
  if (order) q = q.order(order);
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message, data: [] };
  return { ok: true, data: data || [] };
}

const [usuarios, roles, sucursales] = await Promise.all([
  rows('usuarios', 'id_usuario, nombres, apellidos, dni, id_rol, id_sucursal, activo, email, telefono', 'id_usuario'),
  rows('roles', '*'),
  rows('sucursales', '*', 'id_sucursal'),
]);

const tablas = [
  'ventas', 'venta_detalle', 'pagos_venta',
  'compras', 'compra_detalle', 'pagos_compra',
  'comprobantes_sunat', 'comprobantes_electronicos',
  'kardex_movimientos',
  'caja_turnos',
  'inventario_lotes',
  'producto_codigos_proveedor',
  'clientes',
  'pedidos_proveedor', 'pedido_proveedor_detalle',
  'inventario_sesiones', 'inventario_conteos',
  'notas_inventario',
  'tickets_soporte', 'notificaciones',
  'ventas_perdidas',
  'notas_credito', 'nota_credito_detalle',
  'correlativos_venta_interna',
  'series_correlativos',
  'series_sunat',
  'configuracion',
];

const conteos = [];
for (const t of tablas) conteos.push(await count(t));

const turnos = await rows(
  'caja_turnos',
  'id_turno, id_sucursal, id_usuario_vendedor, estado, apertura_at, cierre_at, monto_apertura',
  'id_turno',
);

const ventasPorSuc = await supabase.from('ventas').select('id_sucursal');
const comprasPorSuc = await supabase.from('compras').select('id_sucursal');
const lotes = await supabase
  .from('inventario_lotes')
  .select('id_lote, id_sucursal, id_producto, cantidad_actual, estado, nro_lote');
const kardexTipos = await supabase.from('kardex_movimientos').select('tipo, id_sucursal');
const pcp = await rows('producto_codigos_proveedor', 'id, id_producto, id_proveedor, codigo_proveedor');

function agrupar(lista, key) {
  const m = {};
  for (const r of lista || []) {
    const k = r[key] ?? 'null';
    m[k] = (m[k] || 0) + 1;
  }
  return m;
}

function stockPorSucursal(lista) {
  const m = {};
  for (const r of lista || []) {
    const k = r.id_sucursal ?? 'null';
    if (!m[k]) m[k] = { lotes: 0, lotesConStock: 0, unidades: 0, vigentes: 0 };
    m[k].lotes += 1;
    const qty = Number(r.cantidad_actual) || 0;
    if (qty > 0) {
      m[k].lotesConStock += 1;
      m[k].unidades += qty;
    }
    if (r.estado === 'VIGENTE') m[k].vigentes += 1;
  }
  return m;
}

const out = {
  usuarios: usuarios.ok ? usuarios.data : { error: usuarios.error },
  roles: roles.ok ? roles.data : { error: roles.error },
  sucursales: sucursales.ok ? sucursales.data : { error: sucursales.error },
  conteos,
  turnos: turnos.ok ? turnos.data : { error: turnos.error },
  ventas_por_sucursal: agrupar(ventasPorSuc.data, 'id_sucursal'),
  compras_por_sucursal: agrupar(comprasPorSuc.data, 'id_sucursal'),
  lotes_error: lotes.error?.message || null,
  lotes_por_sucursal: stockPorSucursal(lotes.data),
  kardex_error: kardexTipos.error?.message || null,
  kardex_por_tipo: agrupar(kardexTipos.data, 'tipo'),
  kardex_por_sucursal: agrupar(kardexTipos.data, 'id_sucursal'),
  producto_codigos_proveedor: pcp.ok ? pcp.data : { error: pcp.error },
};

console.log(JSON.stringify(out, null, 2));
