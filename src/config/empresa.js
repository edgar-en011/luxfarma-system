/**
 * Identidad LUXFARMA — datos de empresa para tickets, fallbacks de sucursal y flags.
 * Si hay fila en sucursales / configuracion, esos campos ganan; esto es el respaldo.
 */

function leerFlag(valor) {
  if (valor == null || valor === '') return false
  const s = String(valor).trim().toLowerCase()
  return s === 'true' || s === '1' || s === 'yes' || s === 'si'
}

const envVite = typeof import.meta !== 'undefined' ? import.meta.env : undefined
const envNode = (typeof globalThis !== 'undefined' && globalThis.process?.env)
  ? globalThis.process.env
  : undefined

/** Emisión de Boleta/Factura SUNAT. Por defecto desactivada. */
export const facturacionElectronica = leerFlag(
  envVite?.VITE_FACTURACION_ELECTRONICA ?? envNode?.VITE_FACTURACION_ELECTRONICA,
)

export const EMPRESA = {
  nombreComercial: 'LuxFarma',
  /** Línea superior del ticket (bajo el logo). */
  ticketRubro: 'BOTICA',
  /** Marca grande del ticket térmico. */
  ticketMarca: 'LUXFARMA',
  razonSocial: 'LUXFARMA S.A.C.',
  ruc: '20610381198',
  direccion: 'Jr. San Lucas Nro. 904, Urb. Jerusalén Bl. 4, La Esperanza, Trujillo, La Libertad',
  correo: '',
  telefono: '',
  sede: 'La Esperanza',
  logo: '/ticket-logo.png',
}

/** Cabecera impresa: BOTICA + LUXFARMA. RUC / dirección / contacto con fallback. */
export const TICKET_EMISOR = {
  rubro: EMPRESA.ticketRubro,
  nombreComercial: EMPRESA.ticketMarca,
  razonSocial: EMPRESA.razonSocial,
  ruc: EMPRESA.ruc,
  correo: EMPRESA.correo,
  telefono: EMPRESA.telefono,
  direccion: EMPRESA.direccion,
}

/**
 * Mezcla sucursal (Supabase) con respaldo de empresa.js.
 * @param {object} [sucursal]
 */
export function datosEmpresa(sucursal) {
  const s = sucursal && typeof sucursal === 'object' ? sucursal : {}
  return {
    nombreComercial: s.nombre_comercial || EMPRESA.nombreComercial,
    razonSocial: s.razon_social || EMPRESA.razonSocial,
    ruc: s.ruc || EMPRESA.ruc,
    direccion: s.direccion || EMPRESA.direccion,
    correo: s.correo || s.email || EMPRESA.correo,
    telefono: s.telefono || EMPRESA.telefono,
    sede: s.nombre_comercial || EMPRESA.sede,
  }
}

/** Emisor del ticket: marca fija LUXFARMA; RUC/dirección desde sucursal si existe. */
export function emisorParaTicket(sucursal) {
  const d = datosEmpresa(sucursal)
  return {
    rubro: EMPRESA.ticketRubro,
    nombreComercial: EMPRESA.ticketMarca,
    razonSocial: d.razonSocial,
    ruc: d.ruc,
    correo: d.correo,
    telefono: d.telefono,
    direccion: d.direccion,
  }
}

/** Líneas de contacto/dirección (omite vacías). */
export function lineasContactoEmisor(emisor = TICKET_EMISOR) {
  return [
    emisor.razonSocial,
    emisor.ruc ? `RUC: ${emisor.ruc}` : '',
    emisor.correo,
    emisor.telefono,
    emisor.direccion,
  ].filter((l) => String(l || '').trim())
}

export const LEYENDA_DOCUMENTO_INTERNO = 'Documento interno - no tiene valor tributario'
