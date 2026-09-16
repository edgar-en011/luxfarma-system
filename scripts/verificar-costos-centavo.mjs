/**
 * Solo lectura. Productos con costo entre 0 y 0.02 en catálogo o en lotes
 * vigentes. Sirve para confirmar cuáles son bonificaciones (0.01 placeholder)
 * antes de pasarlos a 0.
 * No escribe nada.
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
const TOPE = 0.02

function soles(n, dec = 4) {
  return Number(n || 0).toLocaleString('es-PE', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  })
}

const productos = await fetchAllRows(() =>
  supabase
    .from('productos')
    .select('id_producto, descripcion, activo, producto_precios(costo, precio_venta)')
    .order('descripcion'),
)

const lotes = await fetchAllRows(() =>
  supabase
    .from('inventario_lotes')
    .select('id_producto, nro_lote, cantidad_actual, costo_unitario_lote, estado')
    .eq('estado', 'VIGENTE')
    .gt('cantidad_actual', 0),
)

const lotesPorId = new Map()
for (const l of lotes) {
  const id = Number(l.id_producto)
  if (!lotesPorId.has(id)) lotesPorId.set(id, [])
  lotesPorId.get(id).push(l)
}

const filas = []
for (const p of productos) {
  const id = Number(p.id_producto)
  const fp = filaProductoPrecios(p.producto_precios)
  const costoCat = Number(fp?.costo)
  const venta = Number(fp?.precio_venta) || 0
  const catEnRango = Number.isFinite(costoCat) && costoCat >= 0 && costoCat <= TOPE
  const lotesProd = lotesPorId.get(id) || []
  const lotesRango = lotesProd.filter((l) => {
    const c = Number(l.costo_unitario_lote)
    return Number.isFinite(c) && c >= 0 && c <= TOPE
  })
  if (!catEnRango && !lotesRango.length) continue
  const stock = lotesProd.reduce((s, l) => s + (Number(l.cantidad_actual) || 0), 0)
  const costosLote = [...new Set(lotesRango.map((l) => Number(l.costo_unitario_lote)))]
  filas.push({
    nombre: p.descripcion || `id ${id}`,
    estado: Number(p.activo) === 1 ? 'activo' : 'inactivo',
    'costo catálogo': catEnRango || Number.isFinite(costoCat) ? soles(costoCat) : '—',
    'p.venta': soles(venta),
    stock,
    'lotes 0–0.02': lotesRango.length
      ? lotesRango.map((l) => `${l.nro_lote || 's/n'}×${Number(l.cantidad_actual)}@${soles(l.costo_unitario_lote)}`).join(' · ')
      : '—',
    dónde: [catEnRango ? 'catálogo' : null, lotesRango.length ? 'lotes' : null].filter(Boolean).join('+'),
    nota: costoCat === 0 && costosLote.every((c) => c === 0)
      ? 'ya en 0'
      : (costoCat > 0 && costoCat <= TOPE ? '¿placeholder 0.01?' : ''),
  })
}

filas.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'))

console.log('=== Costos entre 0 y 0.02 (solo lectura) ===\n')
console.log('Para que confirmen cuáles son bonificaciones antes de pasarlos a 0.')
console.log(`Productos: ${filas.length}\n`)
if (filas.length) console.table(filas)
else console.log('Ninguno.\n')
console.log('Solo lectura: no se escribió nada.')
