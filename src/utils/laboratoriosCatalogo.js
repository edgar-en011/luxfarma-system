import { supabase } from '../supabaseClient';
import { fetchAllRows } from './supabasePage';

const EVENTO_LABS = 'luxfarma:laboratorios-changed';

/** Comparación estable: sin mayúsculas y colapsando espacios extras. */
export function normalizarNombreLab(nombre) {
  return String(nombre || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export async function fetchLaboratorios() {
  return fetchAllRows(() =>
    supabase.from('laboratorios').select('*').order('nombre', { ascending: true }),
  );
}

/** Avisa a todos los selectores/listas de laboratorios montados en la app. */
export function notificarLaboratoriosChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENTO_LABS));
}

export function suscribirLaboratoriosChanged(callback) {
  if (typeof window === 'undefined') return () => {};
  const handler = () => { callback?.(); };
  window.addEventListener(EVENTO_LABS, handler);
  return () => window.removeEventListener(EVENTO_LABS, handler);
}
