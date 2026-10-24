export const MENSAJE_FUERA_DE_ALCANCE = 'Solo puedo responder preguntas sobre inventario, stock, vencimientos, rotación, ventas y reposición usando el resumen de LuxFarma. Reformula tu consulta dentro de esos temas.';

export const MENSAJE_CONSULTA_CLINICA = 'No puedo dar diagnósticos, dosis ni tratamientos médicos. Este asistente solo analiza información operativa de inventario y ventas de LuxFarma.';

const TERMINOS_OPERATIVOS = [
  'stock', 'inventari', 'lote', 'venc', 'caduc', 'rotaci', 'movim',
  'repos', 'repon', 'reabaste', 'pedido', 'compra', 'venta', 'vendid', 'producto',
  'medicamento', 'farmac', 'botica', 'unidad', 'caja', 'blister', 'frasco',
  'sucursal', 'sede', 'minimo', 'agot', 'faltante', 'demanda', 'prioridad',
  'proveedor', 'precio', 'costo', 'margen', 'ganancia', 'resumen', 'analisis',
  'revis', 'recomend',
];

const PATRONES_CLINICOS = [
  /\bdiagnostic/, /\bdosis\b/, /dosificacion/, /\btratamiento\b/, /\breceta\b/,
  /\bsintoma/, /\benfermedad/, /contraindic/, /interaccion medic/, /efecto secundario/,
  /\bque (?:debo|puedo) tomar\b/, /\bcomo (?:curar|tratar)\b/, /\bembarazad/,
];

const PATRONES_MANIPULACION = [
  /ignora.{0,30}(?:instruccion|regla|sistema)/,
  /(?:muestra|revela|dime).{0,30}(?:prompt|instruccion|clave|contrasena|api key|token)/,
  /\bactua como\b/,
  /\bsystem prompt\b/,
  /\bmodo desarrollador\b/,
];

const PATRONES_AJENOS = [
  /\bchiste\b/, /\bpoema\b/, /\bcancion\b/, /\bcuento\b/, /\bhistoria ficticia\b/,
  /\bfutbol\b/, /\bpartido\b/, /\bpelicula\b/, /\bpolitica\b/, /\bclima\b/,
  /\bprograma(?:r|cion)?\b/, /\bcodigo fuente\b/, /\bcriptomoneda\b/,
];

function normalizar(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nombresDelResumen(resumen) {
  const categorias = [
    'stockBajo', 'proximosVencer', 'bajaRotacion', 'mayorMovimiento', 'reposicion',
    'stock_bajo', 'proximos_a_vencer', 'baja_rotacion', 'mayor_movimiento',
  ];
  return categorias.flatMap((categoria) => (
    Array.isArray(resumen?.[categoria]) ? resumen[categoria] : []
  )).map((item) => normalizar(item?.nombre)).filter(Boolean);
}

function mencionaProductoDelResumen(pregunta, resumen) {
  const tokensPregunta = new Set(pregunta.split(' ').filter((token) => token.length >= 4));
  return nombresDelResumen(resumen).some((nombre) => (
    nombre.length >= 4 && (pregunta.includes(nombre)
      || nombre.split(' ').some((token) => token.length >= 4 && tokensPregunta.has(token)))
  ));
}

export function evaluarPreguntaAsistente(pregunta, resumen) {
  const texto = normalizar(pregunta);
  if (!texto) return { permitida: false, motivo: 'vacia', mensaje: MENSAJE_FUERA_DE_ALCANCE };
  if (PATRONES_MANIPULACION.some((patron) => patron.test(texto))) {
    return { permitida: false, motivo: 'manipulacion', mensaje: MENSAJE_FUERA_DE_ALCANCE };
  }
  if (PATRONES_CLINICOS.some((patron) => patron.test(texto))) {
    return { permitida: false, motivo: 'clinica', mensaje: MENSAJE_CONSULTA_CLINICA };
  }
  if (PATRONES_AJENOS.some((patron) => patron.test(texto))) {
    return { permitida: false, motivo: 'fuera_de_alcance', mensaje: MENSAJE_FUERA_DE_ALCANCE };
  }
  const operativa = TERMINOS_OPERATIVOS.some((termino) => texto.includes(termino));
  if (operativa || mencionaProductoDelResumen(texto, resumen)) {
    return { permitida: true, motivo: 'operativa' };
  }
  return { permitida: false, motivo: 'fuera_de_alcance', mensaje: MENSAJE_FUERA_DE_ALCANCE };
}

