/**
 * Impresión térmica ESC/POS (USB) — formato ticket Salud Futura.
 *
 * Orden de resolución de impresora:
 * 1) THERMAL_PRINTER_INTERFACE (env, debug)
 * 2) printer-config.json en userData (configuración Admin)
 * 3) Autodetect: POS-80-Series si existe / única impresora / hint térmico
 * 4) Legacy POS-80-Series (aviso en log)
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { nativeImage } from 'electron'
import { PNG } from 'pngjs'
import thermalPrinterPkg from 'node-thermal-printer'
import { windowsRawDriver, listPrinterNamesSync } from './windowsRawDriver.js'
import {
  readPrinterConfig,
  toPrinterInterface,
  LEGACY_DEFAULT_PRINTER,
} from '../printerConfig.js'
import { numeroALetras } from '../../src/utils/numeroALetras.js'
import { TICKET_EMISOR, etiquetaComprobante, etiquetaDocCliente, desgloseTicket, primerNombreTicket } from '../../src/utils/ticketFarmacia.js'
import { formatPrecioUnitario } from '../../src/utils/precioExacto.js'
import { datosSunatTicket, numeroEncabezadoTicket } from '../../src/utils/ticketSunat.js'
import { encodeQr } from '../../src/utils/qrEncode.js'
import {
  TIPO_DOC_CIERRE_CAJA,
  lineasCierreCaja,
  PIE_CIERRE_CAJA,
} from '../../src/utils/cierreCajaTicket.js'

const { ThermalPrinter, PrinterTypes } = thermalPrinterPkg

const LOG = '[electron:thermal]'
/** Ancho del logo (compacto). Original icono.png = 2000×2000. */
const LOGO_TICKET_WIDTH_PX = 180
/**
 * Ancho printable típico 80mm ESC/POS (203 dpi ≈ 576 dots).
 * GS v 0 (raster) suele IGNORAR alignCenter() — hay que centrar con padding blanco.
 */
const PAPER_WIDTH_PX = 576
const __dirname = path.dirname(fileURLToPath(import.meta.url))

function resolvePrinterType() {
  const t = String(process.env.THERMAL_PRINTER_TYPE || 'epson').toLowerCase()
  if (t === 'star') return PrinterTypes.STAR
  return PrinterTypes.EPSON
}

function looksThermal(name) {
  const n = String(name || '').toLowerCase()
  return /pos|thermal|ticket|80-|tm-|epson|receipt|xp-|rongta|gprinter/.test(n)
}

/**
 * Resuelve interface `printer:Nombre` para node-thermal-printer.
 * @param {{ printerName?: string }} [opts] — override puntual (prueba sin guardar)
 */
export function resolveInterface(opts = {}) {
  if (opts.printerName) {
    const iface = toPrinterInterface(opts.printerName)
    if (iface) return iface
  }
  if (process.env.THERMAL_PRINTER_INTERFACE) {
    return process.env.THERMAL_PRINTER_INTERFACE
  }

  const cfg = readPrinterConfig()
  if (cfg.printerName) {
    return toPrinterInterface(cfg.printerName)
  }

  // Autodetect si aún no hay config guardada
  let installed = []
  try {
    installed = listPrinterNamesSync()
  } catch (err) {
    console.warn(`${LOG} autodetect getPrinters falló:`, err?.message || err)
  }

  const legacy = installed.find((n) => n.toLowerCase() === LEGACY_DEFAULT_PRINTER.toLowerCase())
  if (legacy) {
    console.warn(`${LOG} sin config guardada → usando legacy "${legacy}". Configura en Admin → Impresora.`)
    return toPrinterInterface(legacy)
  }

  const thermalHints = installed.filter(looksThermal)
  if (thermalHints.length === 1) {
    console.warn(`${LOG} sin config → autodetect térmica "${thermalHints[0]}". Configura en Admin → Impresora.`)
    return toPrinterInterface(thermalHints[0])
  }
  if (installed.length === 1) {
    console.warn(`${LOG} sin config → única impresora "${installed[0]}". Configura en Admin → Impresora.`)
    return toPrinterInterface(installed[0])
  }

  console.warn(
    `${LOG} sin impresora configurada y no se pudo autodetectar. ` +
    `Ve a Admin → Impresora. Fallback legacy "${LEGACY_DEFAULT_PRINTER}".`,
  )
  return toPrinterInterface(LEGACY_DEFAULT_PRINTER)
}

