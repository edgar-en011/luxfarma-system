/**
 * Cliente Nubefact en el proceso principal (Node).
 * El renderer NUNCA hace fetch a api.nubefact.com — evita el preflight CORS.
 *
 * Credenciales: 1) archivo .env en disco (electron:dev / cwd), 2) valores que
 * Vite inyectó al empaquetar main, 3) process.env. El .env en disco gana para
 * que un cambio de token/ruta no quede cacheado en el bundle de Vite.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TIMEOUT_MS = 25000
const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const TIPO_COMPROBANTE_NUBEFACT = {
  FACTURA: 1,
  BOLETA: 2,
}

export const TIPO_DOC_NUBEFACT = {
  SIN_DOC: '-',
  DNI: 1,
  CE: 4,
  RUC: 6,
  PASAPORTE: 7,
}

function textoEnv(valor) {
  return valor == null ? '' : String(valor).trim()
}

function enmascararToken(token) {
  const t = textoEnv(token)
  if (!t) return '(vacío)'
  return `${t.slice(0, 8)}… (len=${t.length})`
}

function parsearArchivoEnv(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null
    const out = {}
    for (const raw of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq < 1) continue
      let val = line.slice(eq + 1).trim()
      if (
        (val.startsWith('"') && val.endsWith('"'))
        || (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      out[line.slice(0, eq).trim()] = val
    }
    return out
  } catch {
    return null
  }
}

function rutasCandidatasEnv() {
  return [
    path.join(process.cwd(), '.env'),
    path.join(__dirname, '..', '.env'),
    path.join(__dirname, '..', '..', '.env'),
  ]
}

function leerDotEnvDisco() {
  for (const filePath of rutasCandidatasEnv()) {
    const parsed = parsearArchivoEnv(filePath)
    if (parsed && (parsed.VITE_NUBEFACT_URL || parsed.VITE_NUBEFACT_TOKEN)) {
      return { path: filePath, parsed }
    }
  }
  return { path: null, parsed: null }
}

function valorVite(clave) {
  try {
    if (clave === 'VITE_NUBEFACT_URL') return textoEnv(import.meta.env.VITE_NUBEFACT_URL)
    if (clave === 'VITE_NUBEFACT_TOKEN') return textoEnv(import.meta.env.VITE_NUBEFACT_TOKEN)
    if (clave === 'VITE_NUBEFACT_RUC') return textoEnv(import.meta.env.VITE_NUBEFACT_RUC)
  } catch {
    /* sin Vite */
  }
  return ''
}

function resolverCampo(clave, fromFile) {
  const fileVal = textoEnv(fromFile?.[clave])
  if (fileVal) return { valor: fileVal, fuente: 'dotenv-file' }
  const viteVal = valorVite(clave)
  if (viteVal) return { valor: viteVal, fuente: 'vite-inject' }
  const procVal = textoEnv(process.env[clave])
  if (procVal) return { valor: procVal, fuente: 'process.env' }
  return { valor: '', fuente: 'vacio' }
}

function credenciales() {
  const { path: envPath, parsed } = leerDotEnvDisco()
  const url = resolverCampo('VITE_NUBEFACT_URL', parsed)
  const token = resolverCampo('VITE_NUBEFACT_TOKEN', parsed)
  const ruc = resolverCampo('VITE_NUBEFACT_RUC', parsed)
  return {
    url: url.valor,
    token: token.valor,
    ruc: ruc.valor,
    fuenteUrl: url.fuente,
    fuenteToken: token.fuente,
    fuenteRuc: ruc.fuente,
    envPath,
    fileUrl: textoEnv(parsed?.VITE_NUBEFACT_URL),
    fileToken: textoEnv(parsed?.VITE_NUBEFACT_TOKEN),
    viteUrl: valorVite('VITE_NUBEFACT_URL'),
    viteToken: valorVite('VITE_NUBEFACT_TOKEN'),
  }
}

function debugNubefactActivo() {
  const flag = String(process.env.NUBEFACT_DEBUG || process.env.DEBUG || '').trim().toLowerCase()
  return flag === '1' || flag === 'true' || flag.includes('nubefact')
}

function logCredencialesUsadas(operacion) {
  if (!debugNubefactActivo()) return
  const c = credenciales()
  const urlDuplicada = (c.url || '').includes('api.nubefact.com/api/v1/https://')
  console.log('[nubefact] diagnóstico credenciales', {
    operacion,
    cwd: process.cwd(),
    envFile: c.envPath || '(no encontrado)',
    fuenteUrl: c.fuenteUrl,
    fuenteToken: c.fuenteToken,
    urlUsada: c.url || '(vacía)',
    urlLen: (c.url || '').length,
    urlDuplicada,
    urlViteInject: c.viteUrl || '(vacía)',
    urlArchivoEnv: c.fileUrl || '(vacía)',
    urlArchivoVsUsada: c.fileUrl ? c.fileUrl === c.url : null,
    tokenUsado: enmascararToken(c.token),
    tokenViteInject: enmascararToken(c.viteToken),
    tokenArchivoEnv: enmascararToken(c.fileToken),
    tokenArchivoVsUsado: c.fileToken ? c.fileToken === c.token : null,
    rucUsado: c.ruc || '(vacío)',
    fuenteRuc: c.fuenteRuc,
  })
}

