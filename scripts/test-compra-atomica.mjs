/**
 * Falla a medias del registro de compra + saldo de Kardex.
 *
 * Camino VIEJO: inserta cabecera, “se cae” antes de detalle/stock/kardex;
 * el reintento inserta OTRA fila en compras.
 *
 * Camino NUEVO (contrato de registrar_compra): o commit de todo, o nada.
 * Si el cliente no vio la respuesta, el reintento con la misma clave
 * (proveedor + tipo + serie + numero) devuelve ya_existia y no duplica.
 */
import {
  armarPayloadRegistrarCompra,
  claveComprobanteCompra,
  saldoKardexTrasEntrada,
} from '../src/utils/compraRegistro.js';
import {
  costoPromedioPonderadoLote,
  costoPromedioPonderadoProducto,
  lineaCompraEsBonificacion,
} from '../src/utils/costoPromedioPonderado.js';
import { simularCppCompra } from '../src/utils/aplicarCppCompra.js';

const compraBase = {
  id_sucursal: 1,
  id_proveedor: 7,
  id_usuario: 3,
  comprobante: {
    tipo: 'Factura Electrónica',
    serie: 'FF58',
    numero: '0682243',
    fechaCompra: '2026-09-01',
    formaPago: 'Contado',
  },
  total_compra: 80,
  actualiza_precios: false,
  items: [
    {
      id_producto: 42,
      nro_lote: 'L-CAJA',
      cantidad: 10,
      costo_unitario: 8,
      subtotal: 80,
      codigo_proveedor: 'PROV-42',
    },
  ],
};

function claveDe(payload) {
  return claveComprobanteCompra(payload);
}

/** Flujo viejo: cada insert es independiente. Un crash deja la cabecera huérfana. */
function registrarCompraVieja(db, payload, { fallarDespuesDeCabecera = false } = {}) {
  db.compras.push({
    id_compra: ++db.seq,
    clave: claveDe(payload),
    nro_documento: payload.nro_documento,
  });
  if (fallarDespuesDeCabecera) {
    throw new Error('CORTE_A_MEDIAS');
  }
  db.detalles += payload.items.length;
  db.stock[42] = (db.stock[42] || 0) + payload.items[0].cantidad;
  db.kardex.push({
    cantidad: payload.items[0].cantidad,
    saldo: payload.items[0].cantidad, // BUG: solo la entrada
  });
  return { ok: true, ya_existia: false, id_compra: db.seq };
}

/**
 * Replica el contrato de la RPC: todo en una transacción.
 * Si falla antes de commit, no queda nada. Si ya existe la clave, ya_existia.
 */
function registrarCompraNueva(db, payload, { fallarAntesDeCommit = false } = {}) {
  const clave = claveDe(payload);
  const existente = db.compras.find((c) => c.clave === clave && !c.anulada);
  if (existente) {
    return { ok: true, ya_existia: true, id_compra: existente.id_compra };
  }

  const tx = {
    id_compra: db.seq + 1,
    clave,
    nro_documento: payload.nro_documento,
    stockDelta: payload.items[0].cantidad,
    kardex: {
      cantidad: payload.items[0].cantidad,
      saldo: saldoKardexTrasEntrada(db.stock[42] || 0, payload.items[0].cantidad),
    },
    codigo: payload.items[0].codigo_proveedor,
  };

  if (fallarAntesDeCommit) {
    throw new Error('CORTE_A_MEDIAS');
  }

  db.seq += 1;
  db.compras.push({ id_compra: tx.id_compra, clave, nro_documento: tx.nro_documento });
  db.detalles += payload.items.length;
  db.stock[42] = (db.stock[42] || 0) + tx.stockDelta;
  db.kardex.push(tx.kardex);
  if (tx.codigo) db.codigos.add(`${payload.id_proveedor}|${tx.codigo}`);
  return { ok: true, ya_existia: false, id_compra: tx.id_compra };
}

function dbVacio(stockInicial = 0) {
  return {
    seq: 0,
    compras: [],
    detalles: 0,
    stock: { 42: stockInicial },
    kardex: [],
    codigos: new Set(),
  };
}

const payload = armarPayloadRegistrarCompra(compraBase);
if (payload.nro_documento !== 'FF58-0682243') throw new Error('nro_documento mal armado');
if (payload.items[0].codigo_proveedor !== 'PROV-42') throw new Error('código de proveedor no viajó');
if (payload.items[0].bonificacion !== false) throw new Error('bonificacion debe viajar en el payload');
if (payload.items.length !== 1) throw new Error('items incompletos');

// --- Kardex: saldo = stock anterior + entrada, no la entrada sola ---
const saldo = saldoKardexTrasEntrada(15, 10);
if (saldo !== 25) throw new Error(`saldo kardex ${saldo}, debía ser 25`);
if (saldo === 10) throw new Error('el saldo no puede ser solo la cantidad comprada');

// --- Camino VIEJO: corte tras cabecera + reintento DUPLICA ---
const dbViejo = dbVacio(15);
try {
  registrarCompraVieja(dbViejo, payload, { fallarDespuesDeCabecera: true });
  throw new Error('el corte viejo debía fallar');
} catch (e) {
  if (e.message !== 'CORTE_A_MEDIAS') throw e;
}
if (dbViejo.compras.length !== 1) throw new Error('el corte viejo debía dejar 1 cabecera huérfana');
if (dbViejo.detalles !== 0) throw new Error('el corte viejo no debía llegar al detalle');

