/**
 * Solo lectura. Lista cada forma de venta (y el catálogo unidad) donde
 * precio_venta <= costo. Se venderían a pérdida o al costo.
 *
 * Costo de una forma: producto_precios.costo × factor (el que usa la
 * ganancia al cobrar). Si el catálogo no tiene costo, cae a p_compra.
 *
 * Incluye productos sin stock e inactivos. No escribe nada.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
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

function soles(n, dec = 2) {
  return Number(n || 0).toLocaleString('es-PE', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  })
}

function costoDeForma(costoCatalogo, factor, pCompra) {
  const f = Number(factor) || 1
  if (costoCatalogo > 0) return costoCatalogo * f
  return Number(pCompra) || 0
}

const productos = await fetchAllRows(() =>
  supabase
    .from('productos')
    .select('id_producto, descripcion, activo, producto_precios(costo, precio_venta)')
    .order('descripcion'),
)

const formas = await fetchAllRows(() =>
  supabase
    .from('producto_formas_venta')
    .select('id_producto, factor, p_compra, precio_venta, activo, unidades_medida(nombre)')
    .eq('activo', true),
)

const lotes = await fetchAllRows(() =>
  supabase
    .from('inventario_lotes')
    .select('id_producto, cantidad_actual')
    .eq('estado', 'VIGENTE')
    .gt('cantidad_actual', 0),
)

const stockPorId = new Map()
for (const l of lotes) {
  const id = Number(l.id_producto)
  stockPorId.set(id, (stockPorId.get(id) || 0) + (Number(l.cantidad_actual) || 0))
}

const formasPorId = new Map()
for (const f of formas) {
  const id = Number(f.id_producto)
  if (!formasPorId.has(id)) formasPorId.set(id, [])
  formasPorId.get(id).push(f)
}

const filas = []
for (const p of productos) {
  const id = Number(p.id_producto)
  const fp = filaProductoPrecios(p.producto_precios)
  const costoCat = Number(fp?.costo) || 0
  const ventaCat = Number(fp?.precio_venta) || 0
  const stock = stockPorId.get(id) || 0
  const listaFormas = formasPorId.get(id) || []

  const candidatas = []
  candidatas.push({
    forma: 'UNIDAD (catálogo)',
    factor: 1,
    costo: costoCat,
    venta: ventaCat,
    origenCosto: 'catalogo',
  })
  for (const f of listaFormas) {
    const factor = Number(f.factor) || 1
    const costo = costoDeForma(costoCat, factor, f.p_compra)
    candidatas.push({
      forma: `${f.unidades_medida?.nombre || '?'} ×${factor}`,
      factor,
      costo,
      venta: Number(f.precio_venta) || 0,
      origenCosto: costoCat > 0 ? 'catalogo×factor' : 'p_compra',
    })
  }

  const vistos = new Set()
  for (const c of candidatas) {
    if (!(c.costo > 0) || !(c.venta <= c.costo)) continue
    const clave = `${c.forma}|${c.costo}|${c.venta}`
    if (vistos.has(clave)) continue
    vistos.add(clave)
    const perdida = c.costo - c.venta
    filas.push({
      nombre: p.descripcion || `id ${id}`,
      forma: c.forma,
      costo: c.costo,
      venta: c.venta,
      perdida,
      stock,
      activo: Number(p.activo) === 1,
      origenCosto: c.origenCosto,
    })
  }
}

filas.sort((a, b) => {
  if ((b.stock > 0) !== (a.stock > 0)) return b.stock > 0 ? 1 : -1
  return b.perdida - a.perdida
})

const conStock = filas.filter((f) => f.stock > 0)
const sinStock = filas.filter((f) => f.stock <= 0)
const productosUnicos = new Set(filas.map((f) => f.nombre)).size

console.log('=== Productos que se venderían a pérdida (solo lectura) ===\n')
console.log('Criterio: precio_venta ≤ costo, en catálogo o en cualquier forma activa.')
console.log('Costo de forma = costo de catálogo × factor (el de la ganancia al cobrar).')
console.log(`Formas a pérdida: ${filas.length}   productos distintos: ${productosUnicos}`)
console.log(`  con stock: ${conStock.length}   sin stock: ${sinStock.length}   inactivos: ${filas.filter((f) => !f.activo).length}\n`)

function vista(f) {
  return {
    nombre: f.nombre,
    forma: f.forma,
    costo: soles(f.costo, 4),
    'p.venta': soles(f.venta, 4),
    'pérdida/ud': soles(f.perdida, 4),
    stock: f.stock,
    estado: f.activo ? 'activo' : 'inactivo',
    'pérdida stock': f.stock > 0 ? soles(f.perdida * f.stock) : '—',
  }
}

if (conStock.length) {
  console.log('--- Con stock vigente ---')
  console.table(conStock.map(vista))
} else {
  console.log('Ninguno con stock vigente.\n')
}

if (sinStock.length) {
  console.log('\n--- Sin stock (si se compran, se venden a pérdida) ---')
  console.table(sinStock.map(vista))
}

console.log('\nSolo lectura: no se escribió nada.')
