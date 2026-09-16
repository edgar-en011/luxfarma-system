import { emitirComprobante, consultarEstado } from '../services/nubefactService';
import { tipoNubefactDesdeVenta } from '../services/comprobantesSunat';

export {
  emitirComprobante,
  consultarEstado,
  anularComprobanteNubefact,
  medioPagoNubefact,
  nubefactCredencialesOk,
  nubefactIpcDisponible,
  TIPO_COMPROBANTE_NUBEFACT as TIPO_COMPROBANTE,
  TIPO_DOC_NUBEFACT as TIPO_DOC,
} from '../services/nubefactService';

/** Compatibilidad: envíos antiguos que usaban serie/correlativo interno de ventas. */
export async function enviarComprobanteNubefact({ venta, carrito, cliente, metodoPago, mixtoData }) {
  const tipo = tipoNubefactDesdeVenta(venta?.tipo_comprobante);
  if (!tipo) {
    return { ok: false, error: 'Tipo de comprobante no aplica a SUNAT.' };
  }
  const res = await emitirComprobante({
    tipo_comprobante: tipo,
    serie: venta.serie,
    numero: venta.correlativo ?? venta.numero,
    carrito,
    cliente,
    total: venta.total,
    metodoPago,
    mixtoData,
  });
  if (!res.ok) return { ok: false, error: res.error, descripcion: res.error };
  const d = res.data || {};
  return {
    ok: true,
    aceptado: d.aceptada_por_sunat,
    pdf_url: d.enlace_pdf,
    xml_url: d.enlace_xml,
    hash: d.key_nubefact,
    descripcion: d.sunat_description || 'Emitido correctamente',
    nubefact_data: d.raw,
  };
}

export async function consultarEstadoSunat({ serie, correlativo, tipo_comprobante }) {
  const tipo = tipoNubefactDesdeVenta(tipo_comprobante);
  return consultarEstado(tipo || 2, serie, correlativo);
}
