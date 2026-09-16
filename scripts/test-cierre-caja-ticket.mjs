/**
 * Voucher de cierre de turno: formato de 80mm y garantía de que NUNCA se abre
 * el diálogo de impresión de Windows cuando corre en Electron.
 *
 *   node scripts/test-cierre-caja-ticket.mjs
 */
import {
  buildCierreCajaPayload,
  lineasCierreCaja,
  ANCHO_TICKET,
  TIPO_DOC_CIERRE_CAJA,
} from '../src/utils/cierreCajaTicket.js'

let fallos = 0
function check(cond, msg) {
  if (cond) console.log(`OK ${msg}`)
  else { console.error(`FALLO ${msg}`); fallos++ }
}

const turno = {
  id_turno: 77,
  monto_apertura: 50,
  apertura_at: new Date('2026-09-02T16:43:00').toISOString(),
}
const user = {
  nombres: 'EDGAR',
  apellidos: 'SICCHA PRUEBA',
  sucursales: { nombre_comercial: 'Sede Julcan' },
}

// ── 1) Caja cuadrada ──
const cuadrada = buildCierreCajaPayload({
  turno,
  totalesPagos: { efectivo: 128.3, yape: 42.5, tarjeta: 10 },
  efectivoReal: 178.3,
  yapeReal: 42.5,
  difTotal: 0,
  user,
})
check(cuadrada.tipoDocumento === TIPO_DOC_CIERRE_CAJA, `tipoDocumento = ${TIPO_DOC_CIERRE_CAJA}`)
check(cuadrada.cierre.esperadoEfectivo === 178.3, 'efectivo esperado = apertura 50 + ventas 128.30')
check(cuadrada.cierre.totalVendido === 180.8, 'total vendido suma los tres métodos (180.80)')
check(cuadrada.cierre.cuadrado === true && cuadrada.cierre.estado === 'CAJA CUADRADA', 'cuadrada → CAJA CUADRADA')

// ── 2) Faltante en efectivo ──
const faltante = buildCierreCajaPayload({
  turno,
  totalesPagos: { efectivo: 128.3, yape: 42.5, tarjeta: 0 },
  efectivoReal: 173.3,
  yapeReal: 42.5,
  difTotal: -5,
  observacion: 'Se pago un delivery de la caja y no se registro el egreso en el sistema.',
  user,
})
check(faltante.cierre.difEfectivo === -5, 'diferencia de efectivo = -5.00')
check(faltante.cierre.estado === 'CON FALTANTE', 'faltante → CON FALTANTE')
check(faltante.cierre.estadoDetalle === 'Faltante: S/ 5.00', 'detalle del faltante con monto')

// ── 3) El maquetado no se pasa de las 48 columnas del papel de 80mm ──
for (const [nombre, payload] of [['cuadrada', cuadrada], ['faltante', faltante]]) {
  const lineas = lineasCierreCaja(payload.cierre)
  const largas = lineas.filter((l) => (l.texto || '').length > ANCHO_TICKET)
  check(
    largas.length === 0,
    `caja ${nombre}: ${lineas.length} líneas, ninguna pasa de ${ANCHO_TICKET} columnas`,
  )
  if (largas.length) console.error('   se pasan:', largas.map((l) => l.texto))
}

const textoFaltante = lineasCierreCaja(faltante.cierre).map((l) => l.texto || '').join('\n')
check(textoFaltante.includes('FALTANTE EN EFECTIVO'), 'el faltante sale destacado en su propia línea')
check(textoFaltante.includes('TOTAL VENDIDO'), 'incluye el total vendido')
check(textoFaltante.includes('DIFERENCIA TOTAL'), 'incluye la diferencia total')
check(textoFaltante.includes('OBSERVACION'), 'incluye la observación')
check(/S\/ 178\.30/.test(textoFaltante), 'incluye el efectivo esperado S/ 178.30')

