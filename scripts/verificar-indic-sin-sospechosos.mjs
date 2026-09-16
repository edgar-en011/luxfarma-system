/**
 * Solo lectura. Indic de Productos con y sin los sospechosos (>500% o <10%),
 * más la distribución de los 192 por rango de %.
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

function soles(n) {
  return Number(n || 0).toLocaleString('es-PE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function sumar(lista) {
  let costo = 0
  let venta = 0
  for (const p of lista) {
    costo += p.invCosto
    venta += p.invVenta
  }
  return { costo, venta, utilidad: venta - costo, n: lista.length }
}

function lineaIndic(etiqueta, s) {
  console.log(`${etiqueta}`)
  console.log(`  productos: ${s.n}`)
  console.log(`  P. Compra:    S/ ${soles(s.costo)}`)
  console.log(`  P. Venta:     S/ ${soles(s.venta)}`)
  console.log(`  Utilidad:     S/ ${soles(s.utilidad)}`)
  console.log(`  Indic:        ${formatearPorcentajeGanancia(s.venta, s.costo)}`)
}

const lotes = await fetchAllRows(() =>
  supabase
    .from('inventario_lotes')
    .select('id_producto, cantidad_actual, productos!inner(id_producto, descripcion, activo, producto_precios(costo, precio_venta))')
    .eq('estado', 'VIGENTE')
    .gt('cantidad_actual', 0)
    .eq('productos.activo', 1),
)

const porProducto = new Map()
for (const lote of lotes) {
  const cant = Number(lote.cantidad_actual) || 0
  const prod = lote.productos
  const fp = filaProductoPrecios(prod?.producto_precios)
  const costo = Number(fp?.costo) || 0
  const venta = Number(fp?.precio_venta) || 0
  if (costo <= 0 || venta <= 0) continue
  const id = Number(prod.id_producto || lote.id_producto)
  const prev = porProducto.get(id)
  if (prev) {
    prev.stock += cant
    prev.invCosto += cant * costo
    prev.invVenta += cant * venta
    continue
  }
  const pct = porcentajeGanancia(venta, costo)
  porProducto.set(id, {
    id,
    nombre: prod.descripcion || `id ${id}`,
    costo,
    venta,
    pct,
    stock: cant,
    invCosto: cant * costo,
    invVenta: cant * venta,
    sospechoso: pct != null && (pct > TOPE_ALTO || pct < TOPE_BAJO),
  })
}

const todos = [...porProducto.values()]
const sospechosos = todos.filter((p) => p.sospechoso).sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))
const limpios = todos.filter((p) => !p.sospechoso)
const altos = sospechosos.filter((p) => p.pct > TOPE_ALTO)
const bajos = sospechosos.filter((p) => p.pct < TOPE_BAJO)

const sTodos = sumar(todos)
const sLimpios = sumar(limpios)
const sAltos = sumar(altos)
const sBajos = sumar(bajos)

console.log('=== Indic con y sin sospechosos (solo lectura) ===\n')
lineaIndic('1) Catálogo completo (lo que ves hoy en Productos)', sTodos)
console.log('')
lineaIndic(`2) Sin los ${sospechosos.length} sospechosos (>${TOPE_ALTO}% o <${TOPE_BAJO}%)`, sLimpios)
const deltaPct = porcentajeGanancia(sLimpios.venta, sLimpios.costo) - porcentajeGanancia(sTodos.venta, sTodos.costo)
console.log(`   Δ Indic: ${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(3)} puntos`)
console.log('')
lineaIndic(`   — solo los ${altos.length} altos (inflan)`, sAltos)
lineaIndic(`   — solo los ${bajos.length} bajos (desinflan)`, sBajos)
lineaIndic(`   — catálogo sin los ${altos.length} altos (dejando los bajos)`, sumar(todos.filter((p) => p.pct == null || p.pct <= TOPE_ALTO)))

console.log('\n--- Los 10 excluidos ---')
console.table(sospechosos.map((p) => ({
  nombre: p.nombre,
  '%': `${Number(p.pct).toFixed(3)}%`,
  'inversión S/': soles(p.invCosto),
  'venta aprox S/': soles(p.invVenta),
  'utilidad S/': soles(p.invVenta - p.invCosto),
})))

const rangos = [
  { etiqueta: 'menos de 25%', test: (p) => p.pct < 25 },
  { etiqueta: '25–50%', test: (p) => p.pct >= 25 && p.pct < 50 },
  { etiqueta: '50–100%', test: (p) => p.pct >= 50 && p.pct < 100 },
  { etiqueta: '100–200%', test: (p) => p.pct >= 100 && p.pct < 200 },
  { etiqueta: 'más de 200%', test: (p) => p.pct >= 200 },
]

console.log('\n=== Distribución de los', todos.length, 'productos con stock ===\n')
const dist = rangos.map((r) => {
  const grupo = todos.filter(r.test)
  const s = sumar(grupo)
  return {
    rango: r.etiqueta,
    productos: s.n,
    '% prod.': `${((s.n / todos.length) * 100).toFixed(1)}%`,
    'inversión S/': soles(s.costo),
    '% invers.': sTodos.costo > 0 ? `${((s.costo / sTodos.costo) * 100).toFixed(1)}%` : '—',
    'utilidad S/': soles(s.utilidad),
    Indic: formatearPorcentajeGanancia(s.venta, s.costo),
  }
})
console.table(dist)

const sumaN = dist.reduce((a, r) => a + r.productos, 0)
console.log(`Suma de productos en rangos: ${sumaN} (debe ser ${todos.length})`)
console.log('\nSolo lectura: no se escribió nada.')
