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
if (error) throw error;

console.log(JSON.stringify({
  procesamiento: data.metadata?.procesamiento,
  totales: data.totales,
  devueltos: {
    stockBajo: data.stockBajo?.length,
    proximosVencer: data.proximosVencer?.length,
    bajaRotacion: data.bajaRotacion?.length,
    mayorMovimiento: data.mayorMovimiento?.length,
    reposicion: data.reposicion?.length,
  },
}, null, 2));