function resolveLogoPath() {
  const candidates = [
    path.join(__dirname, 'assets/icono.png'),
    path.join(__dirname, '../assets/icono.png'),
    path.join(process.cwd(), 'electron/assets/icono.png'),
    path.join(process.cwd(), 'src/assets/icono.png'),
    path.join(process.cwd(), 'public/icono.png'),
    path.join(process.cwd(), 'dist/icono.png'),
  ]
  return candidates.find((p) => {
    try {
      return fs.existsSync(p)
    } catch {
      return false
    }
  })
}

function createPrinter(opts = {}) {
  const iface = resolveInterface(opts)
  const type = resolvePrinterType()
  console.log(`${LOG} createPrinter`, { interface: iface, type: String(type) })

  return new ThermalPrinter({
    type,
    interface: iface,
    driver: windowsRawDriver,
    width: 48,
    characterSet: 'PC852_LATIN2',
    removeSpecialCharacters: false,
    lineCharacter: '-',
    breakLine: 'word',
    options: {
      timeout: 5000,
    },
  })
}

function errMessage(err) {
  if (err == null) return 'Error desconocido'
  if (typeof err === 'string') return err
  if (err === false) return 'isPrinterConnected devolvió false / throw false'
  return err?.message || String(err)
}

function money(n) {
  return Number(n || 0).toFixed(2)
}

function trunc(str, max) {
  const s = String(str ?? '')
  return s.length <= max ? s : `${s.slice(0, max - 1)}.`
}

function row4(a, b, c, d, widths = [22, 4, 10, 10]) {
  const [wa, wb, wc, wd] = widths
  return (
    trunc(a, wa).padEnd(wa) +
    trunc(b, wb).padStart(wb) +
    trunc(c, wc).padStart(wc) +
    trunc(d, wd).padStart(wd)
  )
}

function kv(label, value, width = 48) {
  const l = String(label)
  const v = String(value ?? '')
  const spaces = Math.max(1, width - l.length - v.length)
  return `${l}${' '.repeat(spaces)}${v}`
}

/**
 * Coloca el logo centrado en un canvas blanco del ancho del papel.
 * Muchas POS-80 ignoran ESC a (align) en imágenes raster GS v 0.
 */
function centerPngOnPaper(pngBuffer, paperWidth = PAPER_WIDTH_PX) {
  const src = PNG.sync.read(pngBuffer)
  // Ancho múltiplo de 8 (requerido por el empaquetado de bits ESC/POS).
  const canvasW = Math.ceil(paperWidth / 8) * 8
  const canvasH = src.height
  const out = new PNG({ width: canvasW, height: canvasH, colorType: 6 })

  // Fondo blanco opaco
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = 255
    out.data[i + 1] = 255
    out.data[i + 2] = 255
    out.data[i + 3] = 255
  }

  const offsetX = Math.max(0, Math.floor((canvasW - src.width) / 2))
  for (let y = 0; y < src.height; y += 1) {
    for (let x = 0; x < src.width; x += 1) {
      const dx = x + offsetX
      if (dx < 0 || dx >= canvasW) continue
      const si = (src.width * y + x) << 2
      const di = (canvasW * y + dx) << 2
      out.data[di] = src.data[si]
      out.data[di + 1] = src.data[si + 1]
      out.data[di + 2] = src.data[si + 2]
      out.data[di + 3] = src.data[si + 3]
    }
  }

  console.log(`${LOG} logo centrado en canvas ${canvasW}x${canvasH} (offsetX=${offsetX})`)
  return PNG.sync.write(out)
}

function qrToPngBuffer(text, modulePx = 6) {
  const mods = encodeQr(text)
  const n = mods.length
  const w = n * modulePx
  const png = new PNG({ width: w, height: w, colorType: 6 })
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const black = mods[y][x]
      const v = black ? 0 : 255
      for (let dy = 0; dy < modulePx; dy += 1) {
        for (let dx = 0; dx < modulePx; dx += 1) {
          const i = ((y * modulePx + dy) * w + (x * modulePx + dx)) << 2
          png.data[i] = v
          png.data[i + 1] = v
          png.data[i + 2] = v
          png.data[i + 3] = 255
        }
      }
    }
  }
  return PNG.sync.write(png)
}

