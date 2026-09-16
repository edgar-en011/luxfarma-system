/**
 * Publica una versión al bucket público app-updates (Supabase Storage)
 * para electron-updater (latest.yml + instalador + blockmap).
 *
 *   npm run electron:publish
 *
 * Requiere SUPABASE_SERVICE_ROLE_KEY en el entorno o en .env
 * (nunca se commitea; es solo para esta máquina de publicación).
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const BUCKET = 'app-updates'
const FILE_LIMIT = 220 * 1024 * 1024

function leerEnv() {
  const out = { ...process.env }
  for (const nombre of ['.env', '.env.local']) {
    const file = path.join(RAIZ, nombre)
    if (!fs.existsSync(file)) continue
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line || line.startsWith('#') || !line.includes('=')) continue
      const i = line.indexOf('=')
      const k = line.slice(0, i).trim()
      const v = line.slice(i + 1).trim()
      if (k && out[k] == null) out[k] = v
    }
  }
  return out
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: RAIZ, stdio: 'inherit', shell: true, ...opts })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} ${args.join(' ')} → exit ${code}`))
    })
  })
}

async function rest(env, ruta, { method = 'GET', headers = {}, body } = {}) {
  const url = `${env.VITE_SUPABASE_URL}/storage/v1${ruta}`
  const res = await fetch(url, {
    method,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      ...headers,
    },
    body,
  })
  const text = await res.text()
  return { ok: res.ok, status: res.status, text }
}

async function asegurarBucket(env) {
  const listado = await rest(env, '/bucket')
  if (!listado.ok) throw new Error(`listar buckets → HTTP ${listado.status} ${listado.text}`)
  const buckets = JSON.parse(listado.text || '[]')
  const existe = buckets.some((b) => b.name === BUCKET || b.id === BUCKET)
  if (existe) {
    await rest(env, `/bucket/${BUCKET}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public: true, file_size_limit: FILE_LIMIT }),
    })
    console.log(`[publicar] bucket ${BUCKET} ya existía (público, límite ${FILE_LIMIT})`)
    return
  }
  const creado = await rest(env, '/bucket', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: BUCKET,
      name: BUCKET,
      public: true,
      file_size_limit: FILE_LIMIT,
    }),
  })
  if (!creado.ok) throw new Error(`crear bucket → HTTP ${creado.status} ${creado.text}`)
  console.log(`[publicar] bucket ${BUCKET} creado (público)`)
}

async function subir(env, objectPath, filePath, contentType) {
  const bytes = fs.readFileSync(filePath)
  const res = await rest(env, `/object/${BUCKET}/${objectPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
    body: bytes,
  })
  if (!res.ok) throw new Error(`subir ${objectPath} → HTTP ${res.status} ${res.text}`)
  console.log(`[publicar] subido ${objectPath} (${bytes.length} bytes)`)
}

async function main() {
  const env = leerEnv()
  if (!env.VITE_SUPABASE_URL) throw new Error('Falta VITE_SUPABASE_URL')
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'Falta SUPABASE_SERVICE_ROLE_KEY (en el entorno o .env). Se usa solo para publicar; no va en el instalador.',
    )
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'))
  const version = pkg.version
  const outDir = path.join(RAIZ, 'release')

  console.log(`[publicar] versión ${version}`)
  console.log(`[publicar] empaquetando en ${outDir}`)

  await run('npx', ['cross-env', 'ELECTRON=1', 'vite', 'build'])
  await run('npx', ['electron-builder', '--win', '--publish', 'never'])

  const exeName = `SaludFutura-Setup-${version}.exe`
  const exe = path.join(outDir, exeName)
  const blockmap = `${exe}.blockmap`
  const yml = path.join(outDir, 'latest.yml')
  if (!fs.existsSync(exe)) throw new Error(`no está el instalador: ${exe}`)
  if (!fs.existsSync(yml)) throw new Error(`no está latest.yml (electron-builder no lo generó)`)

  await asegurarBucket(env)
  await subir(env, exeName, exe, 'application/octet-stream')
  if (fs.existsSync(blockmap)) {
    await subir(env, `${exeName}.blockmap`, blockmap, 'application/octet-stream')
  }
  await subir(env, 'latest.yml', yml, 'text/yaml')

  const publico = `${env.VITE_SUPABASE_URL}/storage/v1/object/public/${BUCKET}`
  console.log(`[publicar] listo ${version}`)
  console.log(`[publicar] feed ${publico}/latest.yml`)
  console.log(`[publicar] exe   ${exe}`)
}

main().catch((err) => {
  console.error('[publicar] FALLO:', err.message || err)
  process.exit(1)
})
