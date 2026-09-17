/** Tamaño de la bandeja de Compras. Por máquina (localStorage). */

export const BANDEJA_TAMANO_KEY = 'luxfarma_bandejaCompraTamano';
export const BANDEJA_TAMANOS = ['sm', 'md', 'lg'];
export const BANDEJA_TAMANO_DEFAULT = 'md';

const ETIQUETAS = { sm: 'Pequeño', md: 'Normal', lg: 'Grande' };

export function etiquetaBandejaTamano(id) {
  return ETIQUETAS[id] || ETIQUETAS[BANDEJA_TAMANO_DEFAULT];
}

export function leerBandejaTamano() {
  try {
    const v = localStorage.getItem(BANDEJA_TAMANO_KEY);
    if (BANDEJA_TAMANOS.includes(v)) return v;
  } catch { /* ignore */ }
  return BANDEJA_TAMANO_DEFAULT;
}

export function guardarBandejaTamano(id) {
  const v = BANDEJA_TAMANOS.includes(id) ? id : BANDEJA_TAMANO_DEFAULT;
  try { localStorage.setItem(BANDEJA_TAMANO_KEY, v); } catch { /* ignore */ }
  return v;
}

export function bandejaTamanoVecino(id, dir) {
  const i = BANDEJA_TAMANOS.indexOf(BANDEJA_TAMANOS.includes(id) ? id : BANDEJA_TAMANO_DEFAULT);
  const next = i + dir;
  if (next < 0 || next >= BANDEJA_TAMANOS.length) return BANDEJA_TAMANOS[i];
  return BANDEJA_TAMANOS[next];
}
