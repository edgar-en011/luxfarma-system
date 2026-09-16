import { supabase } from '../supabaseClient';
import { mensajeErrorRegistroCompra } from './compraRegistro';
import {
  aplicarCostoPromedioPonderadoCompra,
  snapshotLotesParaCpp,
} from './aplicarCppCompra';

/**
 * Una sola RPC: cabecera + detalle + pago contado + stock + kardex (saldo resultante)
 * + códigos de proveedor. Si el comprobante ya existe, { ya_existia: true }.
 * Después, CPP de lote y catálogo (no pisa compra_detalle: ahí queda el costo de cada línea).
 */
export async function registrarCompraEnServidor(payload) {
  const snapshot = await snapshotLotesParaCpp(supabase, payload);
  const { data, error } = await supabase.rpc('registrar_compra', {
    p_payload: payload,
  });
  if (error) throw new Error(error.message || 'No se pudo registrar la compra.');
  const row = typeof data === 'string' ? JSON.parse(data) : (data || {});
  if (!row.ok) {
    throw new Error(mensajeErrorRegistroCompra(row.error));
  }
  if (!row.ya_existia) {
    await aplicarCostoPromedioPonderadoCompra(supabase, payload, snapshot);
  }
  return row;
}
