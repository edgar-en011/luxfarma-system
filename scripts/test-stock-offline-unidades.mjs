/**
 * CAJA factor 10, stock base 25 → stock_disponible (venta) = 2.
 * El bug mezclaba 2 (cajas) con 20 (uds. base).
 */
import { validarStockOfflineItem } from '../src/utils/stockOffline.js';

const caja = {
  id_producto: 99,
  producto: 'AMOXICILINA 500MG CAJA x10',
  modo_venta: 'CAJA',
  factor: 10,
  cantidad: 2,
  stock_total: 25,
  stock_disponible: 2, // floor(25/10) — unidades de venta
};

// Debería PASAR: 2 cajas = 20 base, hay 25.
const ok = validarStockOfflineItem(caja, []);
if (!ok.ok) throw new Error(`falsa negativa: 2 cajas con 25 uds. se bloqueó (${JSON.stringify(ok)})`);
if (ok.necesario !== 20 || ok.stockBase !== 25) {
  throw new Error(`unidades mal convertidas: ${JSON.stringify(ok)}`);
}

// El cálculo VIEJO (stock_disponible - reservado) habría hecho 2 - 0 = 2; 20 > 2 → bloqueaba.
const virtualViejo = caja.stock_disponible - 0;
if (!(caja.cantidad * caja.factor > virtualViejo)) {
  throw new Error('el contraste del bug viejo no se reproduce');
}

// Debería FALLAR: 3 cajas = 30 base > 25.
const demas = validarStockOfflineItem({ ...caja, cantidad: 3 }, []);
if (demas.ok) throw new Error('falsa positiva: 3 cajas con 25 uds. pasó');

// Cola: 1 caja ya pendiente (10 base). Quedan 15 → 1 caja más OK, 2 cajas no.
const cola = [{ carrito: [{ id_producto: 99, cantidad: 1, factor: 10 }] }];
const unaMas = validarStockOfflineItem({ ...caja, cantidad: 1 }, cola);
if (!unaMas.ok) throw new Error('1 caja más con 15 uds. libres se bloqueó');
const dosMas = validarStockOfflineItem({ ...caja, cantidad: 2 }, cola);
if (dosMas.ok) throw new Error('2 cajas más con solo 15 uds. libres pasaron');

// Factor 1 no se rompe (unidad simple).
const unidad = validarStockOfflineItem({
  id_producto: 1, producto: 'PARACETAMOL', modo_venta: 'UNIDAD',
  factor: 1, cantidad: 5, stock_total: 8, stock_disponible: 8,
}, []);
if (!unidad.ok) throw new Error('factor 1 válido se bloqueó');
const unidadNo = validarStockOfflineItem({
  id_producto: 1, producto: 'PARACETAMOL', modo_venta: 'UNIDAD',
  factor: 1, cantidad: 9, stock_total: 8, stock_disponible: 8,
}, []);
if (unidadNo.ok) throw new Error('factor 1 insuficiente pasó');

console.log('OK CAJA factor 10, stock 25: 2 cajas pasan, 3 fallan');
console.log('OK cola 1 caja: 1 caja más pasa, 2 no');
console.log('OK factor 1 sin regresión');