console.log('\n=== Voucher tal como sale en 48 columnas ===')
console.log('|' + '-'.repeat(ANCHO_TICKET) + '|')
for (const l of lineasCierreCaja(faltante.cierre)) {
  if (l.estilo === 'linea') { console.log('|' + '-'.repeat(ANCHO_TICKET) + '|'); continue }
  if (l.estilo === 'blanco') { console.log('|' + ' '.repeat(ANCHO_TICKET) + '|'); continue }
  const centrado = l.estilo === 'centro' || l.estilo === 'centroBold'
  const t = centrado
    ? l.texto.padStart(Math.floor((ANCHO_TICKET + l.texto.length) / 2)).padEnd(ANCHO_TICKET)
    : l.texto.padEnd(ANCHO_TICKET)
  console.log('|' + t + '|')
}
console.log('|' + '-'.repeat(ANCHO_TICKET) + '|')

// ── 4) En Electron no se toca window.print() ni window.open() ──
// Se monta un window falso ANTES de importar el módulo del renderer.
function montarWindowFalso({ electron, resultadoIpc }) {
  const espias = { print: 0, open: 0, ipc: [] }
  global.window = {
    print: () => { espias.print += 1 },
    open: () => { espias.open += 1; return null },
    electronAPI: electron
      ? {
        isElectron: true,
        printTicket: async (payload) => { espias.ipc.push(payload); return resultadoIpc },
      }
      : undefined,
  }
  return espias
}

let espias = montarWindowFalso({ electron: true, resultadoIpc: { ok: true } })
const { printTicketCierreCaja, buildCierreCajaHtml } = await import('../src/utils/ticketCierreCaja.js')

let res = await printTicketCierreCaja(faltante)
check(res.ok && res.via === 'thermal', 'Electron: imprime por térmica directa')
check(espias.print === 0, 'Electron: window.print() NO se llamó (sin diálogo de Windows)')
check(espias.open === 0, 'Electron: window.open() NO se llamó (sin ventana de impresión)')
check(espias.ipc.length === 1, 'Electron: se mandó exactamente 1 trabajo por IPC')
check(
  espias.ipc[0]?.tipoDocumento === TIPO_DOC_CIERRE_CAJA && !!espias.ipc[0]?.cierre,
  'Electron: el payload IPC lleva tipoDocumento CIERRE_CAJA y los datos del cierre',
)

// El caso peligroso: la térmica falla. Antes acá aparecía el diálogo de Windows.
espias = montarWindowFalso({ electron: true, resultadoIpc: { ok: false, error: 'Impresora no conectada' } })
res = await printTicketCierreCaja(faltante)
check(!res.ok, 'Electron con térmica caída: devuelve error para avisarlo en la app')
check(espias.print === 0, 'Electron con térmica caída: window.print() TAMPOCO se llama')
check(espias.open === 0, 'Electron con térmica caída: no se abre ninguna ventana')

// ── 5) En la web (sin puente Electron) sí corresponde la ventana HTML ──
espias = montarWindowFalso({ electron: false })
global.window.open = () => {
  espias.open += 1
  return { document: { write: () => {}, close: () => {} } }
}
res = await printTicketCierreCaja(faltante)
check(res.ok && res.via === 'html', 'Web: cae a la ventana HTML de impresión')
check(espias.open === 1, 'Web: abre una sola ventana')

const html = buildCierreCajaHtml(faltante)
check(html.includes('size:80mm'), 'Web: la plantilla declara @page 80mm')
check(html.includes('width:80mm'), 'Web: el cuerpo mide 80mm')
check(html.includes('FALTANTE EN EFECTIVO'), 'Web: el HTML sale del mismo maquetado que la térmica')

console.log(fallos === 0 ? '\nOK todas las pruebas pasaron' : `\nFALLO ${fallos} prueba(s)`)
process.exit(fallos === 0 ? 0 : 1)
