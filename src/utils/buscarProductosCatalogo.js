/**
 * Búsqueda de catálogo compartida (POS y Compras): substring en el nombre,
 * código exacto aparte, y orden por relevancia (empieza con… > palabra > contiene).
 */

/** Un solo join en la búsqueda del POS: no hay consulta extra por resultado. */
export const SELECT_POS_BUSQUEDA =
  'id_producto, codigo_barras, descripcion, laboratorios(nombre), producto_precios (precio_venta, costo)'

/** Búsqueda en vivo (POS y Compras): no dispara en cada tecla. */
export const DEBOUNCE_BUSQUEDA_MS = 350
export const MIN_CHARS_BUSQUEDA_VIVA = 3

/** Nombre de laboratorio desde el embed, el catálogo offline o un string plano. */
export function nombreLaboratorioProducto(prod) {
  const labs = prod?.laboratorios
  if (labs && !Array.isArray(labs) && labs.nombre) return String(labs.nombre).trim()
  if (Array.isArray(labs) && labs[0]?.nombre) return String(labs[0].nombre).trim()
  const plano = prod?.laboratorio || prod?.nombreLaboratorio || ''
  return String(plano).trim()
}

export function terminoBusquedaSeguro(valor) {
  return String(valor || '').trim().replace(/[%_,()]/g, ' ').replace(/\s+/g, ' ');
}

export function puntuarCoincidenciaProducto(prod, termino) {
  const t = String(termino || '').trim().toLowerCase();
  const d = String(prod?.descripcion || '').toLowerCase();
  const c = String(prod?.codigo_barras || '').toLowerCase();
  if (!t) return 99;
  if (c && c === t) return 0;
  if (d.startsWith(t)) return 1;
  const palabras = d.split(/[\s\-/.,;:+]+/).filter(Boolean);
  if (palabras.some((w) => w.startsWith(t))) return 2;
  if (d.includes(t)) return 3;
  if (c.includes(t)) return 4;
  return 9;
}

export function ordenarResultadosBusqueda(lista, termino) {
  return [...(lista || [])].sort((a, b) => {
    const pa = puntuarCoincidenciaProducto(a, termino);
    const pb = puntuarCoincidenciaProducto(b, termino);
    if (pa !== pb) return pa - pb;
    return String(a.descripcion || '').localeCompare(String(b.descripcion || ''), 'es');
  });
}
