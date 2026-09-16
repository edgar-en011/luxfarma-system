-- Unicidad real de notificaciones + descarte persistente.
-- También ajusta ids_productos_con_movimiento: movimiento Y al menos un lote.
--
-- Por qué "tuvo un lote" y no "tiene lote VIGENTE ahora":
-- un producto que se vendió hasta agotar queda en AGOTADO y debe seguir
-- alertando stock 0. El que solo tiene un kardex/compra/venta de prueba
-- y nunca se cargó a inventario (cero filas en inventario_lotes) no.

-- ── 1. Clave de dedup en la fila ─────────────────────────────────
ALTER TABLE notificaciones
  ADD COLUMN IF NOT EXISTS clave_dedup TEXT;

UPDATE notificaciones
SET clave_dedup = replace(replace(replace(
      (regexp_match(accion_url, '[?&]dedup=([^&]+)'))[1],
      '%3A', ':'
    ), '%3a', ':'), '%2F', '/')
WHERE clave_dedup IS NULL
  AND accion_url ~ '[?&]dedup=';

-- Duplicados de la misma clave (p. ej. Strict Mode): nos quedamos con la más vieja.
DELETE FROM notificaciones n
WHERE n.clave_dedup IS NOT NULL
  AND n.id NOT IN (
    SELECT MIN(id)
    FROM notificaciones
    WHERE clave_dedup IS NOT NULL
    GROUP BY clave_dedup
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notificaciones_clave_dedup_key'
  ) THEN
    ALTER TABLE notificaciones
      ADD CONSTRAINT notificaciones_clave_dedup_key UNIQUE (clave_dedup);
  END IF;
END $$;

-- ── 2. Insert atómico: el conflicto lo resuelve la base ──────────
CREATE OR REPLACE FUNCTION insertar_notif_dedup(
  p_usuario_id bigint,
  p_tipo text,
  p_categoria text,
  p_mensaje text,
  p_accion_label text,
  p_accion_url text,
  p_clave_dedup text,
  p_reactivar boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  IF p_clave_dedup IS NULL OR btrim(p_clave_dedup) = '' THEN
    RETURN;
  END IF;

  IF p_reactivar THEN
    INSERT INTO notificaciones (
      usuario_id, tipo, categoria, mensaje, leido, accion_label, accion_url, clave_dedup
    ) VALUES (
      p_usuario_id, p_tipo, p_categoria, p_mensaje, false,
      p_accion_label, p_accion_url, p_clave_dedup
    )
    ON CONFLICT (clave_dedup) DO UPDATE SET
      mensaje = EXCLUDED.mensaje,
      tipo = EXCLUDED.tipo,
      accion_label = EXCLUDED.accion_label,
      accion_url = EXCLUDED.accion_url,
      leido = false;
  ELSE
    INSERT INTO notificaciones (
      usuario_id, tipo, categoria, mensaje, leido, accion_label, accion_url, clave_dedup
    ) VALUES (
      p_usuario_id, p_tipo, p_categoria, p_mensaje, false,
      p_accion_label, p_accion_url, p_clave_dedup
    )
    ON CONFLICT (clave_dedup) DO NOTHING;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION insertar_notif_dedup(
  bigint, text, text, text, text, text, text, boolean
) TO anon, authenticated;

-- ── 3. Descarte ≠ leído ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notificaciones_descartes (
  clave TEXT PRIMARY KEY,
  firma TEXT NOT NULL DEFAULT '',
  modo TEXT NOT NULL DEFAULT 'unico',
  descartado_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON notificaciones_descartes TO anon, authenticated;

-- ── 4. Movimiento + al menos un lote (cualquier estado) ──────────
CREATE INDEX IF NOT EXISTS idx_inventario_lotes_id_producto
  ON inventario_lotes (id_producto);

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
