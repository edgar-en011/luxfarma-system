/** Redondeo monetario a 2 decimales (evita acumulación de float en IGV/subtotales). */
export function redondear2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
