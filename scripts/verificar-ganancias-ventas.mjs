/**
 * Solo lectura. Desglosa cada línea de venta real para revisar a mano:
 *   ganancia_linea = subtotal − costo_usado × cantidad × factor
 *
 * Costo: snapshot (venta_detalle.costo_unitario) o catálogo actual
 * (producto_precios.costo) si el snapshot es NULL — ventas del 02/09.
 *
 * Al final compara los dos Indic de la UI (Productos vs Ganancias).
 * No escribe nada.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { formatearPorcentajeGanancia, porcentajeGanancia } from '../src/utils/porcentajeGanancia.js'
import { filaProductoPrecios, gananciaDesdeDetallesVenta } from '../src/utils/productoPrecios.js'
import { fetchAllRows } from '../src/utils/supabasePage.js'
import { hoyLocal, rangoFechasRapido, fechaCalendarioPE } from '../src/utils/fechas.js'
import { cargarReporteGanancias } from '../src/utils/reporteGanancias.js'

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

function costoDeLinea(d) {
  const snap = d.costo_unitario
  const catalogo = Number(filaProductoPrecios(d.productos?.producto_precios)?.costo || 0)
  const tieneSnap = snap != null && snap !== ''
  const costoUsado = tieneSnap ? Number(snap) || 0 : catalogo
  return {
    costoUsado,
    catalogo,
    origen: tieneSnap ? 'snapshot' : 'catalogo',
  }
}

const ventas = await fetchAllRows(() =>
  supabase
    .from('ventas')
    .select('id_venta, serie, correlativo, total, descuento, created_at, tipo_comprobante, estado_anulacion, venta_detalle(cantidad, subtotal, factor, costo_unitario, productos(descripcion, producto_precios(costo)))')
    .order('created_at', { ascending: true }),
)

const reales = (ventas || []).filter((v) => v.estado_anulacion !== 'ANULADO')
const anuladas = (ventas || []).filter((v) => v.estado_anulacion === 'ANULADO').length

console.log('=== Auditoría de ganancia por línea (SOLO LECTURA) ===\n')
console.log(`Ventas leídas: ${ventas.length}  ·  reales (no anuladas): ${reales.length}  ·  anuladas omitidas: ${anuladas}`)
console.log('Fórmula de cada línea: ganancia = subtotal − costo_usado × cantidad × factor')
console.log('origen snapshot = venta_detalle.costo_unitario   |   catalogo = producto_precios.costo de HOY\n')

const filas = []
let totSubtotal = 0
let totCosto = 0
let totGananciaLineas = 0
let totTicket = 0
let lineasSnap = 0
let lineasCat = 0
let lineasDescuadre = 0

for (const v of reales) {
  const comp = `${v.serie || '?'}-${v.correlativo ?? '?'}`
  const fecha = fechaCalendarioPE(v.created_at) || '—'
  const detalles = v.venta_detalle || []
  totTicket += Number(v.total || 0)

  for (const d of detalles) {
    const { costoUsado, catalogo, origen } = costoDeLinea(d)
    const cant = Number(d.cantidad || 0)
    const factor = Number(d.factor) || 1
    const uds = cant * factor
    const subtotal = Number(d.subtotal || 0)
    const costoLinea = costoUsado * uds
    const ganancia = subtotal - costoLinea
    const pVentaUd = uds > 0 ? subtotal / uds : 0
    const check = Math.round((subtotal - costoUsado * uds - ganancia) * 1e6)
    if (check !== 0) lineasDescuadre += 1
    if (origen === 'snapshot') lineasSnap += 1
    else lineasCat += 1
    totSubtotal += subtotal
    totCosto += costoLinea
    totGananciaLineas += ganancia

    filas.push({
      fecha,
      comp,
      producto: (d.productos?.descripcion || `id ${d.id_producto}`).slice(0, 42),
      cant,
      factor,
      uds,
      'p.venta/ud': soles(pVentaUd, 4),
      subtotal: soles(subtotal),
      'costo/ud': soles(costoUsado, 4),
      origen,
      'costo línea': soles(costoLinea, 4),
      ganancia: soles(ganancia),
      'catálogo hoy': origen === 'catalogo' ? '← este' : soles(catalogo, 4),
    })
  }
}

console.table(filas)

const totGananciaTicket = totTicket - totCosto
console.log('\n=== Totales (ventas reales, no anuladas) ===')
console.log(`Suma de subtotales (líneas):     S/ ${soles(totSubtotal)}`)
console.log(`Suma de tickets (ventas.total):  S/ ${soles(totTicket)}`)
if (Math.abs(totTicket - totSubtotal) > 0.02) {
  console.log(`  Δ ticket vs líneas (desc./redondeo): S/ ${soles(totTicket - totSubtotal)}`)
}
console.log(`Costo usado (suma de líneas):    S/ ${soles(totCosto)}`)
console.log(`Ganancia por líneas:             S/ ${soles(totGananciaLineas)}`)
console.log(`Ganancia ticket − costo:         S/ ${soles(totGananciaTicket)}`)
console.log(`% sobre COSTO (líneas):          ${formatearPorcentajeGanancia(totSubtotal, totCosto)}`)
console.log(`% sobre COSTO (tickets):         ${formatearPorcentajeGanancia(totTicket, totCosto)}`)
console.log(`Líneas con snapshot: ${lineasSnap}   con catálogo actual: ${lineasCat}   descuadre fórmula: ${lineasDescuadre}`)

const checkFn = reales.reduce((acc, v) => acc + gananciaDesdeDetallesVenta(v.venta_detalle), 0)
console.log(`Cruzado con gananciaDesdeDetallesVenta(): S/ ${soles(checkFn)}`)

console.log('\n=== Los dos Indic de la UI (mismos criterios que las pantallas) ===\n')

const lotesKpi = await fetchAllRows(() =>
  supabase
    .from('inventario_lotes')
    .select('cantidad_actual, productos!inner(producto_precios(costo, precio_venta), activo)')
    .eq('estado', 'VIGENTE')
    .gt('cantidad_actual', 0)
    .eq('productos.activo', 1),
)

let invCosto = 0
let invVenta = 0
let lotesOk = 0
let lotesOmit = 0
for (const lote of lotesKpi) {
  const cant = Number(lote.cantidad_actual) || 0
  const fp = filaProductoPrecios(lote.productos?.producto_precios)
  const c = Number(fp?.costo) || 0
  const pv = Number(fp?.precio_venta) || 0
  if (c <= 0 || pv <= 0) {
    lotesOmit += 1
    continue
  }
  invCosto += cant * c
  invVenta += cant * pv
  lotesOk += 1
}
const invUtil = invVenta - invCosto
const pctProd = porcentajeGanancia(invVenta, invCosto)
console.log('1) Productos → % Ganancia (Indic)')
console.log('   Qué mide: el stock que HAY AHORA en anaqueles, no lo vendido.')
console.log('   Fórmula:  (P.Venta Aprox − P.Compra) / P.Compra × 100')
console.log(`   P. Compra (inversión): S/ ${soles(invCosto)}`)
console.log(`   P. Venta aprox:        S/ ${soles(invVenta)}`)
console.log(`   Utilidad aprox:        S/ ${soles(invUtil)}`)
console.log(`   % Ganancia (Indic):    ${formatearPorcentajeGanancia(invVenta, invCosto)}`)
console.log(`   lotes en el %: ${lotesOk}   omitidos (sin costo o sin p.venta): ${lotesOmit}`)
if (pctProd != null) {
  const margenSobreVenta = invVenta > 0 ? (invUtil / invVenta) * 100 : 0
  console.log(`   Equivale a un margen sobre el precio de venta de ${margenSobreVenta.toFixed(1)}%`)
  console.log(`   (si compras a 100 y pones precio 276, el Indic es 176%, no “ganaste 176 soles de cada 100 de venta”).`)
}

async function imprimirGanancias(etiqueta, rango) {
  const r = await cargarReporteGanancias(supabase, {
    fechaDesde: rango.fechaDesde,
    fechaHasta: rango.fechaHasta,
  })
  const pctGan = porcentajeGanancia(r.ventas, r.costo)
  console.log(`\n2) Ganancias → Indic (%)  [${etiqueta}]`)
  console.log('   Qué mide: lo que SE VENDIÓ en el rango, con el costo congelado al cobrar')
  console.log('   (si no hay snapshot, cae al catálogo de hoy — caso 02/09).')
  console.log('   Fórmula:  (Ventas − Costo) / Costo × 100   ← la misma función, otra base.')
  console.log(`   Rango:    ${rango.fechaDesde} → ${rango.fechaHasta}`)
  console.log(`   Ventas:    S/ ${soles(r.ventas)}`)
  console.log(`   Costo:     S/ ${soles(r.costo)}`)
  console.log(`   Ganancia:  S/ ${soles(r.ganancia)}`)
  console.log(`   Indic:     ${formatearPorcentajeGanancia(r.ventas, r.costo)}`)
  console.log(`   ops: ${r.operaciones}`)
  if (pctGan != null && r.ventas > 0) {
    const margen = (r.ganancia / r.ventas) * 100
    console.log(`   Equivale a un margen sobre la venta de ${margen.toFixed(1)}%`)
  }
}

try {
  await imprimirGanancias('Hoy, como abre la pantalla', rangoFechasRapido('Hoy'))
  await imprimirGanancias('Este mes — las 7 ventas del 02/09', rangoFechasRapido('Este mes'))
} catch (err) {
  console.log('\n2) Ganancias Indic: no se pudo leer el RPC:', err.message)
}

console.log('\nSolo lectura: no se escribió nada.')
