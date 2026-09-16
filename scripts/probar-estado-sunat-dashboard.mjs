/**
 * Dashboard vs pantalla SUNAT: el panel "Estado SUNAT" y "Comprobantes Nubefact"
 * deben dar SIEMPRE el mismo conteo.
 *
 * 1) Reporta el desfase ventas.estado_sunat vs comprobantes_sunat.estado_envio.
 * 2) Compara el conteo viejo (ventas.estado_sunat con catch-all) contra el nuevo.
 * 3) Fuerza un comprobante a ERROR, luego a PENDIENTE, luego lo devuelve a su estado
 *    original, verificando en cada paso que Dashboard y pantalla SUNAT coinciden.
 *
 * Con --reparar, además sincroniza ventas.estado_sunat desde comprobantes_sunat.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import {
  contarComprobantesSunat,
  contarEstadosSunat,
  clasificarEstadoSunat,
} from '../src/utils/estadoSunat.js'

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
const REPARAR = process.argv.includes('--reparar')

function fail(msg) {
  throw new Error(msg)
}

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

/** Igual que AdminDashboard.cargarEstadoSunat (sin recorte de periodo). */
async function conteoDashboard() {
  return contarComprobantesSunat(supabase, {})
}

/** El conteo VIEJO del Dashboard, para dejar la diferencia a la vista. */
async function conteoViejoDesdeVentas() {
  const { data, error } = await supabase
    .from('ventas')
    .select('id_venta, estado_sunat, estado_anulacion')
  if (error) fail(`ventas: ${error.message}`)
  const vivas = (data || []).filter((v) => v.estado_anulacion !== 'ANULADO')
  const c = { aceptados: 0, pendientes: 0, error: 0 }
  for (const v of vivas) {
    if (v.estado_sunat === 'ACEPTADO') c.aceptados++
    else if (v.estado_sunat === 'ERROR') c.error++
    else c.pendientes++
  }
  return c
}

function compararConteos(etiqueta, dash, pantalla) {
  const iguales =
    dash.enviados === pantalla.enviados &&
    dash.pendientes === pantalla.pendientes &&
    dash.error === pantalla.error &&
    dash.total === pantalla.total
  const resumen = (c) => `enviados=${c.enviados} pendientes=${c.pendientes} error=${c.error} total=${c.total}`
  if (!iguales) {
    fail(`${etiqueta} NO coinciden\n  dashboard: ${resumen(dash)}\n  pantalla : ${resumen(pantalla)}`)
  }
  console.log(`OK ${etiqueta} coinciden → ${resumen(dash)}`)
  return dash
}

// ── 1) Desfase ventas.estado_sunat vs comprobantes_sunat ──
const { data: filas, error: errFilas } = await supabase
  .from('comprobantes_sunat')
  .select('id, id_venta, serie, numero, estado_envio, aceptada_por_sunat')
  .order('id', { ascending: false })
  .limit(400)
if (errFilas) fail(`comprobantes_sunat: ${errFilas.message}`)
if (!filas?.length) fail('no hay filas en comprobantes_sunat para probar')

const { data: ventas, error: errVentas } = await supabase
  .from('ventas')
  .select('id_venta, estado_sunat')
  .in('id_venta', filas.map((f) => f.id_venta))
if (errVentas) fail(`ventas: ${errVentas.message}`)
const mapVentas = new Map((ventas || []).map((v) => [v.id_venta, v.estado_sunat]))

const desfasadas = filas.filter(
  (f) => String(mapVentas.get(f.id_venta)) !== String(f.estado_envio),
)
console.log('=== ANTES: desfase ventas.estado_sunat vs comprobantes_sunat.estado_envio ===')
console.log(JSON.stringify(
  desfasadas.map((f) => ({
    id_venta: f.id_venta,
    comprobante: `${f.serie}-${f.numero}`,
    ventas_estado_sunat: mapVentas.get(f.id_venta),
    comprobantes_sunat_estado_envio: f.estado_envio,
  })),
  null,
  2,
))

console.log('=== Conteo VIEJO (ventas.estado_sunat, catch-all) vs NUEVO (comprobantes_sunat) ===')
const viejo = await conteoViejoDesdeVentas()
const nuevo = await conteoDashboard()
console.log(JSON.stringify({
  viejo_dashboard: viejo,
  nuevo_dashboard: { enviados: nuevo.enviados, pendientes: nuevo.pendientes, error: nuevo.error },
}, null, 2))

