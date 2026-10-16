import { supabase } from '../supabaseClient';
import { construirResumenAsistenteIA, crearSnapshotAsistenteIA, DIAS_VENTAS_ASISTENTE, normalizarResumenAsistenteIARpc } from '../utils/analiticaAsistenteIA';
import { fechaLocalStr, hoyLocal, boundsISOPeru } from '../utils/fechas';
import { calcularProductosStockBajo, cargarIdsProductosConMovimiento } from '../utils/stockBajo';
import { fetchAllRows } from '../utils/supabasePage';

const TAMANO_CHUNK_VENTAS = 200;

function inicioPeriodo(dias) {
  const fecha = new Date();
  fecha.setHours(12, 0, 0, 0);
  fecha.setDate(fecha.getDate() - (dias - 1));
  return fechaLocalStr(fecha);
}

function esTodas(idSucursal) {
  return idSucursal == null || idSucursal === '' || idSucursal === 'TODAS';
}

async function cargarVentasYDetalles({ idSucursal, start, end }) {
  const ventas = await fetchAllRows(() => {
    let consulta = supabase
      .from('ventas')
      .select('id_venta, id_sucursal, created_at, estado_anulacion')
      .gte('created_at', start)
      .lte('created_at', end)
      .or('estado_anulacion.is.null,estado_anulacion.neq.ANULADO')
      .order('id_venta', { ascending: true });
    if (!esTodas(idSucursal)) consulta = consulta.eq('id_sucursal', idSucursal);
    return consulta;
  });

  const idsVenta = ventas
    .filter((venta) => venta.estado_anulacion !== 'ANULADO')
    .map((venta) => venta.id_venta);
  if (idsVenta.length === 0) return [];

  const chunks = [];
  for (let i = 0; i < idsVenta.length; i += TAMANO_CHUNK_VENTAS) {
    chunks.push(idsVenta.slice(i, i + TAMANO_CHUNK_VENTAS));
  }
  const resultados = await Promise.all(chunks.map((ids) => fetchAllRows(() => (
    supabase
      .from('venta_detalle')
      .select('id_venta, id_producto, cantidad, factor')
      .in('id_venta', ids)
      .order('id_venta', { ascending: true })
  ))));
  return resultados.flat();
}

export async function cargarDatosAsistenteIA({ idSucursal = 'TODAS' } = {}) {
  const idSucursalRpc = esTodas(idSucursal) ? null : Number(idSucursal);
  const { data: dataRpc, error: errorRpc } = await supabase.rpc('resumen_asistente_ia', {
    p_id_sucursal: idSucursalRpc,
    p_dias: DIAS_VENTAS_ASISTENTE,
    p_limite: 10,
  });
  if (!errorRpc && dataRpc) {
    const resumen = normalizarResumenAsistenteIARpc(dataRpc);
    const { data: sucursales = [] } = await supabase
      .from('sucursales')
      .select('id_sucursal, nombre_comercial, activo')
      .eq('activo', true)
      .order('id_sucursal', { ascending: true });
    return { resumen, snapshotIA: crearSnapshotAsistenteIA(resumen), sucursales };
  }
  console.warn('resumen_asistente_ia: se usa respaldo local:', errorRpc?.message);

  const periodoHasta = hoyLocal();
  const periodoDesde = inicioPeriodo(DIAS_VENTAS_ASISTENTE);
  const { start, end } = boundsISOPeru(periodoDesde, periodoHasta);

  const [productos, lotes, sucursales, idsMovimiento, detallesVenta] = await Promise.all([
    fetchAllRows(() => supabase
      .from('productos')
      .select('id_producto, codigo_barras, descripcion, stock_minimo, activo, producto_formas_venta(factor, activo, unidades_medida(nombre))')
      .eq('activo', 1)
      .order('id_producto', { ascending: true })),
    fetchAllRows(() => {
      let consulta = supabase
        .from('inventario_lotes')
        .select('id_lote, id_producto, id_sucursal, nro_lote, fecha_vencimiento, cantidad_actual, estado, created_at')
        .order('id_lote', { ascending: true });
      if (!esTodas(idSucursal)) consulta = consulta.eq('id_sucursal', idSucursal);
      return consulta;
    }),
    fetchAllRows(() => supabase
      .from('sucursales')
      .select('id_sucursal, nombre_comercial, activo')
      .eq('activo', true)
      .order('id_sucursal', { ascending: true })),
    cargarIdsProductosConMovimiento(),
    cargarVentasYDetalles({ idSucursal, start, end }),
  ]);

  const idsLotesDelAlcance = new Set(lotes.map((lote) => Number(lote.id_producto)));
  const idsMovimientoAlcance = esTodas(idSucursal)
    ? idsMovimiento
    : new Set([...idsMovimiento].filter((id) => idsLotesDelAlcance.has(Number(id))));
  const stockBajo = calcularProductosStockBajo(productos, lotes, idsMovimientoAlcance);
  const sucursalElegida = sucursales.find((sucursal) => (
    Number(sucursal.id_sucursal) === Number(idSucursal)
  ));

  const resumen = construirResumenAsistenteIA({
    productos,
    lotes,
    detallesVenta,
    productosStockBajo: stockBajo,
    idsConMovimiento: idsMovimientoAlcance,
    sucursales,
    alcance: sucursalElegida?.nombre_comercial || 'Todas las sedes',
    periodoDesde,
    periodoHasta,
  });

  return {
    resumen,
    snapshotIA: crearSnapshotAsistenteIA(resumen),
    sucursales,
  };
}

async function detalleErrorFuncion(error) {
  try {
    const cuerpo = await error?.context?.json?.();
    return cuerpo || null;
  } catch {
    return null;
  }
}

async function invocarAsistente(body, token = null) {
  const opciones = { body };
  if (token) opciones.headers = { 'x-luxfarma-ai-session': token };
  const { data, error } = await supabase.functions.invoke('asistente-ia', opciones);
  if (!error) return data;

  const detalle = await detalleErrorFuncion(error);
  const err = new Error(detalle?.message || 'El servicio de IA no está disponible en este momento.');
  err.code = detalle?.code || 'EDGE_FUNCTION_ERROR';
  throw err;
}

export async function crearSesionAsistenteIA({ idUsuario, password }) {
  return invocarAsistente({
    accion: 'crear_sesion',
    id_usuario: idUsuario,
    password,
  });
}

export async function consultarAsistenteIA({ token, pregunta, snapshot }) {
  return invocarAsistente({
    accion: 'consultar',
    pregunta,
    resumen: snapshot,
  }, token);
}
