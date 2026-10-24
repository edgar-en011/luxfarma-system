import { formatearEquivalenciaStock } from './equivalenciaStock.js';
import { diasHastaFecha, formatearFechaPE } from './fechas.js';
import { UMBRAL_POR_VENCER_DIAS, estaPorVencer } from './umbralesVencimiento.js';
import { cantidadLote, loteDisponible } from './stockLotes.js';

export const DIAS_VENTAS_ASISTENTE = 30;
export const LIMITE_ITEMS_IA = 10;

function numero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

function idNumerico(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function productoVista(producto, stockBase) {
  return {
    idProducto: idNumerico(producto?.id_producto),
    nombre: producto?.descripcion || `Producto #${producto?.id_producto ?? '?'}`,
    codigo: producto?.codigo_barras || null,
    stockBase,
    equivalencia: formatearEquivalenciaStock(
      stockBase,
      producto?.producto_formas_venta || [],
    ),
  };
}

function construirStockPorProducto(lotes, fechaReferencia) {
  const stock = new Map();
  for (const lote of (lotes || [])) {
    if (!loteDisponible(lote, fechaReferencia)) continue;
    const id = idNumerico(lote.id_producto);
    if (id == null) continue;
    stock.set(id, numero(stock.get(id)) + cantidadLote(lote));
  }
  for (const [id, cantidad] of stock) stock.set(id, Math.max(0, cantidad));
  return stock;
}

function construirMovimientoPorProducto(detallesVenta) {
  const movimiento = new Map();
  for (const detalle of (detallesVenta || [])) {
    const id = idNumerico(detalle?.id_producto);
    if (id == null) continue;
    const unidadesBase = Math.max(0, numero(detalle.cantidad))
      * Math.max(0, numero(detalle.factor) || 1);
    movimiento.set(id, numero(movimiento.get(id)) + unidadesBase);
  }
  return movimiento;
}

function setIds(valores) {
  if (valores instanceof Set) return valores;
  return new Set((valores || []).map(idNumerico).filter((id) => id != null));
}

/**
 * Construye indicadores de solo lectura. Todos los stocks permanecen expresados
 * en unidades base; las equivalencias son únicamente una ayuda visual.
 */
export function construirResumenAsistenteIA({
  productos = [],
  lotes = [],
  detallesVenta = [],
  productosStockBajo = [],
  idsConMovimiento = [],
  sucursales = [],
  alcance = 'Todas las sedes',
  fechaReferencia = new Date(),
  periodoDesde,
  periodoHasta,
}) {
  const productosPorId = new Map(
    productos.map((producto) => [idNumerico(producto.id_producto), producto]),
  );
  const sucursalesPorId = new Map(
    sucursales.map((sucursal) => [idNumerico(sucursal.id_sucursal), sucursal]),
  );
  const stockPorProducto = construirStockPorProducto(lotes, fechaReferencia);
  const movimientoPorProducto = construirMovimientoPorProducto(detallesVenta);
  const usados = setIds(idsConMovimiento);

  const stockBajo = productosStockBajo
    .map((item) => {
      const producto = item.producto || productosPorId.get(idNumerico(item.id_producto));
      if (!producto) return null;
      const stockBase = Math.max(0, numero(item.stockTotal));
      const idSucursal = idNumerico(item.id_sucursal);
      return {
        ...productoVista(producto, stockBase),
        idSucursal,
        sucursal: sucursalesPorId.get(idSucursal)?.nombre_comercial || null,
        umbralBase: Math.max(0, numero(item.umbral)),
        unidadesVendidas: numero(movimientoPorProducto.get(idNumerico(item.id_producto))),
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if ((a.stockBase === 0) !== (b.stockBase === 0)) return a.stockBase === 0 ? -1 : 1;
      const ratioA = a.umbralBase > 0 ? a.stockBase / a.umbralBase : a.stockBase;
      const ratioB = b.umbralBase > 0 ? b.stockBase / b.umbralBase : b.stockBase;
      return ratioA - ratioB || b.unidadesVendidas - a.unidadesVendidas;
    });

  const proximosVencer = (lotes || [])
    .map((lote) => {
      if (!loteDisponible(lote, fechaReferencia)) return null;
      const dias = diasHastaFecha(lote.fecha_vencimiento, fechaReferencia);
      if (!estaPorVencer(dias)) return null;
      const producto = productosPorId.get(idNumerico(lote.id_producto));
      if (!producto) return null;
      const stockBase = cantidadLote(lote);
      const idSucursal = idNumerico(lote.id_sucursal);
      return {
        ...productoVista(producto, stockBase),
        idLote: lote.id_lote ?? null,
        numeroLote: lote.numero_lote || lote.nro_lote || null,
        fechaVencimiento: lote.fecha_vencimiento,
        fechaVencimientoTexto: formatearFechaPE(lote.fecha_vencimiento),
        diasParaVencer: dias,
        idSucursal,
        sucursal: sucursalesPorId.get(idSucursal)?.nombre_comercial || null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.diasParaVencer - b.diasParaVencer || b.stockBase - a.stockBase);

  const mayorMovimiento = [...movimientoPorProducto.entries()]
    .map(([idProducto, unidadesVendidas]) => {
      const producto = productosPorId.get(idProducto);
      if (!producto || unidadesVendidas <= 0) return null;
      return {
        ...productoVista(producto, Math.max(0, numero(stockPorProducto.get(idProducto)))),
        unidadesVendidas,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.unidadesVendidas - a.unidadesVendidas);

  const bajaRotacion = productos
    .map((producto) => {
      const idProducto = idNumerico(producto.id_producto);
      const stockBase = Math.max(0, numero(stockPorProducto.get(idProducto)));
      if (idProducto == null || stockBase <= 0 || !usados.has(idProducto)) return null;
      if (numero(movimientoPorProducto.get(idProducto)) > 0) return null;
      return {
        ...productoVista(producto, stockBase),
        diasSinVentas: DIAS_VENTAS_ASISTENTE,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.stockBase - a.stockBase || a.nombre.localeCompare(b.nombre, 'es'));

  const reposicion = stockBajo.map((item) => ({
    ...item,
    brechaMinimoBase: Math.max(0, item.umbralBase - item.stockBase),
    prioridad: item.stockBase <= 0 ? 'Crítica' : 'Atención',
  }));

  return {
    metadata: {
      generadoEn: fechaReferencia.toISOString(),
      alcance,
      periodoDesde,
      periodoHasta,
      periodoDias: DIAS_VENTAS_ASISTENTE,
      umbralVencimientoDias: UMBRAL_POR_VENCER_DIAS,
      fuenteStock: 'inventario_lotes.cantidad_actual en unidades base',
    },
    totales: {
      productosAnalizados: productos.length,
      stockBajo: stockBajo.length,
      lotesProximosVencer: proximosVencer.length,
      bajaRotacion: bajaRotacion.length,
      conMovimiento: mayorMovimiento.length,
      recomendacionesReposicion: reposicion.length,
    },
    stockBajo,
    proximosVencer,
    bajaRotacion,
    mayorMovimiento,
    reposicion,
  };
}

function recortar(lista) {
  return (lista || []).slice(0, LIMITE_ITEMS_IA);
}

function normalizarItemRpc(item = {}) {
  const stockBase = Math.max(0, numero(item.stock_base));
  return {
    idProducto: idNumerico(item.id_producto),
    nombre: item.descripcion || `Producto #${item.id_producto ?? '?'}`,
    codigo: item.codigo_barras || null,
    stockBase,
    equivalencia: formatearEquivalenciaStock(stockBase, item.formas_venta || []),
    idSucursal: idNumerico(item.id_sucursal),
    sucursal: item.sucursal || null,
    umbralBase: Math.max(0, numero(item.umbral_base)),
    unidadesVendidas: numero(item.unidades_vendidas),
    idLote: item.id_lote ?? null,
    numeroLote: item.nro_lote || null,
    fechaVencimiento: item.fecha_vencimiento || null,
    fechaVencimientoTexto: item.fecha_vencimiento ? formatearFechaPE(item.fecha_vencimiento) : null,
    diasParaVencer: numero(item.dias_para_vencer),
    diasSinVentas: numero(item.dias_sin_ventas),
    brechaMinimoBase: Math.max(0, numero(item.brecha_minimo_base)),
    prioridad: item.prioridad || null,
  };
}

/** Convierte el JSON agregado por PostgreSQL al contrato usado por la interfaz. */
export function normalizarResumenAsistenteIARpc(data) {
  if (!data || typeof data !== 'object') throw new Error('Resumen RPC inválido.');
  return {
    metadata: data.metadata || {},
    totales: data.totales || {},
    stockBajo: (data.stockBajo || []).map(normalizarItemRpc),
    proximosVencer: (data.proximosVencer || []).map(normalizarItemRpc),
    bajaRotacion: (data.bajaRotacion || []).map(normalizarItemRpc),
    mayorMovimiento: (data.mayorMovimiento || []).map(normalizarItemRpc),
    reposicion: (data.reposicion || []).map(normalizarItemRpc),
  };
}

/** Snapshot acotado y sin datos personales para enviar a la Edge Function. */
export function crearSnapshotAsistenteIA(resumen) {
  if (!resumen) return null;
  return {
    metadata: {
      ...resumen.metadata,
      limiteItemsPorCategoria: LIMITE_ITEMS_IA,
      listasCompletas: false,
      definiciones: {
        stockDisponible: 'Suma de cantidad_actual solo en lotes con estado VIGENTE.',
        stockVencido: 'No está incluido en stockBase; se consulta por separado.',
        unidades: 'Todas las cantidades se expresan en unidades base.',
      },
    },
    totales: resumen.totales,
    stock_bajo: recortar(resumen.stockBajo),
    proximos_a_vencer: recortar(resumen.proximosVencer),
    baja_rotacion: recortar(resumen.bajaRotacion),
    mayor_movimiento: recortar(resumen.mayorMovimiento),
    reposicion: recortar(resumen.reposicion),
  };
}
