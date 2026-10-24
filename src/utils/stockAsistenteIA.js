import { formatearEquivalenciaStock } from './equivalenciaStock.js';
import { fechaLocalStr } from './fechas.js';

const PALABRAS_VACIAS = new Set([
  'a', 'actual', 'actualmente', 'al', 'cual', 'cuales', 'cuanto', 'cuantos',
  'de', 'del', 'dime', 'disponible', 'disponibles', 'el', 'en', 'es', 'esta',
  'existencia', 'existencias', 'hay', 'la', 'las', 'los', 'medicamento',
  'medicamentos', 'me', 'producto', 'productos', 'que', 'queda', 'quedan',
  'stock', 'tenemos', 'tiene', 'total', 'unidades', 'y',
]);

export function normalizarTextoStock(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokensRelevantes(valor) {
  return normalizarTextoStock(valor)
    .split(' ')
    .filter((token) => token && !PALABRAS_VACIAS.has(token));
}

export function esConsultaStockActual(pregunta) {
  const texto = normalizarTextoStock(pregunta);
  if (/\bstock bajo\b|\bpoco stock\b|\bmenos stock\b|\bvenc|\brotacion\b/.test(texto)) return false;
  return /\bstock\b|\bexistencias?\b|\bdisponibilidad\b|\bcantidad disponible\b|\bcuant\w* (?:hay|queda|quedan|tenemos)\b|\b(?:hay|queda|quedan|tenemos) cuant\w*\b|^hay\b/.test(texto);
}

function puntuarProducto(pregunta, tokensPregunta, producto) {
  const nombre = normalizarTextoStock(producto?.descripcion);
  const codigo = normalizarTextoStock(producto?.codigo_barras).replaceAll(' ', '');
  const preguntaCompacta = pregunta.replaceAll(' ', '');
  if (codigo && preguntaCompacta.includes(codigo)) return 10_000 + codigo.length;
  if (nombre && pregunta.includes(nombre)) return 5_000 + nombre.length;

  const tokensNombre = nombre.split(' ').filter(Boolean);
  const coincidencias = tokensPregunta.filter((token) => tokensNombre.some((parte) => (
    parte === token || (token.length >= 4 && parte.startsWith(token))
  )));
  if (coincidencias.length === 0) return 0;
  const cobertura = coincidencias.length / tokensPregunta.length;
  if (cobertura < 0.6) return 0;
  return Math.round(cobertura * 1_000) + coincidencias.length * 100 - tokensNombre.length;
}

export function buscarProductosParaStock(pregunta, productos, limite = 5) {
  const texto = normalizarTextoStock(pregunta);
  const tokens = [...new Set(tokensRelevantes(texto))];
  if (tokens.length === 0) return [];

  const resultados = (productos || [])
    .map((producto) => ({ producto, puntaje: puntuarProducto(texto, tokens, producto) }))
    .filter((item) => item.puntaje > 0)
    .sort((a, b) => b.puntaje - a.puntaje
      || String(a.producto.descripcion || '').localeCompare(String(b.producto.descripcion || ''), 'es'));
  if (resultados.length === 0) return [];

  const mejor = resultados[0].puntaje;
  const margen = mejor >= 5_000 ? 0 : 120;
  return resultados
    .filter((item) => item.puntaje >= mejor - margen)
    .slice(0, Math.max(1, limite))
    .map((item) => item.producto);
}

function numero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

function cantidadTexto(valor) {
  return numero(valor).toLocaleString('es-PE', { maximumFractionDigits: 6 });
}

function estadoEfectivoLote(lote, fechaReferencia) {
  const fecha = String(lote?.fecha_vencimiento || '').slice(0, 10);
  if (lote?.estado === 'VENCIDO' || (fecha && fecha < fechaLocalStr(fechaReferencia))) return 'VENCIDO';
  return lote?.estado;
}

export function construirDetallesStock(productos, lotes, sucursales, idSucursal = 'TODAS', fechaReferencia = new Date()) {
  const nombresSucursal = new Map((sucursales || []).map((sucursal) => [
    Number(sucursal.id_sucursal),
    sucursal.nombre_comercial || `Sede ${sucursal.id_sucursal}`,
  ]));
  const todas = idSucursal == null || idSucursal === '' || idSucursal === 'TODAS';

  return (productos || []).map((producto) => {
    const lotesProducto = (lotes || []).filter((lote) => (
      Number(lote.id_producto) === Number(producto.id_producto)
      && (todas || Number(lote.id_sucursal) === Number(idSucursal))
    ));
    const disponible = Math.max(0, lotesProducto
      .filter((lote) => estadoEfectivoLote(lote, fechaReferencia) === 'VIGENTE')
      .reduce((total, lote) => total + numero(lote.cantidad_actual), 0));
    const vencido = Math.max(0, lotesProducto
      .filter((lote) => estadoEfectivoLote(lote, fechaReferencia) === 'VENCIDO')
      .reduce((total, lote) => total + numero(lote.cantidad_actual), 0));

    const porSucursal = new Map();
    for (const lote of lotesProducto) {
      const estado = estadoEfectivoLote(lote, fechaReferencia);
      if (!['VIGENTE', 'VENCIDO'].includes(estado)) continue;
      const id = Number(lote.id_sucursal);
      const actual = porSucursal.get(id) || { idSucursal: id, disponible: 0, vencido: 0 };
      if (estado === 'VIGENTE') actual.disponible += numero(lote.cantidad_actual);
      if (estado === 'VENCIDO') actual.vencido += numero(lote.cantidad_actual);
      porSucursal.set(id, actual);
    }

    return {
      idProducto: Number(producto.id_producto),
      nombre: producto.descripcion,
      codigo: producto.codigo_barras || null,
      disponible,
      vencido,
      fisico: disponible + vencido,
      equivalenciaDisponible: formatearEquivalenciaStock(disponible, producto.producto_formas_venta || []),
      lotesRegistrados: lotesProducto.length,
      porSucursal: [...porSucursal.values()].map((item) => ({
        ...item,
        nombre: nombresSucursal.get(item.idSucursal) || `Sede ${item.idSucursal}`,
      })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    };
  });
}

export function respuestaStockExacto(detalles, alcance = 'Todas las sedes') {
  if (!detalles?.length) {
    return 'No encontré un producto que coincida con la consulta. Escribe el nombre completo o su código de barras.';
  }

  const introduccion = detalles.length > 1
    ? `Encontré ${detalles.length} coincidencias. Estos son los valores registrados en ${alcance}:`
    : `Stock registrado en ${alcance}:`;
  const bloques = detalles.map((item) => {
    const lineas = [
      `**${item.nombre}**${item.codigo ? ` (${item.codigo})` : ''}`,
      `- Disponible para venta: **${cantidadTexto(item.disponible)} unidades base**`,
      `- Vencido/no vendible: **${cantidadTexto(item.vencido)} unidades base**`,
      `- Stock físico registrado: **${cantidadTexto(item.fisico)} unidades base**`,
    ];
    if (item.equivalenciaDisponible) lineas.push(`- Equivalencia disponible: ${item.equivalenciaDisponible}`);
    if (item.porSucursal.length > 1) {
      lineas.push(`- Por sede: ${item.porSucursal.map((sede) => (
        `${sede.nombre}: ${cantidadTexto(sede.disponible)} disponible${sede.vencido > 0 ? ` + ${cantidadTexto(sede.vencido)} vencido` : ''}`
      )).join('; ')}`);
    }
    if (item.lotesRegistrados === 0) lineas.push('- No existen lotes registrados para este producto en el alcance elegido.');
    return lineas.join('\n');
  });

  return `${introduccion}\n\n${bloques.join('\n\n')}\n\nEl stock disponible cuenta solo lotes VIGENTE y no vencidos por fecha; el vencido se muestra por separado.`;
}

