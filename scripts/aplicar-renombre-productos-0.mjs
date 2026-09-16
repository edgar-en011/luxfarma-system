/**
 * Aplica los 44 renombres 0→N/O.
 * Compensación all-or-nothing (si un UPDATE falla, revierte los ya aplicados).
 * El log en DB vive en sql/correccion_nombres_0_por_NO.sql (DDL no se puede
 * crear con la anon key).
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

const RENAMES = [
  [7498, '0RALFATE 1G SUSP X 200ML SUCRALFATO', 'NORALFATE 1G SUSP X 200ML SUCRALFATO'],
  [12501, '0FERTYL CJA X 1 AMP', 'OFERTYL CJA X 1 AMP'],
  [12545, '0VALGINA 500MG CJA X 50 TAB', 'NOVALGINA 500MG CJA X 50 TAB'],
  [12546, '0VALGINA 250MG JBE X 100ML', 'NOVALGINA 250MG JBE X 100ML'],
  [13456, '0TIL NF CREMA TBO X 10GR', 'OTIL NF CREMA TBO X 10GR'],
  [13498, '0VOTRIM BALSAMICO SUSP X 100ML', 'OVOTRIM BALSAMICO SUSP X 100ML'],
  [13535, '0TIZOL CREMA TBO X 20GR', 'OTIZOL CREMA TBO X 20GR'],
  [13536, '0TIZOL CREMA TBO X 10GR', 'OTIZOL CREMA TBO X 10GR'],
  [13552, '0NPIRON 100MG PLATA0 SUSP X 60ML', 'NOPIRON 100MG PLATANO SUSP X 60ML'],
  [13606, '0VAXON 250 MG FCO X 75 ML', 'OVAXON 250 MG FCO X 75 ML'],
  [14462, '0PUCID 10 / 2 EN 1 CJA X 40 SACHTS', 'NOPUCID 10 / 2 EN 1 CJA X 40 SACHTS'],
  [15454, '0XOM 100 MG SUSP FCO X 60 ML', 'OXOM 100 MG SUSP FCO X 60 ML'],
  [15458, '0XOM 500 MG COMP X 6', 'OXOM 500 MG COMP X 6'],
  [18469, '0PRAMAX 550GR CJA X 100 TAB NAPROXE0', 'OPRAMAX 550GR CJA X 100 TAB NAPROXENO'],
  [20546, '0NPIRON 100MG FRESA SUSP X 60ML', 'NOPIRON 100MG FRESA SUSP X 60ML'],
  [24479, '0SOTRAS NATURAL ALAS TELA GEL X 10 UND', 'NOSOTRAS NATURAL ALAS TELA GEL X 10 UND'],
  [24480, '0SOTRAS DIARIOS PH BALANCIADO X 15 PROTEC', 'NOSOTRAS DIARIOS PH BALANCIADO X 15 PROTEC'],
  [24481, '0SOTRAS NATURAL BUENAS 0CHES X 10 UND', 'NOSOTRAS NATURAL BUENAS NOCHES X 10 UND'],
  [24482, '0SOTRAS DESODORANTE INVISIBLE TELA X 30', 'NOSOTRAS DESODORANTE INVISIBLE TELA X 30'],
  [35448, '0SOTRAS DESODORTANTE INVISIBLE X 10', 'NOSOTRAS DESODORTANTE INVISIBLE X 10'],
  [35449, '0SOTRAS JABON INTIMO V-CONFIDENT X 200ML', 'NOSOTRAS JABON INTIMO V-CONFIDENT X 200ML'],
  [37475, '0VOTRIM BALSAMICO FORTE CJA X 100', 'OVOTRIM BALSAMICO FORTE CJA X 100'],
  [42482, '0TIPHARM CREMA TBO X 20 GR', 'OTIPHARM CREMA TBO X 20 GR'],
  [46491, '0NGRIPP MAXIMA POTENCIA CJA X 120 TAB', 'ONGRIPP MAXIMA POTENCIA CJA X 120 TAB'],
  [46492, '0NGRIPP MIGRAÑA CJA X 20 TAB', 'ONGRIPP MIGRAÑA CJA X 20 TAB'],
  [47472, '0SOTRAS DIARIOS PH BALANCIADO X 120UND', 'NOSOTRAS DIARIOS PH BALANCIADO X 120UND'],
  [47473, '0SOTRAS JABON INTIMO HERBAL X 200ML', 'NOSOTRAS JABON INTIMO HERBAL X 200ML'],
  [47474, '0SOTRAS NATURAL ALAS TELA GEL X 42 UND', 'NOSOTRAS NATURAL ALAS TELA GEL X 42 UND'],
  [47475, '0SOTRAS DIARIOS PH BALANCIADO X 15 UND', 'NOSOTRAS DIARIOS PH BALANCIADO X 15 UND'],
  [47621, '0SIPREX 20MG CJA X 100 TAB PREDNISONA', 'OSIPREX 20MG CJA X 100 TAB PREDNISONA'],
  [48719, '0NPIRON GOTAS X 15 ML', 'NOPIRON GOTAS X 15 ML'],
  [48751, '0GESTROL 1.5 MG CJA X 1 TAB', 'NOGESTROL 1.5 MG CJA X 1 TAB'],
  [48830, '0SOTRAS JABON INTIMO X 200ML HIERBABUENA', 'NOSOTRAS JABON INTIMO X 200ML HIERBABUENA'],
  [51136, '0VOCORTIL-L CREMA 15G+CANULA', 'NOVOCORTIL-L CREMA 15G+CANULA'],
  [51208, '0VOCORTIL 1% CREMA TBO X 20GR', 'NOVOCORTIL 1% CREMA TBO X 20GR'],
  [51224, '0VACILINA 500MG CJA X 7 COMP', 'NOVACILINA 500MG CJA X 7 COMP'],
  [53326, '0XAL 6MG/ML GOTAS ORAL', 'OXAL 6MG/ML GOTAS ORAL'],
  [58387, '0SOTRAS PROTEC DIARIOS X 150 UND', 'NOSOTRAS PROTEC DIARIOS X 150 UND'],
  [59502, '0RIFAM 1ML AMP', 'ORIFAM 1ML AMP'],
  [64727, '0SOTRAS DESODORANTE PH X 10', 'NOSOTRAS DESODORANTE PH X 10'],
  [72068, '0SOTRAS DIARIOS DESODORANTE X 120 UND', 'NOSOTRAS DIARIOS DESODORANTE X 120 UND'],
  [77168, '0SOTRAS INVISIBLES RAPIGEL X 10 UND', 'NOSOTRAS INVISIBLES RAPIGEL X 10 UND'],
  [94171, '0S DIARIOS PH BALANCEADO 2X15', 'NOSOTRAS DIARIOS PH BALANCIADO 2X15'],
  [95210, '0SOTRAS NAT TLLA TELA BOLSA X 8', 'NOSOTRAS NAT TLLA TELA BOLSA X 8'],
]

const ORIGEN = 'correccion_masiva_0_por_N_O'

async function revertir(aplicados) {
  for (const row of aplicados.reverse()) {
    const { error } = await supabase
      .from('productos')
      .update({ descripcion: row.nombre_anterior })
      .eq('id_producto', row.id_producto)
    if (error) {
      console.error('FALLÓ revertir', row.id_producto, error.message)
    }
  }
}

async function main() {
  const ids = RENAMES.map(([id]) => id)
  const { data, error } = await supabase
    .from('productos')
    .select('id_producto, descripcion')
    .in('id_producto', ids)
  if (error) throw new Error(`No se pudieron leer productos: ${error.message}`)

  const actual = new Map((data || []).map((r) => [r.id_producto, r.descripcion]))
  const faltantes = ids.filter((id) => !actual.has(id))
  if (faltantes.length) {
    throw new Error(`Faltan productos: ${faltantes.join(', ')}`)
  }

  const inesperados = []
  const pendientes = []
  const yaOk = []
  for (const [id, nombre_anterior, nombre_nuevo] of RENAMES) {
    const ahora = actual.get(id)
    if (ahora === nombre_nuevo) {
      yaOk.push({ id_producto: id, nombre_anterior, nombre_nuevo, ahora })
      continue
    }
    if (ahora !== nombre_anterior) {
      inesperados.push({ id_producto: id, esperado: nombre_anterior, ahora, nombre_nuevo })
      continue
    }
    pendientes.push({ id_producto: id, nombre_anterior, nombre_nuevo })
  }

  if (inesperados.length) {
    console.error(JSON.stringify({ inesperados }, null, 2))
    throw new Error(`${inesperados.length} producto(s) ya no tienen el nombre anterior esperado. Abortado, 0 cambios.`)
  }

  const auditoria = {
    fecha: new Date().toISOString(),
    origen: ORIGEN,
    total: RENAMES.length,
    pendientes: pendientes.length,
    ya_aplicados: yaOk.length,
    filas: RENAMES.map(([id_producto, nombre_anterior, nombre_nuevo]) => ({
      id_producto,
      nombre_anterior,
      nombre_nuevo,
    })),
  }
  const auditPath = join(__dirname, 'auditoria-renombre-0.json')
  writeFileSync(auditPath, JSON.stringify(auditoria, null, 2), 'utf8')

  const aplicados = []
  try {
    for (const row of pendientes) {
      const { data: upd, error: errUpd } = await supabase
        .from('productos')
        .update({ descripcion: row.nombre_nuevo })
        .eq('id_producto', row.id_producto)
        .eq('descripcion', row.nombre_anterior)
        .select('id_producto, descripcion')
      if (errUpd) throw new Error(`UPDATE ${row.id_producto}: ${errUpd.message}`)
      if (!upd?.length) throw new Error(`UPDATE ${row.id_producto}: 0 filas (carrera o nombre distinto)`)
      aplicados.push(row)
    }
  } catch (err) {
    console.error('Error a mitad. Revirtiendo', aplicados.length, 'cambios…')
    await revertir(aplicados)
    throw err
  }

  const logRows = pendientes.map((r) => ({
    id_producto: r.id_producto,
    nombre_anterior: r.nombre_anterior,
    nombre_nuevo: r.nombre_nuevo,
    origen: ORIGEN,
  }))
  let logOk = false
  let logError = null
  if (logRows.length) {
    const ins = await supabase.from('productos_log_renombre').insert(logRows).select('id')
    if (ins.error) logError = ins.error.message
    else logOk = (ins.data || []).length === logRows.length
  }

  const { data: verify, error: errV } = await supabase
    .from('productos')
    .select('id_producto, descripcion')
    .in('id_producto', ids)
    .order('id_producto')
  if (errV) throw new Error(errV.message)

  const mapaNuevo = new Map(RENAMES.map(([id, , nuevo]) => [id, nuevo]))
  const confirmados = (verify || []).filter((r) => r.descripcion === mapaNuevo.get(r.id_producto))
  const noCoinciden = (verify || []).filter((r) => r.descripcion !== mapaNuevo.get(r.id_producto))

  console.log(JSON.stringify({
    ok: noCoinciden.length === 0,
    aplicados_ahora: aplicados.length,
    ya_estaban: yaOk.length,
    confirmados: confirmados.length,
    log_db: logOk,
    log_error: logError,
    audit_file: auditPath,
    filas: (verify || []).map((r) => ({
      id_producto: r.id_producto,
      descripcion: r.descripcion,
    })),
    no_coinciden: noCoinciden,
  }, null, 2))

  if (noCoinciden.length) process.exit(1)
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
