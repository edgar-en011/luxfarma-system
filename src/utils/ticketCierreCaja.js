/**
 * Impresión del cierre de turno.
 *
 * Mismo camino que el ticket de venta: en Electron va directo por IPC a la
 * térmica configurada en Configuración → Impresora (ESC/POS raw, sin ningún
 * diálogo de Windows). En la app web, que no tiene ese puente, cae a una
 * ventana HTML de 80mm con el mismo contenido.
 */

import { printTicket, isElectronApp } from './electronBridge.js'
import { TICKET_EMISOR } from './ticketFarmacia.js'
import { buildCierreCajaPayload, lineasCierreCaja, PIE_CIERRE_CAJA } from './cierreCajaTicket.js'

const LOG = '[ticketCierreCaja]'

export { buildCierreCajaPayload }

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Respaldo web: recibo de 80mm en monoespaciada, con las MISMAS líneas que
 * manda la térmica (por eso van en <pre>, para conservar el alineado).
 */
export function buildCierreCajaHtml(payload, opts = {}) {
  const cierre = payload?.cierre
  if (!cierre) return ''
  const autoPrint = opts.autoPrint !== false

  const cuerpo = lineasCierreCaja(cierre).map((linea) => {
    if (linea.estilo === 'linea') return '<div class="line"></div>'
    if (linea.estilo === 'blanco') return '<div class="sp"></div>'
    const clases = {
      texto: '',
      bold: 'bold',
      centro: 'center',
      centroBold: 'center bold',
    }[linea.estilo] || ''
    return `<pre class="${clases}">${escapeHtml(linea.texto)}</pre>`
  }).join('\n')

  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Cierre Turno #${escapeHtml(cierre.turnoId)}</title>
<style>
@page{size:80mm auto;margin:0}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Courier New',monospace;width:80mm;margin:0 auto;padding:3mm;font-size:11px;color:#000;background:#fff}
pre{font-family:inherit;font-size:11px;line-height:1.35;white-space:pre-wrap;word-break:break-word}
.center{text-align:center}.bold{font-weight:800}
.line{border-top:1px dashed #000;margin:5px 0}
.sp{height:5px}
.brand{font-size:18px;font-weight:900;letter-spacing:1px;margin:2px 0 4px}
.cruz{width:22mm;height:auto;display:block;margin:0 auto 3px}
.boticas{font-size:13px;font-weight:800;letter-spacing:2px;margin:2px 0 6px}
@media print{.btn{display:none!important}}
.btn{background:#1e40af;color:#fff;border:none;border-radius:8px;padding:9px 0;font-size:12px;font-weight:700;cursor:pointer;width:100%;margin-top:10px}
</style></head><body>
<div class="center">
  <img class="cruz" src="/icono.png" alt="" />
  <div class="boticas">${escapeHtml(TICKET_EMISOR.rubro)}</div>
  <div class="brand">${escapeHtml(TICKET_EMISOR.nombreComercial)}</div>
  <div>${escapeHtml(TICKET_EMISOR.razonSocial)}</div>
  <div>RUC: ${escapeHtml(TICKET_EMISOR.ruc)}</div>
  <div>${escapeHtml(TICKET_EMISOR.direccion)}</div>
</div>
<div class="line"></div>
${cuerpo}
<div class="line"></div>
${PIE_CIERRE_CAJA.map((t) => `<div class="center">${escapeHtml(t)}</div>`).join('\n')}
<button class="btn" onclick="window.print()">Imprimir</button>
${autoPrint ? '<script>window.onload=function(){setTimeout(function(){window.print()},300)}</script>' : ''}
</body></html>`
}

/** Solo para web: en Electron nunca se abre ventana ni diálogo. */
export function abrirImpresionHtmlCierre(payload) {
  if (!payload?.cierre) return false
  const win = window.open('', '_blank', 'width=340,height=700,scrollbars=yes')
  if (!win) return false
  win.document.write(buildCierreCajaHtml(payload, { autoPrint: true }))
  win.document.close()
  return true
}

/**
 * Imprime el voucher de cierre.
 *
 * En Electron el fallback es silencioso a propósito: si la térmica falla no se
 * abre el diálogo de impresión de Windows, se devuelve el error para que la
 * pantalla lo muestre como aviso dentro de la app.
 *
 * @returns {Promise<{ ok: boolean, via: 'thermal'|'html'|'ninguno', error?: string }>}
 */
export async function printTicketCierreCaja(payload) {
  if (!payload?.cierre) return { ok: false, via: 'ninguno', error: 'Sin datos del cierre' }

  const enElectron = isElectronApp()
  console.info(`${LOG} imprimiendo cierre`, {
    turno: payload.cierre.turnoId,
    difTotal: payload.cierre.difTotal,
    electron: enElectron,
  })

  if (!enElectron) {
    const abierta = abrirImpresionHtmlCierre(payload)
    return abierta
      ? { ok: true, via: 'html' }
      : { ok: false, via: 'ninguno', error: 'El navegador bloqueó la ventana de impresión' }
  }

  const result = await printTicket(payload, { fallbackPrint: () => {} })
  if (result?.ok && result.via === 'thermal') {
    console.info(`${LOG} OK por térmica directa`)
    return { ok: true, via: 'thermal' }
  }
  console.error(`${LOG} la térmica falló`, result)
  return { ok: false, via: 'ninguno', error: result?.error || 'No se pudo imprimir en la térmica' }
}
