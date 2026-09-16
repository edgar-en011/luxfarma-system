/**
 * Número de comprobante que el usuario ve y busca.
 *
 * Boleta/factura: serie-numero de comprobantes_sunat (reservado aunque
 * PENDIENTE/ERROR/RECHAZADO/POR_CONFIRMAR). Si no hay serie, "SUNAT pendiente".
 * Nota de venta: serie-correlativo interno (NV01-…), que es su número real.
 * El correlativo interno B001/F001 no se muestra.
 */

export const TEXTO_SUNAT_PENDIENTE = 'SUNAT pendiente';

/** Embed PostgREST (misma forma que clientes/pagos_venta en el select de ventas). */
export const SELECT_EMBED_COMPROBANTES_SUNAT = 'comprobantes_sunat(serie, numero)';

export function esNotaDeVenta(tipo) {
  return String(tipo || '').toUpperCase().includes('NOTA');
}

export function filaSunatDeVenta(venta) {
  const raw = venta?.comprobantes_sunat;
  if (!raw) return null;
  const fila = Array.isArray(raw) ? raw[0] : raw;
  return fila || null;
}

export function formatSerieNumero(serie, numero) {
  if (serie == null || String(serie).trim() === '') return null;
  if (numero == null || numero === '') return null;
  const n = Number(numero);
  if (!Number.isFinite(n)) return null;
  return `${String(serie).trim()}-${n}`;
}

/**
 * extras.sunatSerie / extras.sunatNumero: para el toast del POS, donde el embed
 * aún no está en el objeto venta pero procesarEmisionSunat ya devolvió la reserva.
 */
export function etiquetaComprobanteVisible(venta, extras = {}) {
  const tipo = extras.tipoComprobante || venta?.tipo_comprobante;
  if (esNotaDeVenta(tipo)) {
    return formatSerieNumero(venta?.serie, venta?.correlativo) || '—';
  }
  const sunat = filaSunatDeVenta(venta);
  const etiqueta = formatSerieNumero(
    extras.sunatSerie ?? sunat?.serie,
    extras.sunatNumero ?? sunat?.numero,
  );
  return etiqueta || TEXTO_SUNAT_PENDIENTE;
}

/**
 * @returns {{ modo: 'serie-numero', serie: string, numero: number }
 *   | { modo: 'serie', serie: string }
 *   | { modo: 'numero', numero: number }
 *   | null}
 */
export function parsearBusquedaComprobante(texto) {
  const t = String(texto || '').trim();
  if (!t) return null;
  const compact = t.replace(/\s/g, '').toUpperCase();
  if (compact.includes('-')) {
    const i = compact.lastIndexOf('-');
    const serie = compact.slice(0, i);
    const numStr = compact.slice(i + 1).replace(/[^0-9]/g, '');
    if (!serie) return null;
    if (!numStr) return { modo: 'serie', serie };
    return { modo: 'serie-numero', serie, numero: Number(numStr) };
  }
  if (/^\d+$/.test(compact)) {
    return { modo: 'numero', numero: Number(compact) };
  }
  if (/^[A-Z][A-Z0-9]*$/.test(compact)) {
    return { modo: 'serie', serie: compact };
  }
  return null;
}

function agregarIds(dest, rows) {
  for (const r of rows || []) {
    if (r?.id_venta != null) dest.add(r.id_venta);
  }
}

/**
 * Resuelve id_venta por el número que el usuario ve (SUNAT) y, si escribe un
 * interno (B001-x / NV01-x), por ventas.serie+correlativo. Con serie no se
 * ignora la letra: B003-8 no cae al correlativo 8 de otra serie.
 */
export async function resolverIdsVentaPorComprobante(cliente, texto) {
  const parsed = parsearBusquedaComprobante(texto);
  if (!parsed) return [];
  const ids = new Set();

  if (parsed.modo === 'serie-numero') {
    const [{ data: sunatRows }, { data: ventaRows }] = await Promise.all([
      cliente.from('comprobantes_sunat').select('id_venta').eq('serie', parsed.serie).eq('numero', parsed.numero),
      cliente.from('ventas').select('id_venta').eq('serie', parsed.serie).eq('correlativo', parsed.numero),
    ]);
    agregarIds(ids, sunatRows);
    agregarIds(ids, ventaRows);
    return [...ids];
  }

  if (parsed.modo === 'serie') {
    const [{ data: sunatRows }, { data: ventaRows }] = await Promise.all([
      cliente.from('comprobantes_sunat').select('id_venta').eq('serie', parsed.serie),
      cliente.from('ventas').select('id_venta').eq('serie', parsed.serie),
    ]);
    agregarIds(ids, sunatRows);
    agregarIds(ids, ventaRows);
    return [...ids];
  }

  const [{ data: sunatRows }, { data: ventaRows }] = await Promise.all([
    cliente.from('comprobantes_sunat').select('id_venta').eq('numero', parsed.numero),
    cliente.from('ventas').select('id_venta').eq('correlativo', parsed.numero),
  ]);
  agregarIds(ids, sunatRows);
  agregarIds(ids, ventaRows);
  return [...ids];
}

function ventaCoincideParsed(venta, parsed) {
  const sunat = filaSunatDeVenta(venta);
  if (parsed.modo === 'serie-numero') {
    if (sunat && String(sunat.serie || '').toUpperCase() === parsed.serie && Number(sunat.numero) === parsed.numero) {
      return true;
    }
    return String(venta?.serie || '').toUpperCase() === parsed.serie
      && Number(venta?.correlativo) === parsed.numero;
  }
  if (parsed.modo === 'serie') {
    if (sunat && String(sunat.serie || '').toUpperCase() === parsed.serie) return true;
    return String(venta?.serie || '').toUpperCase() === parsed.serie;
  }
  if (sunat && Number(sunat.numero) === parsed.numero) return true;
  return Number(venta?.correlativo) === parsed.numero;
}

/** Filtro en memoria (lista ya cargada): coincide con lo visible o con el interno. */
export function coincideBusquedaComprobante(venta, texto) {
  const t = String(texto || '').trim();
  if (!t) return true;
  const needle = t.replace(/\s/g, '').toLowerCase();
  const visible = etiquetaComprobanteVisible(venta).replace(/\s/g, '').toLowerCase();
  if (visible.includes(needle)) return true;
  const interno = formatSerieNumero(venta?.serie, venta?.correlativo);
  if (interno && interno.toLowerCase().includes(needle)) return true;
  const parsed = parsearBusquedaComprobante(t);
  if (!parsed) return false;
  return ventaCoincideParsed(venta, parsed);
}
