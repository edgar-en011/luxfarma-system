import { unidadesBaseDeLinea } from './stockOffline.js';

export function claveLineaCarrito(item) {
  if (!item) return '';
  return `${Number(item.id_producto)}:${Number(item.id_medida) || 1}`;
}

/** Factor de venta; 0/NaN cuenta como 1 (unidad suelta). */
export function factorFormaVenta(forma) {
  return Number(forma?.factor) || 1;
}

/**
 * Forma por defecto en mostrador: la de menor factor (unidad suelta).
 * No usa el orden de la BD ni asume que UNIDAD es id_medida = 1.
 */
export function formaVentaMenorFactor(formas) {
  const lista = (formas || []).filter(Boolean);
  if (!lista.length) return null;
  return lista.reduce((mejor, f) => {
    const fa = factorFormaVenta(mejor);
    const fb = factorFormaVenta(f);
    if (fb < fa) return f;
    if (fb === fa && (Number(f.id_medida) || 0) < (Number(mejor.id_medida) || 0)) return f;
    return mejor;
  });
}

export function formasVentaOrdenadasPorFactor(formas) {
  return [...(formas || [])].sort((a, b) => {
    const d = factorFormaVenta(a) - factorFormaVenta(b);
    if (d !== 0) return d;
    return (Number(a.id_medida) || 0) - (Number(b.id_medida) || 0);
  });
}

export function productoYaEnCarrito(carrito, idProducto) {
  return (carrito || []).some((i) => Number(i.id_producto) === Number(idProducto));
}

/** Segunda (o más) pasada del mismo producto con varias formas: hay que preguntar. */
export function debePreguntarFormaVenta(carrito, idProducto, formas) {
  return productoYaEnCarrito(carrito, idProducto) && (formas || []).length > 1;
}

export function productosDistintosEnCarrito(carrito) {
  return new Set((carrito || []).map((i) => Number(i.id_producto))).size;
}

export function unidadesBaseProducto(carrito, idProducto, exceptClave = null) {
  return (carrito || [])
    .filter((i) => Number(i.id_producto) === Number(idProducto))
    .filter((i) => exceptClave == null || claveLineaCarrito(i) !== exceptClave)
    .reduce((suma, i) => suma + unidadesBaseDeLinea(i), 0);
}

export function etiquetaProductoTicket(item) {
  const nombre = item?.producto || item?.descripcion || '';
  const modo = String(item?.modo_venta || '').trim();
  if (!modo) return nombre;
  return `${nombre} (${modo})`;
}

function topeVentaEnModo(stockBaseLibre, factor) {
  const f = Number(factor) || 1;
  return Math.floor(Math.max(0, stockBaseLibre) / f);
}

export function agregarLineaCarrito(prev, lineaNueva, { maxProductosDistintos } = {}) {
  const carrito = prev || [];
  const clave = claveLineaCarrito(lineaNueva);
  const existe = carrito.find((item) => claveLineaCarrito(item) === clave);
  const stockTotal = Number(lineaNueva.stock_total ?? existe?.stock_total ?? 0);
  const usadoOtros = unidadesBaseProducto(carrito, lineaNueva.id_producto, clave);
  const factor = Number((existe || lineaNueva).factor) || 1;

  if (existe) {
    const usadoEsta = unidadesBaseDeLinea(existe);
    const libre = stockTotal - usadoOtros - usadoEsta;
    if (libre < factor) {
      return {
        carrito,
        error: `Stock máximo alcanzado. Solo hay ${topeVentaEnModo(stockTotal - usadoOtros, factor)} disponibles de "${lineaNueva.producto}".`,
      };
    }
    return {
      carrito: carrito.map((item) => (
        claveLineaCarrito(item) === clave
          ? {
            ...item,
            cantidad: item.cantidad + 1,
            subtotal: Math.round(((item.cantidad + 1) * item.precio) * 100) / 100,
          }
          : item
      )),
    };
  }

  if (
    maxProductosDistintos
    && !carrito.some((i) => Number(i.id_producto) === Number(lineaNueva.id_producto))
    && productosDistintosEnCarrito(carrito) >= maxProductosDistintos
  ) {
    return {
      carrito,
      error: `Límite alcanzado. El ticket solo permite hasta ${maxProductosDistintos} productos distintos.`,
    };
  }

  if (stockTotal - usadoOtros < factor) {
    return {
      carrito,
      error: `Stock máximo alcanzado. Solo hay ${topeVentaEnModo(stockTotal - usadoOtros, factor)} disponibles de "${lineaNueva.producto}".`,
    };
  }

  return { carrito: [...carrito, lineaNueva] };
}

