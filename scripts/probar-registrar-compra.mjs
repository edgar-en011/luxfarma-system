/**
 * Prueba punta a punta de registrar_compra (incluye percepcion).
 * Crea una compra de prueba, verifica cabecera/detalle/stock/kardex y la revierte.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { armarPayloadRegistrarCompra } from '../src/utils/compraRegistro.js'

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
const SERIE = 'SFTEST'
const NUMERO = `P${Date.now().toString().slice(-8)}`

function fail(msg) {
  throw new Error(msg)
}

async function revertirCompraPrueba({
  idCompra,
  idProducto,
  idSucursal,
  nroLote,
  nroDocumento,
  stockAntes,
  loteExistaAntes,
  preciosAntes = null,
}) {
  const { error: errPag } = await supabase.from('pagos_compra').delete().eq('id_compra', idCompra)
  if (errPag) console.warn('WARN borrar pagos', errPag.message)

  const { error: errDet } = await supabase.from('compra_detalle').delete().eq('id_compra', idCompra)
  if (errDet) console.warn('WARN borrar detalle', errDet.message)

  const { error: errKdel } = await supabase
    .from('kardex_movimientos')
    .delete()
    .eq('id_producto', idProducto)
    .eq('id_sucursal', idSucursal)
    .eq('observacion', `Compra ${nroDocumento}`)
  if (errKdel) console.warn('WARN borrar kardex', errKdel.message)

  const { data: lote } = await supabase
    .from('inventario_lotes')
    .select('id_lote, cantidad_actual')
    .eq('id_producto', idProducto)
    .eq('id_sucursal', idSucursal)
    .eq('nro_lote', nroLote)
    .maybeSingle()
  if (lote?.id_lote) {
    const actual = Number(lote.cantidad_actual || 0)
    const nuevo = actual - 1
    if (nuevo <= 0 && !loteExistaAntes) {
      const { error: errLdel } = await supabase.from('inventario_lotes').delete().eq('id_lote', lote.id_lote)
      if (errLdel) console.warn('WARN borrar lote', errLdel.message)
    } else {
      const { error: errLup } = await supabase
        .from('inventario_lotes')
        .update({ cantidad_actual: Math.max(0, Number(stockAntes) || 0) })
        .eq('id_lote', lote.id_lote)
      if (errLup) console.warn('WARN revertir lote', errLup.message)
    }
  }

  const { error: errCompDel } = await supabase.from('compras').delete().eq('id_compra', idCompra)
  if (errCompDel) throw new Error(`revertir compra: ${errCompDel.message}`)

  if (preciosAntes) {
    const { error: errPre } = await supabase
      .from('producto_precios')
      .update({
        costo: preciosAntes.costo,
        precio_venta: preciosAntes.precio_venta,
        precio_caja: preciosAntes.precio_caja,
        ganancia: preciosAntes.ganancia,
      })
      .eq('id_producto', idProducto)
    if (errPre) console.warn('WARN revertir producto_precios', errPre.message)
  }
}

const { error: errCol } = await supabase.from('compras').select('percepcion').limit(1)
if (errCol) {
  console.error('COLUMNA_AUSENTE', errCol.message)
  console.error('Ejecuta en SQL Editor: sql/migracion_compras_percepcion.sql')
  process.exit(2)
}
console.log('OK columna compras.percepcion existe')

const { data: huérfanas } = await supabase
  .from('compras')
  .select('id_compra, nro_documento, id_proveedor, id_sucursal')
  .like('nro_documento', 'SFTEST-%')
for (const h of huérfanas || []) {
  const { data: dets } = await supabase
    .from('compra_detalle')
    .select('id_producto, nro_lote, cantidad')
    .eq('id_compra', h.id_compra)
  for (const d of dets || []) {
    await revertirCompraPrueba({
      idCompra: h.id_compra,
      idProducto: d.id_producto,
      idSucursal: h.id_sucursal,
      nroLote: d.nro_lote,
      nroDocumento: h.nro_documento,
      stockAntes: 0,
      loteExistaAntes: false,
    }).catch((e) => console.warn('WARN limpiar huérfana', e.message))
  }
  if (!dets?.length) {
    await supabase.from('pagos_compra').delete().eq('id_compra', h.id_compra)
    await supabase.from('compras').delete().eq('id_compra', h.id_compra)
  }
  console.log('OK limpia huérfana', h.id_compra, h.nro_documento)
}

const { data: sucursal, error: errS } = await supabase
  .from('sucursales')
  .select('id_sucursal')
  .limit(1)
  .maybeSingle()
if (errS || !sucursal) fail(`sucursal: ${errS?.message || 'ninguna'}`)

const { data: proveedor, error: errP } = await supabase
  .from('proveedores')
  .select('id_proveedor')
  .limit(1)
  .maybeSingle()
if (errP || !proveedor) fail(`proveedor: ${errP?.message || 'ninguno'}`)

const { data: usuario, error: errU } = await supabase
  .from('usuarios')
  .select('id_usuario')
  .limit(1)
  .maybeSingle()
if (errU || !usuario) fail(`usuario: ${errU?.message || 'ninguno'}`)

const { data: producto, error: errPr } = await supabase
  .from('productos')
  .select('id_producto, descripcion')
  .eq('activo', 1)
  .limit(1)
  .maybeSingle()
if (errPr || !producto) fail(`producto: ${errPr?.message || 'ninguno'}`)

const nroLote = `${SERIE}-${NUMERO}`
const nroDocumento = `${SERIE}-${NUMERO}`
const { data: loteAntes } = await supabase
  .from('inventario_lotes')
  .select('id_lote, cantidad_actual')
  .eq('id_producto', producto.id_producto)
  .eq('id_sucursal', sucursal.id_sucursal)
  .eq('nro_lote', nroLote)
  .maybeSingle()
const stockAntes = Number(loteAntes?.cantidad_actual || 0)
const loteExistaAntes = !!loteAntes?.id_lote
const { data: preciosAntes } = await supabase
  .from('producto_precios')
  .select('costo, precio_venta, precio_caja, ganancia')
  .eq('id_producto', producto.id_producto)
  .limit(1)
  .maybeSingle()

const payload = armarPayloadRegistrarCompra({
  id_sucursal: sucursal.id_sucursal,
  id_proveedor: proveedor.id_proveedor,
  id_usuario: usuario.id_usuario,
  comprobante: {
    tipo: 'Factura Electrónica',
    serie: SERIE,
    numero: NUMERO,
    fechaCompra: new Date().toISOString().slice(0, 10),
    formaPago: 'Contado',
  },
  total_compra: 11.8,
  percepcion: 1.8,
  actualiza_precios: false,
  items: [
    {
      id_producto: producto.id_producto,
      nro_lote: nroLote,
      cantidad: 1,
      costo_unitario: 10,
      subtotal: 10,
    },
  ],
})

const { data, error } = await supabase.rpc('registrar_compra', { p_payload: payload })
if (error) fail(`rpc: ${error.message}`)
const row = typeof data === 'string' ? JSON.parse(data) : (data || {})
if (!row.ok) fail(`rpc ok=false: ${row.error}`)
if (row.ya_existia) fail(`la factura de prueba ya existía (#${row.id_compra})`)
console.log('OK rpc id_compra', row.id_compra)

let okPuntaAPunta = false
try {
  const { data: compra, error: errC } = await supabase
    .from('compras')
    .select('id_compra, total_compra, percepcion, nro_documento, serie, numero')
    .eq('id_compra', row.id_compra)
    .maybeSingle()
  if (errC || !compra) fail(`leer compra: ${errC?.message || 'vacío'}`)
  if (Number(compra.percepcion) !== 1.8) fail(`percepcion=${compra.percepcion}, esperado 1.8`)
  if (Number(compra.total_compra) !== 11.8) fail(`total_compra=${compra.total_compra}, esperado 11.8`)
  console.log('OK cabecera', {
    nro: compra.nro_documento,
    percepcion: Number(compra.percepcion),
    total: Number(compra.total_compra),
  })

  const { data: det, error: errD } = await supabase
    .from('compra_detalle')
    .select('id_producto, nro_lote, cantidad, costo_unitario, subtotal')
    .eq('id_compra', row.id_compra)
  if (errD) fail(`detalle: ${errD.message}`)
  if (!det?.length) fail('sin líneas de detalle')
  if (Number(det[0].cantidad) !== 1) fail(`detalle.cantidad=${det[0].cantidad}`)
  console.log('OK detalle', det.length, 'linea(s)')

  const { data: loteDesp } = await supabase
    .from('inventario_lotes')
    .select('id_lote, cantidad_actual')
    .eq('id_producto', producto.id_producto)
    .eq('id_sucursal', sucursal.id_sucursal)
    .eq('nro_lote', nroLote)
    .maybeSingle()
  const stockDesp = Number(loteDesp?.cantidad_actual || 0)
  if (stockDesp !== stockAntes + 1) fail(`stock ${stockAntes} → ${stockDesp}, esperado ${stockAntes + 1}`)
  console.log('OK stock lote', stockAntes, '→', stockDesp)

  const { data: kardex, error: errK } = await supabase
    .from('kardex_movimientos')
    .select('tipo, cantidad, saldo, observacion')
    .eq('id_producto', producto.id_producto)
    .eq('id_sucursal', sucursal.id_sucursal)
    .eq('observacion', `Compra ${nroDocumento}`)
    .limit(5)
  if (errK) fail(`kardex: ${errK.message}`)
  if (!kardex?.length) fail('sin kardex de la compra')
  if (Number(kardex[0].cantidad) !== 1) fail(`kardex.cantidad=${kardex[0].cantidad}`)
  console.log('OK kardex', kardex[0])
  okPuntaAPunta = true
} finally {
  await revertirCompraPrueba({
    idCompra: row.id_compra,
    idProducto: producto.id_producto,
    idSucursal: sucursal.id_sucursal,
    nroLote,
    nroDocumento,
    stockAntes,
    loteExistaAntes,
    preciosAntes,
  })
  const { data: sigue } = await supabase.from('compras').select('id_compra').eq('id_compra', row.id_compra).maybeSingle()
  if (sigue) fail(`la compra #${row.id_compra} no se revirtió`)
  console.log('OK revertido; registro de compra funcionó de punta a punta')
}
if (!okPuntaAPunta) process.exit(1)
