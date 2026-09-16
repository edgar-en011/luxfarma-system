/**
 * Convierte un monto a letras en español (soles peruanos).
 * Ej: 150.5 → "CIENTO CINCUENTA Y 50/100 SOLES"
 */

const UNIDADES = [
  '', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE',
  'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISEIS', 'DIECISIETE',
  'DIECIOCHO', 'DIECINUEVE', 'VEINTE',
]

const DECENAS = [
  '', '', 'VEINTI', 'TREINTA', 'CUARENTA', 'CINCUENTA',
  'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA',
]

const CENTENAS = [
  '', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS',
  'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS',
]

function decenaALetras(n) {
  if (n < 21) return UNIDADES[n]
  if (n === 21) return 'VEINTIUNO'
  if (n < 30) {
    const u = n % 10
    return u === 0 ? 'VEINTE' : `VEINTI${UNIDADES[u]}`
  }
  const d = Math.floor(n / 10)
  const u = n % 10
  return u === 0 ? DECENAS[d] : `${DECENAS[d]} Y ${UNIDADES[u]}`
}

function centenaALetras(n) {
  if (n === 0) return ''
  if (n === 100) return 'CIEN'
  if (n < 100) return decenaALetras(n)
  const c = Math.floor(n / 100)
  const resto = n % 100
  return resto === 0 ? CENTENAS[c] : `${CENTENAS[c]} ${decenaALetras(resto)}`
}

function seccionALetras(n, singular, plural) {
  if (n === 0) return ''
  if (n === 1) return `UN ${singular}`
  return `${centenaALetras(n)} ${plural}`
}

/** Entero 0 … 999_999_999 → letras (sin moneda). */
export function enteroALetras(valor) {
  const n = Math.floor(Math.abs(Number(valor) || 0))
  if (n === 0) return 'CERO'

  const millones = Math.floor(n / 1_000_000)
  const miles = Math.floor((n % 1_000_000) / 1000)
  const cientos = n % 1000

  const partes = []
  if (millones > 0) {
    partes.push(millones === 1 ? 'UN MILLON' : `${centenaALetras(millones)} MILLONES`)
  }
  if (miles > 0) {
    partes.push(seccionALetras(miles, 'MIL', 'MIL').replace(/^UN MIL$/, 'MIL'))
  }
  if (cientos > 0) {
    partes.push(centenaALetras(cientos))
  }

  return partes.join(' ').replace(/\s+/g, ' ').trim()
}

/**
 * @param {number|string} monto
 * @returns {string} ej. "SON: CIENTO CINCUENTA Y 50/100 SOLES"
 */
export function numeroALetras(monto) {
  const num = Number(monto)
  if (!Number.isFinite(num)) return 'SON: CERO Y 00/100 SOLES'

  const negativo = num < 0 ? 'MENOS ' : ''
  const abs = Math.abs(num)
  const enteros = Math.floor(abs + 1e-9)
  const centavos = Math.round((abs - enteros) * 100)

  const letras = enteroALetras(enteros)
  const cents = String(centavos).padStart(2, '0')
  const moneda = enteros === 1 ? 'SOL' : 'SOLES'

  return `SON: ${negativo}${letras} Y ${cents}/100 ${moneda}`
}
