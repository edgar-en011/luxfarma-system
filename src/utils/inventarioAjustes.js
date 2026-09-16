import { supabase } from '../supabaseClient';
import { resultadoEscritura } from './supaWrite';

// Aplica el ajuste de stock de un conteo de inventario: busca (o crea) el lote VIGENTE
// del producto en la sucursal, le suma la diferencia, registra el movimiento en el
// Kardex y marca el conteo como aprobado. Compartida entre AdminTomaInventario.jsx
// (revisión de conteos de otros usuarios) y TomaInventario.jsx (autoaplicación del Admin
// sobre sus propios conteos) para no duplicar la lógica de escritura.
export async function aplicarAjusteInventario({ conteo, idSucursal, idUsuario }) {
  try {
    const { data: lotesExistentes, error: errLotes } = await supabase
      .from('inventario_lotes')
      .select('id_lote, cantidad_actual')
      .eq('id_producto', conteo.id_producto)
      .eq('id_sucursal', idSucursal)
      .eq('estado', 'VIGENTE')
      .not('nro_lote', 'ilike', 'AJUSTE-INV-%')
      .order('cantidad_actual', { ascending: false })
      .limit(1);
    if (errLotes) return { ok: false, error: errLotes };

    if (lotesExistentes && lotesExistentes.length > 0) {
      const lote = lotesExistentes[0];
      const nuevaCantidad = Number(lote.cantidad_actual) + Number(conteo.diferencia);
      const { data, error } = await supabase
        .from('inventario_lotes')
        .update({ cantidad_actual: Math.max(0, nuevaCantidad) })
        .eq('id_lote', lote.id_lote)
        .select('id_lote');
      const r = resultadoEscritura(data, error, `No se actualizó el lote #${lote.id_lote} al aplicar el ajuste.`);
      if (!r.ok) return r;
    } else {
      const nroLote = `AJUSTE-INV-${Date.now()}`;
      const { data, error } = await supabase.from('inventario_lotes').insert({
        id_sucursal: idSucursal,
        id_producto: conteo.id_producto,
        nro_lote: nroLote,
        cantidad_actual: Math.max(0, conteo.diferencia),
        costo_unitario_lote: 0,
        fecha_vencimiento: '2099-12-31',
        estado: 'VIGENTE'
      }).select('id_lote');
      const r = resultadoEscritura(data, error, 'No se pudo crear el lote de ajuste de inventario.');
      if (!r.ok) return r;
    }

    const { data: kardexData, error: errKardex } = await supabase.from('kardex_movimientos').insert({
      id_sucursal: idSucursal,
      id_producto: conteo.id_producto,
      tipo: 'AJUSTE',
      cantidad: Math.abs(conteo.diferencia),
      saldo: conteo.cantidad_fisica,
      id_lote: `AJUSTE-INV-${Date.now()}`,
      id_usuario: idUsuario,
    }).select();
    {
      const r = resultadoEscritura(kardexData, errKardex, 'No se registró el movimiento de kardex del ajuste.');
      if (!r.ok) return r;
    }

    const { data: conteoData, error: errConteo } = await supabase
      .from('inventario_conteos')
      .update({ aprobado: true })
      .eq('id_conteo', conteo.id_conteo)
      .select('id_conteo');
    {
      const r = resultadoEscritura(conteoData, errConteo, `No se marcó como aprobado el conteo #${conteo.id_conteo}.`);
      if (!r.ok) return r;
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

// Cierra una sesión de inventario (estado + fecha_cierre). Compartida entre
// AdminTomaInventario.jsx (cierre desde la pantalla de administración de sesiones) y
// TomaInventario.jsx (cierre desde "Conteo Físico" sin salir de esa pantalla).
// Importante: exigir .select() — un UPDATE con 0 filas (id inválido / ya cerrada /
// filtro RLS) en Supabase NO lanza error; sin verificar data se reportaba OK falso.
export async function cerrarSesionInventario(idSesion) {
  if (idSesion == null || idSesion === '') {
    return { ok: false, error: new Error('id_sesion inválido') };
  }
  try {
    const { data, error } = await supabase
      .from('inventario_sesiones')
      .update({ estado: 'CERRADA', fecha_cierre: new Date().toISOString() })
      .eq('id_sesion', idSesion)
      .select('id_sesion, estado, fecha_cierre')
      .maybeSingle();
    if (error) return { ok: false, error };
    if (data?.estado === 'CERRADA') return { ok: true, sesion: data };

    // Idempotente: si ya estaba cerrada, cuenta como éxito.
    const { data: actual, error: errActual } = await supabase
      .from('inventario_sesiones')
      .select('id_sesion, estado, fecha_cierre')
      .eq('id_sesion', idSesion)
      .maybeSingle();
    if (errActual) return { ok: false, error: errActual };
    if (actual?.estado === 'CERRADA') return { ok: true, yaCerrada: true, sesion: actual };

    return {
      ok: false,
      error: new Error(`No se cerró la sesión #${idSesion} (estado actual: ${actual?.estado || 'desconocido'})`),
    };
  } catch (error) {
    return { ok: false, error };
  }
}
