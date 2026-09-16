/**
 * Armado e impresión de tickets (POS auto + reimpresión desde historial).
 * Electron → térmica ESC/POS; web → ventana HTML de impresión.
 */

import { printTicket, isElectronApp } from './electronBridge'
import { etiquetaComprobante, etiquetaDocCliente, TICKET_EMISOR, desgloseTicket, primerNombreTicket } from './ticketFarmacia'
import { formatPrecioUnitario } from './precioExacto'
import { numeroALetras } from './numeroALetras'
import { datosSunatTicket, numeroEncabezadoTicket, padComprobanteTicket } from './ticketSunat'
import { qrToSvg } from './qrEncode'

const LOG = '[ticketPrint]'

function padComprobante(serie, correlativo) {
  return padComprobanteTicket(serie, correlativo)
}

function fechaTicketDesde(isoOrDate) {
  const fecha = isoOrDate ? new Date(isoOrDate) : new Date()
  const fechaStr = fecha.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const horaStr = fecha.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })
  return `${fechaStr} ${horaStr}`
}

function metodoDesdePagos(pagos = []) {
  if (!pagos.length) return '—'
  if (pagos.length === 1) {
    const m = String(pagos[0].metodo || '').toUpperCase()
    if (m.includes('YAPE')) return 'Yape'
    if (m.includes('TARJETA')) return 'Tarjeta'
    if (m.includes('EFECTIVO')) return 'Efectivo'
    return pagos[0].metodo || '—'
  }
  return pagos
    .map((p) => {
      const m = String(p.metodo || '').toUpperCase()
      const label = m.includes('YAPE') ? 'Yape' : m.includes('TARJETA') ? 'Tarjeta' : 'Efectivo'
      return `${label} S/${Number(p.monto || 0).toFixed(2)}`
    })
    .join(' + ')
}

/** Doc del cliente: nro_doc real (ignora placeholders SD- del POS sin documento). */
function docClienteVisible(nroDoc) {
  const s = String(nroDoc || '').trim()
  if (!s || s.toUpperCase().startsWith('SD-')) return ''
  return s
}

function resumenPayload(payload) {
  if (!payload) return null
  return {
    comprobante: payload.comprobante,
    tipoComprobante: payload.tipoComprobante,
    fecha: payload.fecha,
    metodoPago: payload.metodoPago,
    vendedor: payload.vendedor,
    cliente: payload.cliente,
    clienteDoc: payload.clienteDoc,
    items: Array.isArray(payload.items) ? payload.items.length : 0,
    total: payload.total,
    descuento: payload.descuento,
    montoRecibido: payload.montoRecibido,
    vuelto: payload.vuelto,
    sunatHash: payload.sunatHash || null,
    sunatEnlace: payload.sunatEnlace || null,
    sunatSerie: payload.sunatSerie || null,
    sunatNumero: payload.sunatNumero ?? null,
    ticketProvisional: payload.ticketProvisional || false,
  }
}

