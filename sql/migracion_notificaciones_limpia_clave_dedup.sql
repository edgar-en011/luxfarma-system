-- Limpia avisos de stock que no cumplen el umbral (≤3) y rellena clave_dedup
-- desde ?dedup= para que el UNIQUE empiece a cubrir las filas del cliente viejo.
--
-- No pone clave_dedup NOT NULL: hay filas históricas sin URL de dedup
-- (soporte, inserts sueltos). Ver comentario al final.

-- ── 1. Stock > 3 sin clave (generador viejo, umbral ≤10) ─────────
DELETE FROM notificaciones
WHERE categoria ILIKE 'Stock bajo'
  AND clave_dedup IS NULL
  AND COALESCE(
    (regexp_match(mensaje, 'quedan\s+(\d+)\s+unidades', 'i'))[1]::int,
    0
  ) > 3;

-- ── 2. Duplicado sin columna: la misma clave ya está en otra fila ─
DELETE FROM notificaciones n
WHERE n.clave_dedup IS NULL
  AND n.accion_url ~ '[?&]dedup='
  AND EXISTS (
    SELECT 1
    FROM notificaciones x
    WHERE x.clave_dedup = replace(replace(replace(
        (regexp_match(n.accion_url, '[?&]dedup=([^&]+)'))[1],
        '%3A', ':'
      ), '%3a', ':'), '%2F', '/')
  );

-- ── 3. Clave desde la URL ────────────────────────────────────────
UPDATE notificaciones
SET clave_dedup = replace(replace(replace(
      (regexp_match(accion_url, '[?&]dedup=([^&]+)'))[1],
      '%3A', ':'
    ), '%3a', ':'), '%2F', '/')
WHERE clave_dedup IS NULL
  AND accion_url ~ '[?&]dedup=';

-- ── 4. Duplicados de la misma clave: nos quedamos con la más vieja ─
DELETE FROM notificaciones n
WHERE n.clave_dedup IS NOT NULL
  AND n.id NOT IN (
    SELECT MIN(id)
    FROM notificaciones
    WHERE clave_dedup IS NOT NULL
    GROUP BY clave_dedup
  );

-- UNIQUE (clave_dedup) ya existe (migracion_notificaciones_dedup_descarte.sql).
-- PostgreSQL permite varios NULL: el backfill es lo que hace valer el índice.
--
-- NOT NULL: no aplicar. Tras esta limpieza puede no quedar ningún NULL, pero
-- el helper insertarNotificacion y un cliente viejo insertan sin la columna:
-- el INSERT fallaría en silencio. Con el exe viejo cerrado + UNIQUE, basta.
