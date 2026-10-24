import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { buscarProductosParaStock, construirDetallesStock } from '../src/utils/stockAsistenteIA.js';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((linea) => linea && linea.includes('='))
    .map((linea) => {
      const indice = linea.indexOf('=');
      return [linea.slice(0, indice), linea.slice(indice + 1).replace(/^"|"$/g, '')];
    }),
);

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function todasLasFilas(buildQuery) {
  const filas = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await buildQuery().range(desde, desde + 999);
    if (error) throw error;
    filas.push(...(data || []));
    if (!data || data.length < 1000) return filas;
  }
}

const [{ data: resumen, error: errorResumen }, productos, lotesDirectos] = await Promise.all([
  supabase.rpc('resumen_asistente_ia', {
    p_id_sucursal: null,
    p_dias: 30,
    p_limite: 25,
  }),
  todasLasFilas(() => supabase
    .from('productos')
    .select('id_producto, descripcion')
    .eq('activo', 1)
    .order('id_producto', { ascending: true })),
  todasLasFilas(() => supabase
    .from('inventario_lotes')
    .select('id_lote, id_producto, id_sucursal, cantidad_actual, estado, fecha_vencimiento')
    .order('id_lote', { ascending: true })),
]);
if (errorResumen) throw errorResumen;

const lotesPorProducto = new Map();
for (const lote of lotesDirectos) {
  const id = Number(lote.id_producto);
  if (!lotesPorProducto.has(id)) lotesPorProducto.set(id, []);
  lotesPorProducto.get(id).push(lote);
}

const stock = new Map(productos.map((producto) => {
  const lotes = lotesPorProducto.get(Number(producto.id_producto)) || [];
  const disponible = lotes
    .filter((lote) => lote.estado === 'VIGENTE')
    .reduce((total, lote) => total + Number(lote.cantidad_actual || 0), 0);
  const vencido = lotes
    .filter((lote) => lote.estado === 'VENCIDO')
    .reduce((total, lote) => total + Number(lote.cantidad_actual || 0), 0);
  return [Number(producto.id_producto), { disponible, vencido }];
}));

const items = [
  ...(resumen?.stockBajo || []),
  ...(resumen?.mayorMovimiento || []),
  ...(resumen?.bajaRotacion || []),
];
const discrepancias = items.filter((item) => {
  const esperado = stock.get(Number(item.id_producto))?.disponible ?? 0;
  return Math.abs(esperado - Number(item.stock_base || 0)) > 0.000001;
});

const stockVencido = [...stock.values()].reduce((total, item) => total + item.vencido, 0);
const productoMuestra = productos.find((producto) => producto.descripcion);
const coincidenciaMuestra = productoMuestra
  ? buscarProductosParaStock(`stock actual de ${productoMuestra.descripcion}`, productos, 1)
  : [];
const detalleMuestra = construirDetallesStock(coincidenciaMuestra, lotesDirectos, [])[0] || null;
console.log(JSON.stringify({
  productosActivos: productos.length,
  lotesLeidos: lotesDirectos.length,
  totalesRpc: resumen?.totales || null,
  itemsRpcRevisados: items.length,
  discrepanciasStockDisponible: discrepancias.length,
  productosConStockVencido: [...stock.values()].filter((item) => item.vencido > 0).length,
  unidadesVencidasFueraDelStockDisponible: stockVencido,
  consultaExactaResuelta: Boolean(detalleMuestra),
  consultaExactaDisponible: detalleMuestra?.disponible ?? null,
}, null, 2));

if (discrepancias.length > 0) {
  console.log('Discrepancias:', discrepancias.slice(0, 10).map((item) => ({
    idProducto: item.id_producto,
    reportado: item.stock_base,
    esperado: stock.get(Number(item.id_producto))?.disponible ?? 0,
  })));
  process.exitCode = 1;
}

