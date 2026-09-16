/**
 * Plazos de la boleta electrónica frente al Resumen Diario de SUNAT.
 * Ajustar acá si cambia el criterio (no están hardcodeados en el ciclo).
 */

/** Días calendario desde la emisión: si SUNAT no aceptó, la columna SUNAT muestra SIN CONFIRMAR. */
export const DIAS_SIN_CONFIRMAR = 2;

/** Días calendario máximos para presentar el resumen diario (plazo legal SUNAT). */
export const DIAS_PLAZO_LEGAL_RESUMEN = 7;

/** Quedan estos días o menos: destacar en pantalla y avisar con urgencia. */
export const DIAS_ALERTA_PLAZO_CERCANO = 2;

/** Pausa entre una consulta a Nubefact y la siguiente (no martillar la API). */
export const PAUSA_ENTRE_CONSULTAS_NUBEFACT_MS = 1500;

/** Tope de consultas por ciclo; el resto espera al siguiente. */
export const MAX_CONSULTAS_SUNAT_POR_CICLO = 20;

/** Cada cuánto el admin vuelve a preguntar a Nubefact (además del arranque). */
export const INTERVALO_VERIFICACION_SUNAT_MS = 12 * 60 * 60 * 1000;

/**
 * Tope de POST generar_comprobante por venta (primer envío + reintentos).
 * Las consultas (consultar_comprobante) no cuentan y pueden seguir.
 */
export const MAX_INTENTOS_GENERAR_NUBEFACT = 3;
