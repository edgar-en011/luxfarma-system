/** Primer aviso de vencimiento y umbrales de la campana: 60 / 30 / 15 / 5 / 1 + ya vencido. */
export const UMBRAL_POR_VENCER_DIAS = 60;
export const UMBRALES_AVISO_VENCIMIENTO = [60, 30, 15, 5, 1];

export function estaPorVencer(dias) {
  return dias != null && dias >= 0 && dias <= UMBRAL_POR_VENCER_DIAS;
}
