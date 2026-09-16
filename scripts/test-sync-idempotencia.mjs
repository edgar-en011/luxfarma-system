/**
 * Simula el corte a medias: la RPC ya commitó, el cliente no llegó a
 * marcarSincronizada. El reintento con el mismo uuid no debe insertar de nuevo.
 *
 * Replica el contrato de sincronizar_venta_offline (SELECT por uuid → skip).
 */
import { armarPayloadSincronizacion, nuevoUuidVenta, uuidVentaValido } from '../src/utils/ventaUuid.js';

const ventaBase = {
  uuid_venta: nuevoUuidVenta(),
  tipoComprobante: 'Boleta',
  serie: 'B001',
  total: 15.5,
  vuelto: 0,
  monto_recibido: 20,
  metodoPago: 'Efectivo',
  id_sucursal: 1,
  id_usuario: 9,
  carrito: [
    {
      id_producto: 42,
      modo_venta: 'UNIDAD',
      cantidad: 2,
      precio: 7.75,
      subtotal: 15.5,
      factor: 1,
      id_medida: 1,
      producto: 'PARACETAMOL 500MG',
    },
  ],
  cliente: {
    docInput: '12345678',
    nombres: 'ANA',
    apellidos: 'PEREZ',
    nombreRazonSocial: 'ANA PEREZ',
    tipoDoc: 'DNI',
  },
};

function crearRpcFalsa() {
  const ventas = [];
  let inserts = 0;
  let stockDescuentos = 0;

  function rpc(payload) {
    const uuid = payload.uuid_venta;
    const existente = ventas.find((v) => v.uuid_venta === uuid);
    if (existente) {
      return {
        ok: true,
        ya_existia: true,
        id_venta: existente.id_venta,
        serie: existente.serie,
        correlativo: existente.correlativo,
        faltantes: [],
      };
    }
    inserts += 1;
    stockDescuentos += (payload.items || []).length;
    const row = {
      id_venta: 1000 + inserts,
      uuid_venta: uuid,
      serie: payload.serie,
      correlativo: inserts,
    };
    ventas.push(row);
    return {
      ok: true,
      ya_existia: false,
      id_venta: row.id_venta,
      serie: row.serie,
      correlativo: row.correlativo,
      faltantes: [],
    };
  }

  return {
    rpc,
    stats: () => ({ inserts, stockDescuentos, filas: ventas.length }),
  };
}

async function simularProcesar({ rpc, venta, marcarLocal }) {
  const payload = armarPayloadSincronizacion(venta, { idTurno: 77 });
  const row = rpc(payload);
  if (!row.ok) throw new Error(row.error);
  if (marcarLocal) venta._sincronizado = true;
  return row;
}

const uuid = nuevoUuidVenta();
if (!uuidVentaValido(uuid)) throw new Error('UUID generado inválido');

const payload = armarPayloadSincronizacion(ventaBase, { idTurno: 77 });
if (payload.uuid_venta !== ventaBase.uuid_venta) throw new Error('uuid no viajó en el payload');
if (payload.items.length !== 1) throw new Error('items incompletos');
if (payload.pagos[0].monto !== 15.5) throw new Error('pago incorrecto');

const fake = crearRpcFalsa();

const r1 = await simularProcesar({ rpc: fake.rpc, venta: ventaBase, marcarLocal: false });
if (r1.ya_existia) throw new Error('el primer intento no debía encontrar la venta');
if (fake.stats().inserts !== 1) throw new Error('el primer intento debía insertar 1 vez');

// Corte: no se llamó marcarSincronizada. Reintento con el MISMO uuid.
const r2 = await simularProcesar({ rpc: fake.rpc, venta: ventaBase, marcarLocal: true });
if (!r2.ya_existia) throw new Error('el reintento debía detectar uuid existente');
if (r2.id_venta !== r1.id_venta) throw new Error('el reintento devolvió otro id_venta');
if (fake.stats().inserts !== 1) throw new Error(`duplicó inserts: ${fake.stats().inserts}`);
if (fake.stats().stockDescuentos !== 1) throw new Error('redescuento de stock en el reintento');
if (fake.stats().filas !== 1) throw new Error('hay más de una fila de venta');

// Otra venta (otro uuid) sí inserta.
const otra = { ...ventaBase, uuid_venta: nuevoUuidVenta(), carrito: ventaBase.carrito };
const r3 = await simularProcesar({ rpc: fake.rpc, venta: otra, marcarLocal: true });
if (r3.ya_existia || r3.id_venta === r1.id_venta) throw new Error('la segunda venta no se aisló');
if (fake.stats().inserts !== 2) throw new Error('la segunda venta no insertó');

console.log('OK corte a medias: 1 uuid → 1 insert; reintento ya_existia sin redescontar stock');
console.log(JSON.stringify({ primer: r1, reintento: r2, stats: fake.stats() }, null, 2));
