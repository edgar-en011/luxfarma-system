import { supabase } from '../supabaseClient';
import { hoyLocal } from './fechas';

/** VIGENTE si fecha >= hoy local; VENCIDO si ya pasó. Misma regla que marcarLotesVencidos. */
export function estadoLoteSegunFecha(fechaVencimiento, hoy = hoyLocal()) {
  if (!fechaVencimiento) return null;
  const f = String(fechaVencimiento).slice(0, 10);
  return f < hoy ? 'VENCIDO' : 'VIGENTE';
}

/**
 * Pasa a estado='VENCIDO' todo lote VIGENTE cuya fecha_vencimiento ya pasó,
 * y revive a VIGENTE los VENCIDO con fecha >= hoy y stock > 0 (p.ej. tipografía corregida).
 * Idempotente — se puede llamar al cargar Alertas / generar notificaciones / tras editar fecha.
 * FEFO (POS/sync/notas) solo descuenta VIGENTE, así que deja de vender vencidos.
 */
export async function marcarLotesVencidos() {
  const hoy = hoyLocal();
  const { data: vencidos, error: errV } = await supabase
    .from('inventario_lotes')
    .update({ estado: 'VENCIDO' })
    .eq('estado', 'VIGENTE')
    .not('fecha_vencimiento', 'is', null)
    .lt('fecha_vencimiento', hoy)
    .select('id_lote');
  if (errV) {
    console.error('marcarLotesVencidos:', errV.message);
    return { ok: false, error: errV, actualizados: 0 };
  }

  const { data: vigentes, error: errR } = await supabase
    .from('inventario_lotes')
    .update({ estado: 'VIGENTE' })
    .eq('estado', 'VENCIDO')
    .not('fecha_vencimiento', 'is', null)
    .gte('fecha_vencimiento', hoy)
    .gt('cantidad_actual', 0)
    .select('id_lote');
  if (errR) {
    console.error('marcarLotesVencidos (revive):', errR.message);
    return { ok: false, error: errR, actualizados: (vencidos || []).length };
  }

  return {
    ok: true,
    actualizados: (vencidos || []).length + (vigentes || []).length,
  };
}

/** True si hay kardex ligado al id_lote numérico o al nro_lote textual. */
export async function loteTieneMovimientos(idLote, nroLote) {
  const refs = [];
  if (idLote != null) refs.push(String(idLote));
  if (nroLote != null && String(nroLote).trim() !== '') refs.push(String(nroLote).trim());
  if (refs.length === 0) return false;
  const { count, error } = await supabase
    .from('kardex_movimientos')
    .select('id_mov', { count: 'exact', head: true })
    .in('id_lote', refs);
  if (error) {
    console.error('loteTieneMovimientos:', error.message);
    return true; // ante duda, pedir confirmación extra
  }
  return (count || 0) > 0;
}
