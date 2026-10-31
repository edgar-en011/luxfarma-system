-- Agregados acotados para informes de ventas del asistente.
CREATE OR REPLACE FUNCTION public.resumen_ventas_asistente_ia(
  p_desde date,
  p_hasta date,
  p_id_sucursal integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH ventas_periodo AS (
  SELECT v.id_venta, v.total, v.created_at
  FROM public.ventas v
  WHERE (timezone('America/Lima', v.created_at))::date BETWEEN p_desde AND p_hasta
    AND COALESCE(v.estado_anulacion, '') IS DISTINCT FROM 'ANULADO'
    AND (p_id_sucursal IS NULL OR v.id_sucursal = p_id_sucursal)
), costos AS (
  SELECT COALESCE(SUM(COALESCE(vd.costo_unitario, pp.costo, 0)
    * COALESCE(vd.cantidad, 0) * COALESCE(vd.factor, 1)), 0)::numeric AS costo
  FROM public.venta_detalle vd
  JOIN ventas_periodo v ON v.id_venta = vd.id_venta
  LEFT JOIN public.producto_precios pp ON pp.id_producto = vd.id_producto
), por_dia AS (
  SELECT (timezone('America/Lima', created_at))::date AS dia,
    SUM(total)::numeric AS ventas, COUNT(*)::integer AS operaciones
  FROM ventas_periodo GROUP BY 1
)
SELECT jsonb_build_object(
  'desde', p_desde,
  'hasta', p_hasta,
  'operaciones', (SELECT COUNT(*)::integer FROM ventas_periodo),
  'ventas', COALESCE((SELECT SUM(total) FROM ventas_periodo), 0)::numeric,
  'ticketPromedio', COALESCE((SELECT AVG(total) FROM ventas_periodo), 0)::numeric,
  'costo', (SELECT costo FROM costos),
  'ganancia', COALESCE((SELECT SUM(total) FROM ventas_periodo), 0)::numeric - (SELECT costo FROM costos),
  'serie', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'fecha', dia, 'ventas', ventas, 'operaciones', operaciones
  ) ORDER BY dia) FROM por_dia), '[]'::jsonb)
);
$$;

REVOKE ALL ON FUNCTION public.resumen_ventas_asistente_ia(date, date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resumen_ventas_asistente_ia(date, date, integer) TO authenticated, service_role;
COMMENT ON FUNCTION public.resumen_ventas_asistente_ia(date, date, integer) IS
  'Devuelve solo totales agregados por período para informes del asistente; excluye ventas anuladas.';
NOTIFY pgrst, 'reload schema';
