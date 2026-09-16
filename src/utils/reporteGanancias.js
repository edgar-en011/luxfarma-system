import { boundsISOPeru } from './fechas.js';

export async function cargarReporteGanancias(supabase, { fechaDesde, fechaHasta, idSucursal = null }) {
  const { start, end } = boundsISOPeru(fechaDesde, fechaHasta);
  if (!start || !end) throw new Error('Rango de fechas inválido.');
  const { data, error } = await supabase.rpc('reporte_ganancias', {
    p_desde: start,
    p_hasta: end,
    p_id_sucursal: idSucursal,
  });
  if (error) throw new Error(error.message);
  const row = typeof data === 'string' ? JSON.parse(data) : (data || {});
  if (!row.ok) throw new Error(row.error || 'No se pudo cargar ganancias.');
  return {
    ventas: Number(row.ventas) || 0,
    costo: Number(row.costo) || 0,
    ganancia: Number(row.ganancia) || 0,
    operaciones: Number(row.operaciones) || 0,
    productos: (row.productos || []).map((p) => ({
      id_producto: p.id_producto,
      descripcion: p.descripcion || '',
      cantidad: Number(p.cantidad) || 0,
      ventas: Number(p.ventas) || 0,
      costo: Number(p.costo) || 0,
      ganancia: Number(p.ganancia) || 0,
    })),
    serie: (row.serie || []).map((s) => ({
      periodo: s.periodo,
      ventas: Number(s.ventas) || 0,
      costo: Number(s.costo) || 0,
      ganancia: Number(s.ganancia) || 0,
    })),
  };
}

export function agruparSerieGanancias(serie, fechaDesde, fechaHasta) {
  const dias = Math.max(
    1,
    Math.round((new Date(`${fechaHasta}T00:00:00`) - new Date(`${fechaDesde}T00:00:00`)) / 86400000) + 1,
  );
  if (dias <= 45) {
    return { modo: 'dia', puntos: serie };
  }
  const porMes = new Map();
  for (const p of serie) {
    const mes = String(p.periodo || '').slice(0, 7);
    const prev = porMes.get(mes) || { periodo: mes, ventas: 0, costo: 0, ganancia: 0 };
    prev.ventas += p.ventas;
    prev.costo += p.costo;
    prev.ganancia += p.ganancia;
    porMes.set(mes, prev);
  }
  return { modo: 'mes', puntos: [...porMes.values()].sort((a, b) => a.periodo.localeCompare(b.periodo)) };
}
