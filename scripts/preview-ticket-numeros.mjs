/**
 * Verifica encabezado SUNAT vs interno y genera HTML de vista previa.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  datosSunatTicket,
  numeroEncabezadoTicket,
  padComprobanteTicket,
} from '../src/utils/ticketSunat.js';
import { etiquetaComprobante, TICKET_EMISOR, desgloseTicket } from '../src/utils/ticketFarmacia.js';

const outDir = dirname(fileURLToPath(import.meta.url));
const fallos = [];
function assert(cond, msg) {
  if (!cond) fallos.push(msg);
}

const online = numeroEncabezadoTicket({
  tipoComprobante: 'BOLETA',
  comprobanteInterno: 'B001-00000042',
  sunatSerie: 'B003',
  sunatNumero: 8,
});
assert(online.numero === 'B003-00000008', `online header: ${online.numero}`);
assert(online.cpeSunat === online.numero, `online CPE distinto: ${online.cpeSunat}`);
assert(!online.provisional, 'online no debe ser provisional');

const offline = numeroEncabezadoTicket({
  tipoComprobante: 'BOLETA',
  comprobanteInterno: 'B001-00000042',
});
assert(offline.numero === 'B001-00000042', `offline header: ${offline.numero}`);
assert(offline.cpeSunat === '', `offline no debe tener CPE: ${offline.cpeSunat}`);
assert(offline.provisional, 'offline debe ser provisional');

const nota = numeroEncabezadoTicket({
  tipoComprobante: 'NOTA DE VENTA',
  comprobanteInterno: 'NV01-00000007',
  sunatSerie: 'B003',
  sunatNumero: 99,
});
assert(nota.numero === 'NV01-00000007', `nota header: ${nota.numero}`);
assert(!nota.provisional && nota.cpeSunat === '', 'nota no usa SUNAT');

const payloadOnline = {
  tipoComprobante: 'BOLETA',
  comprobante: online.numero,
  comprobanteInterno: 'B001-00000042',
  fecha: '02/09/2026 17:30',
  metodoPago: 'Efectivo',
  vendedor: 'EDGAR SICCHA',
  cliente: 'JUAN PEREZ',
  clienteDoc: '40071015',
  clienteDocLabel: 'DNI',
  items: [{ producto: 'PARACETAMOL 500 MG', cantidad: 2, precio: 4.5, subtotal: 9 }],
  total: 9,
  descuento: 0,
  montoRecibido: 10,
  vuelto: 1,
  sunatSerie: 'B003',
  sunatNumero: 8,
  sunatHash: 'abcHashPrueba',
  sunatCadenaQr: `${TICKET_EMISOR.ruc}|03|B003|8|1.37|9.00|2026-09-02|1|40071015|abcHashPrueba`,
};
const sunatOnline = datosSunatTicket(payloadOnline);
assert(sunatOnline?.cpe === 'B003-00000008', `CPE online: ${sunatOnline?.cpe}`);
assert(payloadOnline.comprobante === sunatOnline.cpe, 'encabezado y CPE no coinciden (online)');

const reprint = numeroEncabezadoTicket({
  tipoComprobante: 'BOLETA',
  comprobanteInterno: padComprobanteTicket('B001', 42),
  sunatSerie: 'B003',
  sunatNumero: 8,
});
assert(reprint.numero === 'B003-00000008', 'reimpresión no reemplaza el encabezado por SUNAT');
assert(reprint.numero !== 'B001-00000042', 'reimpresión sigue mostrando B001');

function htmlTicket(payload) {
  const vis = numeroEncabezadoTicket(payload);
  const sunat = datosSunatTicket(payload);
  const d = desgloseTicket(payload.total, payload.descuento);
  const tipo = etiquetaComprobante(payload.tipoComprobante);
  const cpe = sunat?.cpe ? `<div>CPE SUNAT: <b>${sunat.cpe}</b></div>` : '';
  const hash = sunat?.codigoHash ? `<div>HASH: ${sunat.codigoHash}</div>` : '';
  const notaProv = vis.provisional
    ? '<div class="center" style="font-size:8px;margin-top:4px">Nro. definitivo disponible al sincronizar</div>'
    : '';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${vis.numero}</title>
<style>
@page{size:80mm auto;margin:0}
body{font-family:'Courier New',monospace;width:80mm;margin:0 auto;padding:8px;font-size:11px;color:#000;background:#fff}
.center{text-align:center}.bold{font-weight:800}.line{border-top:1px dashed #000;margin:6px 0}
.brand{font-size:18px;font-weight:900;letter-spacing:1px}
</style></head><body>
<div class="center">
  <div class="bold">${TICKET_EMISOR.rubro}</div>
  <div class="brand">${TICKET_EMISOR.nombreComercial}</div>
  <div>${TICKET_EMISOR.razonSocial}</div>
  <div>RUC: ${TICKET_EMISOR.ruc}</div>
</div>
<div class="line"></div>
<div class="center bold">${tipo}</div>
<div class="center bold" style="font-size:13px;letter-spacing:1px">${vis.numero}</div>
<div class="line"></div>
<div>FECHA: <b>${payload.fecha}</b></div>
<div>F.PAGO: <b>${payload.metodoPago}</b></div>
<div>CAJERO / VEND: <b>${payload.vendedor}</b></div>
<div>SR(ES): <b>${payload.cliente}</b></div>
<div>DNI: <b>${payload.clienteDoc}</b></div>
<div class="line"></div>
<div>PARACETAMOL 500 MG &nbsp; 2 &nbsp; 4.50 &nbsp; 9.00</div>
<div class="line"></div>
<div class="bold">IMPORTE TOTAL <span style="float:right">${d.importeTotal.toFixed(2)}</span></div>
${sunat ? `<div class="line"></div><div class="center">${sunat.leyenda}${cpe}${hash}</div>` : ''}
${notaProv}
<div class="line"></div>
<div class="center bold">Gracias por su Preferencia</div>
</body></html>`;
}

const payloadOffline = {
  tipoComprobante: 'BOLETA',
  comprobante: offline.numero,
  comprobanteInterno: 'B001-00000042',
  fecha: '02/09/2026 17:30',
  metodoPago: 'Efectivo',
  vendedor: 'EDGAR SICCHA',
  cliente: 'JUAN PEREZ',
  clienteDoc: '40071015',
  items: [{ producto: 'PARACETAMOL 500 MG', cantidad: 2, precio: 4.5, subtotal: 9 }],
  total: 9,
};

const htmlOnline = htmlTicket(payloadOnline);
const htmlOffline = htmlTicket(payloadOffline);
assert(htmlOnline.includes('B003-00000008'), 'HTML online sin B003');
assert(htmlOnline.includes('CPE SUNAT'), 'HTML online sin CPE');
assert(!htmlOnline.includes('B001-00000042'), 'HTML online todavía muestra B001');
assert(htmlOffline.includes('B001-00000042'), 'HTML offline sin B001');
assert(htmlOffline.includes('Nro. definitivo disponible al sincronizar'), 'HTML offline sin nota');
assert(!htmlOffline.includes('CPE SUNAT'), 'HTML offline no debe tener CPE');

writeFileSync(join(outDir, 'preview-ticket-online.html'), htmlOnline);
writeFileSync(join(outDir, 'preview-ticket-offline.html'), htmlOffline);

if (fallos.length) {
  console.error('[preview-ticket-numeros] FALLÓ:\n- ' + fallos.join('\n- '));
  process.exit(1);
}
console.log('[preview-ticket-numeros] OK');
console.log('  online  encabezado=CPE=B003-00000008');
console.log('  offline encabezado=B001-00000042 + nota provisional');
console.log('  reprint B001 interno → B003-00000008');
