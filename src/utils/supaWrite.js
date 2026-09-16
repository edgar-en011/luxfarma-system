/**
 * Verifica escrituras de Supabase. Un UPDATE/DELETE filtrado que no toca filas
 * (RLS, id incorrecto, ya aplicado) suele devolver { error: null, data: [] }
 * — sin esto la UI puede mostrar éxito falso.
 */
export function filasAfectadas(data) {
  if (data == null) return 0;
  return Array.isArray(data) ? data.length : 1;
}

export function assertEscritura(data, error, mensaje = 'La operación no afectó ninguna fila en la base de datos.') {
  if (error) throw error;
  if (filasAfectadas(data) < 1) throw new Error(mensaje);
  return data;
}

/** Variante que retorna { ok, error } en vez de throw (utils compartidos). */
export function resultadoEscritura(data, error, mensaje = 'La operación no afectó ninguna fila en la base de datos.') {
  if (error) return { ok: false, error };
  if (filasAfectadas(data) < 1) return { ok: false, error: new Error(mensaje) };
  return { ok: true, data };
}