export function cambiarCantidadLinea(prev, clave, nuevaCantidad, { redondear2 } = {}) {
  const qty = Number(nuevaCantidad);
  if (qty < 1 || Number.isNaN(qty)) return { carrito: prev };
  const red = redondear2 || ((n) => Math.round(Number(n) * 100) / 100);
  let error = null;
  const carrito = (prev || []).map((item) => {
    if (claveLineaCarrito(item) !== clave) return item;
    const usadoOtros = unidadesBaseProducto(prev, item.id_producto, clave);
    const stockTotal = Number(item.stock_total || 0);
    const factor = Number(item.factor) || 1;
    const maxQty = topeVentaEnModo(stockTotal - usadoOtros, factor);
    if (qty > maxQty) {
      error = `Solo hay ${maxQty} disponibles de "${item.producto}".`;
      return item;
    }
    return { ...item, cantidad: qty, subtotal: red(qty * item.precio) };
  });
  return { carrito, error };
}

export function cambiarModoVentaLinea(prev, claveActual, forma, { redondear2 } = {}) {
  const red = redondear2 || ((n) => Math.round(Number(n) * 100) / 100);
  const actual = (prev || []).find((i) => claveLineaCarrito(i) === claveActual);
  if (!actual || !forma) return { carrito: prev };
  const nuevoFactor = Number(forma.factor) || 1;
  const nuevoPrecio = Number(forma.precio_venta) || 0;
  const idMedida = Number(forma.id_medida);
  const modo = forma.unidades_medida?.nombre || 'UNIDAD';
  const claveDestino = `${Number(actual.id_producto)}:${idMedida}`;
  const stockTotal = Number(actual.stock_total || 0);

  if (claveDestino === claveActual) return { carrito: prev };

  const destino = (prev || []).find((i) => claveLineaCarrito(i) === claveDestino);
  const usadoOtros = unidadesBaseProducto(prev, actual.id_producto, claveActual)
    - (destino ? unidadesBaseDeLinea(destino) : 0);

  if (destino) {
    const qty = destino.cantidad + actual.cantidad;
    const necesario = qty * (Number(destino.factor) || 1);
    if (necesario > stockTotal - usadoOtros) {
      return {
        carrito: prev,
        error: `No hay stock suficiente para juntar ${qty} ${destino.modo_venta} de "${actual.producto}".`,
      };
    }
    return {
      carrito: prev
        .filter((i) => claveLineaCarrito(i) !== claveActual)
        .map((i) => (
          claveLineaCarrito(i) === claveDestino
            ? { ...i, cantidad: qty, subtotal: red(qty * i.precio) }
            : i
        )),
    };
  }

  if (nuevoFactor > stockTotal - usadoOtros) {
    return {
      carrito: prev,
      error: `No hay stock suficiente para vender por ${modo}.`,
    };
  }

  return {
    carrito: (prev || []).map((item) => (
      claveLineaCarrito(item) !== claveActual
        ? item
        : {
          ...item,
          id_medida: idMedida,
          factor: nuevoFactor,
          precio: nuevoPrecio,
          modo_venta: modo,
          cantidad: 1,
          stock_disponible: topeVentaEnModo(stockTotal, nuevoFactor),
          subtotal: red(nuevoPrecio),
        }
    )),
  };
}

export function quitarLineaCarrito(prev, clave) {
  return (prev || []).filter((i) => claveLineaCarrito(i) !== clave);
}