export function nubefactConfigurado() {
  const { url, token } = credenciales()
  return Boolean(url && token)
}

/** 23 = ya existe en Nubefact; 24 = no está. Distinto del "NO EXISTE" de SUNAT. */
function extraerCodigoNubefact(data, fallbackText) {
  const candidatos = [data?.codigo, data?.code, data?.error_codigo]
  for (const c of candidatos) {
    const n = Number(c)
    if (Number.isFinite(n) && n > 0) return n
  }
  const t = String(fallbackText || data?.errors || data?.error || '')
  if (/ya existe/i.test(t)) return 23
  if (/no existe|no fue enviado/i.test(t)) return 24
  return null
}

function mensajeErrorNubefact(data, fallback) {
  if (!data) return fallback
  if (typeof data.errors === 'string' && data.errors.trim()) return data.errors
  if (Array.isArray(data.errors) && data.errors.length) return data.errors.join(', ')
  if (data.descripcion) return data.descripcion
  if (data.sunat_description) return data.sunat_description
  if (data.sunat_soap_error) return data.sunat_soap_error
  return fallback
}

function formatearFechaHoy() {
  const hoy = new Date()
  const dd = String(hoy.getDate()).padStart(2, '0')
  const mm = String(hoy.getMonth() + 1).padStart(2, '0')
  const yyyy = hoy.getFullYear()
  return `${dd}-${mm}-${yyyy}`
}

export function medioPagoNubefact(metodoPago, mixtoData) {
  const m = String(metodoPago || '').trim()
  const upper = m.toUpperCase()
  if (upper === 'EFECTIVO') return 'Efectivo'
  if (upper === 'YAPE') return 'Yape'
  if (upper === 'TARJETA') return 'Tarjeta'
  if (upper === 'MIXTO' && mixtoData) {
    const p1 = mixtoData.metodo1 || ''
    const p2 = mixtoData.metodo2 || ''
    return `Mixto (${p1}/${p2})`
  }
  if (upper === 'MIXTO') return 'Mixto'
  return m || 'Efectivo'
}

function redondear(n, dec = 2) {
  const x = Number(n)
  if (!Number.isFinite(x)) return 0
  const f = 10 ** dec
  return Math.round(x * f) / f
}

function armarItems(datosVenta) {
  if (Array.isArray(datosVenta.items) && datosVenta.items.length > 0 && datosVenta.items[0]?.unidad_de_medida) {
    return datosVenta.items
  }
  const carrito = datosVenta.carrito || datosVenta.items || []
  return carrito.map((item) => {
    const precioUnitario = Number(item.precio_unitario || item.precio || 0)
    const cantidad = Number(item.cantidad || 0)
    const subtotalItem = Number(item.subtotal != null ? item.subtotal : precioUnitario * cantidad)
    const valorUnitario = precioUnitario / 1.18
    const igvItem = subtotalItem - subtotalItem / 1.18
    const modo = String(item.modo_venta || '').toUpperCase()
    return {
      unidad_de_medida: modo === 'CAJA' ? 'BX' : 'NIU',
      codigo: String(item.id_producto || item.codigo || ''),
      descripcion: item.producto || item.descripcion || 'Producto',
      cantidad,
      valor_unitario: redondear(valorUnitario, 6),
      precio_unitario: redondear(precioUnitario, 6),
      descuento: '',
      subtotal: redondear(subtotalItem / 1.18, 2),
      tipo_de_igv: 1,
      igv: redondear(igvItem, 2),
      total: redondear(subtotalItem, 2),
      anticipo_regularizacion: false,
      anticipo_documento_serie: '',
      anticipo_documento_numero: '',
    }
  })
}

