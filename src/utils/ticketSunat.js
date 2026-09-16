/**
 * Datos SUNAT / Nubefact para el pie del ticket térmico y HTML.
 * La plantilla de venta real y el ticket de prueba usan las mismas funciones.
 */

import { TICKET_EMISOR, etiquetaComprobante, etiquetaDocCliente, desgloseTicket } from './ticketFarmacia.js'

export function esTicketElectronico(tipo) {
  const t = String(tipo || '').toUpperCase().trim()
  if (!t || t.includes('NOTA')) return false
  return t.includes('FACTURA') || t.includes('BOLETA') || t === '01' || t === '03' || t === '1' || t === '2'
}

export function tipoCpeSunat(tipo) {
  const t = String(tipo || '').toUpperCase().trim()
  if (t.includes('FACTURA') || t === '01' || t === '1') return '01'
  return '03'
}

function fechaIsoYmd(value) {
  if (!value) return new Date().toISOString().slice(0, 10)
  const s = String(value)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function padComprobanteTicket(serie, numero) {
  return `${serie || ''}-${String(numero ?? 0).padStart(8, '0')}`
}

/**
 * Número del encabezado: SUNAT (B003/F003) si ya existe; si no, interno (B001/F001).
 * Nota de venta nunca usa serie SUNAT.
 */
export function numeroEncabezadoTicket(payload = {}) {
  const tipo = payload.tipoComprobante || payload.comprobanteTipo
  const interno = payload.comprobanteInterno
    || payload.comprobante
    || padComprobanteTicket(payload.serie, payload.correlativo)
  if (!esTicketElectronico(tipo)) {
    return { numero: interno, cpeSunat: '', provisional: false }
  }
  const serieSunat = payload.sunatSerie
  const numeroSunat = payload.sunatNumero
  if (serieSunat != null && String(serieSunat).trim() && numeroSunat != null && numeroSunat !== '') {
    const cpe = padComprobanteTicket(serieSunat, numeroSunat)
    return { numero: cpe, cpeSunat: cpe, provisional: false }
  }
  return { numero: interno, cpeSunat: '', provisional: true }
}

/**
 * Cadena SUNAT para el QR (mismo formato que Nubefact.cadena_para_codigo_qr).
 * RUC|TIPO|SERIE|NUMERO|IGV|TOTAL|FECHA|TIPO_DOC|NUM_DOC|HASH
 */
export function armarCadenaQrSunat({
  ruc = TICKET_EMISOR.ruc,
  tipoComprobante,
  serie,
  numero,
  igv,
  total,
  fechaIso,
  tipoDocCliente = '1',
  nroDocCliente = '',
  hash = '',
} = {}) {
  const tipo = tipoCpeSunat(tipoComprobante)
  const num = String(Number(numero) || numero || '0').replace(/^0+(?=\d)/, '') || '0'
  const tipoDoc = (!tipoDocCliente || tipoDocCliente === '-' || tipoDocCliente === '0')
    ? '0'
    : String(tipoDocCliente)
  const doc = nroDocCliente && nroDocCliente !== '-' ? String(nroDocCliente) : '00000000'
  return [
    ruc,
    tipo,
    String(serie || '').trim(),
    num,
    Number(igv || 0).toFixed(2),
    Number(total || 0).toFixed(2),
    fechaIsoYmd(fechaIso),
    tipoDoc,
    doc,
    hash || '',
  ].join('|')
}

function tipoDocNubefactDesdeLabel(tipoComprobante, nroDoc) {
  const t = String(tipoComprobante || '').toUpperCase()
  const doc = String(nroDoc || '').trim()
  if (!doc || doc === '-' || doc.toUpperCase().startsWith('SD-')) return '0'
  if (t.includes('FACTURA') || doc.length === 11) return '6'
  return '1'
}

/**
 * Normaliza campos Nubefact / reimpresión para la plantilla del ticket.
 */
export function datosSunatTicket(payload = {}) {
  const tipo = payload.tipoComprobante || payload.comprobanteTipo
  if (!esTicketElectronico(tipo)) return null

  const hash = String(payload.sunatHash || payload.codigoHash || '').trim()
  const enlace = String(payload.sunatEnlace || payload.enlace || '').trim()
  let cadena = String(payload.sunatCadenaQr || payload.cadenaQr || '').trim()
  const serieSunat = payload.sunatSerie || null
  const numeroSunat = payload.sunatNumero || null
  const hayDatosReales = Boolean(
    payload.esPrueba || cadena || hash || enlace || (serieSunat && numeroSunat != null),
  )
  if (!hayDatosReales) return null
  const d = desgloseTicket(payload.total, payload.descuento)
  if (!cadena && (serieSunat || payload.comprobante)) {
    const parts = String(payload.comprobante || '').split('-')
    const serie = serieSunat || parts[0] || ''
    const numero = numeroSunat != null ? numeroSunat : parts.slice(1).join('-')
    cadena = armarCadenaQrSunat({
      tipoComprobante: tipo,
      serie,
      numero,
      igv: d.igv,
      total: d.importeTotal,
      fechaIso: payload.fechaIso,
      tipoDocCliente: tipoDocNubefactDesdeLabel(tipo, payload.clienteDoc),
      nroDocCliente: payload.clienteDoc,
      hash,
    })
  }
  if (!cadena && !hash && !enlace) return null

  const cpe = numeroEncabezadoTicket({
    tipoComprobante: tipo,
    sunatSerie: serieSunat,
    sunatNumero: numeroSunat,
  }).cpeSunat

  return {
    cadenaQr: cadena,
    codigoHash: hash,
    enlace,
    barcode: String(payload.sunatBarcode || '').trim(),
    cpe,
    leyenda: `Representacion impresa de la ${etiquetaComprobante(tipo)}`,
  }
}

function fechaTicketAhora() {
  const fecha = new Date()
  const fechaStr = fecha.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const horaStr = fecha.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })
  return `${fechaStr} ${horaStr}`
}

