/**
 * Prueba AISLADA de api.json.pe (DNI / RUC).
 * NO toca POS ni Login — solo evalúa si la API responde.
 *
 * Uso:
 *   JSON_PE_TOKEN=... node scripts/test-json-pe.mjs
 *   JSON_PE_TOKEN=... node scripts/test-json-pe.mjs 27427864 20552103816
 *
 * Token: SOLO PARA PRUEBA vía env. NO hardcodear / NO commitear el token real.
 */

const BASE = 'https://api.json.pe'
const token = process.env.JSON_PE_TOKEN?.trim()
const dni = (process.argv[2] || '27427864').trim()
const ruc = (process.argv[3] || '20552103816').trim()

if (!token) {
  console.error(`
Falta JSON_PE_TOKEN.

Ejemplo (PowerShell):
  $env:JSON_PE_TOKEN = "<token-de-prueba>"
  node scripts/test-json-pe.mjs

Ejemplo (bash):
  JSON_PE_TOKEN=<token-de-prueba> node scripts/test-json-pe.mjs
`)
  process.exit(1)
}

async function postJson(path, body) {
  const url = `${BASE}${path}`
  const started = Date.now()
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  })
  const ms = Date.now() - started
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { _raw: text }
  }
  return { url, status: res.status, ms, json }
}

function dump(label, result) {
  console.log('\n' + '='.repeat(60))
  console.log(label)
  console.log('='.repeat(60))
  console.log(`URL:    ${result.url}`)
  console.log(`HTTP:   ${result.status}  (${result.ms} ms)`)
  console.log('Body:')
  console.log(JSON.stringify(result.json, null, 2))
}

console.log('json.pe — prueba aislada (sin tocar POS)')
console.log(`DNI arg: ${dni}`)
console.log(`RUC arg: ${ruc}`)
console.log(`Token:   ${token.slice(0, 6)}…${token.slice(-4)} (${token.length} chars)`)

try {
  const dniResult = await postJson('/api/dni', { dni })
  dump(`DNI ${dni}`, dniResult)

  const rucResult = await postJson('/api/ruc', { ruc })
  dump(`RUC ${ruc}`, rucResult)

  const dniOk = dniResult.status === 200 && dniResult.json?.success === true
  const rucOk = rucResult.status === 200 && rucResult.json?.success === true
  console.log('\n' + '-'.repeat(60))
  console.log(`Resumen: DNI ${dniOk ? 'OK' : 'FALLÓ'} | RUC ${rucOk ? 'OK' : 'FALLÓ'}`)
  process.exit(dniOk && rucOk ? 0 : 2)
} catch (err) {
  console.error('\nError de red / fetch:', err?.message || err)
  process.exit(1)
}
