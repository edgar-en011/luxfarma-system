import { supabase } from '../supabaseClient';

// numero_correlativo independiente por tipo (INGRESO/SALIDA) — mismo patrón manual
// max(id)+1 que ya usa todo el sistema (productos, laboratorios, pedidos_proveedor),
// filtrado por tipo. El UNIQUE(tipo, numero_correlativo) de la tabla blinda una
// colisión si dos admins guardan al mismo tiempo (el insert fallaría y el usuario
// reintentaría, igual que el resto de los usos de este patrón en el sistema).
export async function obtenerSiguienteCorrelativo(tipo) {
  const { data } = await supabase
    .from('notas_inventario')
    .select('numero_correlativo')
    .eq('tipo', tipo)
    .order('numero_correlativo', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.numero_correlativo || 0) + 1;
}

// Suma el stock VIGENTE de un producto en una sucursal — usado para mostrar
// Stock Actual → Nuevo Stock en vivo y para bloquear una Salida que exceda lo
// disponible antes de intentar descontar nada.
export async function obtenerStockDisponible(idProducto, idSucursal) {
  const { data } = await supabase
    .from('inventario_lotes')
    .select('cantidad_actual')
    .eq('id_producto', idProducto)
    .eq('id_sucursal', idSucursal)
    .eq('estado', 'VIGENTE');
  return (data || []).reduce((acc, l) => acc + Number(l.cantidad_actual || 0), 0);
}

// Nota de INGRESO: crea un lote NUEVO real (con su propio nro_lote/vencimiento/costo)
// + kardex ENTRADA — mismo patrón que usa AdminCompras.jsx al recibir mercadería de un
// proveedor (a diferencia de inventarioAjustes.js, que fusiona todo en un único lote
// genérico "AJUSTE-INV-*" pensado para conteo físico, no para mercadería real con lote
// y vencimiento propios).
async function aplicarIngreso(nota) {
  const { error: errorLote } = await supabase.from('inventario_lotes').insert({
    id_sucursal: nota.id_sucursal,
    id_producto: nota.id_producto,
    nro_lote: nota.nro_lote || `NOTA-ING-${nota.numero_correlativo}`,
    cantidad_actual: nota.cantidad,
    costo_unitario_lote: nota.costo_unitario,
    fecha_vencimiento: nota.tiene_vencimiento ? nota.fecha_vencimiento : '2099-12-31',
    estado: 'VIGENTE',
  });
  if (errorLote) throw errorLote;

  // Saldo = stock TOTAL del producto en la sucursal después del movimiento (mismo
  // criterio que ya usan ProductoFormModal.jsx e inventarioAjustes.js) — sin esto, el
  // insert caía en el default de la columna (0), porque el lote "NOTA-ING-*" es solo una
  // etiqueta de referencia en el Kardex, no un lote real que arrastre su propio saldo.
  const saldoFinal = await obtenerStockDisponible(nota.id_producto, nota.id_sucursal);

  const { error: errorKardex } = await supabase.from('kardex_movimientos').insert({
    id_sucursal: nota.id_sucursal,
    id_producto: nota.id_producto,
    tipo: 'ENTRADA',
    cantidad: nota.cantidad,
    saldo: saldoFinal,
    id_lote: `NOTA-ING-${nota.numero_correlativo}`,
    id_usuario: nota.id_usuario_registro,
    observacion: `Nota de Ingreso #${nota.numero_correlativo}${nota.motivo ? ': ' + nota.motivo : ''}`,
  });
  if (errorKardex) throw errorKardex;
}

// Descuenta un lote concreto (p. ej. retiro de producto VENCIDO desde Alertas).
// No usa FEFO ni filtra por VIGENTE — opera sobre el id_lote indicado.
async function aplicarSalidaLoteEspecifico(nota) {
  const { data: lote, error } = await supabase
    .from('inventario_lotes')
    .select('id_lote, cantidad_actual, estado')
    .eq('id_lote', nota.id_lote_especifico)
    .eq('id_producto', nota.id_producto)
    .eq('id_sucursal', nota.id_sucursal)
    .maybeSingle();
  if (error) throw error;
  if (!lote) throw new Error('No se encontró el lote indicado para retirar.');

  const disponible = Number(lote.cantidad_actual || 0);
  if (nota.cantidad > disponible) {
    throw new Error(`Stock insuficiente en el lote. Disponible: ${disponible}.`);
  }

  const nuevaCantidad = disponible - Number(nota.cantidad);
  // Si queda stock y el lote estaba VENCIDO, se mantiene VENCIDO; si se agota → AGOTADO.
  const nuevoEstado = nuevaCantidad <= 0
    ? 'AGOTADO'
    : (lote.estado === 'VENCIDO' ? 'VENCIDO' : 'VIGENTE');

  const { error: errorUpdate } = await supabase
    .from('inventario_lotes')
    .update({ cantidad_actual: nuevaCantidad, estado: nuevoEstado })
    .eq('id_lote', lote.id_lote);
  if (errorUpdate) throw errorUpdate;

  const saldoFinal = await obtenerStockDisponible(nota.id_producto, nota.id_sucursal);
  const { error: errorKardex } = await supabase.from('kardex_movimientos').insert({
    id_sucursal: nota.id_sucursal,
    id_producto: nota.id_producto,
    tipo: 'SALIDA',
    cantidad: nota.cantidad,
    saldo: saldoFinal,
    id_lote: `NOTA-SAL-${nota.numero_correlativo}`,
    id_usuario: nota.id_usuario_registro,
    observacion: `Nota de Salida #${nota.numero_correlativo}${nota.motivo ? ': ' + nota.motivo : ''} (lote #${lote.id_lote})`,
  });
  if (errorKardex) throw errorKardex;
}

