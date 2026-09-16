/**
 * Indicador "Aceptados" del panel Estado SUNAT del Dashboard.
 *
 * Aceptados responde una pregunta distinta a Enviados/Pendientes/Error:
 *   estado_envio        → ¿salió el comprobante hacia Nubefact?
 *   aceptada_por_sunat  → ¿SUNAT ya lo validó? (en boletas puede tardar días)
 *
 * Verifica que:
 *  1) aceptados = filas con aceptada_por_sunat = true, ni una más.
 *  2) Dashboard y pantalla SUNAT dan el mismo número en los cuatro indicadores.
 *  3) Los dos ejes son independientes: mover aceptada_por_sunat no toca
 *     enviados/pendientes/error, y mover estado_envio no toca aceptados.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { contarComprobantesSunat, contarEstadosSunat } from '../src/utils/estadoSunat.js'

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

function fail(msg) {
  throw new Error(msg)
}

const resumen = (c) =>
  `enviados=${c.enviados} pendientes=${c.pendientes} error=${c.error} aceptados=${c.aceptados} total=${c.total}`

/** Igual que AdminSunat.cargarFilasSunat + contarEstadosSunat. */
async function conteoPantallaSunat() {
  const { data, error } = await supabase
    .from('comprobantes_sunat')
    .select('id, id_venta, id_sucursal, estado_envio, aceptada_por_sunat')
    .order('id', { ascending: false })
    .limit(400)
  if (error) fail(`pantalla SUNAT: ${error.message}`)
  return contarEstadosSunat(data || [])
}

/** Igual que AdminDashboard.cargarEstadoSunat. */
async function conteoDashboard() {
  return contarComprobantesSunat(supabase, {})
}

/** Compara los CUATRO indicadores entre las dos pantallas. */
async function ambasPantallas(etiqueta) {
  const dash = await conteoDashboard()
  const pantalla = await conteoPantallaSunat()
  const iguales =
    dash.enviados === pantalla.enviados &&
    dash.pendientes === pantalla.pendientes &&
    dash.error === pantalla.error &&
    dash.aceptados === pantalla.aceptados &&
    dash.total === pantalla.total
  if (!iguales) {
    fail(`${etiqueta}: NO coinciden\n  dashboard: ${resumen(dash)}\n  pantalla : ${resumen(pantalla)}`)
  }
  console.log(`OK ${etiqueta} → ${resumen(dash)}`)
  return dash
}

// ── 1) Estado real crudo, sin pasar por el clasificador ──
const { data: filas, error: errFilas } = await supabase
  .from('comprobantes_sunat')
  .select('id, id_venta, serie, numero, estado_envio, aceptada_por_sunat')
  .order('id', { ascending: false })
  .limit(400)
if (errFilas) fail(`comprobantes_sunat: ${errFilas.message}`)
if (!filas?.length) fail('no hay filas en comprobantes_sunat para probar')

const porEstado = {}
for (const f of filas) porEstado[f.estado_envio ?? '(null)'] = (porEstado[f.estado_envio ?? '(null)'] || 0) + 1
const aceptadasCrudo = filas.filter((f) => f.aceptada_por_sunat === true)

console.log('=== Estado real en comprobantes_sunat ===')
console.log(JSON.stringify({
  total: filas.length,
  por_estado_envio: porEstado,
  aceptada_por_sunat_true: aceptadasCrudo.length,
  aceptada_por_sunat_false_o_null: filas.length - aceptadasCrudo.length,
}, null, 2))

// ── 2) El indicador cuenta exactamente aceptada_por_sunat = true ──
const base = await ambasPantallas('estado actual')
if (base.aceptados !== aceptadasCrudo.length) {
  fail(`aceptados=${base.aceptados} pero aceptada_por_sunat=true son ${aceptadasCrudo.length}`)
}
console.log(`OK aceptados sale de aceptada_por_sunat=true y nada más (${base.aceptados})`)
if (base.aceptados !== base.enviados) {
  console.log(`OK aceptados (${base.aceptados}) NO se confunde con enviados (${base.enviados})`)
}

