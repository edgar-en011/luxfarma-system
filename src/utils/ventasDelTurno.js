import { etiquetaComprobanteVisible } from './comprobanteVisible';

/**
 * Misma consulta y el mismo filtro que "Mi Turno" (Dashboard).
 * Un solo origen para total vendido y número de operaciones.
 */
export const SELECT_VENTAS_DEL_TURNO =
  'serie, correlativo, total, created_at, estado_anulacion, tipo_comprobante, pagos_venta(metodo, monto), comprobantes_sunat(serie, numero)';

export function formatearVentasDelTurno(data) {
  // Excluye ventas anuladas ANTES de sumar — este monto alimenta directo el cuadre
  // de caja (efectivo/yape esperado), el ticket impreso de cierre, y lo que se
  // graba en caja_turnos al cerrar, así que una venta anulada acá inflaría lo que
  // se le pide rendir al vendedor. Se filtra en el origen (data) en vez de cada
  // consumidor por separado, porque ventasHoy/totalVentas/CAJA ACTUAL/"Mis ventas
  // de hoy" derivan todos de este mismo array.
  const dataActivas = (data || []).filter((v) => v.estado_anulacion !== 'ANULADO');
  let sumEfectivo = 0;
  let sumYape = 0;
  let sumTarjeta = 0;
  const ventas = dataActivas.map((v) => {
    v.pagos_venta?.forEach((pago) => {
      if (pago.metodo === 'EFECTIVO') sumEfectivo += Number(pago.monto);
      if (pago.metodo === 'YAPE') sumYape += Number(pago.monto);
      if (pago.metodo === 'TARJETA') sumTarjeta += Number(pago.monto);
    });
    return {
      comprobante: etiquetaComprobanteVisible(v),
      cliente: 'Público General',
      metodo: v.pagos_venta?.length > 1 ? 'Mixto' : (v.pagos_venta?.[0]?.metodo || 'Efectivo'),
      total: Number(v.total),
      hora: new Date(v.created_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }),
    };
  });
  const totalVendido = ventas.reduce((acc, venta) => acc + Number(venta.total), 0);
  return {
    ventas,
    totalesPagos: { efectivo: sumEfectivo, yape: sumYape, tarjeta: sumTarjeta },
    totalVendido,
    operaciones: ventas.length,
  };
}

export async function cargarVentasDelTurno(cliente, idTurno) {
  const { data, error } = await cliente
    .from('ventas')
    .select(SELECT_VENTAS_DEL_TURNO)
    .eq('id_turno', idTurno)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return formatearVentasDelTurno(data);
}
