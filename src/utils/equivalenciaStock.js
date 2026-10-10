const PRECISION_FACTOR = 1_000_000;

function redondearCantidad(valor) {
  return Math.round((Number(valor) + Number.EPSILON) * PRECISION_FACTOR) / PRECISION_FACTOR;
}

function formaActiva(forma) {
  const activo = forma?.activo;
  return activo !== false && activo !== 0 && activo !== '0' && String(activo).toLowerCase() !== 'false';
}

function nombreForma(forma) {
  return String(
    forma?.unidades_medida?.nombre
      || forma?.medida_nombre
      || forma?.nombre
      || '',
  ).trim();
}

function formatearCantidad(valor) {
  return Number(valor).toLocaleString('es-PE', { maximumFractionDigits: 6 });
}

/**
 * Descompone un stock expresado en unidades base usando las formas configuradas.
 * Es una representación visual: no modifica ni recalcula el inventario real.
 */
export function formatearEquivalenciaStock(stockBase, formasVenta = []) {
  const stock = Math.max(0, Number(stockBase) || 0);
  if (stock <= 0) return null;

  const factoresVistos = new Set();
  const formas = (formasVenta || [])
    .filter(formaActiva)
    .map((forma) => ({
      factor: Number(forma?.factor),
      nombre: nombreForma(forma),
    }))
    .filter((forma) => Number.isFinite(forma.factor) && forma.factor > 0 && forma.nombre)
    .sort((a, b) => b.factor - a.factor)
    .filter((forma) => {
      const clave = redondearCantidad(forma.factor);
      if (factoresVistos.has(clave)) return false;
      factoresVistos.add(clave);
      return true;
    });

  // Una única forma base no agrega información al total principal.
  if (!formas.some((forma) => forma.factor > 1)) return null;

  let restante = stock;
  const partes = [];

  for (const forma of formas) {
    const cantidad = Math.floor((restante + Number.EPSILON) / forma.factor);
    if (cantidad <= 0) continue;
    partes.push({ ...forma, cantidad });
    restante = redondearCantidad(restante - cantidad * forma.factor);
  }

  // Si no existe una forma factor 1, el residuo sigue siendo stock en unidades base.
  if (restante > 0) {
    partes.push({ factor: 1, nombre: 'unidades base', cantidad: restante, esBase: true });
  }

  if (!partes.some((parte) => parte.factor > 1)) return null;

  return partes
    .map((parte) => `${formatearCantidad(parte.cantidad)} × ${parte.nombre}`)
    .join(' + ');
}