// Nota de SALIDA: descuenta FIFO (por fecha_vencimiento ascendente) entre los lotes
// VIGENTE del producto — mismo patrón que syncEngine.js usa al descontar stock de una
// venta. El caller ya validó con obtenerStockDisponible que alcanza; acá se revalida
// igual (restante > 0 al final) por si el stock cambió entre la validación y el guardado.
//
// Excepción: si viene `id_lote_especifico` (retiro desde Alertas de vencido), descuenta
// SOLO ese lote — ver aplicarSalidaLoteEspecifico. El flujo normal no pasa ese campo.
async function aplicarSalida(nota) {
  if (nota.id_lote_especifico) {
    await aplicarSalidaLoteEspecifico(nota);
    return;
  }

  const { data: lotes, error: errorLotes } = await supabase
    .from('inventario_lotes')
    .select('id_lote, cantidad_actual')
    .eq('id_producto', nota.id_producto)
    .eq('id_sucursal', nota.id_sucursal)
    .eq('estado', 'VIGENTE')
    .gt('cantidad_actual', 0)
    .order('fecha_vencimiento', { ascending: true });
  if (errorLotes) throw errorLotes;

  let restante = nota.cantidad;
  for (const lote of (lotes || [])) {
    if (restante <= 0) break;
    const descontar = Math.min(restante, Number(lote.cantidad_actual));
    const nuevaCantidad = Number(lote.cantidad_actual) - descontar;
    const { error: errorUpdate } = await supabase
      .from('inventario_lotes')
      .update({ cantidad_actual: nuevaCantidad, estado: nuevaCantidad <= 0 ? 'AGOTADO' : 'VIGENTE' })
      .eq('id_lote', lote.id_lote);
    if (errorUpdate) throw errorUpdate;
    restante -= descontar;
  }

  if (restante > 0) {
    throw new Error('Stock insuficiente para completar la salida (el stock cambió justo antes de guardar). Vuelve a intentarlo.');
  }

  // Saldo = stock TOTAL del producto en la sucursal después de descontar (ver mismo
  // comentario en aplicarIngreso) — se calcula DESPUÉS del loop de descuento FIFO, así
  // ya refleja los lotes actualizados.
  const saldoFinal = await obtenerStockDisponible(nota.id_producto, nota.id_sucursal);

  const { error: errorKardex } = await supabase.from('kardex_movimientos').insert({
    id_sucursal: nota.id_sucursal,
    id_producto: nota.id_producto,
    tipo: 'SALIDA',
    cantidad: nota.cantidad,
    saldo: saldoFinal,
    id_lote: `NOTA-SAL-${nota.numero_correlativo}`,
    id_usuario: nota.id_usuario_registro,
    observacion: `Nota de Salida #${nota.numero_correlativo}${nota.motivo ? ': ' + nota.motivo : ''}`,
  });
  if (errorKardex) throw errorKardex;
}

// Punto de entrada único: asigna el correlativo, inserta la nota en notas_inventario y
// aplica el ajuste de stock correspondiente. Si el ajuste de stock falla DESPUÉS de
// insertar la nota (ej. stock insuficiente detectado recién en aplicarSalida), se
// revierte el insert para no dejar una nota "guardada" sin efecto real en stock.
export async function guardarNotaInventario(datos) {
  try {
    // id_lote_especifico es solo control de aplicación de stock (no es columna DB);
    // se persiste el id_lote real en notas_inventario cuando viene de retiro dirigido.
    const { id_lote_especifico, ...datosTabla } = datos;
    const numero_correlativo = await obtenerSiguienteCorrelativo(datos.tipo);
    const payload = {
      ...datosTabla,
      numero_correlativo,
      id_lote: id_lote_especifico ?? datosTabla.id_lote ?? null,
    };

    const { data: notaGuardada, error: errorInsert } = await supabase
      .from('notas_inventario')
      .insert(payload)
      .select()
      .single();
    if (errorInsert) return { ok: false, error: errorInsert };

    try {
      if (datos.tipo === 'INGRESO') {
        await aplicarIngreso({ ...datosTabla, numero_correlativo });
      } else {
        await aplicarSalida({ ...datosTabla, id_lote_especifico, numero_correlativo });
      }
      return { ok: true, nota: notaGuardada };
    } catch (error) {
      await supabase.from('notas_inventario').delete().eq('id_nota', notaGuardada.id_nota);
      return { ok: false, error };
    }
  } catch (error) {
    return { ok: false, error };
  }
}
