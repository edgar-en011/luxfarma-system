function normalizar(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cantidad(valor) {
  return Number(valor || 0).toLocaleString('es-PE', { maximumFractionDigits: 6 });
}

function alcance(resumen) {
  return resumen?.metadata?.alcance || 'el alcance seleccionado';
}

function notaLimite(lista, total) {
  const faltan = Math.max(0, Number(total || 0) - (lista?.length || 0));
  return faltan > 0 ? `\n\nEl resumen muestra los primeros ${lista.length}; existen ${faltan} registro(s) adicionales.` : '';
}

function respuestaStockBajo(resumen) {
  const items = resumen.stockBajo || [];
  const total = resumen.totales?.stockBajo || 0;
  if (items.length === 0) return `No hay productos con stock bajo analizables en ${alcance(resumen)}.`;
  const filas = items.map((item, indice) => (
    `${indice + 1}. **${item.nombre}** — ${cantidad(item.stockBase)} disponibles; mínimo ${cantidad(item.umbralBase)}${item.sucursal ? `; ${item.sucursal}` : ''}.`
  ));
  return `Hay ${cantidad(total)} registro(s) con stock bajo en ${alcance(resumen)}:\n\n${filas.join('\n')}${notaLimite(items, total)}`;
}

function respuestaReposicion(resumen) {
  const items = resumen.reposicion || [];
  const total = resumen.totales?.recomendacionesReposicion || 0;
  if (items.length === 0) return `No hay reposiciones sugeridas con los datos registrados en ${alcance(resumen)}.`;
  const filas = items.map((item, indice) => (
    `${indice + 1}. **${item.nombre}** — ${item.prioridad || 'Atención'}; disponible ${cantidad(item.stockBase)}; brecha al mínimo ${cantidad(item.brechaMinimoBase)}${item.sucursal ? `; ${item.sucursal}` : ''}.`
  ));
  return `Prioridad de reposición en ${alcance(resumen)}:\n\n${filas.join('\n')}${notaLimite(items, total)}\n\nLa recomendación es informativa y no genera pedidos automáticamente.`;
}

function respuestaVencimientos(resumen) {
  const items = resumen.proximosVencer || [];
  const total = resumen.totales?.lotesProximosVencer || 0;
  if (items.length === 0) return `No hay lotes próximos a vencer registrados en ${alcance(resumen)}.`;
  const filas = items.map((item, indice) => (
    `${indice + 1}. **${item.nombre}** — lote ${item.numeroLote || 'sin número'}; vence ${item.fechaVencimientoTexto || item.fechaVencimiento}; ${cantidad(item.stockBase)} unidades${item.sucursal ? `; ${item.sucursal}` : ''}.`
  ));
  return `Hay ${cantidad(total)} lote(s) próximos a vencer en ${alcance(resumen)}:\n\n${filas.join('\n')}${notaLimite(items, total)}`;
}

function respuestaMovimiento(resumen) {
  const items = resumen.mayorMovimiento || [];
  const total = resumen.totales?.conMovimiento || 0;
  if (items.length === 0) return `No hay ventas analizables en el período para ${alcance(resumen)}.`;
  const filas = items.map((item, indice) => (
    `${indice + 1}. **${item.nombre}** — ${cantidad(item.unidadesVendidas)} unidades base vendidas; ${cantidad(item.stockBase)} disponibles.`
  ));
  return `Productos con mayor movimiento en ${alcance(resumen)}:\n\n${filas.join('\n')}${notaLimite(items, total)}`;
}

function respuestaBajaRotacion(resumen) {
  const items = resumen.bajaRotacion || [];
  const total = resumen.totales?.bajaRotacion || 0;
  if (items.length === 0) return `No hay productos con baja rotación analizables en ${alcance(resumen)}.`;
  const filas = items.map((item, indice) => (
    `${indice + 1}. **${item.nombre}** — ${cantidad(item.stockBase)} unidades disponibles y sin ventas en ${cantidad(item.diasSinVentas)} días.`
  ));
  return `Hay ${cantidad(total)} producto(s) con baja rotación en ${alcance(resumen)}:\n\n${filas.join('\n')}${notaLimite(items, total)}`;
}

function respuestaRevision(resumen) {
  const totales = resumen.totales || {};
  const lineas = [
    `- Stock bajo: **${cantidad(totales.stockBajo)}** registro(s).`,
    `- Próximos a vencer: **${cantidad(totales.lotesProximosVencer)}** lote(s).`,
    `- Baja rotación: **${cantidad(totales.bajaRotacion)}** producto(s).`,
  ];
  const primeroReposicion = resumen.reposicion?.[0];
  const primeroVencer = resumen.proximosVencer?.[0];
  if (primeroReposicion) lineas.push(`- Primera reposición a revisar: **${primeroReposicion.nombre}** (${primeroReposicion.prioridad || 'Atención'}).`);
  if (primeroVencer) lineas.push(`- Vencimiento más cercano: **${primeroVencer.nombre}**, lote ${primeroVencer.numeroLote || 'sin número'}, ${primeroVencer.fechaVencimientoTexto || primeroVencer.fechaVencimiento}.`);
  return `Prioridades verificadas para esta semana en ${alcance(resumen)}:\n\n${lineas.join('\n')}`;
}

export function responderResumenDeterministico(pregunta, resumen) {
  if (!resumen) return null;
  const texto = normalizar(pregunta);
  const totales = resumen.totales || {};
  const sinInventario = Number(totales.productosAnalizados || 0) > 0
    && totales.productosConStock != null
    && Number(totales.productosConStock || 0) === 0;
  if (sinInventario && /\brepon|\breabaste|\bpedido|\bvenc|\bcaduc|\bstock bajo\b|\bpoco stock\b|\bmenos stock\b|\bmovimiento\b|\bvendid|\brotacion\b|\bsin ventas\b|\bque deberia revisar\b/.test(texto)) {
    return `No puedo calcular esa prioridad todavía: el catálogo contiene ${cantidad(totales.productosAnalizados)} productos, pero no hay productos con stock disponible registrados en ${alcance(resumen)}. Primero registra o sincroniza los lotes; no estimaré cantidades inexistentes.`;
  }
  if (/\bque deberia revisar\b|\bprioridades? (?:de|para) esta semana\b/.test(texto)) return respuestaRevision(resumen);
  if (/\brepon|\breabaste|\bpedido/.test(texto)) return respuestaReposicion(resumen);
  if (/\bvenc|\bcaduc/.test(texto)) return respuestaVencimientos(resumen);
  if (/\bstock bajo\b|\bpoco stock\b|\bmenos stock\b/.test(texto)) return respuestaStockBajo(resumen);
  if (/\bmayor movimiento\b|\bmas vendid|\bmayores ventas\b/.test(texto)) return respuestaMovimiento(resumen);
  if (/\bbaja rotacion\b|\bsin ventas\b/.test(texto)) return respuestaBajaRotacion(resumen);
  return null;
}

