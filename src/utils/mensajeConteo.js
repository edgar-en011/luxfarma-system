import { supabase } from '../supabaseClient';

// Mensaje de conteo enriquecido con Kardex: en vez de solo mirar el signo de la
// diferencia, busca si hubo un movimiento reciente (ENTRADA/SALIDA, sin contar AJUSTEs
// de conteos previos) que la explique, y avisa cuando NO hay nada que la respalde.
// Compartido entre TomaInventario.jsx (Vendedor/Admin contando) y
// AdminTomaInventario.jsx ("Detalle de conteos") para no duplicar la lógica.
export const VENTANA_KARDEX_MS = 48 * 60 * 60 * 1000; // 48 horas hacia atrás

// Batch: consulta kardex_movimientos para varios productos a la vez dentro de la
// ventana, y fusiona el resultado (vía setKardexRecienteMap) en un mapa
// { [id_producto]: { tieneEntrada, tieneSalida } }.
export async function cargarKardexReciente(ids, idSucursal, setKardexRecienteMap) {
  if (!ids || ids.length === 0 || !idSucursal) return;
  const desde = new Date(Date.now() - VENTANA_KARDEX_MS).toISOString();
  const { data } = await supabase
    .from('kardex_movimientos')
    .select('id_producto, tipo, created_at')
    .eq('id_sucursal', idSucursal)
    .in('id_producto', ids)
    .in('tipo', ['ENTRADA', 'SALIDA'])
    .gte('created_at', desde);

  const nuevoMapa = {};
  ids.forEach(id => { nuevoMapa[id] = { tieneEntrada: false, tieneSalida: false }; });
  (data || []).forEach(m => {
    if (!nuevoMapa[m.id_producto]) nuevoMapa[m.id_producto] = { tieneEntrada: false, tieneSalida: false };
    if (m.tipo === 'ENTRADA') nuevoMapa[m.id_producto].tieneEntrada = true;
    if (m.tipo === 'SALIDA') nuevoMapa[m.id_producto].tieneSalida = true;
  });
  setKardexRecienteMap(prev => ({ ...prev, ...nuevoMapa }));
}

// Traduce una diferencia (y lo que se sabe de Kardex para ese producto) al mensaje final.
export function calcularMensajeConteo(diferencia, idProducto, kardexRecienteMap) {
  if (diferencia === 0) return { texto: 'Sin Movimiento', alerta: false };
  const info = kardexRecienteMap[idProducto];
  if (diferencia > 0) {
    return info?.tieneEntrada
      ? { texto: 'Ingreso — coincide con entrada reciente', alerta: false }
      : { texto: 'Ingreso — sin movimiento registrado, revisar', alerta: true };
  }
  return info?.tieneSalida
    ? { texto: 'Salida — coincide con movimiento reciente', alerta: false }
    : { texto: 'Salida — sin movimiento registrado, revisar', alerta: true };
}