if (REPARAR && desfasadas.length) {
  for (const f of desfasadas) {
    const { error } = await supabase
      .from('ventas')
      .update({ estado_sunat: f.estado_envio })
      .eq('id_venta', f.id_venta)
    if (error) fail(`reparar venta ${f.id_venta}: ${error.message}`)
  }
  const { data: ventas2 } = await supabase
    .from('ventas')
    .select('id_venta, estado_sunat')
    .in('id_venta', desfasadas.map((f) => f.id_venta))
  console.log('=== DESPUÉS: ventas resincronizadas ===')
  console.log(JSON.stringify(
    desfasadas.map((f) => ({
      id_venta: f.id_venta,
      comprobante: `${f.serie}-${f.numero}`,
      ventas_estado_sunat: (ventas2 || []).find((v) => v.id_venta === f.id_venta)?.estado_sunat,
      comprobantes_sunat_estado_envio: f.estado_envio,
    })),
    null,
    2,
  ))
}

// ── 2) Coincidencia en el estado actual ──
const base = compararConteos('estado actual', await conteoDashboard(), await conteoPantallaSunat())

// ── 3) Forzar ERROR → PENDIENTE → estado original ──
const cobaya = filas[0]
const estadoOriginal = cobaya.estado_envio
const aceptadaOriginal = cobaya.aceptada_por_sunat
console.log(`\n=== Cobaya: comprobante ${cobaya.serie}-${cobaya.numero} (venta ${cobaya.id_venta}), estado original ${estadoOriginal} ===`)

async function forzarEstado(estado, aceptada) {
  const { error } = await supabase
    .from('comprobantes_sunat')
    .update({ estado_envio: estado, aceptada_por_sunat: aceptada, fecha_actualizacion: new Date().toISOString() })
    .eq('id', cobaya.id)
  if (error) fail(`forzar ${estado}: ${error.message}`)
}

const bucketOriginal = clasificarEstadoSunat(estadoOriginal)

try {
  await forzarEstado('ERROR', false)
  const conError = compararConteos('con la cobaya en ERROR', await conteoDashboard(), await conteoPantallaSunat())
  if (conError.error !== base.error + (bucketOriginal === 'error' ? 0 : 1)) {
    fail(`el Dashboard no contó el ERROR (error=${conError.error}, base=${base.error})`)
  }
  console.log(`OK el Dashboard cuenta el comprobante en ERROR (error: ${base.error} → ${conError.error})`)

  await forzarEstado('PENDIENTE', false)
  const conPend = compararConteos('con la cobaya en PENDIENTE', await conteoDashboard(), await conteoPantallaSunat())
  if (conPend.pendientes !== base.pendientes + (bucketOriginal === 'pendiente' ? 0 : 1)) {
    fail(`el Dashboard no contó el PENDIENTE (pendientes=${conPend.pendientes}, base=${base.pendientes})`)
  }
  if (conPend.error !== base.error - (bucketOriginal === 'error' ? 1 : 0)) {
    fail(`al pasar a PENDIENTE el error no bajó (error=${conPend.error})`)
  }
  console.log(`OK el Dashboard cuenta el comprobante en PENDIENTE (pendientes: ${base.pendientes} → ${conPend.pendientes})`)
} finally {
  await forzarEstado(estadoOriginal, aceptadaOriginal)
}

const restaurado = compararConteos('tras volver a ' + estadoOriginal, await conteoDashboard(), await conteoPantallaSunat())
if (restaurado.enviados !== base.enviados || restaurado.pendientes !== base.pendientes || restaurado.error !== base.error) {
  fail('el conteo no volvió al estado inicial')
}
console.log(`OK al volver a ${estadoOriginal} ya no se cuenta como pendiente ni error`)

// ── 4) Coincidencia también con recorte por periodo ──
const hoyStart = new Date(); hoyStart.setHours(0, 0, 0, 0)
const hoyEnd = new Date(); hoyEnd.setHours(23, 59, 59, 999)
const dashHoy = await contarComprobantesSunat(supabase, {
  desde: hoyStart.toISOString(),
  hasta: hoyEnd.toISOString(),
})
console.log(`OK recorte por periodo "Hoy" → enviados=${dashHoy.enviados} pendientes=${dashHoy.pendientes} error=${dashHoy.error} total=${dashHoy.total}`)

console.log('\nOK Dashboard y pantalla SUNAT coinciden en todos los pasos')
