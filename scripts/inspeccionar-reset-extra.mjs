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

const [series, internas, pedido, sesion, nota, perdida, lote2, clientes] = await Promise.all([
  supabase.from('series_correlativos').select('*'),
  supabase.from('correlativos_venta_interna').select('*'),
  supabase.from('pedidos_proveedor').select('id_pedido, id_proveedor, estado, fecha_pedido, id_sucursal'),
  supabase.from('inventario_sesiones').select('id_sesion, id_sucursal, estado, fecha_inicio').order('id_sesion', { ascending: false }).limit(5),
  supabase.from('notas_inventario').select('id_nota, tipo, id_sucursal, numero_correlativo'),
  supabase.from('ventas_perdidas').select('id, id_sucursal, created_at'),
  supabase.from('inventario_lotes').select('id_lote, id_producto, nro_lote, cantidad_actual, estado').eq('id_sucursal', 2),
  supabase.from('clientes').select('id_cliente, nro_doc, nombre_razon_social').limit(20),
]);

console.log(JSON.stringify({
  series_correlativos: series.data,
  series_error: series.error?.message,
  correlativos_venta_interna: internas.data,
  internas_error: internas.error?.message,
  pedidos: pedido.data,
  sesiones_muestra: sesion.data,
  notas_inventario: nota.data,
  ventas_perdidas: perdida.data,
  lote_sucursal_2: lote2.data,
  clientes: clientes.data,
}, null, 2));
