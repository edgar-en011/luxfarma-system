/**
 * Payload y reglas de la RPC registrar_compra (transacción atómica).
 * La clave de idempotencia es (id_proveedor, tipo_comprobante, serie, numero).
 * El costo de lote/catálogo lo calcula la RPC con CPP (no se envía el promedio).
 */

export function normalizarTextoComprobante(valor) {
  return String(valor ?? '').trim();
}

export function nroDocumentoCompra(serie, numero) {
  const s = normalizarTextoComprobante(serie);
  const n = normalizarTextoComprobante(numero);
  if (!s || !n) return '';
  return `${s}-${n}`;
}

export function claveComprobanteCompra({ id_proveedor, tipo_comprobante, serie, numero }) {
  return [
    Number(id_proveedor) || 0,
    normalizarTextoComprobante(tipo_comprobante),
    normalizarTextoComprobante(serie),
    normalizarTextoComprobante(numero),
  ].join('|');
}

/** Saldo de Kardex = stock físico TOTAL después de la entrada (no la cantidad comprada). */
export function saldoKardexTrasEntrada(stockAnteriorBase, cantidadEntradaBase) {
  return (Number(stockAnteriorBase) || 0) + (Number(cantidadEntradaBase) || 0);
}

function fechaVencimientoClave(valor) {
  if (valor == null || valor === '') return '';
  return String(valor).slice(0, 10);
}

function costoPartidaClave(valor) {
  return (Number(valor) || 0).toFixed(6);
}

/** Lote escrito por el usuario, o FAC-{serie-numero} si viene vacío. */
export function loteBaseLineaCompra(nroLoteUsuario, nroDocumento) {
  const escrito = normalizarTextoComprobante(nroLoteUsuario);
  if (escrito) return escrito;
  const doc = normalizarTextoComprobante(nroDocumento);
  return doc ? `FAC-${doc}` : 'FAC';
}

/**
 * Un lote por partida. Se fusionan solo si coinciden costo, vencimiento y lote base.
 * Si hay que separar y el lote base se repite, el sufijo es determinista
 * (ordenado por costo y fecha): FAC-serie-numero-1, FAC-serie-numero-2.
 */
export function asignarNroLoteLineasCompra(items, nroDocumento) {
  const lista = items || [];
  const anotadas = lista.map((item, idx) => ({
    idx,
    loteBase: loteBaseLineaCompra(item.nro_lote, nroDocumento),
    idProducto: Number(item.id_producto) || 0,
    costo: Number(item.costo_unitario) || 0,
    fv: fechaVencimientoClave(item.fecha_vencimiento),
  }));

  const gruposPorBase = new Map();
  for (const a of anotadas) {
    const kBase = `${a.idProducto}\t${a.loteBase}`;
    if (!gruposPorBase.has(kBase)) gruposPorBase.set(kBase, new Map());
    const kPartida = `${costoPartidaClave(a.costo)}\t${a.fv}`;
    const grupos = gruposPorBase.get(kBase);
    if (!grupos.has(kPartida)) grupos.set(kPartida, { costo: a.costo, fv: a.fv });
  }

  const nombrePorPartida = new Map();
  for (const [kBase, grupos] of gruposPorBase) {
    const loteBase = kBase.split('\t').slice(1).join('\t');
    const ordenados = [...grupos.values()].sort((x, y) => {
      if (x.costo !== y.costo) return x.costo - y.costo;
      return x.fv.localeCompare(y.fv);
    });
    ordenados.forEach((g, i) => {
      const kPartida = `${kBase}\t${costoPartidaClave(g.costo)}\t${g.fv}`;
      nombrePorPartida.set(
        kPartida,
        ordenados.length === 1 ? loteBase : `${loteBase}-${i + 1}`,
      );
    });
  }

  return lista.map((item, idx) => {
    const a = anotadas[idx];
    const kPartida = `${a.idProducto}\t${a.loteBase}\t${costoPartidaClave(a.costo)}\t${a.fv}`;
    return { ...item, nro_lote: nombrePorPartida.get(kPartida) || a.loteBase };
  });
}

export function armarPayloadRegistrarCompra({
  id_sucursal,
  id_proveedor,
  id_usuario,
  comprobante,
  total_compra,
  percepcion = 0,
  compra_origen_id = null,
  id_pedido_origen = null,
  total_editado_manualmente = false,
  total_calculado_original = null,
  actualiza_precios = true,
  items = [],
}) {
  const tipo = normalizarTextoComprobante(comprobante?.tipo);
  const serie = normalizarTextoComprobante(comprobante?.serie);
  const numero = normalizarTextoComprobante(comprobante?.numero);
  const formaPago = normalizarTextoComprobante(comprobante?.formaPago) || 'Contado';

  return {
    id_sucursal: Number(id_sucursal) || null,
    id_proveedor: Number(id_proveedor) || null,
    id_usuario: Number(id_usuario) || null,
    tipo_comprobante: tipo,
    serie,
    numero,
    nro_documento: nroDocumentoCompra(serie, numero),
    fecha_compra: comprobante?.fechaCompra || null,
    total_compra: Number(total_compra) || 0,
    forma_pago: formaPago,
    fecha_vencimiento: (formaPago === 'Crédito' && comprobante?.venceCredito)
      ? comprobante.venceCredito
      : null,
    percepcion: Number(percepcion) || 0,
    compra_origen_id: compra_origen_id ? Number(compra_origen_id) : null,
    id_pedido_origen: id_pedido_origen ? Number(id_pedido_origen) : null,
    total_editado_manualmente: !!total_editado_manualmente,
    total_calculado_original: total_editado_manualmente ? Number(total_calculado_original) : null,
    actualiza_precios: !!actualiza_precios,
    items: asignarNroLoteLineasCompra(
      (items || []).map((item) => ({
        id_producto: Number(item.id_producto) || null,
        nro_lote: normalizarTextoComprobante(item.nro_lote),
        fecha_vencimiento: item.fecha_vencimiento || null,
        cantidad: Number(item.cantidad) || 0,
        costo_unitario: Number(item.costo_unitario) || 0,
        subtotal: Number(item.subtotal) || 0,
        p_venta: Number(item.p_venta) || 0,
        p_venta_caja: Number(item.p_venta_caja) || 0,
        codigo_proveedor: normalizarTextoComprobante(item.codigo_proveedor) || null,
        descripcion_catalogo: normalizarTextoComprobante(item.descripcion_catalogo) || null,
        bonificacion: !!item.bonificacion,
      })),
      nroDocumentoCompra(serie, numero),
    ),
  };
}

export function mensajeErrorRegistroCompra(errorCrudo) {
  const raw = String(errorCrudo || '');
  if (raw === 'DATOS_INCOMPLETOS') return 'Faltan datos de la compra (proveedor, sucursal, serie o número).';
  if (raw === 'SIN_ITEMS') return 'La compra no tiene ítems para registrar.';
  if (raw === 'ITEM_INVALIDO') return 'Hay un ítem de la compra sin producto o con cantidad inválida.';
  return raw || 'No se pudo registrar la compra.';
}
