-- ===========================================================
-- RPC reporte_ganancias: totales + por producto + serie diaria.
-- Costo = snapshot venta_detalle.costo_unitario; si es NULL
-- (ventas viejas) cae al costo actual de catálogo.
-- Excluye ventas ANULADO.
-- p_desde / p_hasta: timestamptz (bounds Perú desde el cliente).
-- ===========================================================

CREATE OR REPLACE FUNCTION reporte_ganancias(
  p_desde timestamptz,
  p_hasta timestamptz,
  p_id_sucursal integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH ventas_ok AS (
    SELECT id_venta, total, created_at
    FROM ventas
    WHERE created_at >= p_desde
      AND created_at <= p_hasta
      AND COALESCE(estado_anulacion, '') IS DISTINCT FROM 'ANULADO'
      AND (p_id_sucursal IS NULL OR id_sucursal = p_id_sucursal)
  ),
  lineas AS (
    SELECT
      vd.id_producto,
      COALESCE(p.descripcion, 'Producto #' || vd.id_producto::text) AS descripcion,
      (COALESCE(vd.cantidad, 0) * COALESCE(vd.factor, 1)) AS uds_base,
      COALESCE(vd.subtotal, 0) AS ventas,
      COALESCE(vd.costo_unitario, pp.costo, 0)
        * COALESCE(vd.cantidad, 0)
        * COALESCE(vd.factor, 1) AS costo,
      (timezone('America/Lima', v.created_at))::date AS dia
    FROM venta_detalle vd
    JOIN ventas_ok v ON v.id_venta = vd.id_venta
    LEFT JOIN productos p ON p.id_producto = vd.id_producto
    LEFT JOIN producto_precios pp ON pp.id_producto = vd.id_producto
  ),
  tot AS (
    SELECT
      COALESCE((SELECT SUM(total) FROM ventas_ok), 0) AS ventas,
      COALESCE((SELECT SUM(costo) FROM lineas), 0) AS costo,
      COALESCE((SELECT COUNT(*) FROM ventas_ok), 0) AS operaciones
  ),
  por_prod AS (
    SELECT
      id_producto,
      descripcion,
      SUM(uds_base) AS cantidad,
      SUM(ventas) AS ventas,
      SUM(costo) AS costo,
      SUM(ventas) - SUM(costo) AS ganancia
    FROM lineas
    GROUP BY id_producto, descripcion
  ),
  por_dia AS (
    SELECT
      dia::text AS periodo,
      SUM(ventas) AS ventas,
      SUM(costo) AS costo,
      SUM(ventas) - SUM(costo) AS ganancia
    FROM lineas
    GROUP BY dia
  )
  SELECT jsonb_build_object(
    'ok', true,
    'ventas', (SELECT ventas FROM tot),
    'costo', (SELECT costo FROM tot),
    'ganancia', (SELECT ventas FROM tot) - (SELECT costo FROM tot),
    'operaciones', (SELECT operaciones FROM tot),
    'productos', COALESCE((
      SELECT jsonb_agg(row_to_json(p)::jsonb ORDER BY p.ganancia DESC)
      FROM por_prod p
    ), '[]'::jsonb),
    'serie', COALESCE((
      SELECT jsonb_agg(row_to_json(s)::jsonb ORDER BY s.periodo)
      FROM por_dia s
    ), '[]'::jsonb)
  );
$$;

GRANT EXECUTE ON FUNCTION reporte_ganancias(timestamptz, timestamptz, integer) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