function armarCliente(datosVenta) {
  const tipo = Number(datosVenta.tipo_comprobante) === TIPO_COMPROBANTE_NUBEFACT.FACTURA
    ? TIPO_COMPROBANTE_NUBEFACT.FACTURA
    : TIPO_COMPROBANTE_NUBEFACT.BOLETA
  const c = datosVenta.cliente || {}

  if (c.cliente_tipo_de_documento != null && c.cliente_numero_de_documento != null) {
    return {
      tipo_doc: c.cliente_tipo_de_documento,
      numero_doc: c.cliente_numero_de_documento,
      nombre: c.cliente_denominacion || c.denominacion || 'CLIENTES VARIOS',
      direccion: c.cliente_direccion || c.direccion || '',
      email: c.cliente_email || c.email || '',
    }
  }

  const dni = String(c.dni || c.nro_doc || c.numero_doc || '').trim()
  const ruc = String(c.ruc || '').trim()
  const nombres = `${c.nombres || ''} ${c.apellidos || ''}`.trim()
  const razon = (c.razon_social || c.razonSocial || c.nombre_razon_social || c.denominacion || '').trim()

  if (tipo === TIPO_COMPROBANTE_NUBEFACT.FACTURA) {
    return {
      tipo_doc: TIPO_DOC_NUBEFACT.RUC,
      numero_doc: ruc || dni || '',
      nombre: razon || 'CLIENTE GENERAL',
      direccion: c.direccion || '',
      email: c.email || '',
    }
  }

  if (!dni || dni.startsWith('SD-')) {
    return {
      tipo_doc: TIPO_DOC_NUBEFACT.SIN_DOC,
      numero_doc: '-',
      nombre: nombres || 'CLIENTES VARIOS',
      direccion: '',
      email: c.email || '',
    }
  }

  return {
    tipo_doc: TIPO_DOC_NUBEFACT.DNI,
    numero_doc: dni,
    nombre: nombres || 'CLIENTES VARIOS',
    direccion: '',
    email: c.email || '',
  }
}

function armarPayloadGenerar(datosVenta) {
  const tipo = Number(datosVenta.tipo_comprobante) === TIPO_COMPROBANTE_NUBEFACT.FACTURA
    ? TIPO_COMPROBANTE_NUBEFACT.FACTURA
    : TIPO_COMPROBANTE_NUBEFACT.BOLETA
  const totalVenta = Number(datosVenta.total || 0)
  const baseImponible = datosVenta.total_gravada != null
    ? Number(datosVenta.total_gravada)
    : totalVenta / 1.18
  const igv = datosVenta.total_igv != null
    ? Number(datosVenta.total_igv)
    : totalVenta - baseImponible
  const cliente = armarCliente(datosVenta)
  const fecha = datosVenta.fecha_de_emision || formatearFechaHoy()
  const { ruc } = credenciales()

  return {
    operacion: 'generar_comprobante',
    tipo_de_comprobante: tipo,
    serie: String(datosVenta.serie || '').trim(),
    numero: Number(datosVenta.numero),
    sunat_transaction: 1,
    cliente_tipo_de_documento: cliente.tipo_doc,
    cliente_numero_de_documento: cliente.numero_doc,
    cliente_denominacion: cliente.nombre,
    cliente_direccion: cliente.direccion || '',
    cliente_email: cliente.email || '',
    cliente_email_1: '',
    cliente_email_2: '',
    fecha_de_emision: fecha,
    fecha_de_vencimiento: fecha,
    moneda: 1,
    porcentaje_de_igv: 18,
    total_gravada: redondear(baseImponible, 2),
    total_exonerada: '',
    total_inafecta: '',
    total_igv: redondear(igv, 2),
    total_gratuita: '',
    total_otros_cargos: '',
    total: redondear(totalVenta, 2),
    items: armarItems(datosVenta),
    enviar_automaticamente_a_la_sunat: true,
    enviar_automaticamente_al_cliente: false,
    codigo_unico: `${datosVenta.serie}-${datosVenta.numero}`,
    condiciones_de_pago: 'Contado',
    medio_de_pago: datosVenta.medio_de_pago
      || medioPagoNubefact(datosVenta.metodoPago, datosVenta.mixtoData),
    placa_vehiculo: '',
    orden_compra_servicio: '',
    tabla_personalizada_codigo: '',
    formato_de_pdf: 'TICKET',
    observaciones: ruc ? `RUC emisor ${ruc}` : '',
  }
}

