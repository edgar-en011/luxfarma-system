/**
 * CPP en registrar_compra:
 *  1) Corrige Azitromicina F004-1406500 lote 2039946 → 4.90 (solo ese producto).
 *  2) Simula 2 líneas en la misma factura a costos distintos.
 *  3) Simula una compra posterior (otra fecha/número) sobre stock existente.
 *  4) Verifica que una línea Bonificación no diluya el costo.
 * Todo lo de prueba se revierte. Azitromicina queda corregida.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { armarPayloadRegistrarCompra } from '../src/utils/compraRegistro.js'
import { costoPromedioPonderadoLote, costoPromedioPonderadoProducto } from '../src/utils/costoPromedioPonderado.js'
import {
  aplicarCostoPromedioPonderadoCompra,
  snapshotLotesParaCpp,
} from '../src/utils/aplicarCppCompra.js'

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
const ID_AZITRO = 22466
const LOTE_AZITRO = '2039946'
const COSTO_CPP_AZITRO = 4.9
const SERIE = 'SFTEST'
const stamp = Date.now().toString().slice(-8)

function fail(msg) {
  throw new Error(msg)
}

function casiIgual(a, b, tol = 0.0001) {
  return Math.abs(Number(a) - Number(b)) <= tol
}

function assertCasi(actual, esperado, etiqueta) {
  if (!casiIgual(actual, esperado)) {
    fail(`${etiqueta}: ${actual}, esperado ${esperado}`)
  }
}

async function leerAzitro() {
  const { data: prod } = await supabase
    .from('productos')
    .select('id_producto, descripcion')
    .eq('id_producto', ID_AZITRO)
    .maybeSingle()
  const { data: precios } = await supabase
    .from('producto_precios')
    .select('costo, precio_venta, ganancia')
    .eq('id_producto', ID_AZITRO)
    .limit(1)
    .maybeSingle()
  const { data: lotes } = await supabase
    .from('inventario_lotes')
    .select('id_lote, nro_lote, cantidad_actual, costo_unitario_lote, estado')
    .eq('id_producto', ID_AZITRO)
  const { data: det } = await supabase
    .from('compra_detalle')
    .select('cantidad, costo_unitario, subtotal, nro_lote')
    .eq('id_compra', 30)
    .eq('id_producto', ID_AZITRO)
  return { prod, precios, lotes, det }
}

function resumenAzitro(row) {
  const lote = (row.lotes || []).find((l) => l.nro_lote === LOTE_AZITRO)
  const qty = Number(lote?.cantidad_actual || 0)
  const costoLote = Number(lote?.costo_unitario_lote || 0)
  const costoCat = Number(row.precios?.costo || 0)
  return {
    producto: row.prod?.descripcion,
    lineas_factura: (row.det || []).map((d) => ({
      qty: Number(d.cantidad),
      costo: Number(d.costo_unitario),
      subtotal: Number(d.subtotal),
    })),
    lote: LOTE_AZITRO,
    stock: qty,
    costo_lote: costoLote,
    inversion_lote: qty * costoLote,
    costo_catalogo: costoCat,
    precio_venta: Number(row.precios?.precio_venta || 0),
    ganancia: Number(row.precios?.ganancia || 0),
    inversion_catalogo: qty * costoCat,
  }
}

async function cppCatalogoProducto(idProducto) {
  const { data: lotes, error } = await supabase
    .from('inventario_lotes')
    .select('cantidad_actual, costo_unitario_lote, estado')
    .eq('id_producto', idProducto)
  if (error) fail(`lotes catálogo: ${error.message}`)
  return costoPromedioPonderadoProducto(lotes || [])
}

async function rpcCompra(payload) {
  const snapshot = await snapshotLotesParaCpp(supabase, payload)
  const { data, error } = await supabase.rpc('registrar_compra', { p_payload: payload })
  if (error) fail(`rpc: ${error.message}`)
  const row = typeof data === 'string' ? JSON.parse(data) : (data || {})
  if (!row.ok) fail(`rpc ok=false: ${row.error}`)
  if (row.ya_existia) fail(`la factura de prueba ya existía (#${row.id_compra})`)
  await aplicarCostoPromedioPonderadoCompra(supabase, payload, snapshot)
  return row
}

async function revertirComprasPrueba({
  idsCompra,
  idProducto,
  idSucursal,
  lotesNuevos,
  preciosAntes,
}) {
  for (const idCompra of idsCompra) {
    await supabase.from('pagos_compra').delete().eq('id_compra', idCompra)
    await supabase.from('compra_detalle').delete().eq('id_compra', idCompra)
    const { data: c } = await supabase
      .from('compras')
      .select('nro_documento')
      .eq('id_compra', idCompra)
      .maybeSingle()
    if (c?.nro_documento) {
      await supabase
        .from('kardex_movimientos')
        .delete()
        .eq('id_producto', idProducto)
        .eq('id_sucursal', idSucursal)
        .eq('observacion', `Compra ${c.nro_documento}`)
    }
    await supabase.from('compras').delete().eq('id_compra', idCompra)
  }
  for (const nroLote of lotesNuevos) {
    await supabase
      .from('inventario_lotes')
      .delete()
      .eq('id_producto', idProducto)
      .eq('id_sucursal', idSucursal)
      .eq('nro_lote', nroLote)
  }
  if (preciosAntes) {
    const { error } = await supabase
      .from('producto_precios')
      .update({
        costo: preciosAntes.costo,
        precio_venta: preciosAntes.precio_venta,
        precio_caja: preciosAntes.precio_caja,
        ganancia: preciosAntes.ganancia,
      })
      .eq('id_producto', idProducto)
    if (error) console.warn('WARN revertir precios', error.message)
  }
}

console.log('=== ANTES Azitromicina F004-1406500 / lote 2039946 ===')
const antes = resumenAzitro(await leerAzitro())
console.log(JSON.stringify(antes, null, 2))

if (Number(antes.stock) !== 8) {
  console.warn('WARN stock Azitromicina no es 8; se corrige el costo igual')
}

if (casiIgual(antes.costo_lote, COSTO_CPP_AZITRO) && casiIgual(antes.costo_catalogo, COSTO_CPP_AZITRO)) {
  console.log('OK Azitromicina ya estaba en CPP 4.90')
} else {
  const { error: errLote } = await supabase
    .from('inventario_lotes')
    .update({ costo_unitario_lote: COSTO_CPP_AZITRO })
    .eq('id_producto', ID_AZITRO)
    .eq('nro_lote', LOTE_AZITRO)
  if (errLote) fail(`corregir lote: ${errLote.message}`)

  const gananciaNueva = Math.round((Number(antes.precio_venta) - COSTO_CPP_AZITRO) * 10000) / 10000
  const { error: errPre } = await supabase
    .from('producto_precios')
    .update({ costo: COSTO_CPP_AZITRO, ganancia: gananciaNueva })
    .eq('id_producto', ID_AZITRO)
  if (errPre) fail(`corregir producto_precios: ${errPre.message}`)

  console.log('=== DESPUÉS Azitromicina (solo este producto; resto de F004-1406500 intacto) ===')
  const despues = resumenAzitro(await leerAzitro())
  console.log(JSON.stringify(despues, null, 2))
  assertCasi(despues.costo_lote, COSTO_CPP_AZITRO, 'costo lote Azitromicina')
  assertCasi(despues.costo_catalogo, COSTO_CPP_AZITRO, 'costo catálogo Azitromicina')
  console.log('OK corrección Azitromicina 0.10 → 4.90')
}

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
  .neq('id_producto', ID_AZITRO)
  .limit(1)
  .maybeSingle()
if (errPr || !producto) fail(`producto prueba: ${errPr?.message || 'ninguno'}`)

const { data: preciosAntes } = await supabase
  .from('producto_precios')
  .select('costo, precio_venta, precio_caja, ganancia')
  .eq('id_producto', producto.id_producto)
  .limit(1)
  .maybeSingle()

const loteA = `CPP1-${stamp}`
const loteB = `CPP2-${stamp}`
const idsCompra = []
const hoy = new Date().toISOString().slice(0, 10)
const ayer = new Date(Date.now() - 86400000).toISOString().slice(0, 10)

try {
  // ── Caso 1: misma factura, 2 líneas mismo lote, costos distintos (Azitromicina) ──
  const num1 = `A${stamp}`
  const row1 = await rpcCompra(armarPayloadRegistrarCompra({
    id_sucursal: sucursal.id_sucursal,
    id_proveedor: proveedor.id_proveedor,
    id_usuario: usuario.id_usuario,
    comprobante: {
      tipo: 'Factura Electrónica',
      serie: SERIE,
      numero: num1,
      fechaCompra: hoy,
      formaPago: 'Contado',
    },
    total_compra: 39.2,
    actualiza_precios: true,
    items: [
      { id_producto: producto.id_producto, nro_lote: loteA, cantidad: 6, costo_unitario: 6.5, subtotal: 39, p_venta: 12 },
      { id_producto: producto.id_producto, nro_lote: loteA, cantidad: 2, costo_unitario: 0.1, subtotal: 0.2, p_venta: 12 },
    ],
  }))
  idsCompra.push(row1.id_compra)

  const { data: det1 } = await supabase
    .from('compra_detalle')
    .select('cantidad, costo_unitario')
    .eq('id_compra', row1.id_compra)
    .order('costo_unitario', { ascending: false })
  if ((det1 || []).length !== 2) fail(`detalle caso 1: ${det1?.length} líneas`)
  assertCasi(det1[0].costo_unitario, 6.5, 'detalle línea 1 debe conservar 6.50')
  assertCasi(det1[1].costo_unitario, 0.1, 'detalle línea 2 debe conservar 0.10')

  const { data: lote1 } = await supabase
    .from('inventario_lotes')
    .select('cantidad_actual, costo_unitario_lote')
    .eq('id_producto', producto.id_producto)
    .eq('id_sucursal', sucursal.id_sucursal)
    .eq('nro_lote', loteA)
    .maybeSingle()
  assertCasi(lote1?.cantidad_actual, 8, 'stock caso 1')
  const esperado1 = costoPromedioPonderadoLote({
    stockActual: 6, costoActual: 6.5, cantidadNueva: 2, costoNueva: 0.1,
  })
  if (!casiIgual(lote1?.costo_unitario_lote, esperado1)) {
    fail(`CPP lote caso 1: ${lote1?.costo_unitario_lote}, esperado ${esperado1} (no debe quedar 0.10)`)
  }
  const { data: cat1 } = await supabase
    .from('producto_precios')
    .select('costo')
    .eq('id_producto', producto.id_producto)
    .limit(1)
    .maybeSingle()
  const cppCat1 = await cppCatalogoProducto(producto.id_producto)
  assertCasi(cat1?.costo, cppCat1, 'catálogo caso 1 = CPP de todo el stock vigente')
  if (casiIgual(lote1?.costo_unitario_lote, 0.1)) fail('el lote quedó en el último costo 0.10')
  console.log('OK caso 1 misma factura 2 líneas', {
    producto: producto.descripcion,
    lote: loteA,
    stock: Number(lote1.cantidad_actual),
    costo_lote: Number(lote1.costo_unitario_lote),
    costo_catalogo: Number(cat1.costo),
  })

  // ── Caso 2: compra nueva, otra fecha, producto que YA tiene stock ──
  const num2 = `B${stamp}`
  const row2 = await rpcCompra(armarPayloadRegistrarCompra({
    id_sucursal: sucursal.id_sucursal,
    id_proveedor: proveedor.id_proveedor,
    id_usuario: usuario.id_usuario,
    comprobante: {
      tipo: 'Factura Electrónica',
      serie: SERIE,
      numero: num2,
      fechaCompra: ayer,
      formaPago: 'Contado',
    },
    total_compra: 40,
    actualiza_precios: true,
    items: [
      { id_producto: producto.id_producto, nro_lote: loteA, cantidad: 4, costo_unitario: 10, subtotal: 40, p_venta: 12 },
    ],
  }))
  idsCompra.push(row2.id_compra)

  const esperado2 = costoPromedioPonderadoLote({
    stockActual: 8, costoActual: esperado1, cantidadNueva: 4, costoNueva: 10,
  })
  const { data: lote2 } = await supabase
    .from('inventario_lotes')
    .select('cantidad_actual, costo_unitario_lote')
    .eq('id_producto', producto.id_producto)
    .eq('id_sucursal', sucursal.id_sucursal)
    .eq('nro_lote', loteA)
    .maybeSingle()
  assertCasi(lote2?.cantidad_actual, 12, 'stock caso 2')
  assertCasi(lote2?.costo_unitario_lote, esperado2, 'CPP compra posterior (no sobrescribir con 10)')
  const { data: cat2 } = await supabase
    .from('producto_precios')
    .select('costo')
    .eq('id_producto', producto.id_producto)
    .limit(1)
    .maybeSingle()
  const cppCat2 = await cppCatalogoProducto(producto.id_producto)
  assertCasi(cat2?.costo, cppCat2, 'catálogo caso 2 = CPP de todo el stock vigente')
  if (casiIgual(lote2?.costo_unitario_lote, 10)) fail('el lote quedó en el último costo 10 (sobrescritura)')
  console.log('OK caso 2 compra posterior otra fecha', {
    fechas: { primera: hoy, segunda: ayer },
    stock: Number(lote2.cantidad_actual),
    costo_lote: Number(lote2.costo_unitario_lote),
    costo_catalogo: Number(cat2.costo),
    no_es_ultimo_precio: !casiIgual(lote2.costo_unitario_lote, 10),
  })

  // ── Caso 3: lote nuevo + línea bonificación no diluye el CPP del producto ──
  const num3 = `C${stamp}`
  const cppAntesBonif = Number(cat2?.costo)
  const row3 = await rpcCompra(armarPayloadRegistrarCompra({
    id_sucursal: sucursal.id_sucursal,
    id_proveedor: proveedor.id_proveedor,
    id_usuario: usuario.id_usuario,
    comprobante: {
      tipo: 'Factura Electrónica',
      serie: SERIE,
      numero: num3,
      fechaCompra: hoy,
      formaPago: 'Contado',
    },
    total_compra: 0,
    actualiza_precios: true,
    items: [
      {
        id_producto: producto.id_producto,
        nro_lote: loteB,
        cantidad: 5,
        costo_unitario: 0,
        subtotal: 0,
        bonificacion: true,
        p_venta: 12,
      },
    ],
  }))
  idsCompra.push(row3.id_compra)

  const { data: loteBonif } = await supabase
    .from('inventario_lotes')
    .select('cantidad_actual, costo_unitario_lote')
    .eq('id_producto', producto.id_producto)
    .eq('id_sucursal', sucursal.id_sucursal)
    .eq('nro_lote', loteB)
    .maybeSingle()
  assertCasi(loteBonif?.cantidad_actual, 5, 'stock bonificación')
  assertCasi(loteBonif?.costo_unitario_lote, cppAntesBonif, 'lote regalo hereda CPP, no 0')

  const { data: cat3 } = await supabase
    .from('producto_precios')
    .select('costo')
    .eq('id_producto', producto.id_producto)
    .limit(1)
    .maybeSingle()
  assertCasi(cat3?.costo, cppAntesBonif, 'catálogo no se diluye con bonificación')
  console.log('OK caso 3 bonificación no diluye', {
    lote_regalo: loteB,
    costo_lote_regalo: Number(loteBonif.costo_unitario_lote),
    costo_catalogo: Number(cat3.costo),
  })
} finally {
  await revertirComprasPrueba({
    idsCompra,
    idProducto: producto.id_producto,
    idSucursal: sucursal.id_sucursal,
    lotesNuevos: [loteA, loteB],
    preciosAntes,
  })
  console.log('OK pruebas revertidas; catálogo de', producto.descripcion, 'restaurado')
}

console.log('OK CPP punta a punta')
