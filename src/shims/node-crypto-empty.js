/**
 * Stub de `crypto` (Node) para el bundle del navegador.
 * bcryptjs@3 hace `import crypto from "crypto"`; en browser basta Web Crypto API
 * (crypto.getRandomValues), que bcryptjs ya prueba primero.
 */
const empty = {
  randomBytes() {
    throw new Error('node:crypto no disponible en el navegador')
  },
}

export default empty
export const randomBytes = empty.randomBytes
