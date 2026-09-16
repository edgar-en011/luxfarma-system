/** UUID de idempotencia para ventas offline (viaja a Supabase como ventas.uuid_venta). */

export function nuevoUuidVenta() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  throw new Error('crypto.randomUUID no está disponible en este entorno.');
}

export function uuidVentaValido(valor) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(valor || ''),
  );
}

/**
 * Arma el JSON que consume la RPC sincronizar_venta_offline.
 * El correlativo lo asigna Postgres; el cliente solo manda el uuid estable.
 */
export function armarPayloadSincronizacion(venta, { idTurno, exigirUuid = true } = {}) {
  const uuid = String(venta.uuid_venta || '').trim();
  if (exigirUuid && !uuidVentaValido(uuid)) {
    throw new Error('La venta offline no tiene uuid_venta válido.');
  }
  if (!idTurno) {
    throw new Error('No hay turno abierto para sincronizar esta venta.');
  }

  const tipoComprobante = String(venta.tipoComprobante || '').trim();
  const esNotaVenta = tipoComprobante === 'Nota de Venta';
  const cliente = venta.cliente || null;

  const items = (venta.carrito || []).map((item) => ({
    id_producto: item.id_producto,
    modo_venta: item.modo_venta || 'UNIDAD',
    cantidad: Number(item.cantidad) || 0,
    precio_unitario: Number(item.precio) || 0,
    subtotal: Number(item.subtotal) || 0,
    factor: Number(item.factor) || 1,
    id_medida: item.id_medida || null,
    lote: item.lote || 'VENTA',
    nombre: item.producto || item.descripcion || null,
    costo_unitario: item.costo_unitario == null || item.costo_unitario === ''
      ? null
      : Number(item.costo_unitario),
  }));

  const pagos = [];
  if (venta.metodoPago === 'Mixto') {
    if (venta.mixtoData?.monto1 > 0) {
      pagos.push({
        metodo: String(venta.mixtoData.metodo1 || '').toUpperCase(),
        monto: Number(venta.mixtoData.monto1),
      });
    }
    if (venta.mixtoData?.monto2 > 0) {
      pagos.push({
        metodo: String(venta.mixtoData.metodo2 || '').toUpperCase(),
        monto: Number(venta.mixtoData.monto2),
      });
    }
  } else {
    pagos.push({
      metodo: String(venta.metodoPago || 'EFECTIVO').toUpperCase(),
      monto: Number(venta.total) || 0,
    });
  }

  return {
    uuid_venta: uuidVentaValido(uuid) ? uuid : null,
    id_sucursal: venta.id_sucursal,
    id_turno: idTurno,
    id_usuario: venta.id_usuario,
    tipo_comprobante: tipoComprobante.toUpperCase(),
    serie: venta.serie,
    total: Number(venta.total) || 0,
    vuelto: venta.vuelto > 0 && venta.metodoPago !== 'Mixto' ? Number(venta.vuelto) : 0,
    monto_recibido: Number(venta.monto_recibido) || 0,
    estado_sunat: esNotaVenta ? 'NO_APLICA' : 'PENDIENTE',
    cliente,
    items,
    pagos,
  };
}

export function mensajeErrorRegistroVenta(errorCrudo) {
  const raw = String(errorCrudo || '');
  if (raw.startsWith('STOCK_INSUFICIENTE')) {
    const parts = raw.split('|');
    const nombre = parts[1] || 'un producto';
    const requerido = parts[2] ?? '?';
    const alcanzado = parts[3] ?? '?';
    return `Stock insuficiente de "${nombre}" (se pudieron descontar ${alcanzado} de ${requerido} uds. base).`;
  }
  return raw || 'No se pudo registrar la venta.';
}
