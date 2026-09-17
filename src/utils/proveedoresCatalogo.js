import { supabase } from '../supabaseClient';

const EVENTO_PROV = 'luxfarma:proveedores-changed';

export function esProveedorActivo(p) {
  if (p == null || p.activo == null) return true;
  return p.activo === true || p.activo === 1 || String(p.activo) === '1';
}

export async function fetchProveedores({ soloActivos = false } = {}) {
  const { data, error } = await supabase
    .from('proveedores')
    .select('*')
    .order('razon_social', { ascending: true });
  if (error) throw error;
  const lista = data || [];
  return soloActivos ? lista.filter(esProveedorActivo) : lista;
}

/** Avisa a selectores/listas de proveedores (Pedidos, Cuentas, Compras…). */
export function notificarProveedoresChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENTO_PROV));
}

export function suscribirProveedoresChanged(callback) {
  if (typeof window === 'undefined') return () => {};
  const handler = () => { callback?.(); };
  window.addEventListener(EVENTO_PROV, handler);
  return () => window.removeEventListener(EVENTO_PROV, handler);
}
