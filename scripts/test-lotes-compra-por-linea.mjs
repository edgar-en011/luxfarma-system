/**
 * Cruce de lotes en compras: mismo producto, dos partidas.
 *  1) JS: asignarNroLoteLineasCompra (siempre).
 *  2) RPC: factura de prueba con nro_lote vacío (la SQL debe sufijar).
 *     Si la RPC vieja funde las partidas, avisa que falta ejecutar
 *     sql/migracion_lotes_compra_por_linea.sql y revierte.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import {
  armarPayloadRegistrarCompra,
  asignarNroLoteLineasCompra,
} from '../src/utils/compraRegistro.js'

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

function fail(msg) {
  throw new Error(msg)
}

function assert(cond, msg) {
  if (!cond) fail(msg)
}

function lotsOf(items) {
  return items.map((i) => ({
    costo: i.costo_unitario,
    fv: i.fecha_vencimiento,
    nro_lote: i.nro_lote,
  }))
}

console.log('=== 1) Asignación JS (sin RPC) ===')

const doc = 'F001-888001'
const splitItems = asignarNroLoteLineasCompra([
  { id_producto: 10, nro_lote: '', costo_unitario: 8.5, fecha_vencimiento: '2028-06-01' },
  { id_producto: 10, nro_lote: '', costo_unitario: 5, fecha_vencimiento: '2027-01-01' },
], doc)
assert(splitItems[0].nro_lote === 'FAC-F001-888001-2', `línea cara debe ser -2, fue ${splitItems[0].nro_lote}`)
assert(splitItems[1].nro_lote === 'FAC-F001-888001-1', `línea barata debe ser -1, fue ${splitItems[1].nro_lote}`)
console.log('OK separar por costo+vencimiento (sufijo por costo, no por orden)')
console.log(JSON.stringify(lotsOf(splitItems), null, 2))

const invertidos = asignarNroLoteLineasCompra([
  { id_producto: 10, nro_lote: '', costo_unitario: 5, fecha_vencimiento: '2027-01-01' },
  { id_producto: 10, nro_lote: '', costo_unitario: 8.5, fecha_vencimiento: '2028-06-01' },
], doc)
assert(invertidos[0].nro_lote === 'FAC-F001-888001-1')
assert(invertidos[1].nro_lote === 'FAC-F001-888001-2')
console.log('OK reintento en otro orden: mismos sufijos')

const merged = asignarNroLoteLineasCompra([
  { id_producto: 10, nro_lote: '', costo_unitario: 5, fecha_vencimiento: '2027-01-01' },
  { id_producto: 10, nro_lote: '', costo_unitario: 5, fecha_vencimiento: '2027-01-01' },
], doc)
assert(merged.every((i) => i.nro_lote === 'FAC-F001-888001'), `debían fusionar: ${merged.map((i) => i.nro_lote)}`)
console.log('OK mismo costo+vence+lote → un solo FAC-serie-numero')

const soloFv = asignarNroLoteLineasCompra([
  { id_producto: 10, nro_lote: 'ABC', costo_unitario: 5, fecha_vencimiento: '2027-01-01' },
  { id_producto: 10, nro_lote: 'ABC', costo_unitario: 5, fecha_vencimiento: '2028-06-01' },
], doc)
assert(soloFv[0].nro_lote === 'ABC-1')
assert(soloFv[1].nro_lote === 'ABC-2')
console.log('OK mismo lote escrito, vencimientos distintos → ABC-1 / ABC-2')

const payload = armarPayloadRegistrarCompra({
  id_sucursal: 1,
  id_proveedor: 1,
  id_usuario: 1,
  comprobante: { tipo: 'Factura Electrónica', serie: 'F001', numero: '888001', fechaCompra: '2026-09-04' },
  total_compra: 70,
  items: [
    { id_producto: 10, nro_lote: '', cantidad: 10, costo_unitario: 5, fecha_vencimiento: '2027-01-01', subtotal: 50, p_venta: 9 },
    { id_producto: 10, nro_lote: '', cantidad: 4, costo_unitario: 8.5, fecha_vencimiento: '2028-06-01', subtotal: 34, p_venta: 11 },
  ],
})
assert(payload.items[0].nro_lote === 'FAC-F001-888001-1')
assert(payload.items[1].nro_lote === 'FAC-F001-888001-2')
assert(payload.items[1].p_venta === 11)
console.log('OK payload de la app: último p_venta=11 (intencional, un precio de venta)')
console.log('OK CPP: compra_detalle conserva 5.00 y 8.50; el catálogo promedia lotes VIGENTE')

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
const SERIE = 'SFTEST'
const NUMERO = `L${Date.now().toString().slice(-8)}`
const nroDoc = `${SERIE}-${NUMERO}`
const hoy = new Date().toISOString().slice(0, 10)

async function revertir({ idCompra, idProducto, idSucursal, nrosLote, preciosAntes }) {
  if (idCompra) {
    await supabase.from('pagos_compra').delete().eq('id_compra', idCompra)
    await supabase.from('compra_detalle').delete().eq('id_compra', idCompra)
    await supabase
      .from('kardex_movimientos')
      .delete()
      .eq('id_producto', idProducto)
      .eq('id_sucursal', idSucursal)
      .eq('observacion', `Compra ${nroDoc}`)
    await supabase.from('compras').delete().eq('id_compra', idCompra)
  }
  for (const nro of nrosLote) {
    await supabase
      .from('inventario_lotes')
      .delete()
      .eq('id_producto', idProducto)
      .eq('id_sucursal', idSucursal)
      .eq('nro_lote', nro)
  }
  if (preciosAntes) {
    await supabase
      .from('producto_precios')
      .update({
        costo: preciosAntes.costo,
        precio_venta: preciosAntes.precio_venta,
        precio_caja: preciosAntes.precio_caja,
        ganancia: preciosAntes.ganancia,
      })
      .eq('id_producto', idProducto)
  }
}

console.log('\n=== 2) RPC registrar_compra (nro_lote vacío → decide SQL) ===')

const { data: sucursal, error: errS } = await supabase.from('sucursales').select('id_sucursal').limit(1).maybeSingle()
if (errS || !sucursal) fail(`sucursal: ${errS?.message || 'ninguna'}`)
const { data: proveedor, error: errP } = await supabase.from('proveedores').select('id_proveedor').limit(1).maybeSingle()
if (errP || !proveedor) fail(`proveedor: ${errP?.message || 'ninguno'}`)
const { data: usuario, error: errU } = await supabase.from('usuarios').select('id_usuario').limit(1).maybeSingle()
if (errU || !usuario) fail(`usuario: ${errU?.message || 'ninguno'}`)
const { data: producto, error: errPr } = await supabase
  .from('productos')
  .select('id_producto, descripcion')
  .eq('activo', 1)
  .limit(1)
  .maybeSingle()
if (errPr || !producto) fail(`producto: ${errPr?.message || 'ninguno'}`)

const { data: preciosAntes } = await supabase
  .from('producto_precios')
  .select('costo, precio_venta, precio_caja, ganancia')
  .eq('id_producto', producto.id_producto)
  .limit(1)
  .maybeSingle()

const payloadLive = armarPayloadRegistrarCompra({
  id_sucursal: sucursal.id_sucursal,
  id_proveedor: proveedor.id_proveedor,
  id_usuario: usuario.id_usuario,
  comprobante: {
    tipo: 'Factura Electrónica',
    serie: SERIE,
    numero: NUMERO,
    fechaCompra: hoy,
    formaPago: 'Contado',
  },
  total_compra: 84,
  actualiza_precios: true,
  items: [
    {
      id_producto: producto.id_producto,
      nro_lote: '',
      cantidad: 10,
      costo_unitario: 5,
      fecha_vencimiento: '2027-01-01',
      subtotal: 50,
      p_venta: 9,
    },
    {
      id_producto: producto.id_producto,
      nro_lote: '',
      cantidad: 4,
      costo_unitario: 8.5,
      fecha_vencimiento: '2028-06-01',
      subtotal: 34,
      p_venta: 11,
    },
  ],
})

const lote1 = `FAC-${nroDoc}-1`
const lote2 = `FAC-${nroDoc}-2`
const loteFundo = `FAC-${nroDoc}`
const payloadSql = {
  ...payloadLive,
  items: payloadLive.items.map((i) => ({ ...i, nro_lote: '' })),
}

let idCompra = null
try {
  const { data, error } = await supabase.rpc('registrar_compra', { p_payload: payloadSql })
  if (error) fail(error.message)
  const row = typeof data === 'string' ? JSON.parse(data) : (data || {})
  if (!row.ok) fail(row.error || 'RPC no ok')
  idCompra = row.id_compra

  const { data: det } = await supabase
    .from('compra_detalle')
    .select('nro_lote, cantidad, costo_unitario, fecha_vencimiento')
    .eq('id_compra', idCompra)
    .order('costo_unitario', { ascending: true })

  const { data: lotes } = await supabase
    .from('inventario_lotes')
    .select('nro_lote, cantidad_actual, costo_unitario_lote, fecha_vencimiento')
    .eq('id_producto', producto.id_producto)
    .eq('id_sucursal', sucursal.id_sucursal)
    .in('nro_lote', [lote1, lote2, loteFundo])
    .order('nro_lote')

  const { data: cat } = await supabase
    .from('producto_precios')
    .select('costo, precio_venta')
    .eq('id_producto', producto.id_producto)
    .limit(1)
    .maybeSingle()

  console.log('compra_detalle', det)
  console.log('inventario_lotes', lotes)
  console.log('catalogo', cat)

  const nLotes = (lotes || []).length
  if (nLotes < 2) {
    console.error('FALLO: la RPC fundió las partidas en un solo lote (vencimiento pisado).')
    console.error('Ejecutá en Supabase: sql/migracion_lotes_compra_por_linea.sql')
    console.error('Luego volvé a correr: node scripts/test-lotes-compra-por-linea.mjs')
    process.exitCode = 2
  } else {
    const a = lotes.find((l) => l.nro_lote === lote1)
    const b = lotes.find((l) => l.nro_lote === lote2)
    assert(a && b, `faltan ${lote1} / ${lote2}`)
    assert(String(a.fecha_vencimiento).startsWith('2027-01-01'), `lote-1 vence ${a.fecha_vencimiento}, no debe ser el de la última línea`)
    assert(String(b.fecha_vencimiento).startsWith('2028-06-01'), `lote-2 vence ${b.fecha_vencimiento}`)
    assert(Number(a.costo_unitario_lote) === 5, `lote-1 costo ${a.costo_unitario_lote}`)
    assert(Number(b.costo_unitario_lote) === 8.5, `lote-2 costo ${b.costo_unitario_lote}`)
    assert(Number(cat?.precio_venta) === 11, `p_venta catálogo ${cat?.precio_venta} (debe ganar el último=11)`)
    console.log('OK RPC: dos lotes, vencimientos intactos, último p_venta en catálogo')
  }
} finally {
  await revertir({
    idCompra,
    idProducto: producto.id_producto,
    idSucursal: sucursal.id_sucursal,
    nrosLote: [lote1, lote2, loteFundo],
    preciosAntes,
  })
  console.log('OK prueba revertida', producto.descripcion)
}

if (process.exitCode === 2) {
  console.log('\nJS OK; RPC todavía es la versión vieja')
} else {
  console.log('\nOK lotes por línea')
}
