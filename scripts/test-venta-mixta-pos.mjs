/**
 * Venta mixta POS: 1 caja + 10 unidades del mismo producto.
 * Simula carrito, payload de la RPC, venta_detalle, descuento de stock y kardex.
 * No registra una venta real.
 */
import { armarPayloadSincronizacion } from '../src/utils/ventaUuid.js'
import {
  agregarLineaCarrito,
  cambiarCantidadLinea,
  cambiarModoVentaLinea,
  claveLineaCarrito,
  debePreguntarFormaVenta,
  etiquetaProductoTicket,
  formaVentaMenorFactor,
  productosDistintosEnCarrito,
  quitarLineaCarrito,
  unidadesBaseProducto,
} from '../src/utils/carritoPos.js'
import { validarStockOfflineCarrito, unidadesBaseDeLinea } from '../src/utils/stockOffline.js'

function fail(msg) {
  throw new Error(msg)
}

function assert(cond, msg) {
  if (!cond) fail(msg)
}

const formas = [
  { id_medida: 1, factor: 1, precio_venta: 1.5, unidades_medida: { nombre: 'UNIDAD' } },
  { id_medida: 2, factor: 20, precio_venta: 28, unidades_medida: { nombre: 'CAJA' } },
]

function lineaUnidad(overrides = {}) {
  return {
    id_producto: 99,
    producto: 'PARACETAMOL 500 MG',
    formasVenta: formas,
    id_medida: 1,
    factor: 1,
    precio: 1.5,
    modo_venta: 'UNIDAD',
    cantidad: 1,
    stock_total: 40,
    stock_disponible: 40,
    lote: 'L-1',
    subtotal: 1.5,
    ...overrides,
  }
}

console.log('=== Carrito: misma forma suma, otra forma abre línea ===')
let { carrito, error } = agregarLineaCarrito([], lineaUnidad())
assert(!error)
;({ carrito, error } = agregarLineaCarrito(carrito, lineaUnidad()))
assert(!error)
assert(carrito.length === 1 && carrito[0].cantidad === 2, 'misma forma debe sumar')

;({ carrito, error } = cambiarModoVentaLinea(carrito, claveLineaCarrito(carrito[0]), formas[1]))
assert(!error, error)
assert(carrito.length === 1 && carrito[0].modo_venta === 'CAJA')

;({ carrito, error } = agregarLineaCarrito(carrito, lineaUnidad()))
assert(!error, error)
;({ carrito, error } = cambiarCantidadLinea(carrito, claveLineaCarrito(carrito[1]), 10))
assert(!error, error)
assert(carrito.length === 2, `debían quedar 2 líneas, hay ${carrito.length}`)
assert(productosDistintosEnCarrito(carrito) === 1)
assert(unidadesBaseProducto(carrito, 99) === 30, `base ${unidadesBaseProducto(carrito, 99)}`)
console.log('OK 1 CAJA + 10 UNIDAD = 30 uds. base, 2 líneas, 1 producto')

console.log('\n=== Ticket ===')
for (const item of carrito) {
  console.log(`  ${item.cantidad} × ${etiquetaProductoTicket(item)}  S/ ${item.precio}  = S/ ${item.subtotal}`)
}

console.log('\n=== Stock: 1 caja + 10 und no puede pasar con 29 ===')
const corto = validarStockOfflineCarrito(
  carrito.map((i) => ({ ...i, stock_total: 29 })),
  [],
)
assert(!corto.ok, 'con 29 uds. debía rechazar')
const justo = validarStockOfflineCarrito(carrito, [])
assert(justo.ok, 'con 40 uds. debía pasar')
;({ error } = cambiarCantidadLinea(carrito, claveLineaCarrito(carrito[1]), 21))
assert(error, '21 und + 1 caja = 41 debía rechazar')
console.log('OK validación suma las líneas del mismo producto')

console.log('\n=== Cambiar forma a una que ya existe → junta ===')
;({ carrito, error } = cambiarModoVentaLinea(carrito, claveLineaCarrito(carrito[0]), formas[0]))
assert(!error, error)
assert(carrito.length === 1 && carrito[0].cantidad === 11 && carrito[0].modo_venta === 'UNIDAD')
console.log('OK 1 CAJA + 10 UNIDAD al pasar la caja a UNIDAD → 11 UNIDAD')

