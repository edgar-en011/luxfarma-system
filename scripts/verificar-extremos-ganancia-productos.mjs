/**
 * Solo lectura. Productos con stock VIGENTE, ordenados por % de ganancia
 * (misma fórmula que el Indic de Productos).
 *
 *   ganancia   = precio_venta − costo
 *   porcentaje = ganancia / costo × 100
 *
 * Lista los 30 más altos, los 30 más bajos, y todos los sospechosos
 * (>500% o <10%). No escribe nada.
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

function filaVista(p) {
  return {
    nombre: p.nombre,
    costo: soles(p.costo, 4),
    'p.venta': soles(p.venta, 4),
    'ganancia S/': soles(p.ganancia, 4),
    '%': formatearPorcentajeGanancia(p.venta, p.costo),
    stock: p.stock,
    alerta: p.alerta || (p.formasIguales ? 'unidad=caja' : ''),
  }
}

console.log('=== Extremos de % ganancia (stock VIGENTE, solo lectura) ===\n')
console.log('Misma cuenta que Productos → % Ganancia (Indic): (p.venta − costo) / costo × 100')
console.log(`Sospechoso: >${TOPE_ALTO}% o <${TOPE_BAJO}%\n`)

const lotes = await fetchAllRows(() =>
  supabase
    .from('inventario_lotes')
    .select('id_producto, cantidad_actual, productos!inner(id_producto, descripcion, activo, producto_precios(costo, precio_venta))')
    .eq('estado', 'VIGENTE')
    .gt('cantidad_actual', 0)
    .eq('productos.activo', 1),
)

const porProducto = new Map()
let lotesOk = 0
let lotesOmit = 0
for (const lote of lotes) {
  const cant = Number(lote.cantidad_actual) || 0
  const prod = lote.productos
  const fp = filaProductoPrecios(prod?.producto_precios)
  const costo = Number(fp?.costo) || 0
  const venta = Number(fp?.precio_venta) || 0
  if (costo <= 0 || venta <= 0) {
    lotesOmit += 1
    continue
  }
  lotesOk += 1
  const id = Number(prod.id_producto || lote.id_producto)
  const prev = porProducto.get(id)
  if (prev) {
    prev.stock += cant
    continue
  }
  const ganancia = venta - costo
  const pct = porcentajeGanancia(venta, costo)
  porProducto.set(id, {
    id,
    nombre: prod.descripcion || `id ${id}`,
    costo,
    venta,
    ganancia,
    pct,
    stock: cant,
    alerta: alertaDe(pct),
    formasIguales: false,
  })
}

const ids = [...porProducto.keys()]
if (ids.length) {
  const formas = await fetchAllRows(() =>
    supabase
      .from('producto_formas_venta')
      .select('id_producto, factor, precio_venta, activo')
      .eq('activo', true)
      .in('id_producto', ids),
  )
  const porId = new Map()
  for (const f of formas) {
    const id = Number(f.id_producto)
    if (!porId.has(id)) porId.set(id, [])
    porId.get(id).push(f)
  }
  for (const [id, lista] of porId) {
    const precios = lista.map((f) => Number(f.precio_venta) || 0)
    const factores = new Set(lista.map((f) => Number(f.factor) || 1))
    const unicos = new Set(precios.filter((n) => n > 0))
    if (lista.length >= 2 && factores.size >= 2 && unicos.size === 1) {
      const p = porProducto.get(id)
      if (p) p.formasIguales = true
    }
  }
}

const ordenados = [...porProducto.values()].sort((a, b) => (b.pct ?? -Infinity) - (a.pct ?? -Infinity))
const altos = ordenados.slice(0, 30)
const bajos = ordenados.slice(-30).reverse()
const sospechosos = ordenados.filter((p) => p.alerta || p.formasIguales)

let invCosto = 0
let invVenta = 0
for (const p of ordenados) {
  invCosto += p.stock * p.costo
  invVenta += p.stock * p.venta
}

console.log(`Productos en el Indic: ${ordenados.length}   lotes: ${lotesOk}   omitidos (sin costo o sin p.venta): ${lotesOmit}`)
console.log(`Indic recalculado:     ${formatearPorcentajeGanancia(invVenta, invCosto)}`)
console.log(`  P. Compra ${soles(invCosto)}   P. Venta ${soles(invVenta)}   Utilidad ${soles(invVenta - invCosto)}`)
console.log(`Sospechosos (>${TOPE_ALTO}%, <${TOPE_BAJO}% o unidad=caja): ${sospechosos.length}\n`)

console.log('--- 30 más altos ---')
console.table(altos.map(filaVista))

console.log('\n--- 30 más bajos ---')
console.table(bajos.map(filaVista))

if (sospechosos.length) {
  console.log('\n--- Todos los sospechosos ---')
  console.table(sospechosos.map(filaVista))
}

console.log('\nSolo lectura: no se escribió nada.')
