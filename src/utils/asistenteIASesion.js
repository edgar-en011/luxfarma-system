const ASISTENTE_IA_SESSION_KEY = 'luxfarma_asistente_ia_sesion';

function storageDisponible() {
  return typeof window !== 'undefined' && window.sessionStorage;
}

export function guardarSesionAsistenteIA(idUsuario, sesion) {
  if (!storageDisponible() || !sesion?.token || !sesion?.expires_at) return;
  try {
    sessionStorage.setItem(ASISTENTE_IA_SESSION_KEY, JSON.stringify({
      idUsuario: Number(idUsuario),
      token: sesion.token,
      expires_at: sesion.expires_at,
    }));
  } catch {
    // El modo privado o un almacenamiento lleno no deben bloquear el login.
  }
}

export function leerSesionAsistenteIA(idUsuario) {
  if (!storageDisponible()) return null;
  try {
    const sesion = JSON.parse(sessionStorage.getItem(ASISTENTE_IA_SESSION_KEY) || 'null');
    const vigente = sesion?.token
      && sesion?.expires_at
      && Number(sesion.idUsuario) === Number(idUsuario)
      && Date.parse(sesion.expires_at) > Date.now();
    if (vigente) return sesion;
  } catch {
    // Una sesión dañada se elimina debajo.
  }
  limpiarSesionAsistenteIA();
  return null;
}

export function limpiarSesionAsistenteIA() {
  if (!storageDisponible()) return;
  try { sessionStorage.removeItem(ASISTENTE_IA_SESSION_KEY); } catch { /* ignore */ }
}

