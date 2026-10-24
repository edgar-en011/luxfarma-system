import { supabase } from '../supabaseClient';
import { crearSnapshotAsistenteIA, DIAS_VENTAS_ASISTENTE, normalizarResumenAsistenteIARpc } from '../utils/analiticaAsistenteIA';
import { buscarProductosParaStock, construirDetallesStock, respuestaStockExacto } from '../utils/stockAsistenteIA';
import { fetchAllRows } from '../utils/supabasePage';

const CACHE_CATALOGO_STOCK_MS = 5 * 60 * 1000;
let cacheCatalogoStock = { at: 0, productos: null, inflight: null };

function esTodas(idSucursal) {
  return idSucursal == null || idSucursal === '' || idSucursal === 'TODAS';
}

export async function cargarDatosAsistenteIA({ idSucursal = 'TODAS', token } = {}) {
  const idSucursalRpc = esTodas(idSucursal) ? null : Number(idSucursal);
  let resultado;
  try {
    resultado = await invocarAsistente({
      accion: 'resumen',
      id_sucursal: idSucursalRpc,
      dias: DIAS_VENTAS_ASISTENTE,
      limite: 10,
    }, token);
  } catch (error) {
    // Compatibilidad temporal mientras se despliega la nueva Edge Function.
    if (error?.code !== 'INVALID_ACTION') throw error;
    const [{ data: resumen, error: errorResumen }, { data: sucursales, error: errorSucursales }] = await Promise.all([
      supabase.rpc('resumen_asistente_ia', {
        p_id_sucursal: idSucursalRpc,
        p_dias: DIAS_VENTAS_ASISTENTE,
        p_limite: 10,
      }),
      supabase
        .from('sucursales')
        .select('id_sucursal, nombre_comercial, activo')
        .eq('activo', true)
        .order('id_sucursal', { ascending: true }),
    ]);
    if (errorResumen || errorSucursales) throw errorResumen || errorSucursales;
    resultado = { resumen, sucursales };
  }
  if (!resultado?.resumen) throw new Error('El servicio no devolvió un resumen válido.');

  const resumen = normalizarResumenAsistenteIARpc(resultado.resumen);
  return {
    resumen,
    snapshotIA: crearSnapshotAsistenteIA(resumen),
    sucursales: Array.isArray(resultado.sucursales) ? resultado.sucursales : [],
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

async function cargarCatalogoParaStock() {
  const ahora = Date.now();
  if (cacheCatalogoStock.productos && ahora - cacheCatalogoStock.at < CACHE_CATALOGO_STOCK_MS) {
    return cacheCatalogoStock.productos;
  }
  if (cacheCatalogoStock.inflight) return cacheCatalogoStock.inflight;

  cacheCatalogoStock.inflight = fetchAllRows(() => supabase
    .from('productos')
    .select('id_producto, descripcion, codigo_barras')
    .eq('activo', 1)
    .order('descripcion', { ascending: true }))
    .then((productos) => {
      cacheCatalogoStock = { at: Date.now(), productos, inflight: null };
      return productos;
    })
    .catch((error) => {
      cacheCatalogoStock.inflight = null;
      throw error;
    });
  return cacheCatalogoStock.inflight;
}

export async function consultarStockActualAsistenteIA({ pregunta, idSucursal = 'TODAS', sucursales = [] }) {
  const catalogo = await cargarCatalogoParaStock();
  const coincidencias = buscarProductosParaStock(pregunta, catalogo, 5);
  if (coincidencias.length === 0) {
    return { respuesta: respuestaStockExacto([], 'el alcance elegido'), tipo: 'stock_actual' };
  }

  const ids = coincidencias.map((producto) => producto.id_producto);
  const [{ data: productos, error: errorProductos }, lotes] = await Promise.all([
    supabase
      .from('productos')
      .select('id_producto, descripcion, codigo_barras, producto_formas_venta(factor, activo, unidades_medida(nombre))')
      .in('id_producto', ids),
    fetchAllRows(() => {
      let consulta = supabase
        .from('inventario_lotes')
        .select('id_lote, id_producto, id_sucursal, cantidad_actual, estado, fecha_vencimiento')
        .in('id_producto', ids)
        .in('estado', ['VIGENTE', 'VENCIDO'])
        .order('id_lote', { ascending: true });
      if (idSucursal !== 'TODAS' && idSucursal != null && idSucursal !== '') {
        consulta = consulta.eq('id_sucursal', Number(idSucursal));
      }
      return consulta;
    }),
  ]);
  if (errorProductos) throw errorProductos;

  const orden = new Map(ids.map((id, indice) => [Number(id), indice]));
  const productosOrdenados = (productos || []).sort((a, b) => (
    (orden.get(Number(a.id_producto)) ?? 999) - (orden.get(Number(b.id_producto)) ?? 999)
  ));
  const detalles = construirDetallesStock(productosOrdenados, lotes, sucursales, idSucursal);
  const alcance = idSucursal === 'TODAS'
    ? 'todas las sedes'
    : sucursales.find((sucursal) => Number(sucursal.id_sucursal) === Number(idSucursal))?.nombre_comercial
      || `la sede ${idSucursal}`;
  return { respuesta: respuestaStockExacto(detalles, alcance), tipo: 'stock_actual', detalles };
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

export async function consultarAsistenteIA({ token, pregunta, snapshot, historial = [] }) {
  return invocarAsistente({
    accion: 'consultar',
    pregunta,
    resumen: snapshot,
    historial,
  }, token);
}

export async function enviarFeedbackAsistenteIA({ token, respuestaId, util }) {
  return invocarAsistente({ accion: 'feedback', respuesta_id: respuestaId, util }, token);
}

export async function cargarFeedbackAsistenteIA(token) {
  return invocarAsistente({ accion: 'feedback_resumen' }, token);
}
