/**
 * Solo lectura. Efecto de correcciones de precio (Assis, Meloxicam, etc.)
 * sobre el Indic de Productos, sospechosos y ventas a pérdida.
 * No escribe nada.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { formatearPorcentajeGanancia, porcentajeGanancia } from '../src/utils/porcentajeGanancia.js'
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
const TOPE_ALTO = 500
const TOPE_BAJO = 10
const INDIC_ANTES = 93.551
const BUSCAR = [
  'ASSIS 400 SUSP X 220ML',
  'MELOXICAM 15MG CJA X 100 TAB',
]

function soles(n, dec = 2) {
  return Number(n || 0).toLocaleString('es-PE', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  })
}

function alertaDe(pct) {
  if (pct == null) return 'sin %'
  if (pct > TOPE_ALTO) return `ALTO (>${TOPE_ALTO}%)`
  if (pct < TOPE_BAJO) return `BAJO (<${TOPE_BAJO}%)`
  return ''
}

function costoDeForma(costoCatalogo, factor, pCompra) {
  const f = Number(factor) || 1
  if (costoCatalogo > 0) return costoCatalogo * f
  return Number(pCompra) || 0
}

const lotesKpi = await fetchAllRows(() =>
  supabase
    .from('inventario_lotes')
    .select('id_producto, cantidad_actual, productos!inner(id_producto, descripcion, activo, producto_precios(costo, precio_venta))')
    .eq('estado', 'VIGENTE')
    .gt('cantidad_actual', 0)
    .eq('productos.activo', 1),
)

const porProducto = new Map()
let invCosto = 0
let invVenta = 0
for (const lote of lotesKpi) {
  const cant = Number(lote.cantidad_actual) || 0
  const prod = lote.productos
  const fp = filaProductoPrecios(prod?.producto_precios)
  const costo = Number(fp?.costo) || 0
  const venta = Number(fp?.precio_venta) || 0
  if (costo <= 0 || venta <= 0) continue
  invCosto += cant * costo
  invVenta += cant * venta
  const id = Number(prod.id_producto || lote.id_producto)
  const prev = porProducto.get(id)
  if (prev) {
    prev.stock += cant
    continue
  }
  const pct = porcentajeGanancia(venta, costo)
  porProducto.set(id, {
    id,
    nombre: prod.descripcion || `id ${id}`,
    costo,
    venta,
    ganancia: venta - costo,
    pct,
    stock: cant,
    alerta: alertaDe(pct),
  })
}

const indic = porcentajeGanancia(invVenta, invCosto)
const delta = (indic ?? 0) - INDIC_ANTES
console.log('=== 1) Indic de Productos (solo lectura) ===\n')
console.log(`Antes de las correcciones: ${INDIC_ANTES.toFixed(3)}%`)
console.log(`P. Compra:    S/ ${soles(invCosto)}`)
console.log(`P. Venta:     S/ ${soles(invVenta)}`)
console.log(`Utilidad:     S/ ${soles(invVenta - invCosto)}`)
console.log(`Indic ahora:  ${formatearPorcentajeGanancia(invVenta, invCosto)}`)
console.log(`Δ:            ${delta >= 0 ? '+' : ''}${delta.toFixed(3)} puntos`)
console.log(`productos en el Indic: ${porProducto.size}\n`)

const { data: corregidos, error: errCorr } = await supabase
  .from('productos')
  .select('id_producto, descripcion, activo, producto_precios(costo, precio_venta)')
  .or(BUSCAR.map((n) => `descripcion.ilike.%${n}%`).join(','))
if (errCorr) throw new Error(errCorr.message)

const idsCorr = (corregidos || []).map((p) => Number(p.id_producto))
const formasCorr = idsCorr.length
  ? await fetchAllRows(() =>
    supabase
      .from('producto_formas_venta')
      .select('id_producto, factor, p_compra, precio_venta, activo, unidades_medida(nombre)')
      .eq('activo', true)
      .in('id_producto', idsCorr),
  )
  : []

const stockCorr = new Map()
if (idsCorr.length) {
  const lotesCorr = await fetchAllRows(() =>
    supabase
      .from('inventario_lotes')
      .select('id_producto, cantidad_actual')
      .eq('estado', 'VIGENTE')
      .gt('cantidad_actual', 0)
      .in('id_producto', idsCorr),
  )
  for (const l of lotesCorr) {
    const id = Number(l.id_producto)
    stockCorr.set(id, (stockCorr.get(id) || 0) + (Number(l.cantidad_actual) || 0))
  }
}

console.log('=== 2) Assis y Meloxicam — catálogo y formas ===\n')
const filasCorr = []
for (const p of corregidos || []) {
  const id = Number(p.id_producto)
  const fp = filaProductoPrecios(p.producto_precios)
  const costoCat = Number(fp?.costo) || 0
  const ventaCat = Number(fp?.precio_venta) || 0
  const stock = stockCorr.get(id) || 0
  filasCorr.push({
    producto: p.descripcion,
    forma: 'UNIDAD (catálogo)',
    costo: soles(costoCat, 4),
    'p.venta': soles(ventaCat, 4),
    'ganancia S/': soles(ventaCat - costoCat, 4),
    '%': formatearPorcentajeGanancia(ventaCat, costoCat),
    stock,
  })
  for (const f of formasCorr.filter((x) => Number(x.id_producto) === id)) {
    const factor = Number(f.factor) || 1
    const costo = costoDeForma(costoCat, factor, f.p_compra)
    const venta = Number(f.precio_venta) || 0
    filasCorr.push({
      producto: p.descripcion,
      forma: `${f.unidades_medida?.nombre || '?'} ×${factor}`,
      costo: soles(costo, 4),
      'p.venta': soles(venta, 4),
      'ganancia S/': soles(venta - costo, 4),
      '%': formatearPorcentajeGanancia(venta, costo),
      stock,
    })
  }
}
if (!filasCorr.length) console.log('No se encontraron Assis ni Meloxicam.\n')
else console.table(filasCorr)

const sospechosos = [...porProducto.values()]
  .filter((p) => p.alerta)
  .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))

console.log(`\n=== 3) Sospechosos actuales (>${TOPE_ALTO}% o <${TOPE_BAJO}%) ===\n`)
console.log(`${sospechosos.length} productos\n`)
if (sospechosos.length) {
  console.table(sospechosos.map((p) => ({
    nombre: p.nombre,
    costo: soles(p.costo, 4),
    'p.venta': soles(p.venta, 4),
    'ganancia S/': soles(p.ganancia, 4),
    '%': formatearPorcentajeGanancia(p.venta, p.costo),
    stock: p.stock,
    alerta: p.alerta,
  })))
} else {
  console.log('Ninguno.\n')
}

const productos = await fetchAllRows(() =>
  supabase
    .from('productos')
    .select('id_producto, descripcion, activo, producto_precios(costo, precio_venta)')
    .order('descripcion'),
)
const formasAll = await fetchAllRows(() =>
  supabase
    .from('producto_formas_venta')
    .select('id_producto, factor, p_compra, precio_venta, activo, unidades_medida(nombre)')
    .eq('activo', true),
)
const lotesAll = await fetchAllRows(() =>
  supabase
    .from('inventario_lotes')
    .select('id_producto, cantidad_actual')
    .eq('estado', 'VIGENTE')
    .gt('cantidad_actual', 0),
)
const stockPorId = new Map()
for (const l of lotesAll) {
  const id = Number(l.id_producto)
  stockPorId.set(id, (stockPorId.get(id) || 0) + (Number(l.cantidad_actual) || 0))
}
const formasPorId = new Map()
for (const f of formasAll) {
  const id = Number(f.id_producto)
  if (!formasPorId.has(id)) formasPorId.set(id, [])
  formasPorId.get(id).push(f)
}

const aPerdida = []
for (const p of productos) {
  const id = Number(p.id_producto)
  const fp = filaProductoPrecios(p.producto_precios)
  const costoCat = Number(fp?.costo) || 0
  const ventaCat = Number(fp?.precio_venta) || 0
  const stock = stockPorId.get(id) || 0
  const candidatas = [
    { forma: 'UNIDAD (catálogo)', costo: costoCat, venta: ventaCat },
  ]
  for (const f of formasPorId.get(id) || []) {
    const factor = Number(f.factor) || 1
    candidatas.push({
      forma: `${f.unidades_medida?.nombre || '?'} ×${factor}`,
      costo: costoDeForma(costoCat, factor, f.p_compra),
      venta: Number(f.precio_venta) || 0,
    })
  }
  const vistos = new Set()
  for (const c of candidatas) {
    if (!(c.costo > 0) || !(c.venta <= c.costo)) continue
    const clave = `${c.forma}|${c.costo}|${c.venta}`
    if (vistos.has(clave)) continue
    vistos.add(clave)
    aPerdida.push({
      nombre: p.descripcion || `id ${id}`,
      forma: c.forma,
      costo: soles(c.costo, 4),
      'p.venta': soles(c.venta, 4),
      'pérdida/ud': soles(c.costo - c.venta, 4),
      stock,
      estado: Number(p.activo) === 1 ? 'activo' : 'inactivo',
      tipo: c.venta < c.costo ? 'pérdida' : 'al costo',
    })
  }
}

console.log('\n=== 4) A pérdida o al costo exacto ===\n')
console.log(`${aPerdida.length} formas\n`)
if (aPerdida.length) console.table(aPerdida)
else console.log('Ninguno.\n')

console.log('Solo lectura: no se escribió nada.')
