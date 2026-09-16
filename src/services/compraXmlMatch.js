export function normalizarTextoMatch(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Match exacto por codigo_proveedor; si no, nombre (sin tildes, case-insensitive, parcial).
 * Varios parciales → sin match automático.
 */
export function emparejarItemXml(item, { codigosMap, productos }) {
  const codigo = item?.codigoProveedor ? String(item.codigoProveedor) : '';
  if (codigo && codigosMap.has(codigo)) {
    const id = codigosMap.get(codigo);
    const prod = productos.find((p) => p.id_producto === id);
    if (prod) return { producto: prod, tipo: 'codigo' };
  }

  const nom = normalizarTextoMatch(item?.descripcion);
  if (!nom) return { producto: null, tipo: null };

  const exactos = productos.filter((p) => normalizarTextoMatch(p.descripcion) === nom);
  if (exactos.length === 1) return { producto: exactos[0], tipo: 'nombre' };

  const parciales = productos.filter((p) => {
    const d = normalizarTextoMatch(p.descripcion);
    return d && (d.includes(nom) || nom.includes(d));
  });
  if (parciales.length === 1) return { producto: parciales[0], tipo: 'nombre' };

  return { producto: null, tipo: null };
}

/** Palabras de presentación/medida que no bastan para sugerir un producto. */
const STOPWORDS_SIMILITUD = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'y', 'e', 'o', 'u', 'en', 'con', 'para', 'por', 'al', 'a',
  'mg', 'ml', 'g', 'gr', 'kg', 'ui', 'iu', 'cc', 'cm', 'oz', 'l',
  'und', 'unid', 'unidad', 'unidades', 'pza', 'pzas',
  'tab', 'tabs', 'tableta', 'tabletas', 'comp', 'comprimido', 'comprimidos',
  'cap', 'caps', 'capsula', 'capsulas',
  'crema', 'gel', 'jarabe', 'gota', 'gotas', 'amp', 'ampolla',
  'ovulo', 'ovulos', 'unguento', 'solucion', 'susp', 'suspension',
  'fco', 'fcox', 'frasco', 'caja', 'blister', 'sob', 'sobre', 'tubo',
  'sh', 'shampoo', 'champu', 'jabon',
  'prot', 'proteccion', 'plus', 'maxi', 'mini', 'new', 'nuevo',
  'x', 'n', 'no', 'num',
]);

export function normalizarTextoSimilitud(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function expandirTokens(norm) {
  const crudos = String(norm || '').split(' ').filter(Boolean);
  const out = [];
  for (const t of crudos) {
    out.push(t);
    const partes = t.split(/(?<=[a-z])(?=\d)|(?<=\d)(?=[a-z])/);
    if (partes.length > 1) {
      for (const p of partes) {
        if (p) out.push(p);
      }
    }
  }
  return [...new Set(out)];
}

function esTokenDebil(t) {
  if (!t || t.length < 2) return true;
  if (STOPWORDS_SIMILITUD.has(t)) return true;
  if (/^\d+$/.test(t)) return true;
  if (/^\d+(ml|mg|g|kg|ui|iu|l|oz|cm)$/.test(t)) return true;
  return false;
}

function esTokenFuerte(t) {
  return !!t && t.length >= 2 && !esTokenDebil(t);
}

function distanciaLevenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  if (a.length > b.length) return distanciaLevenshtein(b, a);
  const fila = new Array(a.length + 1);
  for (let i = 0; i <= a.length; i += 1) fila[i] = i;
  for (let j = 1; j <= b.length; j += 1) {
    let prev = j - 1;
    fila[0] = j;
    for (let i = 1; i <= a.length; i += 1) {
      const tmp = fila[i];
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      fila[i] = Math.min(fila[i] + 1, fila[i - 1] + 1, prev + costo);
      prev = tmp;
    }
  }
  return fila[a.length];
}

function ratioLevenshtein(a, b) {
  const max = Math.max(a.length, b.length);
  if (!max) return 0;
  if (Math.abs(a.length - b.length) / max > 0.72) return 0;
  return 1 - distanciaLevenshtein(a, b) / max;
}

function tokenFuerteCoincide(consulta, tokensProd) {
  for (const p of tokensProd) {
    if (consulta === p) return true;
    if (consulta.length >= 3 && p.length >= 3 && (consulta.includes(p) || p.includes(consulta))) {
      const corto = Math.min(consulta.length, p.length);
      const largo = Math.max(consulta.length, p.length);
      if (corto / largo >= 0.45) return true;
    }
    if (consulta.length >= 4 && p.length >= 4) {
      if (ratioLevenshtein(consulta, p) >= 0.78) return true;
    }
  }
  return false;
}

function analizarNombreSimilitud(texto) {
  const norm = normalizarTextoSimilitud(texto);
  const tokens = expandirTokens(norm);
  return {
    norm,
    tokens,
    fuertes: tokens.filter(esTokenFuerte),
    debiles: tokens.filter((t) => !esTokenFuerte(t) && t.length >= 2),
  };
}