async function printSunatBlock(printer, payload) {
  const sunat = datosSunatTicket(payload)
  if (!sunat) return

  printer.drawLine()
  printer.alignCenter()

  if (sunat.cadenaQr) {
    try {
      const png = centerPngOnPaper(qrToPngBuffer(sunat.cadenaQr, 5), PAPER_WIDTH_PX)
      printer.alignCenter()
      await printer.printImageBuffer(png)
      printer.newLine()
    } catch (err) {
      console.warn(`${LOG} QR raster falló, intento printQR nativo:`, errMessage(err))
      try {
        printer.alignCenter()
        printer.printQR(sunat.cadenaQr, { cellSize: 6, correction: 'M', model: 2 })
        printer.newLine()
      } catch (errQr) {
        console.warn(`${LOG} printQR nativo falló:`, errMessage(errQr))
      }
    }
  }

  printer.alignCenter()
  printer.println(sunat.leyenda)
  if (sunat.cpe) printer.println(`CPE SUNAT: ${sunat.cpe}`)
  if (sunat.codigoHash) {
    printer.println(`HASH: ${sunat.codigoHash}`)
  }
}

/**
 * Redimensiona el PNG a LOGO_TICKET_WIDTH_PX y lo centra en el ancho 80mm.
 * @returns {Buffer|null} PNG listo para printImageBuffer
 */
function prepareTicketLogoPng(logoPath) {
  const img = nativeImage.createFromPath(logoPath)
  if (img.isEmpty()) {
    console.warn(`${LOG} nativeImage vacío:`, logoPath)
    return null
  }
  const { width: srcW, height: srcH } = img.getSize()
  const targetW = LOGO_TICKET_WIDTH_PX
  const targetH = Math.max(1, Math.round((srcH / srcW) * targetW))
  const resized = img.resize({ width: targetW, height: targetH, quality: 'best' })
  console.log(`${LOG} logo resize ${srcW}x${srcH} → ${targetW}x${targetH} px`)
  return centerPngOnPaper(resized.toPNG(), PAPER_WIDTH_PX)
}

async function printHeader(printer) {
  const logo = resolveLogoPath()
  // alignCenter ayuda en texto; la imagen raster se centra con padding (ver centerPngOnPaper).
  printer.alignCenter()
  if (logo) {
    try {
      console.log(`${LOG} logo:`, logo)
      const png = prepareTicketLogoPng(logo)
      if (png) {
        printer.alignCenter()
        await printer.printImageBuffer(png)
      } else {
        printer.alignCenter()
        await printer.printImage(logo)
      }
      printer.newLine()
    } catch (err) {
      console.warn(`${LOG} printImage falló (sigue sin logo):`, errMessage(err))
    }
  } else {
    console.warn(`${LOG} logo no encontrado — ticket sin imagen`)
  }
  printer.alignCenter()

  // "BOTICAS" debajo de la cruz (no superpuesto): alto doble, ancho normal — más chico
  // que "SALUD FUTURA" (quad) y legible en 80 mm.
  printer.bold(true)
  printer.setTextDoubleHeight()
  printer.println(TICKET_EMISOR.rubro)
  printer.setTextNormal()
  printer.bold(false)
  printer.newLine()

  // Marca grande (doble alto + doble ancho). "SALUD FUTURA" = 13 chars → ~26 en
  // ancho de 48: cabe sin cortar en 80mm. Luego volver a texto normal.
  printer.bold(true)
  printer.setTextQuadArea()
  printer.println(TICKET_EMISOR.nombreComercial)
  printer.setTextNormal()
  printer.bold(false)

  printer.println(TICKET_EMISOR.razonSocial)
  printer.println(`RUC: ${TICKET_EMISOR.ruc}`)
  printer.println(TICKET_EMISOR.correo)
  printer.println(TICKET_EMISOR.direccion)
  printer.drawLine()
}

/**
 * Cuerpo del voucher de cierre de turno.
 * Las líneas ya vienen maquetadas a 48 columnas desde cierreCajaTicket.js, que es
 * el mismo módulo que usa el respaldo HTML de la web: acá solo se aplica el estilo.
 */
function printCierreCajaBody(printer, cierre) {
  for (const linea of lineasCierreCaja(cierre)) {
    if (linea.estilo === 'linea') {
      printer.drawLine()
      continue
    }
    if (linea.estilo === 'blanco') {
      printer.newLine()
      continue
    }
    const centrado = linea.estilo === 'centro' || linea.estilo === 'centroBold'
    const negrita = linea.estilo === 'bold' || linea.estilo === 'centroBold'
    if (centrado) printer.alignCenter()
    else printer.alignLeft()
    if (negrita) printer.bold(true)
    printer.println(linea.texto)
    if (negrita) printer.bold(false)
  }
  printer.alignLeft()
}

