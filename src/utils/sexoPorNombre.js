/**
 * Sugerencia de sexo (M/F) por primer nombre.
 *
 * Orden de prioridad:
 * 1) Overrides locales (Perú / variantes ortográficas frecuentes)
 * 2) Dataset español de `gender-detection-from-name` (~9.9k nombres; solo names/es.js ≈262KB)
 * 3) Heurística conservadora: termina en "a" → F, termina en "o" → M (con excepciones)
 *
 * Sigue siendo sugerencia editable en el POS; si no hay confianza → null.
 */

import esNames from 'gender-detection-from-name/names/es.js';

/** Normaliza: minúsculas, sin tildes (el dataset ES no usa acentos). */
function normalizarClave(raw) {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-zñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokensNombre(nombresCompletos) {
  return normalizarClave(nombresCompletos).split(' ').filter(Boolean);
}

/** Primer token: "maria esperanza" → "maria". */
export function extraerPrimerNombre(nombresCompletos) {
  return tokensNombre(nombresCompletos)[0] || '';
}

/**
 * Overrides Perú / latam. Prioridad sobre el dataset ES
 * (p.ej. Andrea en ES = male; en Perú casi siempre female).
 */
const OVERRIDES_PE = new Map([
  // Ortografías / anglicismos frecuentes en Perú
  ['jhon', 'male'],
  ['jhony', 'male'],
  ['jhonny', 'male'],
  ['jhonatan', 'male'],
  ['jonatan', 'male'],
  ['cristhofer', 'male'],
  ['crhistofer', 'male'],
  ['cristopher', 'male'],
  ['brayan', 'male'],
  ['braian', 'male'],
  ['bryan', 'male'],
  ['kelvin', 'male'],
  ['lenin', 'male'],
  ['stiven', 'male'],
  ['yeison', 'male'],
  ['yeferson', 'male'],
  ['jeferson', 'male'],
  ['anderson', 'male'],
  ['piero', 'male'],
  ['giancarlo', 'male'],
  ['gianfranco', 'male'],
  ['gianmarco', 'male'],
  ['alessandro', 'male'],
  // Femeninos latam / Perú
  ['gianella', 'female'],
  ['giannina', 'female'],
  ['brigith', 'female'],
  ['briggith', 'female'],
  ['melany', 'female'],
  ['melani', 'female'],
  ['sheyla', 'female'],
  ['yulissa', 'female'],
  ['yulisa', 'female'],
  ['yuliza', 'female'],
  ['yadira', 'female'],
  ['xiomara', 'female'],
  ['kiara', 'female'],
  ['keyla', 'female'],
  ['keila', 'female'],
  ['katerin', 'female'],
  ['katerine', 'female'],
  ['estefany', 'female'],
  ['stefany', 'female'],
  ['lizeth', 'female'],
  ['lizet', 'female'],
  ['nayeli', 'female'],
  ['nayelli', 'female'],
  ['yenifer', 'female'],
  ['jenifer', 'female'],
  ['jackelin', 'female'],
  ['joselyn', 'female'],
  ['yoselin', 'female'],
  ['yosselin', 'female'],
  ['ashly', 'female'],
  ['fiorella', 'female'],
  ['fiorela', 'female'],
  ['pierina', 'female'],
  ['luzmila', 'female'],
  ['luzmarina', 'female'],
  // Dataset ES marca Andrea como male (España/IT); en Perú casi siempre F
  ['andrea', 'female'],
]);

/** Masculinos que terminan en "a" — la heurística no debe marcarlos F. */
const MALE_TERMINA_A = new Set([
  'josua', 'joshua', 'elia', 'tobia', 'tobias', 'neemia', 'barnaba',
  'judas', 'luca', 'lucca', 'nicola', 'attila', 'ezra',
]);

/** Femeninos que terminan en "o" — la heurística no debe marcarlos M. */
const FEMALE_TERMINA_O = new Set([
  'consuelo', 'amparo', 'socorro', 'rocio', 'rosario',
]);

function mapLibASexo(valor) {
  if (valor === 'male') return 'M';
  if (valor === 'female') return 'F';
  return null;
}

function lookupDataset(clave) {
  if (!clave) return null;
  if (OVERRIDES_PE.has(clave)) return mapLibASexo(OVERRIDES_PE.get(clave));
  const fromEs = typeof esNames?.get === 'function' ? esNames.get(clave) : null;
  return mapLibASexo(fromEs);
}

/**
 * Último recurso. Conservadora: no adivina Carmen/Isabel/Raquel (consonante).
 */
function heuristicaPorTerminacion(clave) {
  if (!clave || clave.length < 3 || clave.includes(' ')) return null;
  if (MALE_TERMINA_A.has(clave)) return 'M';
  if (FEMALE_TERMINA_O.has(clave)) return 'F';
  if (clave.endsWith('a')) return 'F';
  if (clave.endsWith('o')) return 'M';
  return null;
}

/**
 * @param {string} nombresCompletos — p.ej. "MARIA ESPERANZA" o "JOSE LUIS"
 * @returns {'M'|'F'|null}
 */
export function sugerirSexoPorNombre(nombresCompletos) {
  const parts = tokensNombre(nombresCompletos);
  if (parts.length === 0) return null;

  // Compuesto de 2 tokens si el dataset lo tiene ("jose luis", "maria jose")
  if (parts.length >= 2) {
    const hitCompound = lookupDataset(`${parts[0]} ${parts[1]}`);
    if (hitCompound) return hitCompound;
  }

  const primero = parts[0];
  const hit = lookupDataset(primero);
  if (hit) return hit;

  return heuristicaPorTerminacion(primero);
}

/**
 * @returns {{ sexo: 'M'|'F'|'', sugerido: boolean }}
 */
export function resolverSexoAutofill(nombresCompletos, sexoConocido) {
  const known = String(sexoConocido || '').trim().toUpperCase();
  if (known === 'M' || known === 'F') {
    return { sexo: known, sugerido: false };
  }
  const sugerido = sugerirSexoPorNombre(nombresCompletos);
  if (sugerido) return { sexo: sugerido, sugerido: true };
  return { sexo: '', sugerido: false };
}

/** Solo para diagnóstico / tests. */
export function coberturaDatasetEs() {
  return typeof esNames?.size === 'number' ? esNames.size : 0;
}
