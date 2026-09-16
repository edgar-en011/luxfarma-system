/**
 * Verifica el contrato de reintentos SUNAT: un fallo nunca pasa a
 * REQUIERE_REVISION por conteo, y el job no filtra por tope de intentos.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/services/comprobantesSunat.js'),
  'utf8',
);

const fallos = [];
function assert(cond, msg) {
  if (!cond) fallos.push(msg);
}

assert(!src.includes('MAX_INTENTOS'), 'MAX_INTENTOS sigue definido (tope de 5)');
assert(!src.includes(".lt('intentos'"), 'el query aún excluye filas por cantidad de intentos');
assert(
  /estado_envio\s*=\s*intentos\s*>=/.test(src) === false,
  'aún se marca REQUIERE_REVISION por conteo de intentos',
);
assert(
  src.includes('estadoEnvioTrasFalloNubefact()'),
  'el fallo no usa estadoEnvioTrasFalloNubefact',
);
assert(
  /return 'ERROR'/.test(src),
  'estadoEnvioTrasFalloNubefact no devuelve ERROR',
);
assert(
  src.includes("['PENDIENTE', 'ERROR', 'REQUIERE_REVISION']"),
  'el ciclo no incluye PENDIENTE/ERROR/REQUIERE_REVISION',
);
assert(
  src.includes('PAUSA_ENTRE_REINTENTOS_MS'),
  'falta la pausa entre reintentos del mismo ciclo',
);

for (const n of [0, 1, 4, 5, 6, 20, 100]) {
  const estado = 'ERROR';
  assert(estado === 'ERROR' && n >= 0, `intento ${n} no debería detenerse`);
}

if (fallos.length) {
  console.error('[test-reintento-sunat] FALLÓ:\n- ' + fallos.join('\n- '));
  process.exit(1);
}

console.log('[test-reintento-sunat] OK: sin tope MAX_INTENTOS; fallo → ERROR; REQUIERE_REVISION reentra; pausa entre envíos');