registrarCompraVieja(dbViejo, payload);
if (dbViejo.compras.length !== 2) {
  throw new Error(`el reintento viejo debía duplicar cabecera, hay ${dbViejo.compras.length}`);
}

// --- Camino NUEVO: corte ANTES de commit + reintento NO duplica ---
const dbNuevo = dbVacio(15);
try {
  registrarCompraNueva(dbNuevo, payload, { fallarAntesDeCommit: true });
  throw new Error('el corte nuevo debía fallar');
} catch (e) {
  if (e.message !== 'CORTE_A_MEDIAS') throw e;
}
if (dbNuevo.compras.length !== 0) throw new Error('el corte nuevo no debía persistir cabecera');
if (dbNuevo.stock[42] !== 15) throw new Error('el corte nuevo no debía mover stock');

const r1 = registrarCompraNueva(dbNuevo, payload);
if (r1.ya_existia) throw new Error('el primer commit no debía encontrar la compra');
if (dbNuevo.compras.length !== 1) throw new Error('el primer commit debía dejar 1 compra');
if (dbNuevo.stock[42] !== 25) throw new Error(`stock ${dbNuevo.stock[42]}, debía ser 25`);
if (dbNuevo.kardex[0].saldo !== 25) {
  throw new Error(`kardex.saldo ${dbNuevo.kardex[0].saldo}, debía ser 25 (no ${dbNuevo.kardex[0].cantidad})`);
}
if (!dbNuevo.codigos.has('7|PROV-42')) throw new Error('no persistió el código de proveedor');

// Cliente no vio la respuesta. Reintento con la misma factura.
const r2 = registrarCompraNueva(dbNuevo, payload);
if (!r2.ya_existia) throw new Error('el reintento debía devolver ya_existia');
if (r2.id_compra !== r1.id_compra) throw new Error('el reintento devolvió otro id_compra');
if (dbNuevo.compras.length !== 1) throw new Error(`duplicó compras: ${dbNuevo.compras.length}`);
if (dbNuevo.stock[42] !== 25) throw new Error('el reintento volvió a sumar stock');
if (dbNuevo.kardex.length !== 1) throw new Error('el reintento insertó otro kardex');

// Otra factura sí entra.
const otra = armarPayloadRegistrarCompra({
  ...compraBase,
  comprobante: { ...compraBase.comprobante, numero: '0682244' },
});
const r3 = registrarCompraNueva(dbNuevo, otra);
if (r3.ya_existia || r3.id_compra === r1.id_compra) throw new Error('la segunda factura no se aisló');
if (dbNuevo.compras.length !== 2) throw new Error('la segunda factura no insertó');
if (dbNuevo.kardex[1].saldo !== 35) {
  throw new Error(`segunda entrada: saldo ${dbNuevo.kardex[1].saldo}, debía ser 35`);
}

// --- CPP: misma factura 2 líneas, compra posterior, bonificación ---
const cppAzitro = costoPromedioPonderadoLote({
  stockActual: 6,
  costoActual: 6.5,
  cantidadNueva: 2,
  costoNueva: 0.1,
});
if (cppAzitro !== 4.9) throw new Error(`CPP Azitromicina ${cppAzitro}, debía ser 4.9`);

const cppNuevaCompra = costoPromedioPonderadoLote({
  stockActual: 8,
  costoActual: 4.9,
  cantidadNueva: 4,
  costoNueva: 10,
});
if (cppNuevaCompra !== 6.6) throw new Error(`CPP compra posterior ${cppNuevaCompra}, debía ser 6.6`);

const cppBonif = costoPromedioPonderadoLote({
  stockActual: 6,
  costoActual: 6.5,
  cantidadNueva: 2,
  costoNueva: 0,
  bonificacion: true,
});
if (cppBonif !== 6.5) throw new Error(`bonificación no debe diluir el costo (${cppBonif})`);
if (lineaCompraEsBonificacion({ bonificacion: true, costo_unitario: 0 }) !== true) {
  throw new Error('flag bonificacion no detectado');
}
if (lineaCompraEsBonificacion({ bonificacion: false, costo_unitario: 0.1 }) !== false) {
  throw new Error('costo 0.10 no es bonificación');
}

const cppCatalogo = costoPromedioPonderadoProducto([
  { cantidad_actual: 8, costo_unitario_lote: 4.9, estado: 'VIGENTE' },
  { cantidad_actual: 8, costo_unitario_lote: 1, estado: 'VIGENTE' },
]);
if (cppCatalogo !== 2.95) throw new Error(`CPP catálogo ${cppCatalogo}, debía ser 2.95`);

const sim = simularCppCompra({
  id_sucursal: 1,
  items: [
    { id_producto: 99, nro_lote: 'L1', cantidad: 6, costo_unitario: 6.5 },
    { id_producto: 99, nro_lote: 'L1', cantidad: 2, costo_unitario: 0.1 },
  ],
}, new Map());
if (sim.touched[0].costo !== 4.9) throw new Error(`simular CPP ${sim.touched[0].costo}, debía ser 4.9`);
console.log('OK corte a medias VIEJO: 1 cabecera huérfana + reintento = 2 compras');
console.log('OK corte a medias NUEVO: rollback → 0; commit → 1; reintento ya_existia sin duplicar');
console.log('OK kardex: stock 15 + compra 10 = saldo 25 (no 10)');
console.log('OK CPP: 6×6.50 + 2×0.10 = 4.90; compra posterior 6.60; bonificación no diluye');
console.log(JSON.stringify({ primer: r1, reintento: r2, segunda: r3, stock: dbNuevo.stock[42] }, null, 2));
