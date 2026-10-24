import assert from 'node:assert/strict';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((linea) => linea && linea.includes('='))
    .map((linea) => {
      const indice = linea.indexOf('=');
      return [linea.slice(0, indice), linea.slice(indice + 1).replace(/^"|"$/g, '')];
    }),
);

const endpoint = `${env.VITE_SUPABASE_URL}/functions/v1/asistente-ia`;
const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    apikey: env.VITE_SUPABASE_ANON_KEY,
    Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    'x-luxfarma-ai-session': 'token-invalido-para-comprobar-version-desplegada',
  },
  body: JSON.stringify({ accion: 'resumen', id_sucursal: null, dias: 30, limite: 10 }),
});
const body = await response.json();

assert.equal(response.status, 401);
assert.equal(body.code, 'SESSION_INVALID');
console.log('OK: la Edge Function desplegada reconoce el flujo nuevo y exige una sesión válida.');

