import bcrypt from 'bcryptjs';
import { supabase } from '../supabaseClient';

const BCRYPT_ROUNDS = 10;
const BCRYPT_PREFIX = /^\$2[aby]\$/;

/** true si el valor guardado ya es un hash bcrypt ($2a$ / $2b$ / $2y$). */
export function esHashBcrypt(valor) {
  return typeof valor === 'string' && BCRYPT_PREFIX.test(valor);
}

/** Genera hash bcrypt de una contraseña en texto plano. */
export async function hashPassword(plain) {
  return bcrypt.hash(String(plain ?? ''), BCRYPT_ROUNDS);
}

/**
 * Compara plano vs valor guardado.
 * - Si es bcrypt → bcrypt.compare
 * - Si es legado (texto plano) → igualdad directa
 */
export async function verificarPassword(plain, stored) {
  if (stored == null || stored === '') return false;
  const plano = String(plain ?? '');
  const guardado = String(stored);
  if (esHashBcrypt(guardado)) {
    return bcrypt.compare(plano, guardado);
  }
  return plano === guardado;
}

/**
 * Verifica la contraseña y, si coincidía en texto plano (legado), migra a bcrypt
 * en el mismo momento. Devuelve { ok, migrated }.
 */
export async function verificarYMigrarSiPlano({ id_usuario, plain, stored }) {
  const ok = await verificarPassword(plain, stored);
  if (!ok) return { ok: false, migrated: false };

  if (esHashBcrypt(stored)) {
    return { ok: true, migrated: false };
  }

  // Migración lazy: primer login/reauth exitoso con clave aún en plano.
  const nuevoHash = await hashPassword(plain);
  const { error } = await supabase
    .from('usuarios')
    .update({ password_hash: nuevoHash })
    .eq('id_usuario', id_usuario);

  if (error) {
    // Login sigue OK aunque falle el UPDATE — reintentará migrar en el próximo acceso.
    console.warn('[passwordHash] No se pudo migrar a bcrypt:', error.message);
    return { ok: true, migrated: false };
  }
  return { ok: true, migrated: true };
}
