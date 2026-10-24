import { supabase } from '../supabaseClient';

export async function iniciarSesionCuenta({ dni, password }) {
  const { data, error } = await supabase.functions.invoke('auth-cuenta', {
    body: { accion: 'login', dni, password },
  });
  if (error || !data?.session || !data?.profile) {
    let detail = null;
    try { detail = await error?.context?.json?.(); } catch { /* ignore */ }
    const fallo = new Error(detail?.message || 'No se pudo iniciar sesión.');
    fallo.code = detail?.code || 'LOGIN_FAILED';
    throw fallo;
  }
  const { error: sessionError } = await supabase.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
  if (sessionError) throw sessionError;
  return data.profile;
}

export async function verificarPasswordCuenta(password) {
  const { data, error } = await supabase.functions.invoke('auth-cuenta', { body: { accion: 'reauth', password } });
  if (error || !data?.ok) {
    let detail = null;
    try { detail = await error?.context?.json?.(); } catch { /* ignore */ }
    const fallo = new Error(detail?.message || 'Contraseña incorrecta.');
    fallo.code = detail?.code || 'INVALID_CREDENTIALS';
    throw fallo;
  }
  return true;
}

export async function cambiarPasswordCuenta(passwordActual, passwordNueva) {
  const { data, error } = await supabase.functions.invoke('auth-cuenta', {
    body: { accion: 'cambiar_password', password_actual: passwordActual, password_nueva: passwordNueva },
  });
  if (error || !data?.ok) {
    let detail = null;
    try { detail = await error?.context?.json?.(); } catch { /* ignore */ }
    const fallo = new Error(detail?.message || 'No se pudo cambiar la contraseña.');
    fallo.code = detail?.code || 'PASSWORD_UPDATE_FAILED';
    throw fallo;
  }
}

async function invocarRecuperacion(body) {
  const { data, error } = await supabase.functions.invoke('auth-cuenta', { body });
  if (error || !data) {
    let detail = null;
    try { detail = await error?.context?.json?.(); } catch { /* ignore */ }
    const fallo = new Error(detail?.message || 'No se pudo procesar la solicitud.');
    fallo.code = detail?.code || 'RECOVERY_FAILED';
    throw fallo;
  }
  return data;
}

export async function buscarCuentaRecuperacion(dni) {
  const result = await invocarRecuperacion({ accion: 'buscar_recuperacion', dni });
  return result.usuario;
}

export async function solicitarRecuperacionCuenta({ dni, descripcion }) {
  const result = await invocarRecuperacion({ accion: 'crear_ticket_recuperacion', dni, descripcion });
  return result.ticket;
}
