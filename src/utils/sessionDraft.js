/**
 * Helpers de borrador en sessionStorage (mismo patrón que POS.jsx).
 * Persisten al navegar entre rutas; se limpian al confirmar/cancelar o al logout.
 */
import { resetWelcomeVoice } from './welcomeVoice';
import { limpiarSesionAsistenteIA } from './asistenteIASesion';

export function leerSessionDraft(key, defaultValue) {
  try {
    const saved = sessionStorage.getItem(key);
    if (saved == null) return defaultValue;
    return JSON.parse(saved);
  } catch {
    return defaultValue;
  }
}

export function escribirSessionDraft(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // sessionStorage lleno / privado — no bloquea el flujo
  }
}

export function limpiarSessionDraft(...keys) {
  keys.forEach((key) => {
    try { sessionStorage.removeItem(key); } catch { /* ignore */ }
  });
}

/** Claves de borrador/filtro conocidas (sin scope de usuario). */
export const SESSION_DRAFT_KEYS = [
  'compras_registro_borrador',
  'pedidos_nuevo_borrador',
  'nota_inv_ingreso',
  'nota_inv_salida',
  'ti_v_filtro_conteo',
];

export const POS_SESSION_KEYS = [
  'pos_carrito', 'pos_tipo', 'pos_metodo', 'pos_monto', 'pos_doc',
  'pos_nombres', 'pos_apellidos', 'pos_sexo', 'pos_razon', 'pos_dir',
];

/**
 * Lee un borrador solo si pertenece al usuario actual (mismo patrón que
 * ti_v_filtro_conteo en Conteo Físico). Si es de otro usuario o legacy sin id, lo ignora.
 */
export function leerDraftDeUsuario(key, idUsuario, defaultValue) {
  const raw = leerSessionDraft(key, null);
  if (raw == null) return defaultValue;
  if (raw && typeof raw === 'object' && 'idUsuario' in raw) {
    if (Number(raw.idUsuario) !== Number(idUsuario)) return defaultValue;
    return raw;
  }
  // Legacy sin idUsuario: no reutilizar entre sesiones/usuarios
  return defaultValue;
}

/** Escribe borrador incluyendo idUsuario para aislamiento entre logins. */
export function escribirDraftDeUsuario(key, idUsuario, payload) {
  escribirSessionDraft(key, { ...payload, idUsuario: Number(idUsuario) });
}

/**
 * Limpia storage de sesión al cerrar sesión: POS, borradores admin, filtro conteo,
 * turno activo y legacy de compras. Evita que el siguiente usuario herede estado.
 */
export function limpiarStorageAlLogout() {
  try {
    limpiarSessionDraft(...SESSION_DRAFT_KEYS, ...POS_SESSION_KEYS);
  } catch { /* ignore */ }
  try { localStorage.removeItem('luxfarma_turnoActivo'); } catch { /* ignore */ }
  try { localStorage.removeItem('luxfarma_borrador_compra'); } catch { /* ignore */ }
  try { localStorage.removeItem('ti_v_filtro_conteo'); } catch { /* ignore */ }
  try { limpiarSesionAsistenteIA(); } catch { /* ignore */ }
  try { resetWelcomeVoice(); } catch { /* ignore */ }
}
