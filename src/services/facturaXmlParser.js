import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (name) => ['InvoiceLine', 'CreditNoteLine', 'PartyIdentification', 'TaxTotal', 'ItemInstance'].includes(name),
});

function asArray(valor) {
  if (valor == null) return [];
  return Array.isArray(valor) ? valor : [valor];
}

function texto(nodo) {
  if (nodo == null || nodo === '') return null;
  if (typeof nodo === 'string' || typeof nodo === 'number') {
    const s = String(nodo).trim();
    return s || null;
  }
  if (typeof nodo === 'object') {
    if (nodo['#text'] != null && String(nodo['#text']).trim() !== '') return String(nodo['#text']).trim();
    if (nodo._text != null && String(nodo._text).trim() !== '') return String(nodo._text).trim();
  }
  return null;
}

function numero(nodo) {
  const t = texto(nodo);
  if (t == null) return null;
  const n = Number(String(t).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function atributo(nodo, nombre) {
  if (!nodo || typeof nodo !== 'object') return null;
  const v = nodo[`@_${nombre}`] ?? nodo[nombre];
  return v == null ? null : String(v);
}

function limpiarCodigoProveedor(raw) {
  const s = texto(raw);
  if (!s) return null;
  const trimmed = s.trim();
  if (/^\d+$/.test(trimmed)) return String(parseInt(trimmed, 10));
  return trimmed.replace(/^0+/, '') || trimmed;
}

function fechaDesdeYyyymmdd(raw) {
  const s = texto(raw);
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  if (digits.length === 8) {
    const y = digits.slice(0, 4);
    const m = digits.slice(4, 6);
    const d = digits.slice(6, 8);
    const dt = new Date(`${y}-${m}-${d}T12:00:00`);
    if (!Number.isNaN(dt.getTime())) return `${y}-${m}-${d}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

function splitIdComprobante(idRaw) {
  const id = texto(idRaw) || '';
  const idx = id.lastIndexOf('-');
  if (idx <= 0) {
    return { serie: id || null, numero: null };
  }
  const serie = id.slice(0, idx).trim() || null;
  const numRaw = id.slice(idx + 1).trim();
  let numero = numRaw;
  if (/^\d+$/.test(numRaw)) {
    numero = String(parseInt(numRaw, 10));
  }
  return { serie, numero };
}

function parsearDescripcionItem(raw) {
  const full = texto(raw) || '';
  if (!full.includes('@#@')) {
    return { descripcion: full || null, fechaVencimiento: null, porcentajeDescuento: null };
  }
  const partes = full.split('@#@');
  return {
    descripcion: (partes[0] || '').trim() || null,
    fechaVencimiento: fechaDesdeYyyymmdd(partes[1]),
    porcentajeDescuento: texto(partes[2]),
  };
}

function mapUnidad(unitCode) {
  const c = String(unitCode || '').toUpperCase();
  if (c === 'NIU' || c === 'ZZ' || c === 'UN') return 'UNIDAD';
  if (c === 'BX' || c === 'XBX') return 'CAJA';
  if (c === 'PK' || c === 'PR') return 'PAQUETE';
  return c || 'UNIDAD';
}

function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function recorrerNodos(nodo, visitar, profundidad = 0) {
  if (!nodo || typeof nodo !== 'object' || profundidad > 12) return;
  if (Array.isArray(nodo)) {
    nodo.forEach((n) => recorrerNodos(n, visitar, profundidad + 1));
    return;
  }
  visitar(nodo);
  Object.keys(nodo).forEach((k) => {
    if (k.startsWith('@_') || k === '#text') return;
    recorrerNodos(nodo[k], visitar, profundidad + 1);
  });
}

/**
 * Los proveedores meten la condición de pago en extensiones propias, sin un
 * esquema común: puede ser <CustomText name="Condición Pago">…</CustomText> o
 * un <Text name="Condición Pago"> anidado. Se busca cualquier nodo rotulado
 * con un name que hable de condición/forma de pago.
 */
function textoCondicionPagoExtension(doc) {
  let encontrado = null;
  recorrerNodos(doc?.UBLExtensions, (nodo) => {
    if (encontrado) return;
    const nombre = normalizarTexto(nodo['@_name'] ?? nodo['@_Name'] ?? nodo['@_NAME']);
    if (!nombre) return;
    // "condici" y no "condicion": el XML se decodifica como ISO-8859-1 y algunos
    // proveedores lo emiten en UTF-8, con lo que la tilde llega distorsionada.
    const hablaDePago = nombre.includes('pago')
      && (nombre.includes('condici') || nombre.includes('forma') || nombre.includes('modalidad'));
    if (!hablaDePago) return;
    const valor = texto(nodo);
    if (valor) encontrado = valor;
  });
  return encontrado;
}

/**
 * Interpreta textos libres tipo "Contado 0 días con remesa anticipada",
 * "CREDITO 30 DIAS" o "30 días". Devuelve null cuando no hay confianza
 * suficiente, para no pisar el valor por defecto del formulario.
 */
export function interpretarCondicionPago(textoLibre) {
  const t = normalizarTexto(textoLibre);
  if (!t) return null;

  const matchDias = t.match(/(\d{1,3})\s*(?:d|dias?|dias)\b/) || t.match(/\ba\s+(\d{1,3})\s*dias?/);
  const dias = matchDias ? Number(matchDias[1]) : null;

  if (/cr\S{0,3}dito/.test(t)) {
    return { forma: 'Crédito', diasCredito: dias != null && dias > 0 ? dias : null };
  }
  if (t.includes('contado') || t.includes('efectivo') || t.includes('anticipado')) {
    // "Contado 0 días" es contado; si el proveedor escribe contado con plazo
    // real (>0 días) el plazo manda, porque es lo que define la cuenta por pagar.
    if (dias != null && dias > 0) return { forma: 'Crédito', diasCredito: dias };
    return { forma: 'Contado', diasCredito: null };
  }
  if (dias != null && dias > 0) {
    return { forma: 'Crédito', diasCredito: dias };
  }
  return null;
}

function diasEntreFechas(desde, hasta) {
  if (!desde || !hasta) return null;
  const a = new Date(`${desde}T12:00:00`);
  const b = new Date(`${hasta}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const dias = Math.round((b - a) / 86400000);
  return dias > 0 ? dias : null;
}

/**
 * Estructura estándar SUNAT: cac:PaymentTerms con cbc:ID = "FormaPago" y
 * cbc:PaymentMeansID = Contado | Credito, más cuotas con PaymentDueDate.
 */
function condicionPagoDesdePaymentTerms(doc, fechaEmision) {
  const terminos = asArray(doc?.PaymentTerms);
  if (!terminos.length) return null;

  let forma = null;
  let vencimiento = null;
  terminos.forEach((t) => {
    const id = normalizarTexto(texto(t?.ID));
    if (id !== 'formapago') return;
    const medio = normalizarTexto(texto(t?.PaymentMeansID));
    if (medio === 'contado' && !forma) forma = 'Contado';
    if (/cr\S{0,3}dito/.test(medio)) forma = 'Crédito';
    if (medio.startsWith('cuota')) {
      const due = fechaDesdeYyyymmdd(t?.PaymentDueDate);
      if (due && (!vencimiento || due > vencimiento)) vencimiento = due;
    }
  });

  if (!forma) return null;
  if (forma === 'Contado') return { forma, diasCredito: null, fechaVencimiento: null };
  return {
    forma,
    diasCredito: diasEntreFechas(fechaEmision, vencimiento),
    fechaVencimiento: vencimiento,
  };
}

function extraerCondicionPago(doc, fechaEmision) {
  const textoExt = textoCondicionPagoExtension(doc);
  const desdeExt = interpretarCondicionPago(textoExt);
  if (desdeExt) {
    return {
      forma: desdeExt.forma,
      diasCredito: desdeExt.diasCredito,
      fechaVencimiento: null,
      textoOriginal: textoExt,
      fuente: 'extension',
    };
  }

  const desdeTerms = condicionPagoDesdePaymentTerms(doc, fechaEmision);
  if (desdeTerms) {
    return { ...desdeTerms, textoOriginal: textoExt || null, fuente: 'paymentTerms' };
  }

  return { forma: null, diasCredito: null, fechaVencimiento: null, textoOriginal: textoExt || null, fuente: null };
}

function extraerRaiz(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.Invoice) return { nodo: parsed.Invoice, lineasKey: 'InvoiceLine' };
  if (parsed.CreditNote) return { nodo: parsed.CreditNote, lineasKey: 'CreditNoteLine' };
  const keys = Object.keys(parsed);
  const invoiceKey = keys.find((k) => k.toLowerCase().endsWith('invoice') && parsed[k]?.ID);
  if (invoiceKey) return { nodo: parsed[invoiceKey], lineasKey: 'InvoiceLine' };
  return parsed.ID ? { nodo: parsed, lineasKey: 'InvoiceLine' } : null;
}

function extraerIgvDocumento(doc) {
  let igv = null;
  asArray(doc?.TaxTotal).forEach((t) => {
    asArray(t?.TaxSubtotal).forEach((s) => {
      const id = texto(s?.TaxCategory?.TaxScheme?.ID);
      const name = String(texto(s?.TaxCategory?.TaxScheme?.Name) || '').toUpperCase();
      if (id === '1000' || name === 'IGV') {
        const monto = numero(s?.TaxAmount);
        if (monto != null) igv = (igv || 0) + monto;
      }
    });
  });
  if (igv == null) {
    const primero = asArray(doc?.TaxTotal)[0];
    igv = numero(primero?.TaxAmount);
  }
  return igv;
}

function extraerTotalesDocumento(doc) {
  const legal = doc?.LegalMonetaryTotal || {};
  const gravado = numero(legal.LineExtensionAmount);
  const totalConIgv = numero(legal.TaxInclusiveAmount);
  const totalPagar = numero(legal.PayableAmount);
  const igv = extraerIgvDocumento(doc);
  const total = totalPagar ?? totalConIgv ?? null;
  return {
    gravado,
    igv,
    total,
    totalConIgv,
  };
}

function totalesDesdeLineas(items) {
  const gravado = (items || []).reduce((s, i) => s + (Number(i.subtotal) || 0), 0);
  const igv = (items || []).reduce((s, i) => s + (Number(i.igv) || 0), 0);
  return {
    gravado: Number.isFinite(gravado) ? gravado : 0,
    igv: Number.isFinite(igv) ? igv : 0,
    total: (Number.isFinite(gravado) ? gravado : 0) + (Number.isFinite(igv) ? igv : 0),
  };
}

function parsearLinea(linea) {
  const qtyNodo = linea?.InvoicedQuantity ?? linea?.CreditedQuantity;
  const cantidad = numero(qtyNodo);
  const unidadMedida = mapUnidad(atributo(qtyNodo, 'unitCode'));
  const subtotal = numero(linea?.LineExtensionAmount);
  const taxTotals = asArray(linea?.TaxTotal);
  const igv = numero(taxTotals[0]?.TaxAmount);
  const item = linea?.Item || {};
  const desc = parsearDescripcionItem(item.Description);
  const codigoProveedor = limpiarCodigoProveedor(item?.SellersItemIdentification?.ID)
    || limpiarCodigoProveedor(item?.SellersItemIdentification);
  const lotes = asArray(item?.ItemInstance);
  const lote = texto(lotes[0]?.LotIdentification?.LotNumberID)
    || texto(item?.LotIdentification?.LotNumberID);
  const precioRef = numero(linea?.Price?.PriceAmount);
  const qtySafe = cantidad && cantidad !== 0 ? cantidad : 1;
  const costoNetoUnit = subtotal != null ? subtotal / qtySafe : null;
  const costoConIgvUnit = (subtotal != null && igv != null)
    ? (subtotal + igv) / qtySafe
    : null;
  // En AdminCompras el P.Costo es neto (sin IGV). PriceAmount a veces trae el
  // referencial con IGV: si coincide más con costoConIgvUnit, usamos el neto.
  let precioUnitario = costoNetoUnit ?? precioRef;
  if (precioRef != null && costoConIgvUnit != null && costoNetoUnit != null) {
    const dNeto = Math.abs(precioRef - costoNetoUnit);
    const dIgv = Math.abs(precioRef - costoConIgvUnit);
    precioUnitario = dIgv < dNeto ? costoNetoUnit : costoNetoUnit;
  }

  const precioLista = numero(
    linea?.PricingReference?.AlternativeConditionPrice?.PriceAmount
    ?? asArray(linea?.PricingReference?.AlternativeConditionPrice)[0]?.PriceAmount,
  );
  const precioFacturadoCero = (subtotal != null && Math.abs(subtotal) < 0.0005)
    || (precioRef != null && Math.abs(precioRef) < 0.0005);
  const bonificacion = !!precioFacturadoCero;

  return {
    codigoProveedor: codigoProveedor || null,
    descripcion: desc.descripcion,
    fechaVencimiento: desc.fechaVencimiento,
    porcentajeDescuento: desc.porcentajeDescuento,
    cantidad,
    unidadMedida,
    precioUnitario: precioUnitario != null ? Number(precioUnitario.toFixed(6)) : null,
    precioLista,
    subtotal,
    igv,
    lote: lote || null,
    bonificacion,
  };
}

function decodificarIso88591(xmlBuffer) {
  const bytes = xmlBuffer instanceof ArrayBuffer
    ? new Uint8Array(xmlBuffer)
    : xmlBuffer instanceof Uint8Array
      ? xmlBuffer
      : new Uint8Array(xmlBuffer);
  try {
    return new TextDecoder('iso-8859-1').decode(bytes);
  } catch {
    return new TextDecoder('latin1').decode(bytes);
  }
}

/**
 * Parsea un XML UBL 2.1 (factura de compra Perú).
 * Tags ausentes → null, no lanza por campos faltantes.
 */
export function parsearFacturaXML(xmlBuffer) {
  if (!xmlBuffer) {
    throw new Error('El archivo XML está vacío.');
  }
  const xmlTexto = decodificarIso88591(xmlBuffer);
  if (!xmlTexto.trim()) {
    throw new Error('No se pudo leer el XML (archivo vacío).');
  }

  const parsed = parser.parse(xmlTexto);
  const raiz = extraerRaiz(parsed);
  if (!raiz?.nodo) {
    throw new Error('No se reconoció una factura UBL (Invoice) en el XML.');
  }

  const doc = raiz.nodo;
  const { serie, numero } = splitIdComprobante(doc.ID);
  const party = doc?.AccountingSupplierParty?.Party || {};
  const ident = asArray(party.PartyIdentification)[0];
  const legal = asArray(party.PartyLegalEntity)[0];
  const ruc = texto(ident?.ID) || texto(party?.PartyTaxScheme?.CompanyID);
  const razonSocial = texto(legal?.RegistrationName)
    || texto(party?.PartyName?.Name);

  const lineas = asArray(doc[raiz.lineasKey]);
  const items = lineas.map((linea) => {
    try {
      return parsearLinea(linea);
    } catch {
      return {
        codigoProveedor: null,
        descripcion: null,
        fechaVencimiento: null,
        porcentajeDescuento: null,
        cantidad: null,
        unidadMedida: null,
        precioUnitario: null,
        subtotal: null,
        igv: null,
        lote: null,
        bonificacion: false,
        precioLista: null,
      };
    }
  });

  const oficiales = extraerTotalesDocumento(doc);
  const desdeLineas = totalesDesdeLineas(items);
  const fechaEmision = texto(doc.IssueDate);

  return {
    proveedor: { ruc: ruc || null, razonSocial: razonSocial || null },
    serie,
    numero,
    fechaEmision,
    condicionPago: extraerCondicionPago(doc, fechaEmision),
    moneda: texto(doc.DocumentCurrencyCode),
    items,
    totales: {
      gravado: oficiales.gravado ?? desdeLineas.gravado,
      igv: oficiales.igv ?? desdeLineas.igv,
      total: oficiales.total ?? desdeLineas.total,
      totalConIgv: oficiales.totalConIgv ?? oficiales.total ?? desdeLineas.total,
      fuente: oficiales.total != null ? 'documento' : 'lineas',
    },
  };
}