/**
 * Claves del índice invertido: trigramas para tokens largos, token completo
 * para los cortos. Dos tokens que se parecen (igualdad, contención o 1 edición)
 * comparten al menos una clave, así el prefiltro no descarta candidatos reales.
 */
function clavesDeToken(token) {
  if (token.length <= 3) return [token];
  const claves = [];
  for (let i = 0; i + 3 <= token.length; i += 1) claves.push(token.slice(i, i + 3));
  return claves;
}

function agregarEntradaAlIndice(indice, producto) {
  const analisis = analizarNombreSimilitud(producto?.descripcion);
  const pos = indice.entradas.length;
  indice.entradas.push({ producto, ...analisis });
  const claves = new Set();
  for (const token of analisis.fuertes) {
    for (const clave of clavesDeToken(token)) claves.add(clave);
  }
  for (const clave of claves) {
    const lista = indice.porClave.get(clave);
    if (lista) lista.push(pos);
    else indice.porClave.set(clave, [pos]);
  }
}

export function indexarCatalogoParaSimilitud(productos) {
  const indice = { entradas: [], porClave: new Map() };
  for (const producto of productos || []) agregarEntradaAlIndice(indice, producto);
  return indice;
}

/**
 * Construcción por lotes del índice, para no bloquear el hilo principal con
 * catálogos grandes (miles de productos).
 */
export function crearConstructorIndiceSimilitud(productos) {
  const lista = productos || [];
  const indice = { entradas: [], porClave: new Map() };
  let cursor = 0;
  return {
    indice,
    get terminado() {
      return cursor >= lista.length;
    },
    procesarLote(tamano = 500) {
      const fin = Math.min(cursor + tamano, lista.length);
      for (; cursor < fin; cursor += 1) agregarEntradaAlIndice(indice, lista[cursor]);
      return cursor >= lista.length;
    },
  };
}

function resolverIndice(productosOIndice) {
  if (productosOIndice && productosOIndice.porClave instanceof Map) return productosOIndice;
  return indexarCatalogoParaSimilitud(productosOIndice);
}

function candidatosPorPrefiltro(indice, tokensConsulta) {
  const posiciones = new Set();
  for (const token of tokensConsulta) {
    for (const clave of clavesDeToken(token)) {
      const lista = indice.porClave.get(clave);
      if (!lista) continue;
      for (const pos of lista) posiciones.add(pos);
    }
  }
  return posiciones;
}

/**
 * Candidatos por similitud de nombre (no vincula). Exige tokens distintivos
 * en común; no sugiere solo por "shampoo", "375ml", etc.
 */
export function sugerirProductosPorSimilitud(descripcionXml, productosOIndice, opciones = {}) {
  const umbral = opciones.umbral ?? 0.4;
  const max = opciones.max ?? 3;
  const margenParejo = opciones.margenParejo ?? 0.08;
  const consulta = analizarNombreSimilitud(descripcionXml);
  if (!consulta.fuertes.length) return [];

  const indice = resolverIndice(productosOIndice);

  const ranked = [];
  for (const pos of candidatosPorPrefiltro(indice, consulta.fuertes)) {
    const item = indice.entradas[pos];
    const prod = item.producto;
    if (!prod?.id_producto) continue;
    const fuertesProd = item.fuertes || [];
    const coincidencias = consulta.fuertes.filter((t) => tokenFuerteCoincide(t, fuertesProd));
    const lev = ratioLevenshtein(consulta.norm, item.norm || '');
    if (coincidencias.length === 0 && lev < 0.74) continue;

    const cobertura = coincidencias.length / consulta.fuertes.length;
    const union = new Set([...consulta.fuertes, ...fuertesProd]).size || 1;
    const jaccard = coincidencias.length / union;
    const debilHit = consulta.debiles.some((t) => (item.tokens || []).includes(t)) ? 1 : 0;
    let score = cobertura * 0.5 + jaccard * 0.2 + lev * 0.15 + debilHit * 0.15;
    if (coincidencias.length === 0) score = Math.max(score, lev);
    if (score < umbral) continue;
    ranked.push({
      id_producto: prod.id_producto,
      descripcion: prod.descripcion,
      score,
      aciertos: coincidencias.length,
    });
  }

  ranked.sort((a, b) => b.score - a.score || String(a.descripcion).localeCompare(String(b.descripcion)));
  if (!ranked.length) return [];
  const mejor = ranked[0].score;
  const elegidos = [];
  for (const r of ranked) {
    const pareja = r.score >= mejor - margenParejo;
    const variosAciertos = r.aciertos >= 2;
    if (!pareja && !variosAciertos) continue;
    elegidos.push({ id_producto: r.id_producto, descripcion: r.descripcion, score: r.score });
    if (elegidos.length >= max) break;
  }
  return elegidos;
}
