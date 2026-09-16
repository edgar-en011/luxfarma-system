/**
 * Solo lectura. Muestra el % de ganancia con la MISMA función que Productos /
 * formas de venta / inventario (src/utils/porcentajeGanancia.js).
 *
 *   ganancia   = precio_venta − precio_compra
 *   porcentaje = (ganancia / precio_compra) × 100   →  "103.610%" o "—"
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { formatearPorcentajeGanancia } from '../src/utils/porcentajeGanancia.js'
import { filaProductoPrecios } from '../src/utils/productoPrecios.js'
import { fetchAllRows } from '../src/utils/supabasePage.js'

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
const CREMA = 'CREMA CONCHA DE NACAR LACOOPER CJA X 20'

function soles(n) {
  return Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function gananciaSoles(venta, compra) {
  return Number(venta) - Number(compra || 0)
}

function filaTxt({ nombre, forma, compra, venta }) {
  const g = gananciaSoles(venta, compra)
  return {
    nombre,
    forma: forma || 'UNIDAD (catálogo)',
    'precio_compra': soles(compra),
    'precio_venta': soles(venta),
    'ganancia (S/)': soles(g),
    '% calculado': formatearPorcentajeGanancia(venta, compra),
  }
}

function stockDe(lotesPorProducto, id) {
  return (lotesPorProducto.get(Number(id)) || []).reduce((s, l) => s + (Number(l.cantidad_actual) || 0), 0)
}

console.log('=== % ganancia (misma función que la UI) ===\n')

const { data: cremaRows, error: errCrema } = await supabase
  .from('productos')
  .select('id_producto, descripcion, activo, producto_precios(costo, precio_venta, ganancia)')
  .ilike('descripcion', `%${CREMA}%`)
if (errCrema) throw new Error(errCrema.message)

const { data: sinCostoPrecios, error: errZero } = await supabase
  .from('producto_precios')
  .select('id_producto, costo, precio_venta, ganancia, productos!inner(id_producto, descripcion, activo)')
  .eq('productos.activo', 1)
  .or('costo.eq.0,costo.is.null')
  .gt('precio_venta', 0)
  .limit(40)
if (errZero) throw new Error(errZero.message)
const sinCostoRows = (sinCostoPrecios || []).map((row) => ({
  id_producto: row.id_producto,
  descripcion: row.productos?.descripcion,
  activo: row.productos?.activo,
  producto_precios: { costo: row.costo, precio_venta: row.precio_venta, ganancia: row.ganancia },
}))

const formasAll = await fetchAllRows(() =>
  supabase
    .from('producto_formas_venta')
    .select('id_producto, factor, p_compra, precio_venta, activo, unidades_medida(nombre)')
    .eq('activo', true),
)

const porProductoFormas = new Map()
for (const f of formasAll) {
  const id = Number(f.id_producto)
  if (!porProductoFormas.has(id)) porProductoFormas.set(id, [])
  porProductoFormas.get(id).push(f)
}
const idsMulti = [...porProductoFormas.entries()]
  .filter(([, fs]) => fs.length > 1)
  .map(([id]) => id)

const { data: multiRows, error: errMulti } = idsMulti.length
  ? await supabase
    .from('productos')
    .select('id_producto, descripcion, activo, producto_precios(costo, precio_venta, ganancia)')
    .in('id_producto', idsMulti.slice(0, 80))
    .eq('activo', 1)
  : { data: [], error: null }
if (errMulti) throw new Error(errMulti.message)

const { data: extraRows, error: errExtra } = await supabase
  .from('productos')
  .select('id_producto, descripcion, activo, producto_precios!inner(costo, precio_venta, ganancia)')
  .eq('activo', 1)
  .gt('producto_precios.precio_venta', 0)
  .gt('producto_precios.costo', 0)
  .limit(40)
if (errExtra) throw new Error(errExtra.message)

const candidatos = new Map()
for (const p of [...(cremaRows || []), ...(sinCostoRows || []), ...(multiRows || []), ...(extraRows || [])]) {
  candidatos.set(Number(p.id_producto), p)
}

const ids = [...candidatos.keys()]
const lotes = await fetchAllRows(() =>
  supabase
    .from('inventario_lotes')
    .select('id_producto, cantidad_actual, estado')
    .in('id_producto', ids)
    .eq('estado', 'VIGENTE')
    .gt('cantidad_actual', 0),
)
const lotesPorProducto = new Map()
for (const l of lotes) {
  const id = Number(l.id_producto)
  if (!lotesPorProducto.has(id)) lotesPorProducto.set(id, [])
  lotesPorProducto.get(id).push(l)
}

function conStock(p) {
  return stockDe(lotesPorProducto, p.id_producto) > 0
}

const crema = (cremaRows || []).find((p) => conStock(p)) || (cremaRows || [])[0] || null
const sinCosto = (sinCostoRows || []).find((p) => conStock(p)) || (sinCostoRows || [])[0] || null
const multi = (multiRows || []).find((p) =>
  conStock(p) && Number(p.id_producto) !== Number(crema?.id_producto),
) || (multiRows || [])[0] || null

const elegidos = []
const seen = new Set()
function pushProd(p, motivo) {
  if (!p) return
  const id = Number(p.id_producto)
  if (seen.has(id)) return
  seen.add(id)
  elegidos.push({ ...p, motivo })
}

pushProd(crema, 'bug 0.73 / 1.50')
pushProd(sinCosto, 'costo 0 / vacío')
pushProd(multi, 'varias formas')

for (const p of extraRows || []) {
  if (elegidos.length >= 10) break
  if (!conStock(p)) continue
  pushProd(p, 'muestra')
}

if (elegidos.length < 10) {
  for (const p of candidatos.values()) {
    if (elegidos.length >= 10) break
    if (!conStock(p)) continue
    pushProd(p, 'muestra')
  }
}

const filasCatalogo = elegidos.map((p) => {
  const fp = filaProductoPrecios(p.producto_precios)
  return {
    ...filaTxt({
      nombre: p.descripcion,
      forma: 'catálogo',
      compra: fp?.costo,
      venta: fp?.precio_venta,
    }),
    stock: stockDe(lotesPorProducto, p.id_producto),
    motivo: p.motivo,
    'ganancia col. BD': soles(fp?.ganancia),
  }
})

console.log('Catálogo (producto_precios.costo / precio_venta) — lo que ve Inventario / KPI por producto\n')
console.table(filasCatalogo)

const filasFormas = []
for (const p of elegidos) {
  const fs = porProductoFormas.get(Number(p.id_producto)) || []
  if (fs.length < 2 && p.motivo !== 'varias formas') continue
  for (const f of fs) {
    filasFormas.push({
      ...filaTxt({
        nombre: p.descripcion,
        forma: `${f.unidades_medida?.nombre || '?'} ×${Number(f.factor) || 1}`,
        compra: f.p_compra,
        venta: f.precio_venta,
      }),
    })
  }
}

if (filasFormas.length) {
  console.log('\nFormas de venta (p_compra / precio_venta de cada forma) — lo que ve el combo de Productos\n')
  console.table(filasFormas)
} else {
  console.log('\nNo se encontró un producto activo con 2+ formas de venta en esta muestra.')
}

if (!crema) {
  console.log(`\nNo está en la base: ${CREMA}`)
} else {
  const fp = filaProductoPrecios(crema.producto_precios)
  const pct = formatearPorcentajeGanancia(fp?.precio_venta, fp?.costo)
  console.log(`\nCREMA CONCHA DE NACAR: costo ${soles(fp?.costo)}  venta ${soles(fp?.precio_venta)}  % = ${pct}`)
  console.log('Esperado si costo=0.73 y venta=1.50 → 105.479%  ( (1.50−0.73)/0.73 × 100 )')
}

if (!sinCosto) {
  console.log('\nNo hay producto activo con stock, precio de venta y costo 0/vacío en la muestra.')
}

console.log('\n=== Recuadro Productos — % Ganancia (Indic) ===')
console.log('Mismos criterios que la pantalla por defecto: Activos, sin otros filtros.')
console.log('Stock VIGENTE > 0 × costo/venta de catálogo; omite costo≤0 o venta≤0.\n')

const lotesKpi = await fetchAllRows(() =>
  supabase
    .from('inventario_lotes')
    .select('cantidad_actual, productos!inner(producto_precios(costo, precio_venta), activo)')
    .eq('estado', 'VIGENTE')
    .gt('cantidad_actual', 0)
    .eq('productos.activo', 1),
)

let costo = 0
let venta = 0
let lotesContados = 0
let lotesOmitidos = 0
for (const lote of lotesKpi) {
  const cant = Number(lote.cantidad_actual) || 0
  const fp = filaProductoPrecios(lote.productos?.producto_precios)
  const costoUnit = Number(fp?.costo) || 0
  const ventaUnit = Number(fp?.precio_venta) || 0
  if (costoUnit <= 0 || ventaUnit <= 0) {
    lotesOmitidos += 1
    continue
  }
  costo += cant * costoUnit
  venta += cant * ventaUnit
  lotesContados += 1
}

const utilidad = venta - costo
console.log(`P. Compra (Inversión):  S/ ${soles(costo)}`)
console.log(`P. Venta Aprox:         S/ ${soles(venta)}`)
console.log(`Utilidad Aprox:         S/ ${soles(utilidad)}`)
console.log(`% Ganancia (Indic):     ${formatearPorcentajeGanancia(venta, costo)}`)
console.log(`lotes en el %: ${lotesContados}   omitidos (sin costo o sin p.venta): ${lotesOmitidos}`)
console.log('\nEso es valorización de inventario, no el Indic de ventas del sistema viejo.')
console.log('Solo lectura: no se escribió nada.')
