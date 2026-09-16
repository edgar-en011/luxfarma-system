import { supabase } from '../supabaseClient';
import { mensajeErrorRegistroVenta } from './ventaUuid';

export { mensajeErrorRegistroVenta };

/**
 * Una sola RPC: correlativo con lock + venta + detalle + pagos + stock atómico + kardex.
 * SUNAT queda fuera (el caller).
 */
export async function registrarVentaEnServidor(payload) {
  const { data, error } = await supabase.rpc('sincronizar_venta_offline', {
    p_payload: payload,
  });
  if (error) throw new Error(error.message || 'No se pudo registrar la venta.');
  const row = typeof data === 'string' ? JSON.parse(data) : (data || {});
  if (!row.ok) {
    throw new Error(mensajeErrorRegistroVenta(row.error));
  }
  return row;
}
