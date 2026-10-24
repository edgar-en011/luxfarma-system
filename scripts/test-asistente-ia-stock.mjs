import assert from 'node:assert/strict';
import {
  buscarProductosParaStock,
  construirDetallesStock,
  esConsultaStockActual,
  respuestaStockExacto,
} from '../src/utils/stockAsistenteIA.js';

const productos = [
  {
    id_producto: 1,
    descripcion: 'Paracetamol 500 mg caja 100 tabletas',
    codigo_barras: '775000000001',
    producto_formas_venta: [
      { factor: 10, activo: true, unidades_medida: { nombre: 'Blíster' } },
      { factor: 1, activo: true, unidades_medida: { nombre: 'Unidad' } },
    ],
  },
  { id_producto: 2, descripcion: 'Paracetamol jarabe 120 mg', codigo_barras: '775000000002' },
  { id_producto: 3, descripcion: 'Ibuprofeno 400 mg', codigo_barras: '775000000003' },
];

assert.equal(esConsultaStockActual('¿Cuál es el stock actual de Paracetamol 500 mg?'), true);
assert.equal(esConsultaStockActual('¿Cuánto queda de ibuprofeno?'), true);
assert.equal(esConsultaStockActual('¿Hay Paracetamol?'), true);
assert.equal(esConsultaStockActual('¿Cuál es la cantidad disponible de Ibuprofeno?'), true);
assert.equal(esConsultaStockActual('¿Qué productos tienen stock bajo?'), false);

const coincidenciaNombre = buscarProductosParaStock('stock actual de paracetamol 500 mg', productos);
assert.equal(coincidenciaNombre[0].id_producto, 1);
const coincidenciaCodigo = buscarProductosParaStock('existencias 775000000003', productos);
assert.deepEqual(coincidenciaCodigo.map((p) => p.id_producto), [3]);

const detalles = construirDetallesStock(
  [productos[0]],
  [
    { id_producto: 1, id_sucursal: 1, cantidad_actual: 17, estado: 'VIGENTE', fecha_vencimiento: '2027-01-01' },
    { id_producto: 1, id_sucursal: 1, cantidad_actual: 4, estado: 'VENCIDO', fecha_vencimiento: '2026-10-01' },
    { id_producto: 1, id_sucursal: 2, cantidad_actual: 8, estado: 'VIGENTE', fecha_vencimiento: '2027-02-01' },
    { id_producto: 1, id_sucursal: 2, cantidad_actual: 3, estado: 'VIGENTE', fecha_vencimiento: '2026-10-20' },
    { id_producto: 1, id_sucursal: 2, cantidad_actual: 999, estado: 'AGOTADO' },
  ],
  [
    { id_sucursal: 1, nombre_comercial: 'Centro' },
    { id_sucursal: 2, nombre_comercial: 'Norte' },
  ],
  'TODAS',
  new Date(2026, 9, 24, 12, 0, 0),
);

assert.equal(detalles[0].disponible, 25, 'solo suma lotes VIGENTE como disponible');
assert.equal(detalles[0].vencido, 7, 'separa VENCIDO y VIGENTE con fecha ya vencida');
assert.equal(detalles[0].fisico, 32, 'físico = vigente no vencido + vencido efectivo');
assert.equal(detalles[0].equivalenciaDisponible, '2 × Blíster + 5 × Unidad');
assert.match(respuestaStockExacto(detalles), /Disponible para venta: \*\*25 unidades base\*\*/);
assert.match(respuestaStockExacto(detalles), /Vencido\/no vendible: \*\*7 unidades base\*\*/);

console.log('OK: las consultas de stock usan datos exactos y separan vigente, vencido y físico.');