/**
 * @param {object} payload
 * @param {{ printerName?: string }} [opts] — override de impresora (prueba desde Admin)
 */
export async function printThermalTicket(payload = {}, opts = {}) {
  const printerOverride = opts.printerName || payload.printerName || undefined
  const iface = resolveInterface({ printerName: printerOverride })
  console.log(`${LOG} ——— printThermalTicket INICIO ———`, {
    interface: iface,
    test: !!payload.test,
    tipoDocumento: payload.tipoDocumento || 'VENTA',
    comprobante: payload.comprobante,
    tipoComprobante: payload.tipoComprobante,
    fecha: payload.fecha,
    metodoPago: payload.metodoPago,
    vendedor: payload.vendedor,
    cliente: payload.cliente,
    clienteDoc: payload.clienteDoc,
    items: Array.isArray(payload.items) ? payload.items.length : 0,
    itemsSample: Array.isArray(payload.items)
      ? payload.items.slice(0, 2).map((i) => ({
        producto: i?.producto ?? i?.descripcion,
        cantidad: i?.cantidad,
        precio: i?.precio,
        subtotal: i?.subtotal,
      }))
      : null,
    total: payload.total,
    descuento: payload.descuento,
    montoRecibido: payload.montoRecibido,
    vuelto: payload.vuelto,
    payloadKeys: Object.keys(payload || {}),
  })

  let printer
  try {
    printer = createPrinter({ printerName: printerOverride })
  } catch (err) {
    const error = `createPrinter falló: ${errMessage(err)}`
    console.error(`${LOG} ${error}`)
    return { ok: false, error, step: 'createPrinter', interface: iface }
  }

  try {
    console.log(`${LOG} paso: isPrinterConnected…`)
    const connected = await printer.isPrinterConnected()
    console.log(`${LOG} isPrinterConnected →`, connected)
    if (!connected) {
      const error = `Impresora no conectada (interface: ${iface}).`
      console.error(`${LOG} ${error}`)
      return { ok: false, error, step: 'isPrinterConnected', interface: iface }
    }
  } catch (err) {
    const error = `Fallo al verificar impresora (${iface}): ${errMessage(err)}`
    console.error(`${LOG} ${error}`)
    return { ok: false, error, step: 'isPrinterConnected', interface: iface }
  }

  try {
    console.log(`${LOG} paso: armar buffer ESC/POS…`)
    printer.clear()
    await printHeader(printer)

    const esCierreCaja = payload.tipoDocumento === TIPO_DOC_CIERRE_CAJA

    if (payload.test) {
      printer.alignCenter()
      printer.println('TICKET DE PRUEBA')
      printer.println(TICKET_EMISOR.nombreComercial)
      printer.println(new Date().toLocaleString('es-PE'))
      printer.drawLine()
      printer.println(`Impresora: ${iface.replace(/^printer:/, '')}`)
      printer.println('USB ESC/POS OK')
    } else if (esCierreCaja) {
      printCierreCajaBody(printer, payload.cierre)
    } else {
      if (payload.esPrueba) {
        printer.alignCenter()
        printer.bold(true)
        printer.println('COMPROBANTE DE PRUEBA')
        printer.println('SIN VALOR TRIBUTARIO')
        printer.bold(false)
        printer.drawLine()
      }
      const tipoRaw = payload.tipoComprobante || payload.comprobanteTipo
      const tipoLabel = etiquetaComprobante(tipoRaw)
      const docLabel = payload.clienteDocLabel || etiquetaDocCliente(tipoRaw)
      const encabezado = numeroEncabezadoTicket(payload)
      const nro = encabezado.numero || payload.comprobante || '—'
      printer.alignCenter()
      printer.bold(true)
      printer.println(tipoLabel)
      printer.println(nro)
      printer.bold(false)
      printer.drawLine()

      printer.alignLeft()
      printer.println(`FECHA: ${payload.fecha || new Date().toLocaleString('es-PE')}`)
      printer.println(`F.PAGO: ${payload.metodoPago || '—'}`)
      printer.println(`CAJERO / VEND: ${primerNombreTicket(payload.vendedor) || '—'}`)
      printer.println(`SR(ES): ${payload.cliente || 'CLIENTE GENERAL'}`)
      printer.println(`${docLabel}: ${payload.clienteDoc || '—'}`)
      printer.println(`PUNTOS ACUM: ${payload.puntosAcum ?? 0}`)
      if (payload.clienteDireccion) {
        printer.println(`DIREC: ${payload.clienteDireccion}`)
      }
      printer.drawLine()

      printer.println(row4('PRODUCTO', 'Cant', 'Precio', 'Total'))
      printer.drawLine()
      for (const item of payload.items || []) {
        const nombre = String(item.producto || item.descripcion || 'Producto')
        const cant = String(item.cantidad ?? 1)
        const precio = formatPrecioUnitario(item.precio)
        const totalLinea = money(item.subtotal ?? (Number(item.precio) * Number(item.cantidad || 1)))
        // Nombre en línea propia si es largo
        if (nombre.length > 22) {
          printer.println(trunc(nombre, 48))
          printer.println(row4('', cant, precio, totalLinea))
        } else {
          printer.println(row4(nombre, cant, precio, totalLinea))
        }
      }
      printer.drawLine()

      const d = desgloseTicket(payload.total, payload.descuento)
      const recibido = payload.montoRecibido != null ? Number(payload.montoRecibido) : null
      const vuelto = payload.vuelto != null ? Number(payload.vuelto) : null

      printer.println(kv('INAFECTAS:', money(d.inafectas)))
      printer.println(kv('OPERACION GRAVADA:', money(d.operacionGravada)))
      printer.println(kv('IGV:', money(d.igv)))
      printer.println(kv('TOTAL BRUTO:', money(d.totalBruto)))
      printer.println(kv('DSTO SOLES:', money(d.dstoSoles)))
      printer.bold(true)
      printer.println(kv('IMPORTE TOTAL:', money(d.importeTotal)))
      printer.bold(false)
      if (recibido != null && !Number.isNaN(recibido)) {
        printer.println(kv('RECIBIDO:', money(recibido)))
      }
      if (vuelto != null && !Number.isNaN(vuelto)) {
        printer.println(kv('VUELTO:', money(Math.max(0, vuelto))))
      }
      printer.drawLine()

      printer.alignLeft()
      printer.println(numeroALetras(d.importeTotal))
      await printSunatBlock(printer, payload)
      if (encabezado.provisional) {
        printer.alignCenter()
        printer.println('Nro. definitivo disponible al sincronizar')
      }
    }

    printer.drawLine()
    printer.alignCenter()
    if (esCierreCaja) {
      // No es comprobante de pago: no corresponde el "gracias por su compra".
      for (const linea of PIE_CIERRE_CAJA) printer.println(linea)
    } else {
      printer.println('Gracias por su Preferencia')
    }
    printer.newLine()
    printer.cut()

    const byteLength = printer.getBuffer()?.length ?? 0
    console.log(`${LOG} paso: execute() — enviando ${byteLength} bytes RAW a ${iface}…`)
    const job = await printer.execute()
    console.log(`${LOG} ——— printThermalTicket OK ———`, job)
    return { ok: true, interface: iface, job: job ? String(job) : undefined }
  } catch (err) {
    const error = `Fallo al enviar a impresora (${iface}): ${errMessage(err)}`
    console.error(`${LOG} ——— printThermalTicket ERROR ———`, error)
    return { ok: false, error, step: 'execute', interface: iface }
  }
}

