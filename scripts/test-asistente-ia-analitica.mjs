import assert from 'node:assert/strict';
import { construirResumenAsistenteIA, crearSnapshotAsistenteIA } from '../src/utils/analiticaAsistenteIA.js';

const productos = [
  {
    id_producto: 1,
    codigo_barras: 'A-1',
    descripcion: 'Producto dinámico',
    stock_minimo: 20,
    producto_formas_venta: [
      { factor: 24, activo: true, unidades_medida: { nombre: 'Bandeja' } },
      { factor: 6, activo: true, unidades_medida: { nombre: 'Tira' } },
      { factor: 1, activo: true, unidades_medida: { nombre: 'Unidad' } },
    ],
  },
  {
    id_producto: 2,
    descripcion: 'Producto sin rotación',
    stock_minimo: 3,
    producto_formas_venta: [{ factor: 1, activo: true, unidades_medida: { nombre: 'Unidad' } }],
  },
];

const lotes = [
  { id_lote: 11, id_producto: 1, id_sucursal: 1, nro_lote: 'L-1', cantidad_actual: 17, estado: 'VIGENTE', fecha_vencimiento: '2026-10-20' },
  { id_lote: 12, id_producto: 2, id_sucursal: 1, nro_lote: 'L-2', cantidad_actual: 8, estado: 'VIGENTE', fecha_vencimiento: '2027-12-01' },
  { id_lote: 13, id_producto: 1, id_sucursal: 1, nro_lote: 'VENCIDO', cantidad_actual: 999, estado: 'VENCIDO', fecha_vencimiento: '2026-01-01' },
];

const resumen = construirResumenAsistenteIA({
  productos,
  lotes,
  detallesVenta: [{ id_producto: 1, cantidad: 2, factor: 6 }],
  productosStockBajo: [{ id_producto: 1, id_sucursal: 1, stockTotal: 17, umbral: 20, producto: productos[0] }],
  idsConMovimiento: new Set([1, 2]),
  sucursales: [{ id_sucursal: 1, nombre_comercial: 'Sede Centro' }],
  alcance: 'Sede Centro',
  fechaReferencia: new Date(2026, 9, 10, 12, 0, 0),
  periodoDesde: '2026-09-11',
  periodoHasta: '2026-10-10',
});

assert.equal(resumen.stockBajo.length, 1);
assert.equal(resumen.stockBajo[0].stockBase, 17, 'el stock bajo conserva unidades base');
assert.equal(resumen.stockBajo[0].equivalencia, '2 × Tira + 5 × Unidad', 'usa factores dinámicos sin nombres programados');
assert.equal(resumen.mayorMovimiento[0].unidadesVendidas, 12, 'movimiento = cantidad por factor');
assert.equal(resumen.bajaRotacion.length, 1);
assert.equal(resumen.bajaRotacion[0].idProducto, 2);
assert.equal(resumen.bajaRotacion[0].equivalencia, null, 'no muestra equivalencia redundante de factor uno');
assert.equal(resumen.proximosVencer.length, 1);
assert.equal(resumen.proximosVencer[0].numeroLote, 'L-1');
assert.equal(resumen.reposicion[0].brechaMinimoBase, 3);

const snapshot = crearSnapshotAsistenteIA(resumen);
assert.equal(snapshot.metadata.fuenteStock, 'inventario_lotes.cantidad_actual en unidades base');
assert.equal(snapshot.stock_bajo[0].stockBase, 17);
assert.equal(Object.hasOwn(snapshot, 'usuarios'), false, 'el snapshot no incorpora datos personales');

const vacio = construirResumenAsistenteIA({
  productos: [],
  lotes: [],
  detallesVenta: [],
  productosStockBajo: [],
  idsConMovimiento: new Set(),
  fechaReferencia: new Date(2026, 9, 10, 12, 0, 0),
});
assert.deepEqual(vacio.totales, {
  productosAnalizados: 0,
  stockBajo: 0,
  lotesProximosVencer: 0,
  bajaRotacion: 0,
  conMovimiento: 0,
  recomendacionesReposicion: 0,
}, 'sin datos devuelve colecciones y contadores vacíos, no información inventada');
assert.deepEqual(vacio.reposicion, []);

console.log('OK: analítica del Asistente IA validada en unidades base.');
