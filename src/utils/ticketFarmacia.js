/**
 * Datos fijos del emisor para ticket térmico / recibo en pantalla.
 * Confirmados por Brayan (sede Julcán). Dirección es placeholder temporal.
 */
export const TICKET_EMISOR = {
  /** Línea centrada inmediata debajo de la cruz (antes de la marca grande). */
  rubro: 'BOTICAS',
  /** Marca grande bajo el logo (ESC/POS setTextQuadArea). */
  nombreComercial: 'SALUD FUTURA',
  razonSocial: 'GRUPO SALUD FUTURA S.A.C.',
  ruc: '20611770708',
  correo: 'gruposaludfutura@hotmail.com',
  direccion: 'Sede Julcán',
}

/** Etiqueta de tipo de comprobante para el ticket. */
export function etiquetaComprobante(tipo) {
  const t = String(tipo || 'BOLETA').toUpperCase().trim()
  if (t.includes('NOTA')) return 'NOTA DE VENTA'
  if (t.includes('FACTURA')) return 'FACTURA ELECTRONICA'
  return 'BOLETA ELECTRONICA'
}

/**
 * Primer nombre para la línea CAJERO / VEND del ticket de cliente.
 * No usar en Nubefact, persistencia ni pantallas: solo representación impresa.
 * Vacío/nulo → '' (el ticket sigue mostrando "—" como hoy).
 */
export function primerNombreTicket(valor) {
  if (valor == null) return ''
  const partes = String(valor).trim().split(/[\s\-]+/).filter(Boolean)
  return partes[0] || ''
}

/** Etiqueta del documento del cliente en el ticket (Factura → RUC; Boleta/Nota → DNI). */
export function etiquetaDocCliente(tipo) {
  const t = String(tipo || '').toUpperCase().trim()
  if (t.includes('FACTURA')) return 'RUC'
  return 'DNI'
}

/**
 * Desglose IGV típico (precios con IGV incluido).
 * INAFECTAS en 0 hasta que el catálogo distinga afectación.
 */
export function desgloseTicket(total, descuento = 0) {
  const importeTotal = Number(total) || 0
  const dsto = Number(descuento) || 0
  const totalBruto = importeTotal + dsto
  const gravada = Math.round((importeTotal / 1.18) * 100) / 100
  const igv = Math.round((importeTotal - gravada) * 100) / 100
  return {
    inafectas: 0,
    operacionGravada: gravada,
    igv,
    totalBruto,
    dstoSoles: dsto,
    importeTotal,
  }
}
