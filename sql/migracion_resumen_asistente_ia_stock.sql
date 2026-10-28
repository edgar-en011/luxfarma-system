-- Amplía el resumen del Asistente IA con existencias reales (conteos + ranking).
-- Sin esto Gemini solo ve alertas top-10 y responde que no hay listado de stock.

CREATE OR REPLACE FUNCTION public.resumen_asistente_ia(
  p_id_sucursal integer DEFAULT NULL,
  p_dias integer DEFAULT 30,
  p_limite integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH
parametros AS (
  SELECT
    GREATEST(1, LEAST(COALESCE(p_dias, 30), 90)) AS dias,
    GREATEST(1, LEAST(COALESCE(p_limite, 10), 25)) AS limite,
    80 AS limite_stock,
    30 AS limite_sin_stock,
    (timezone('America/Lima', now()))::date AS hoy
),
formas AS (
  SELECT pfv.id_producto,
    jsonb_agg(jsonb_build_object(
      'factor', pfv.factor,
      'activo', pfv.activo,
      'unidades_medida', jsonb_build_object('nombre', um.nombre)
    ) ORDER BY pfv.factor DESC) AS formas_venta
  FROM public.producto_formas_venta pfv
  JOIN public.unidades_medida um ON um.id_medida = pfv.id_medida
  WHERE pfv.activo = true
  GROUP BY pfv.id_producto
),
productos_usados AS (
  SELECT id_producto FROM public.kardex_movimientos WHERE id_producto IS NOT NULL
  UNION SELECT id_producto FROM public.compra_detalle WHERE id_producto IS NOT NULL
  UNION SELECT id_producto FROM public.venta_detalle WHERE id_producto IS NOT NULL
),
producto_sede AS (
  SELECT DISTINCT l.id_producto, l.id_sucursal
  FROM public.inventario_lotes l
  WHERE p_id_sucursal IS NULL OR l.id_sucursal = p_id_sucursal
),
stock_sede AS (
  SELECT l.id_producto, l.id_sucursal,
    GREATEST(0, COALESCE(SUM(l.cantidad_actual), 0))::numeric AS stock_base
  FROM public.inventario_lotes l
  WHERE upper(btrim(COALESCE(l.estado, ''))) IN ('VIGENTE', 'VENCIDO')
    AND (p_id_sucursal IS NULL OR l.id_sucursal = p_id_sucursal)
  GROUP BY l.id_producto, l.id_sucursal
),
stock_producto AS (
  SELECT ps.id_producto, SUM(COALESCE(ss.stock_base, 0))::numeric AS stock_base
  FROM producto_sede ps
  LEFT JOIN stock_sede ss
    ON ss.id_producto = ps.id_producto AND ss.id_sucursal = ps.id_sucursal
  GROUP BY ps.id_producto
),
movimiento_30 AS (
  SELECT vd.id_producto,
    SUM(GREATEST(COALESCE(vd.cantidad, 0), 0) * GREATEST(COALESCE(vd.factor, 1), 0))::numeric AS unidades_vendidas
  FROM public.ventas v
  JOIN public.venta_detalle vd ON vd.id_venta = v.id_venta
  CROSS JOIN parametros pa
  WHERE v.created_at >= pa.hoy - (pa.dias - 1)
    AND v.created_at < pa.hoy + 1
    AND COALESCE(v.estado_anulacion, '') IS DISTINCT FROM 'ANULADO'
    AND (p_id_sucursal IS NULL OR v.id_sucursal = p_id_sucursal)
  GROUP BY vd.id_producto
),
base_stock_bajo AS (
  SELECT p.id_producto, p.descripcion, p.codigo_barras, ps.id_sucursal,
    s.nombre_comercial AS sucursal,
    COALESCE(ss.stock_base, 0)::numeric AS stock_base,
    (CASE WHEN COALESCE(p.stock_minimo, 0) > 0 THEN p.stock_minimo ELSE 3 END)::numeric AS umbral_base,
    COALESCE(m.unidades_vendidas, 0)::numeric AS unidades_vendidas,
    COALESCE(f.formas_venta, '[]'::jsonb) AS formas_venta
  FROM public.productos p
  JOIN producto_sede ps ON ps.id_producto = p.id_producto
  JOIN productos_usados pu ON pu.id_producto = p.id_producto
  LEFT JOIN stock_sede ss
    ON ss.id_producto = p.id_producto AND ss.id_sucursal = ps.id_sucursal
  LEFT JOIN public.sucursales s ON s.id_sucursal = ps.id_sucursal
  LEFT JOIN movimiento_30 m ON m.id_producto = p.id_producto
  LEFT JOIN formas f ON f.id_producto = p.id_producto
  WHERE p.activo = 1
    AND COALESCE(ss.stock_base, 0) <= CASE WHEN COALESCE(p.stock_minimo, 0) > 0 THEN p.stock_minimo ELSE 3 END
),
stock_bajo AS (
  SELECT * FROM base_stock_bajo
  ORDER BY (stock_base = 0) DESC,
    stock_base / NULLIF(umbral_base, 0), unidades_vendidas DESC
  LIMIT (SELECT limite FROM parametros)
),
base_vencimientos AS (
  SELECT p.id_producto, p.descripcion, p.codigo_barras,
    l.id_lote, l.nro_lote, l.fecha_vencimiento,
    (l.fecha_vencimiento - pa.hoy)::integer AS dias_para_vencer,
    GREATEST(0, l.cantidad_actual)::numeric AS stock_base,
    l.id_sucursal, s.nombre_comercial AS sucursal,
    COALESCE(f.formas_venta, '[]'::jsonb) AS formas_venta
  FROM public.inventario_lotes l
  JOIN public.productos p ON p.id_producto = l.id_producto AND p.activo = 1
  LEFT JOIN public.sucursales s ON s.id_sucursal = l.id_sucursal
  LEFT JOIN formas f ON f.id_producto = p.id_producto
  CROSS JOIN parametros pa
  WHERE l.estado = 'VIGENTE' AND l.cantidad_actual > 0
    AND l.fecha_vencimiento BETWEEN pa.hoy AND pa.hoy + 60
    AND (p_id_sucursal IS NULL OR l.id_sucursal = p_id_sucursal)
),
vencimientos AS (
  SELECT * FROM base_vencimientos
  ORDER BY dias_para_vencer, stock_base DESC
  LIMIT (SELECT limite FROM parametros)
),
base_movimiento AS (
  SELECT p.id_producto, p.descripcion, p.codigo_barras,
    COALESCE(sp.stock_base, 0)::numeric AS stock_base,
    m.unidades_vendidas,
    COALESCE(f.formas_venta, '[]'::jsonb) AS formas_venta
  FROM movimiento_30 m
  JOIN public.productos p ON p.id_producto = m.id_producto AND p.activo = 1
  LEFT JOIN stock_producto sp ON sp.id_producto = p.id_producto
  LEFT JOIN formas f ON f.id_producto = p.id_producto
  WHERE m.unidades_vendidas > 0
),
mayor_movimiento AS (
  SELECT * FROM base_movimiento ORDER BY unidades_vendidas DESC
  LIMIT (SELECT limite FROM parametros)
),
base_baja_rotacion AS (
  SELECT p.id_producto, p.descripcion, p.codigo_barras, sp.stock_base,
    pa.dias AS dias_sin_ventas,
    COALESCE(f.formas_venta, '[]'::jsonb) AS formas_venta
  FROM stock_producto sp
  JOIN public.productos p ON p.id_producto = sp.id_producto AND p.activo = 1
  JOIN productos_usados pu ON pu.id_producto = p.id_producto
  LEFT JOIN movimiento_30 m ON m.id_producto = p.id_producto
  LEFT JOIN formas f ON f.id_producto = p.id_producto
  CROSS JOIN parametros pa
  WHERE sp.stock_base > 0 AND COALESCE(m.unidades_vendidas, 0) = 0
),
baja_rotacion AS (
  SELECT * FROM base_baja_rotacion ORDER BY stock_base DESC, descripcion
  LIMIT (SELECT limite FROM parametros)
),
reposicion AS (
  SELECT sb.*,
    GREATEST(0, sb.umbral_base - sb.stock_base)::numeric AS brecha_minimo_base,
    CASE WHEN sb.stock_base <= 0 THEN 'Crítica' ELSE 'Atención' END AS prioridad
  FROM stock_bajo sb
),
base_stock_actual AS (
  SELECT p.id_producto, p.descripcion, p.codigo_barras,
    sp.stock_base,
    COALESCE(f.formas_venta, '[]'::jsonb) AS formas_venta
  FROM stock_producto sp
  JOIN public.productos p ON p.id_producto = sp.id_producto AND p.activo = 1
  LEFT JOIN formas f ON f.id_producto = p.id_producto
  WHERE sp.stock_base > 0
),
stock_actual AS (
  SELECT * FROM base_stock_actual
  ORDER BY stock_base DESC, descripcion
  LIMIT (SELECT limite_stock FROM parametros)
),
base_sin_stock AS (
  SELECT p.id_producto, p.descripcion, p.codigo_barras,
    0::numeric AS stock_base,
    COALESCE(f.formas_venta, '[]'::jsonb) AS formas_venta
  FROM public.productos p
  LEFT JOIN stock_producto sp ON sp.id_producto = p.id_producto
  LEFT JOIN formas f ON f.id_producto = p.id_producto
  WHERE p.activo = 1 AND COALESCE(sp.stock_base, 0) <= 0
),
sin_stock AS (
  SELECT * FROM base_sin_stock
  ORDER BY descripcion
  LIMIT (SELECT limite_sin_stock FROM parametros)
),
catalogo AS (
  SELECT p.id_producto, p.descripcion, p.codigo_barras,
    COALESCE(sp.stock_base, 0)::numeric AS stock_base,
    COALESCE(f.formas_venta, '[]'::jsonb) AS formas_venta
  FROM public.productos p
  LEFT JOIN stock_producto sp ON sp.id_producto = p.id_producto
  LEFT JOIN formas f ON f.id_producto = p.id_producto
  WHERE p.activo = 1
  ORDER BY COALESCE(sp.stock_base, 0) DESC, p.descripcion
  LIMIT (SELECT limite_stock FROM parametros)
)
SELECT jsonb_build_object(
  'metadata', jsonb_build_object(
    'generadoEn', now(),
    'alcance', COALESCE((SELECT nombre_comercial FROM public.sucursales WHERE id_sucursal = p_id_sucursal), 'Todas las sedes'),
    'periodoDesde', (SELECT hoy - (dias - 1) FROM parametros),
    'periodoHasta', (SELECT hoy FROM parametros),
    'periodoDias', (SELECT dias FROM parametros),
    'umbralVencimientoDias', 60,
    'fuenteStock', 'inventario_lotes.cantidad_actual en unidades base',
    'procesamiento', 'PostgreSQL/Supabase RPC',
    'limiteListadoStock', (SELECT limite_stock FROM parametros)
  ),
  'totales', jsonb_build_object(
    'productosAnalizados', (SELECT count(*) FROM public.productos WHERE activo = 1),
    'productosConStock', (SELECT count(*) FROM base_stock_actual),
    'productosSinStock', (SELECT count(*) FROM base_sin_stock),
    'unidadesEnStock', (SELECT COALESCE(SUM(stock_base), 0) FROM base_stock_actual),
    'lotesRegistrados', (
      SELECT count(*) FROM public.inventario_lotes l
      WHERE p_id_sucursal IS NULL OR l.id_sucursal = p_id_sucursal
    ),
    'stockBajo', (SELECT count(*) FROM base_stock_bajo),
    'lotesProximosVencer', (SELECT count(*) FROM base_vencimientos),
    'bajaRotacion', (SELECT count(*) FROM base_baja_rotacion),
    'conMovimiento', (SELECT count(*) FROM base_movimiento),
    'recomendacionesReposicion', (SELECT count(*) FROM base_stock_bajo)
  ),
  'stockBajo', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM stock_bajo x), '[]'::jsonb),
  'proximosVencer', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM vencimientos x), '[]'::jsonb),
  'bajaRotacion', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM baja_rotacion x), '[]'::jsonb),
  'mayorMovimiento', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM mayor_movimiento x), '[]'::jsonb),
  'reposicion', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM reposicion x), '[]'::jsonb),
  'stockActual', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM stock_actual x), '[]'::jsonb),
  'sinStock', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM sin_stock x), '[]'::jsonb),
  'catalogo', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM catalogo x), '[]'::jsonb)
)
$$;

COMMENT ON FUNCTION public.resumen_asistente_ia(integer, integer, integer) IS
  'Resumen del Asistente IA: alertas top-N más ranking de existencias (hasta 80 con stock).';

NOTIFY pgrst, 'reload schema';