export async function getThermalPrinterStatus() {
  const cfg = readPrinterConfig()
  const iface = resolveInterface()
  let installed = []
  try {
    installed = listPrinterNamesSync()
  } catch { /* empty */ }
  try {
    const printer = createPrinter()
    const connected = await printer.isPrinterConnected()
    console.log(`${LOG} status`, { interface: iface, connected: !!connected })
    return {
      ok: true,
      connected: !!connected,
      interface: iface,
      printerName: cfg.printerName || iface.replace(/^printer:/, ''),
      configured: !!cfg.printerName,
      printers: installed,
      type: String(process.env.THERMAL_PRINTER_TYPE || 'epson'),
      logo: resolveLogoPath() || null,
    }
  } catch (err) {
    const error = errMessage(err)
    console.error(`${LOG} status ERROR:`, error)
    return {
      ok: false,
      connected: false,
      interface: iface,
      printerName: cfg.printerName,
      configured: !!cfg.printerName,
      printers: installed,
      error,
    }
  }
}

/** Lista impresoras Windows para la UI Admin. */
export function listInstalledPrinters() {
  try {
    const names = listPrinterNamesSync()
    return { ok: true, printers: names }
  } catch (err) {
    return { ok: false, printers: [], error: errMessage(err) }
  }
}
