import bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 10;

/** Hash bcrypt para el alta de cuentas; la verificación ocurre en auth-cuenta. */
export async function hashPassword(plain) {
  return bcrypt.hash(String(plain ?? ''), BCRYPT_ROUNDS);
}