// ── 3) Los dos ejes son independientes ──
const cobaya = filas.find((f) => String(f.estado_envio).toUpperCase() === 'ENVIADO') || filas[0]
const estadoOriginal = cobaya.estado_envio
const aceptadaOriginal = cobaya.aceptada_por_sunat
console.log(`\n=== Cobaya: ${cobaya.serie}-${cobaya.numero} (venta ${cobaya.id_venta}), original estado_envio=${estadoOriginal} aceptada_por_sunat=${aceptadaOriginal} ===`)

async function forzar(estado, aceptada) {
  const { error } = await supabase
    .from('comprobantes_sunat')
    .update({ estado_envio: estado, aceptada_por_sunat: aceptada, fecha_actualizacion: new Date().toISOString() })
    .eq('id', cobaya.id)
  if (error) fail(`forzar ${estado}/${aceptada}: ${error.message}`)
}

try {
  // 3a) SUNAT acepta un comprobante que ya estaba ENVIADO: sube aceptados, nada más se mueve.
  await forzar('ENVIADO', true)
  const aceptado = await ambasPantallas('cobaya ENVIADO + aceptada_por_sunat=true')
  if (aceptado.aceptados !== base.aceptados + 1) {
    fail(`aceptados no subió (${base.aceptados} → ${aceptado.aceptados})`)
  }
  if (
    aceptado.enviados !== base.enviados ||
    aceptado.pendientes !== base.pendientes ||
    aceptado.error !== base.error
  ) {
    fail(`aceptar movió los otros indicadores:\n  antes: ${resumen(base)}\n  ahora: ${resumen(aceptado)}`)
  }
  console.log(`OK aceptar solo movió aceptados (${base.aceptados} → ${aceptado.aceptados}); enviados sigue en ${aceptado.enviados}`)

  // 3b) Falla el reenvío pero la aceptación previa sigue en pie: se mueve error, no aceptados.
  await forzar('ERROR', true)
  const conError = await ambasPantallas('cobaya ERROR + aceptada_por_sunat=true')
  if (conError.aceptados !== base.aceptados + 1) {
    fail(`cambiar estado_envio movió aceptados (${aceptado.aceptados} → ${conError.aceptados})`)
  }
  if (conError.error !== base.error + 1 || conError.enviados !== base.enviados - 1) {
    fail(`el eje de estado_envio no reaccionó: ${resumen(conError)}`)
  }
  console.log(`OK mover estado_envio no tocó aceptados (sigue en ${conError.aceptados})`)

  // 3c) Ni PENDIENTE ni ERROR cuentan como aceptados si SUNAT no los validó.
  await forzar('PENDIENTE', false)
  const pendiente = await ambasPantallas('cobaya PENDIENTE + aceptada_por_sunat=false')
  if (pendiente.aceptados !== base.aceptados) {
    fail(`aceptados no volvió a ${base.aceptados} (quedó en ${pendiente.aceptados})`)
  }
  if (pendiente.pendientes !== base.pendientes + 1) {
    fail(`pendientes no subió: ${resumen(pendiente)}`)
  }
  console.log(`OK un pendiente sin validar no entra en aceptados (${pendiente.aceptados})`)
} finally {
  await forzar(estadoOriginal, aceptadaOriginal)
}

const restaurado = await ambasPantallas(`tras devolver la cobaya a ${estadoOriginal}/${aceptadaOriginal}`)
if (
  restaurado.enviados !== base.enviados ||
  restaurado.pendientes !== base.pendientes ||
  restaurado.error !== base.error ||
  restaurado.aceptados !== base.aceptados
) {
  fail(`el conteo no volvió al estado inicial:\n  inicial: ${resumen(base)}\n  final  : ${resumen(restaurado)}`)
}

// ── 4) También con el recorte de periodo que usa el Dashboard ──
const desde = new Date(); desde.setHours(0, 0, 0, 0)
const hasta = new Date(); hasta.setHours(23, 59, 59, 999)
const hoy = await contarComprobantesSunat(supabase, {
  desde: desde.toISOString(),
  hasta: hasta.toISOString(),
})
console.log(`OK periodo "Hoy" → ${resumen(hoy)}`)

console.log('\nOK Aceptados es un indicador aparte y coincide en Dashboard y pantalla SUNAT')
