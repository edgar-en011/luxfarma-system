import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((linea) => linea && linea.includes('='))
    .map((linea) => {
      const indice = linea.indexOf('=');
      return [linea.slice(0, indice), linea.slice(indice + 1).replace(/^"|"$/g, '')];
    }),
);

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data, error } = await supabase.rpc('resumen_asistente_ia', {
  p_id_sucursal: null,
  p_dias: 30,
  p_limite: 10,
});
if (!error || data) {
  throw new Error('La anon key todavía puede ejecutar resumen_asistente_ia. Aplica la migración de seguridad.');
}

console.log('OK: la anon key no puede leer directamente el resumen gerencial del Asistente IA.');
