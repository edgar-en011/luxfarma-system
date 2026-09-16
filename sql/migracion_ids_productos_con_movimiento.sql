-- IDs de productos que ya tuvieron movimiento (compra, venta o kardex).
-- La campana y las pantallas de alerta solo piden este set, no el historial.

CREATE INDEX IF NOT EXISTS idx_kardex_movimientos_id_producto
  ON kardex_movimientos (id_producto);

CREATE INDEX IF NOT EXISTS idx_compra_detalle_id_producto
  ON compra_detalle (id_producto);

CREATE INDEX IF NOT EXISTS idx_venta_detalle_id_producto
  ON venta_detalle (id_producto);

CREATE OR REPLACE FUNCTION ids_productos_con_movimiento()
RETURNS TABLE(id_producto integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT x.id_producto
  FROM (
    SELECT DISTINCT k.id_producto
    FROM kardex_movimientos k
    WHERE k.id_producto IS NOT NULL
    UNION
    SELECT DISTINCT c.id_producto
    FROM compra_detalle c
    WHERE c.id_producto IS NOT NULL
    UNION
    SELECT DISTINCT v.id_producto
    FROM venta_detalle v
    WHERE v.id_producto IS NOT NULL
  ) x
  WHERE EXISTS (
    SELECT 1
    FROM inventario_lotes l
    WHERE l.id_producto = x.id_producto
  )
$$;

GRANT EXECUTE ON FUNCTION ids_productos_con_movimiento() TO anon, authenticated;
