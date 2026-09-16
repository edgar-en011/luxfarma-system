/**
 * Voucher de cierre de turno, maquetado a 48 columnas (papel de 80mm).
 *
 * Módulo puro, sin dependencias del renderer ni de Electron: lo consumen tanto
 * electron/printers/thermal.js (ESC/POS directo a la térmica) como
 * ticketCierreCaja.js (HTML de respaldo para la app web). Al salir las dos
 * desde el MISMO listado de líneas, el formato no puede divergir entre ambas.
 */

/** Tipo de documento que reconoce printThermalTicket para tomar esta rama. */
export const TIPO_DOC_CIERRE_CAJA = 'CIERRE_CAJA'

/** Columnas útiles de una térmica de 80mm con fuente A (igual que el ticket de venta). */
export const ANCHO_TICKET = 48

function money(n) {
  return `S/ ${(Number(n) || 0).toFixed(2)}`
}

/** Diferencias con signo explícito; dentro de un céntimo se considera cuadrado. */
function moneyDif(n) {
  const v = Number(n) || 0
  if (Math.abs(v) <= 0.01) return 'S/ 0.00'
  return `${v > 0 ? '+' : '-'}S/ ${Math.abs(v).toFixed(2)}`
}

function hora12(valor) {
  const d = valor instanceof Date ? valor : new Date(valor)
  if (Number.isNaN(d.getTime())) return '—'
  return d
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    .toLowerCase()
}