async function postNubefact(payload) {
  logCredencialesUsadas(payload?.operacion || 'post')
  const { url, token } = credenciales()
  if (!url || !token) {
    return { ok: false, error: 'Credenciales de Nubefact no configuradas.' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    let data = null
    try {
      data = await response.json()
    } catch {
      data = null
    }

    if (!data) {
      return {
        ok: false,
        codigo: null,
        timeout: false,
        error: !response.ok ? `Error HTTP ${response.status}` : 'Respuesta inválida de Nubefact.',
      }
    }

    const tieneErrors = (typeof data.errors === 'string' && data.errors.trim())
      || (Array.isArray(data.errors) && data.errors.length > 0)
      || Boolean(data.error)
    if (!response.ok || tieneErrors) {
      const error = mensajeErrorNubefact(data, `Error HTTP ${response.status}`)
      return {
        ok: false,
        codigo: extraerCodigoNubefact(data, error),
        timeout: false,
        error,
        data,
      }
    }

    return { ok: true, data }
  } catch (err) {
    if (err?.name === 'AbortError') {
      return { ok: false, timeout: true, codigo: null, error: 'Timeout al consultar Nubefact.' }
    }
    return { ok: false, timeout: false, codigo: null, error: err?.message || 'Sin conexión con Nubefact.' }
  } finally {
    clearTimeout(timer)
  }
}

export async function emitirComprobanteNubefact(datosVenta) {
  try {
    const serie = String(datosVenta?.serie || '').trim()
    const numero = Number(datosVenta?.numero)
    if (!serie || !Number.isFinite(numero) || numero < 1) {
      return { ok: false, error: 'Serie y número SUNAT son obligatorios para emitir.' }
    }
    console.log(`[nubefact] generar_comprobante ${serie}-${numero} (main)`)
    const payload = armarPayloadGenerar(datosVenta)
    const res = await postNubefact(payload)
    if (!res.ok) return res

    const data = res.data || {}
    return {
      ok: true,
      data: {
        aceptada_por_sunat: Boolean(data.aceptada_por_sunat),
        key_nubefact: data.key || data.codigo_unico || null,
        enlace_pdf: data.enlace_del_pdf || data.enlace || null,
        enlace_xml: data.enlace_del_xml || null,
        sunat_description: data.sunat_description || data.descripcion || null,
        codigo_hash: data.codigo_hash || null,
        cadena_qr: data.cadena_para_codigo_qr || null,
        enlace: data.enlace || data.enlace_del_pdf || null,
        codigo_barras: data.codigo_de_barras || null,
        raw: data,
      },
    }
  } catch (err) {
    return { ok: false, error: err?.message || 'Error inesperado al emitir comprobante.' }
  }
}

export async function consultarEstadoNubefact(tipoComprobante, serie, numero) {
  try {
    const tipo = Number(tipoComprobante) === TIPO_COMPROBANTE_NUBEFACT.FACTURA
      ? TIPO_COMPROBANTE_NUBEFACT.FACTURA
      : TIPO_COMPROBANTE_NUBEFACT.BOLETA
    console.log(`[nubefact] consultar_comprobante ${serie}-${numero} (main)`)
    const res = await postNubefact({
      operacion: 'consultar_comprobante',
      tipo_de_comprobante: tipo,
      serie: String(serie || '').trim(),
      numero: Number(numero),
    })
    if (!res.ok) return res

    const data = res.data || {}
    const aceptada = Boolean(data.aceptada_por_sunat)
    return {
      ok: true,
      data: {
        aceptada_por_sunat: aceptada,
        estado: aceptada ? 'ACEPTADO' : (data.sunat_description || 'ENVIADO'),
        enlace_pdf: data.enlace_del_pdf || data.enlace || null,
        enlace_xml: data.enlace_del_xml || null,
        key_nubefact: data.key || null,
        sunat_description: data.sunat_description || data.descripcion || null,
        sunat_note: data.sunat_note || null,
        sunat_responsecode: data.sunat_responsecode ?? null,
        sunat_soap_error: data.sunat_soap_error || null,
        codigo_hash: data.codigo_hash || null,
        cadena_qr: data.cadena_para_codigo_qr || null,
        enlace: data.enlace || data.enlace_del_pdf || null,
        codigo_barras: data.codigo_de_barras || null,
        raw: data,
      },
    }
  } catch (err) {
    return { ok: false, error: err?.message || 'Error inesperado al consultar comprobante.' }
  }
}

export async function anularComprobanteNubefactMain({ tipo_comprobante, serie, numero, correlativo, motivo }) {
  try {
    const tipo = Number(tipo_comprobante) === TIPO_COMPROBANTE_NUBEFACT.FACTURA
      || String(tipo_comprobante).toUpperCase() === 'FACTURA'
      || String(tipo_comprobante) === '01'
      ? TIPO_COMPROBANTE_NUBEFACT.FACTURA
      : TIPO_COMPROBANTE_NUBEFACT.BOLETA
    const nro = Number(numero || correlativo)
    console.log(`[nubefact] generar_anulacion ${serie}-${nro} (main)`)
    const res = await postNubefact({
      operacion: 'generar_anulacion',
      tipo_de_comprobante: tipo,
      serie,
      numero: nro,
      motivo: motivo || 'Error en la emisión',
    })
    if (!res.ok) return res
    return { ok: true, data: res.data }
  } catch (err) {
    return { ok: false, error: err?.message || 'Error al anular comprobante.' }
  }
}