/** Payload desde el objeto recibo del POS (venta recién cobrada). */
export function buildPrintPayloadFromRecibo(data) {
  if (!data) return null
  const {
    venta, carrito: c = [], total: t, descuento: desc = 0,
    metodoPago: mp, mixtoData: mx, user: u,
    montoRecibido: mr, vuelto: vt, clienteNombre,
    clienteDoc = '', clienteDireccion = '', puntosAcum = 0,
    sunat = null,
  } = data

  const encabezado = numeroEncabezadoTicket({
    tipoComprobante: venta?.tipo_comprobante,
    comprobanteInterno: padComprobante(venta?.serie, venta?.correlativo),
    sunatSerie: sunat?.serie || null,
    sunatNumero: sunat?.numero ?? null,
  })
  const comprobante = encabezado.numero
  const docLabel = etiquetaDocCliente(venta?.tipo_comprobante)
  const vendedor = ((u?.nombres || '') + ' ' + (u?.apellidos?.split(' ')[0] || '')).trim()
  const clienteStr = (clienteNombre && String(clienteNombre).trim()) || 'CLIENTE GENERAL'
  let metodoStr = mp
  if (mp === 'Mixto' && mx) {
    metodoStr = `${mx.metodo1} S/${Number(mx.monto1).toFixed(2)} + ${mx.metodo2} S/${Number(mx.monto2).toFixed(2)}`
  }
  const mostrarRecibido = mp === 'Efectivo' || (mr != null && Number(mr) > 0)

  const payload = {
    tipoComprobante: venta?.tipo_comprobante,
    comprobante,
    fecha: fechaTicketDesde(venta?.created_at || venta?.fecha_hora),
    metodoPago: metodoStr,
    vendedor: vendedor || '',
    cliente: clienteStr,
    clienteDoc: clienteDoc || '',
    clienteDocLabel: docLabel,
    clienteDireccion: clienteDireccion || '',
    puntosAcum: puntosAcum ?? 0,
    items: c.map((item) => ({
      producto: item.modo_venta
        ? `${item.producto} (${item.modo_venta})`
        : item.producto,
      cantidad: item.cantidad,
      precio: item.precio,
      subtotal: item.subtotal,
    })),
    total: t,
    descuento: desc || 0,
    montoRecibido: mostrarRecibido ? Number(mr || 0) : undefined,
    vuelto: mostrarRecibido ? Number(vt > 0 ? vt : 0) : undefined,
    fechaIso: venta?.created_at || venta?.fecha_hora || null,
    sunatSerie: sunat?.serie || null,
    sunatNumero: sunat?.numero || null,
    sunatHash: sunat?.codigoHash || sunat?.codigo_hash || '',
    sunatCadenaQr: sunat?.cadenaQr || sunat?.cadena_qr || '',
    sunatEnlace: sunat?.enlace || sunat?.enlace_pdf || '',
    sunatBarcode: sunat?.barcode || sunat?.codigo_barras || '',
    ticketProvisional: encabezado.provisional,
  }
  console.info(`${LOG} buildPrintPayloadFromRecibo (POS cobro)`, resumenPayload(payload))
  return payload
}

function bloqueSunatHtml(payload) {
  const sunat = datosSunatTicket(payload)
  if (!sunat) return ''
  let qrMarkup = ''
  if (sunat.cadenaQr) {
    try {
      qrMarkup = `<div class="qr">${qrToSvg(sunat.cadenaQr, { moduleSize: 3, border: 2 })}</div>`
    } catch (err) {
      console.warn(`${LOG} QR HTML:`, err?.message || err)
    }
  }
  const hash = sunat.codigoHash
    ? `<div>HASH: <b style="word-break:break-all">${escapeHtml(sunat.codigoHash)}</b></div>`
    : ''
  const cpe = sunat.cpe
    ? `<div>CPE SUNAT: <b>${escapeHtml(sunat.cpe)}</b></div>`
    : ''
  const barcode = sunat.barcode
    ? `<div class="barcode">${escapeHtml(sunat.barcode)}</div>`
    : ''
  return `<div class="line"></div>
<div class="center sunat">
  ${qrMarkup}
  <div class="bold" style="font-size:9px;margin-top:4px">${escapeHtml(sunat.leyenda)}</div>
  ${cpe}
  ${hash}
  ${barcode}
</div>`
}

/**
 * HTML del ticket (misma plantilla que venta real y ticket de prueba).
 * @param {{ autoPrint?: boolean }} [opts]
 */