carrito = []
;({ carrito } = agregarLineaCarrito([], { ...lineaUnidad(), id_medida: 2, factor: 20, precio: 28, modo_venta: 'CAJA', subtotal: 28 }))
;({ carrito } = agregarLineaCarrito(carrito, lineaUnidad()))
;({ carrito } = cambiarCantidadLinea(carrito, claveLineaCarrito(carrito[1]), 10))
carrito = quitarLineaCarrito(carrito, claveLineaCarrito(carrito[1]))
assert(carrito.length === 1 && carrito[0].modo_venta === 'CAJA')
console.log('OK quitar línea quita solo esa forma')

carrito = []
;({ carrito } = agregarLineaCarrito([], { ...lineaUnidad(), id_medida: 2, factor: 20, precio: 28, modo_venta: 'CAJA', subtotal: 28 }))
;({ carrito } = agregarLineaCarrito(carrito, lineaUnidad()))
;({ carrito } = cambiarCantidadLinea(carrito, claveLineaCarrito(carrito[1]), 10))

const payload = armarPayloadSincronizacion({
  uuid_venta: '12345678-1234-4123-8123-1234567890ab',
  id_sucursal: 1,
  id_usuario: 1,
  tipoComprobante: 'Nota de Venta',
  serie: 'NV01',
  total: carrito.reduce((s, i) => s + Number(i.subtotal), 0),
  metodoPago: 'Efectivo',
  carrito,
}, { idTurno: 1 })

const ventaDetalle = payload.items.map((item) => ({
  id_producto: item.id_producto,
  modo_venta: item.modo_venta,
  cantidad: item.cantidad,
  factor: item.factor,
  precio_unitario: item.precio_unitario,
  subtotal: item.subtotal,
  unidades_base: item.cantidad * item.factor,
}))

const descuentoStock = ventaDetalle.reduce((s, d) => s + d.unidades_base, 0)
const kardex = ventaDetalle.map((d) => ({
  tipo: 'SALIDA',
  id_producto: d.id_producto,
  cantidad: d.unidades_base,
  observacion: `línea ${d.modo_venta}`,
}))

console.log('\n=== venta_detalle (la RPC inserta una fila por ítem) ===')
console.log(JSON.stringify(ventaDetalle, null, 2))
console.log('\n=== Descuento de stock ===')
console.log({ unidades_base_totales: descuentoStock, lotes: 'FEFO sobre inventario_lotes del producto' })
console.log('\n=== kardex_movimientos ===')
console.log(JSON.stringify(kardex, null, 2))

assert(ventaDetalle.length === 2)
assert(ventaDetalle.some((d) => d.modo_venta === 'CAJA' && d.cantidad === 1 && d.factor === 20))
assert(ventaDetalle.some((d) => d.modo_venta === 'UNIDAD' && d.cantidad === 10 && d.factor === 1))
assert(descuentoStock === 30)
assert(kardex.length === 2)
assert(kardex.every((k) => k.tipo === 'SALIDA'))
assert(kardex.reduce((s, k) => s + k.cantidad, 0) === 30)
assert(unidadesBaseDeLinea(carrito[0]) + unidadesBaseDeLinea(carrito[1]) === 30)
console.log('\nOK venta mixta: 2 filas en venta_detalle, −30 uds. stock, 2 SALIDA en kardex')
console.log('OK Nubefact no cambia: lee venta_detalle (una fila por línea, cada una con su precio)')

console.log('\n=== Forma por defecto = menor factor, no orden de BD ===')
const desorden = [
  { id_medida: 2, factor: 20, unidades_medida: { nombre: 'CAJA' } },
  { id_medida: 9, factor: 10, unidades_medida: { nombre: 'BLISTER' } },
  { id_medida: 5, factor: 1, unidades_medida: { nombre: 'UNIDAD' } },
]
const def = formaVentaMenorFactor(desorden)
assert(def?.id_medida === 5 && def.factor === 1, 'debía elegir la de factor 1 aunque no sea id_medida=1 ni la primera')
assert(!debePreguntarFormaVenta([], 99, formas), 'primera vez no pregunta')
assert(debePreguntarFormaVenta(carrito, 99, formas), 'segunda vez con 2 formas sí pregunta')
assert(!debePreguntarFormaVenta(carrito, 99, [formas[0]]), 'una sola forma no pregunta')
console.log('OK default = menor factor; modal solo si ya está y hay 2+ formas')