/**
 * Payload ficticio con la misma forma que una venta real (Boleta o Factura).
 * Incluye QR / hash / enlace al estilo Nubefact para validar la plantilla.
 */
export function buildTicketPruebaPayload(tipo = 'Boleta') {
  const esFactura = String(tipo).toUpperCase().includes('FACTURA')
  const tipoComprobante = esFactura ? 'Factura' : 'Boleta'
  const serie = esFactura ? 'F002' : 'B002'
  const numero = 1
  const items = [
    { producto: 'PARACETAMOL 500 MG TAB', cantidad: 2, precio: 4.5, subtotal: 9 },
    { producto: 'IBUPROFENO 400 MG TAB', cantidad: 1, precio: 6, subtotal: 6 },
    { producto: 'SUERO FISIOLOGICO 100 ML', cantidad: 1, precio: 5.5, subtotal: 5.5 },
  ]
  const total = items.reduce((acc, it) => acc + it.subtotal, 0)
  const d = desgloseTicket(total, 0)
  const cliente = esFactura ? 'CLIENTE PRUEBA S.A.C.' : 'JUAN PEREZ PRUEBA'
  const clienteDoc = esFactura ? '20123456789' : '40071015'
  const hash = 'xK9mP2qL8nR4tYwE1sA5uB3cD='
  const cadenaQr = armarCadenaQrSunat({
    tipoComprobante,
    serie,
    numero,
    igv: d.igv,
    total: d.importeTotal,
    fechaIso: new Date().toISOString().slice(0, 10),
    tipoDocCliente: esFactura ? '6' : '1',
    nroDocCliente: clienteDoc,
    hash,
  })
  const cpe = `${serie}-${String(numero).padStart(8, '0')}`

  return {
    esPrueba: true,
    tipoComprobante,
    comprobante: cpe,
    fecha: fechaTicketAhora(),
    fechaIso: new Date().toISOString().slice(0, 10),
    metodoPago: 'Efectivo',
    vendedor: 'Cajero Prueba',
    cliente,
    clienteDoc,
    clienteDocLabel: etiquetaDocCliente(tipoComprobante),
    clienteDireccion: esFactura ? 'Av. Ejemplo 123, Julcan' : '',
    puntosAcum: 0,
    items,
    total,
    descuento: 0,
    montoRecibido: 25,
    vuelto: 4.5,
    sunatSerie: serie,
    sunatNumero: numero,
    sunatHash: hash,
    sunatCadenaQr: cadenaQr,
    sunatEnlace: `https://www.nubefact.com/cpe/${TICKET_EMISOR.ruc}-${tipoCpeSunat(tipoComprobante)}-${serie}-${numero}`,
    sunatBarcode: `${serie}${String(numero).padStart(8, '0')}`,
  }
}
