/**
 * Solo lectura. Totales del Diario Resumido (Ganancias) para un rango real.
 * Usa formatearPorcentajeGanancia — la misma función que la pantalla.
 *
 * Requiere sql/migracion_reporte_ganancias.sql en Supabase.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { formatearPorcentajeGanancia } from '../src/utils/porcentajeGanancia.js'
import { hoyLocal, rangoFechasRapido } from '../src/utils/fechas.js'
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

function soles(n) {
  return Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

async function probar(etiqueta, fechaDesde, fechaHasta) {
  console.log(`\n=== ${etiqueta}  ${fechaDesde} → ${fechaHasta} ===`)
  try {
    const r = await cargarReporteGanancias(supabase, { fechaDesde, fechaHasta })
    console.log(`Ventas:     S/ ${soles(r.ventas)}`)
    console.log(`Costo:      S/ ${soles(r.costo)}`)
    console.log(`Ganancia:   S/ ${soles(r.ganancia)}`)
    console.log(`Indic:      ${formatearPorcentajeGanancia(r.ventas, r.costo)}`)
    console.log(`Ops:        ${r.operaciones}   productos: ${r.productos.length}   días: ${r.serie.length}`)
    if (r.productos[0]) {
      const p = r.productos[0]
      console.log(`Top ganancia: ${p.descripcion}  S/ ${soles(p.ganancia)}  ${formatearPorcentajeGanancia(p.ventas, p.costo)}`)
    }
    return r
  } catch (err) {
    console.error(err.message)
    if (String(err.message).includes('reporte_ganancias') || String(err.message).includes('Could not find')) {
      console.error('Ejecutá en Supabase: sql/migracion_reporte_ganancias.sql')
      console.error('(y antes: sql/migracion_venta_detalle_costo_snapshot.sql)')
    }
    throw err
  }
}

const mes = rangoFechasRapido('Este mes')
await probar('Hoy', hoyLocal(), hoyLocal())
await probar('Este mes', mes.fechaDesde, mes.fechaHasta)
console.log('\nSolo lectura. El Indic usa src/utils/porcentajeGanancia.js')
