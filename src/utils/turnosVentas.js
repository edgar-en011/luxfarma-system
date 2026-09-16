/** Chip / encabezado: Turno #0042 */
export function labelTurno(idTurno) {
  if (idTurno == null) return 'Sin turno';
  return `Turno #${String(idTurno).padStart(4, '0')}`;
}

export function chipTurno(idTurno) {
  if (idTurno == null) return null;
  return `#${String(idTurno).padStart(4, '0')}`;
}

/** Cantidad de id_turno distintos (ignora null). */
export function contarTurnosUnicos(ventas) {
  const set = new Set();
  for (const v of ventas || []) {
    if (v.id_turno != null) set.add(v.id_turno);
  }
  return set.size;
}

/**
 * Agrupa ventas por id_turno. Subtotal excluye ANULADO.
 * Orden: turno más reciente primero (por created_at máx. del grupo).
 */
export function agruparVentasPorTurno(ventas) {
  const map = new Map();
  for (const v of ventas || []) {
    const key = v.id_turno == null ? '__sin__' : v.id_turno;
    if (!map.has(key)) {
      map.set(key, { id_turno: v.id_turno ?? null, ventas: [], total: 0 });
    }
    const g = map.get(key);
    g.ventas.push(v);
    if (v.estado_anulacion !== 'ANULADO') g.total += Number(v.total || 0);
  }
  return Array.from(map.values()).sort((a, b) => {
    const maxA = a.ventas.reduce((m, v) => (v.created_at > m ? v.created_at : m), '');
    const maxB = b.ventas.reduce((m, v) => (v.created_at > m ? v.created_at : m), '');
    return maxB.localeCompare(maxA);
  });
}

/** Ordena lista plana: grupos por turno (mismo criterio) y dentro por created_at desc. */
export function ordenarVentasPorTurno(ventas) {
  return agruparVentasPorTurno(ventas).flatMap((g) =>
    [...g.ventas].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  );
}