export function buildTicketHtml(payload, opts = {}) {
  if (!payload) return ''
  const d = desgloseTicket(payload.total, payload.descuento)
  const tipoLabel = etiquetaComprobante(payload.tipoComprobante)
  const docLabel = payload.clienteDocLabel || etiquetaDocCliente(payload.tipoComprobante)
  const filas = (payload.items || []).map((item) => (
    `<tr>
      <td>${escapeHtml(item.producto)}</td>
      <td style="text-align:center">${item.cantidad}</td>
      <td style="text-align:right">${formatPrecioUnitario(item.precio)}</td>
      <td style="text-align:right"><b>${Number(item.subtotal).toFixed(2)}</b></td>
    </tr>`
  )).join('')
  const bannerPrueba = payload.esPrueba
    ? '<div class="center bold" style="font-size:9px;letter-spacing:0.4px">COMPROBANTE DE PRUEBA — SIN VALOR TRIBUTARIO</div><div class="line"></div>'
    : ''
  const autoPrint = opts.autoPrint !== false

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHtml(payload.comprobante || 'Ticket')}</title>
<style>
@page{size:80mm auto;margin:0}
body{font-family:'Courier New',monospace;width:80mm;margin:0 auto;padding:3mm;font-size:11px;color:#000;background:#fff}
.center{text-align:center}.bold{font-weight:800}.line{border-top:1px dashed #000;margin:6px 0}
table{width:100%;border-collapse:collapse} th,td{padding:2px;font-size:10px}
th{border-bottom:1px solid #000;text-align:left}.brand{font-size:18px;font-weight:900;letter-spacing:1px;margin:2px 0 4px}
.cruz{width:22mm;height:auto;display:block;margin:0 auto 3px}
.boticas{font-size:13px;font-weight:800;letter-spacing:2px;margin:2px 0 6px}
.qr{display:flex;justify-content:center;margin:6px 0}.qr svg{width:38mm;height:38mm}
.barcode{font-family:'OCR A',monospace;letter-spacing:2px;font-size:12px;margin-top:4px}
.sunat{font-size:9px;line-height:1.35}
</style></head><body>
${bannerPrueba}
<div class="center">
  <img class="cruz" src="/icono.png" alt="" />
  <div class="boticas">${escapeHtml(TICKET_EMISOR.rubro)}</div>
  <div class="brand">${escapeHtml(TICKET_EMISOR.nombreComercial)}</div>
  <div>${escapeHtml(TICKET_EMISOR.razonSocial)}</div>
  <div>RUC: ${escapeHtml(TICKET_EMISOR.ruc)}</div>
  <div>${escapeHtml(TICKET_EMISOR.correo)}</div>
  <div>${escapeHtml(TICKET_EMISOR.direccion)}</div>
</div>
<div class="line"></div>
<div class="center bold">${escapeHtml(tipoLabel)}</div>
<div class="center bold" style="font-size:13px;letter-spacing:1px">${escapeHtml(numeroEncabezadoTicket(payload).numero || payload.comprobante || '')}</div>
<div class="line"></div>
<div>FECHA: <b>${escapeHtml(payload.fecha || '')}</b></div>
<div>F.PAGO: <b>${escapeHtml(payload.metodoPago || '—')}</b></div>
<div>CAJERO / VEND: <b>${escapeHtml(primerNombreTicket(payload.vendedor) || '—')}</b></div>
<div>SR(ES): <b>${escapeHtml(payload.cliente || 'CLIENTE GENERAL')}</b></div>
<div>${escapeHtml(docLabel)}: <b>${escapeHtml(payload.clienteDoc || '—')}</b> &nbsp; PUNTOS ACUM: <b>${payload.puntosAcum ?? 0}</b></div>
${payload.clienteDireccion ? `<div>DIREC: <b>${escapeHtml(payload.clienteDireccion)}</b></div>` : ''}
<div class="line"></div>
<table><thead><tr><th>PRODUCTO</th><th>Cant</th><th style="text-align:right">Precio</th><th style="text-align:right">Total</th></tr></thead>
<tbody>${filas}</tbody></table>
<div class="line"></div>
<div>INAFECTAS <span style="float:right">${d.inafectas.toFixed(2)}</span></div>
<div>OPERACION GRAVADA <span style="float:right">${d.operacionGravada.toFixed(2)}</span></div>
<div>IGV <span style="float:right">${d.igv.toFixed(2)}</span></div>
<div>TOTAL BRUTO <span style="float:right">${d.totalBruto.toFixed(2)}</span></div>
<div>DSTO SOLES <span style="float:right">${d.dstoSoles.toFixed(2)}</span></div>
<div class="bold" style="font-size:12px;margin-top:4px">IMPORTE TOTAL <span style="float:right">${d.importeTotal.toFixed(2)}</span></div>
${payload.montoRecibido != null ? `<div>RECIBIDO <span style="float:right">${Number(payload.montoRecibido).toFixed(2)}</span></div>` : ''}
${payload.vuelto != null ? `<div>VUELTO <span style="float:right">${Number(payload.vuelto).toFixed(2)}</span></div>` : ''}
<div class="line"></div>
<div class="bold" style="font-size:9px">${escapeHtml(numeroALetras(d.importeTotal))}</div>
${bloqueSunatHtml(payload)}
${numeroEncabezadoTicket(payload).provisional
    ? '<div class="center" style="font-size:8px;margin-top:4px">Nro. definitivo disponible al sincronizar</div>'
    : ''}
<div class="line"></div>
<div class="center bold">Gracias por su Preferencia</div>
${autoPrint ? '<script>window.onload=function(){setTimeout(function(){window.print()},300)}</script>' : ''}
</body></html>`
}

/** Fallback web: ventana mínima con el ticket (no imprime la pantalla admin/POS). */
export function abrirImpresionHtmlTicket(payload) {
  if (!payload) return
  const html = buildTicketHtml(payload, { autoPrint: true })
  const win = window.open('', '_blank', 'width=340,height=640,scrollbars=yes')
  if (win) {
    win.document.write(html)
    win.document.close()
  }
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Imprime payload: térmica en Electron; HTML en web (o si falla la térmica). */
export async function printTicketVenta(payload, opts = {}) {
  if (!payload) return { ok: false, error: 'Sin payload' }
  console.info(`${LOG} printTicketVenta →`, resumenPayload(payload), { electron: isElectronApp() })
  const fallback = opts.silentFallback
    ? () => {}
    : () => abrirImpresionHtmlTicket(payload)
  const result = await printTicket(payload, {
    fallbackPrint: fallback,
  })
  console.info(`${LOG} printTicketVenta resultado →`, result)
  return result
}

/**
 * Carga una venta desde Supabase y arma el payload de reimpresión.
 * Nota: clientes NO tiene columnas dni/ruc — usa nro_doc + tipo_doc.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function cargarPayloadReimpresion(supabase, idVenta) {
  console.info(`${LOG} cargarPayloadReimpresion INICIO id_venta=`, idVenta)

  const [resVenta, resDet, resPagos, resElec, resSunat] = await Promise.all([
    supabase
      .from('ventas')
      .select(`
        id_venta, serie, correlativo, total, descuento, vuelto, monto_recibido,
        created_at, fecha_hora, tipo_comprobante, id_usuario_vendedor, id_cliente,
        clientes(nombre_razon_social, nombres, apellidos, nro_doc, tipo_doc, direccion)
      `)
      .eq('id_venta', idVenta)
      .single(),
    supabase
      .from('venta_detalle')
      .select('cantidad, precio_unitario, subtotal, modo_venta, productos(descripcion)')
      .eq('id_venta', idVenta),
    supabase
      .from('pagos_venta')
      .select('metodo, monto')
      .eq('id_venta', idVenta),
    supabase
      .from('comprobantes_electronicos')
      .select('cliente_nombre, cliente_numero_doc, cliente_tipo_doc, hash_cdr, pdf_url, serie, correlativo, total_igv, total')
      .eq('id_venta', idVenta)
      .maybeSingle(),
    supabase
      .from('comprobantes_sunat')
      .select('serie, numero, cadena_qr, codigo_hash, enlace, enlace_pdf, key_nubefact, estado_envio')
      .eq('id_venta', idVenta)
      .maybeSingle(),
  ])

  if (resVenta.error) {
    console.error(`${LOG} ERROR consulta ventas:`, resVenta.error)
    throw new Error(`No se pudo cargar la venta: ${resVenta.error.message}`)
  }
  if (resDet.error) {
    console.error(`${LOG} ERROR consulta venta_detalle:`, resDet.error)
    throw new Error(`No se pudo cargar el detalle: ${resDet.error.message}`)
  }
  if (resPagos.error) {
    console.error(`${LOG} ERROR consulta pagos_venta:`, resPagos.error)
    throw new Error(`No se pudieron cargar los pagos: ${resPagos.error.message}`)
  }
  // comprobantes_electronicos / comprobantes_sunat son opcionales (nota de venta / offline)
  if (resElec.error) {
    console.warn(`${LOG} aviso comprobantes_electronicos:`, resElec.error.message)
  }
  if (resSunat.error) {
    console.warn(`${LOG} aviso comprobantes_sunat:`, resSunat.error.message)
  }

  const venta = resVenta.data
  if (!venta) throw new Error('Venta no encontrada')

  console.info(`${LOG} venta OK`, {
    id_venta: venta.id_venta,
    serie: venta.serie,
    correlativo: venta.correlativo,
    total: venta.total,
    id_cliente: venta.id_cliente,
    detalleRows: (resDet.data || []).length,
    pagosRows: (resPagos.data || []).length,
  })

  let vendedor = ''
  if (venta.id_usuario_vendedor) {
    const { data: usr, error: errUsr } = await supabase
      .from('usuarios')
      .select('nombres, apellidos')
      .eq('id_usuario', venta.id_usuario_vendedor)
      .maybeSingle()
    if (errUsr) console.warn(`${LOG} aviso usuarios:`, errUsr.message)
    if (usr) {
      vendedor = `${usr.nombres || ''} ${(usr.apellidos || '').split(' ')[0] || ''}`.trim()
    }
  }

  const cli = venta.clientes
  const elec = resElec.data
  const sunatRow = resSunat.data
  const nombreDesdeCliente = cli
    ? (`${cli.nombres || ''} ${cli.apellidos || ''}`.trim() || (cli.nombre_razon_social || '').trim())
    : ''
  const clienteStr = (elec?.cliente_nombre || '').trim()
    || nombreDesdeCliente
    || 'CLIENTE GENERAL'

  const tipo = venta.tipo_comprobante || 'BOLETA'
  const clienteDoc = docClienteVisible(elec?.cliente_numero_doc)
    || docClienteVisible(cli?.nro_doc)

  const pagos = resPagos.data || []
  const metodoStr = metodoDesdePagos(pagos)
  const esEfectivo = metodoStr === 'Efectivo' || String(metodoStr).toLowerCase().includes('efectivo')

  const items = (resDet.data || []).map((d) => ({
    producto: d.modo_venta
      ? `${d.productos?.descripcion || 'Producto'} (${d.modo_venta})`
      : (d.productos?.descripcion || 'Producto'),
    cantidad: d.cantidad,
    precio: d.precio_unitario,
    subtotal: d.subtotal,
  }))

  const sunatSerie = sunatRow?.serie || elec?.serie || null
  const sunatNumero = sunatRow?.numero != null
    ? sunatRow.numero
    : (elec?.correlativo != null ? elec.correlativo : null)
  const encabezado = numeroEncabezadoTicket({
    tipoComprobante: tipo,
    comprobanteInterno: padComprobante(venta.serie, venta.correlativo),
    sunatSerie,
    sunatNumero,
  })

  const payload = {
    tipoComprobante: tipo,
    comprobante: encabezado.numero,
    fecha: fechaTicketDesde(venta.fecha_hora || venta.created_at),
    metodoPago: metodoStr,
    vendedor,
    cliente: clienteStr,
    clienteDoc,
    clienteDocLabel: etiquetaDocCliente(tipo),
    clienteDireccion: cli?.direccion || '',
    puntosAcum: 0,
    items,
    total: venta.total,
    descuento: venta.descuento || 0,
    montoRecibido: esEfectivo ? Number(venta.monto_recibido || 0) || undefined : undefined,
    vuelto: esEfectivo ? Number(venta.vuelto || 0) : undefined,
    fechaIso: venta.fecha_hora || venta.created_at,
    sunatSerie,
    sunatNumero,
    sunatHash: sunatRow?.codigo_hash || elec?.hash_cdr || '',
    sunatCadenaQr: sunatRow?.cadena_qr || '',
    sunatEnlace: sunatRow?.enlace || sunatRow?.enlace_pdf || elec?.pdf_url || '',
    ticketProvisional: encabezado.provisional,
  }

  console.info(`${LOG} cargarPayloadReimpresion OK (historial)`, resumenPayload(payload), {
    itemsSample: items.slice(0, 3),
    pagos,
  })
  return payload
}

/** Reimpresión desde historial (AdminVentas / MisVentas). */
export async function reimprimirVentaPorId(supabase, idVenta) {
  console.info(`${LOG} reimprimirVentaPorId id_venta=`, idVenta)
  try {
    const payload = await cargarPayloadReimpresion(supabase, idVenta)
    const result = await printTicketVenta(payload)
    console.info(`${LOG} reimprimirVentaPorId FIN`, result)
    return result
  } catch (err) {
    console.error(`${LOG} reimprimirVentaPorId FALLÓ:`, err?.message || err, err)
    throw err
  }
}

export { isElectronApp }
export { buildTicketPruebaPayload } from './ticketSunat'