function fecha(valor) {
  const d = valor instanceof Date ? valor : new Date(valor)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Etiqueta a la izquierda, valor pegado al borde derecho del papel. */
function kv(label, value, ancho = ANCHO_TICKET) {
  const l = String(label ?? '')
  const v = String(value ?? '')
  const huecos = Math.max(1, ancho - l.length - v.length)
  return `${l}${' '.repeat(huecos)}${v}`
}

/** Corta en palabras para que ninguna línea pase del ancho del papel. */
function envolver(texto, ancho = ANCHO_TICKET) {
  const palabras = String(texto ?? '').trim().split(/\s+/).filter(Boolean)
  const lineas = []
  let actual = ''
  for (const palabra of palabras) {
    // Una palabra más larga que el papel se parte a lo bruto, si no no entraría nunca.
    if (palabra.length > ancho) {
      if (actual) { lineas.push(actual); actual = '' }
      for (let i = 0; i < palabra.length; i += ancho) lineas.push(palabra.slice(i, i + ancho))
      continue
    }
    if (!actual) actual = palabra
    else if (actual.length + 1 + palabra.length <= ancho) actual += ` ${palabra}`
    else { lineas.push(actual); actual = palabra }
  }
  if (actual) lineas.push(actual)
  return lineas
}

/**
 * Normaliza los datos del turno en el paquete que viaja por IPC.
 * Los montos se calculan una sola vez acá para que el voucher impreso y el
 * cuadre que se guardó en caja_turnos no puedan discrepar.
 */
export function buildCierreCajaPayload({
  turno,
  totalesPagos,
  efectivoReal,
  yapeReal,
  difTotal,
  observacion = '',
  user = null,
} = {}) {
  if (!turno) return null

  const apertura = Number(turno.monto_apertura) || 0
  const efectivo = Number(totalesPagos?.efectivo) || 0
  const yape = Number(totalesPagos?.yape) || 0
  const tarjeta = Number(totalesPagos?.tarjeta) || 0
  const efectivoDeclarado = Number(efectivoReal) || 0
  const yapeDeclarado = Number(yapeReal) || 0

  const esperadoEfectivo = apertura + efectivo
  const difEfectivo = efectivoDeclarado - esperadoEfectivo
  const difYape = yapeDeclarado - yape
  const diferenciaTotal = difTotal != null ? Number(difTotal) : difEfectivo + difYape
  const cuadrado = Math.abs(diferenciaTotal) <= 0.01

  let estado = 'CAJA CUADRADA'
  let estadoDetalle = 'Todo cuadra perfectamente'
  if (!cuadrado) {
    if (difEfectivo < -0.01) {
      estado = 'CON FALTANTE'
      estadoDetalle = `Faltante: ${money(Math.abs(difEfectivo))}`
    } else if (difEfectivo > 0.01) {
      estado = 'CON SOBRANTE'
      estadoDetalle = `Sobrante: ${money(difEfectivo)}`
    } else {
      estado = 'CON DIFERENCIA'
      estadoDetalle = `Diferencia de ${money(Math.abs(diferenciaTotal))}`
    }
  }

  const emitidoAt = new Date()

  return {
    tipoDocumento: TIPO_DOC_CIERRE_CAJA,
    cierre: {
      turnoId: String(turno.id_turno ?? '').padStart(4, '0'),
      sede: user?.sucursales?.nombre_comercial || 'Sede Principal',
      personal: `${user?.nombres || ''} ${(user?.apellidos || '').split(' ')[0] || ''}`.trim() || '—',
      fecha: fecha(emitidoAt),
      horaApertura: hora12(turno.apertura_at),
      horaCierre: hora12(emitidoAt),
      apertura,
      efectivo,
      yape,
      tarjeta,
      totalVendido: efectivo + yape + tarjeta,
      esperadoEfectivo,
      efectivoDeclarado,
      difEfectivo,
      esperadoYape: yape,
      yapeDeclarado,
      difYape,
      difTotal: diferenciaTotal,
      cuadrado,
      estado,
      estadoDetalle,
      observacion: String(observacion || '').trim(),
    },
  }
}

/**
 * Listado de líneas ya ajustadas al ancho del papel.
 * @returns {Array<{ texto?: string, estilo: 'texto'|'bold'|'centro'|'centroBold'|'linea'|'blanco' }>}
 */
export function lineasCierreCaja(cierre) {
  if (!cierre) return []
  const l = []
  const txt = (texto) => l.push({ texto, estilo: 'texto' })
  const bold = (texto) => l.push({ texto, estilo: 'bold' })
  const linea = () => l.push({ estilo: 'linea' })

  l.push({ texto: 'CIERRE DE TURNO', estilo: 'centroBold' })
  l.push({ texto: `TURNO #${cierre.turnoId}`, estilo: 'centroBold' })
  linea()

  txt(`FECHA: ${cierre.fecha}`)
  txt(`SEDE: ${cierre.sede}`)
  txt(`PERSONAL: ${cierre.personal}`)
  txt(kv(`ENTRADA: ${cierre.horaApertura}`, `SALIDA: ${cierre.horaCierre}`))
  linea()

  bold('VENTAS POR METODO DE PAGO')
  txt(kv('Efectivo', money(cierre.efectivo)))
  txt(kv('Yape', money(cierre.yape)))
  txt(kv('Tarjeta', money(cierre.tarjeta)))
  bold(kv('TOTAL VENDIDO', money(cierre.totalVendido)))
  linea()

  bold('CUADRE DE CAJA')
  txt(kv('Apertura de caja', money(cierre.apertura)))
  txt(kv('Ventas en efectivo', money(cierre.efectivo)))
  txt(kv('Efectivo esperado en gaveta', money(cierre.esperadoEfectivo)))
  txt(kv('Efectivo contado', money(cierre.efectivoDeclarado)))
  txt(kv('Diferencia efectivo', moneyDif(cierre.difEfectivo)))
  if (cierre.difEfectivo < -0.01) {
    bold(kv('FALTANTE EN EFECTIVO', money(Math.abs(cierre.difEfectivo))))
  } else if (cierre.difEfectivo > 0.01) {
    bold(kv('SOBRANTE EN EFECTIVO', money(cierre.difEfectivo)))
  }
  l.push({ estilo: 'blanco' })
  txt(kv('Yape esperado (sistema)', money(cierre.esperadoYape)))
  txt(kv('Yape verificado', money(cierre.yapeDeclarado)))
  txt(kv('Diferencia Yape', moneyDif(cierre.difYape)))
  linea()
  bold(kv('DIFERENCIA TOTAL', moneyDif(cierre.difTotal)))
  linea()

  if (cierre.observacion) {
    bold('OBSERVACION')
    for (const fila of envolver(cierre.observacion)) txt(fila)
    linea()
  }

  l.push({ texto: cierre.estado, estilo: 'centroBold' })
  l.push({ texto: cierre.estadoDetalle, estilo: 'centro' })
  linea()
  txt(`Emitido: ${cierre.fecha} ${cierre.horaCierre}`)

  return l
}

/** Pie del voucher: es control interno, no un comprobante de pago. */
export const PIE_CIERRE_CAJA = [
  'Documento interno de control',
  'No es comprobante de pago',
]
