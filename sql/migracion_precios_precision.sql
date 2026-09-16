-- Precisión de precios unitarios (costo / venta / formas de venta / lote).
-- Antes NUMERIC(x,2) redondeaba valores como 0.578 → 0.58.
-- Totales de compra/venta (subtotal, total) se dejan en 2 decimales.
--
-- Postgres no deja ALTER TYPE de una columna si un trigger la menciona
-- (p.ej. AFTER UPDATE OF precio_venta). Este script:
--   1) guarda la definición de TODOS los triggers de usuario (y de las
--      funciones que disparan) en las tablas afectadas
--   2) guarda vistas/matviews que dependan de esas columnas
--   3) DROP TRIGGER / DROP VIEW temporales
--   4) ALTER COLUMN
--   5) recrea vistas y triggers exactamente como estaban
--
-- Pegar TODO el archivo de una vez en Supabase → SQL Editor → Run.

DROP TABLE IF EXISTS _mig_cols, _mig_trg, _mig_fn, _mig_view;

-- ── Tablas/columnas a ampliar ──────────────────────────────────────────
CREATE TEMP TABLE _mig_cols (
  tabla   text NOT NULL,
  columna text NOT NULL
);

INSERT INTO _mig_cols (tabla, columna) VALUES
  ('producto_precios',      'costo'),
  ('producto_precios',      'precio_venta'),
  ('producto_precios',      'precio_caja'),
  ('producto_precios',      'ganancia'),
  ('compra_detalle',        'costo_unitario'),
  ('inventario_lotes',      'costo_unitario_lote'),
  ('producto_formas_venta', 'precio_venta'),
  ('producto_formas_venta', 'p_compra'),
  ('venta_detalle',         'precio_unitario');

-- ── 1. Snapshot de triggers (incluye trg_sync_precio_a_forma_unidad) ──
CREATE TEMP TABLE _mig_trg (
  orden  int GENERATED ALWAYS AS IDENTITY,
  tabla  text NOT NULL,
  nombre text NOT NULL,
  def    text NOT NULL
);

INSERT INTO _mig_trg (tabla, nombre, def)
SELECT c.relname,
       t.tgname,
       pg_get_triggerdef(t.oid, true)
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
  AND c.relname IN (SELECT DISTINCT tabla FROM _mig_cols)
ORDER BY c.relname, t.tgname;

-- Funciones disparadas por esos triggers (NO se dropean: solo se documentan)
CREATE TEMP TABLE _mig_fn (
  nombre text NOT NULL,
  def    text NOT NULL
);

INSERT INTO _mig_fn (nombre, def)
SELECT DISTINCT p.proname, pg_get_functiondef(p.oid)
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
  AND c.relname IN (SELECT DISTINCT tabla FROM _mig_cols);

-- ── Vistas / matviews que dependen de las columnas a alterar ───────────
CREATE TEMP TABLE _mig_view (
  orden      int GENERATED ALWAYS AS IDENTITY,
  esquema    text NOT NULL,
  nombre     text NOT NULL,
  tipo       char NOT NULL, -- v = view, m = matview
  def        text NOT NULL
);

INSERT INTO _mig_view (esquema, nombre, tipo, def)
SELECT DISTINCT
  nv.nspname,
  v.relname,
  v.relkind,
  pg_get_viewdef(v.oid, true)
FROM pg_depend d
JOIN pg_rewrite rw ON rw.oid = d.objid
JOIN pg_class v ON v.oid = rw.ev_class
JOIN pg_namespace nv ON nv.oid = v.relnamespace
JOIN pg_class t ON t.oid = d.refobjid
JOIN pg_namespace nt ON nt.oid = t.relnamespace
JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
JOIN _mig_cols mc ON mc.tabla = t.relname AND mc.columna = a.attname
WHERE nt.nspname = 'public'
  AND nv.nspname = 'public'
  AND v.relkind IN ('v', 'm')
  AND d.refobjsubid > 0;

-- Si el trigger que ya falló existe en la tabla, tiene que estar en el snapshot
-- (si no, abortamos para no dropearlo sin poder recrearlo).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'producto_precios'
      AND t.tgname = 'trg_sync_precio_a_forma_unidad'
      AND NOT t.tgisinternal
  ) AND NOT EXISTS (
    SELECT 1 FROM _mig_trg
    WHERE tabla = 'producto_precios'
      AND nombre = 'trg_sync_precio_a_forma_unidad'
  ) THEN
    RAISE EXCEPTION 'No se pudo capturar trg_sync_precio_a_forma_unidad; se aborta sin tocar nada.';
  END IF;
END $$;

-- Resultado visible en el SQL Editor (triggers, funciones y vistas capturados)
SELECT 'TRIGGER' AS tipo, tabla, nombre, def FROM _mig_trg
UNION ALL
SELECT 'FUNCION', '', nombre, def FROM _mig_fn
UNION ALL
SELECT 'VISTA', esquema || '.' || nombre, CASE tipo WHEN 'm' THEN 'MATERIALIZED' ELSE 'VIEW' END, def FROM _mig_view
ORDER BY 1, 2, 3;

-- ── 2. DROP TRIGGER temporales ─────────────────────────────────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT tabla, nombre FROM _mig_trg ORDER BY orden LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', r.nombre, r.tabla);
    RAISE NOTICE 'DROP TRIGGER % ON %', r.nombre, r.tabla;
  END LOOP;
END $$;

-- ── DROP vistas dependientes (si las hay) ──────────────────────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM _mig_view ORDER BY orden DESC LOOP
    IF r.tipo = 'm' THEN
      EXECUTE format('DROP MATERIALIZED VIEW IF EXISTS public.%I', r.nombre);
    ELSE
      EXECUTE format('DROP VIEW IF EXISTS public.%I', r.nombre);
    END IF;
    RAISE NOTICE 'DROP VIEW %', r.nombre;
  END LOOP;
END $$;

-- ── 3. ALTER COLUMN ────────────────────────────────────────────────────
ALTER TABLE producto_precios
  ALTER COLUMN costo TYPE NUMERIC(14, 6) USING costo::numeric(14, 6),
  ALTER COLUMN precio_venta TYPE NUMERIC(14, 6) USING precio_venta::numeric(14, 6),
  ALTER COLUMN precio_caja TYPE NUMERIC(14, 6) USING precio_caja::numeric(14, 6),
  ALTER COLUMN ganancia TYPE NUMERIC(14, 6) USING ganancia::numeric(14, 6);

ALTER TABLE compra_detalle
  ALTER COLUMN costo_unitario TYPE NUMERIC(14, 6) USING costo_unitario::numeric(14, 6);

ALTER TABLE inventario_lotes
  ALTER COLUMN costo_unitario_lote TYPE NUMERIC(14, 6) USING costo_unitario_lote::numeric(14, 6);

ALTER TABLE producto_formas_venta
  ALTER COLUMN precio_venta TYPE NUMERIC(14, 6) USING precio_venta::numeric(14, 6),
  ALTER COLUMN p_compra TYPE NUMERIC(14, 6) USING p_compra::numeric(14, 6);

ALTER TABLE venta_detalle
  ALTER COLUMN precio_unitario TYPE NUMERIC(14, 6) USING precio_unitario::numeric(14, 6);

-- ── 4. Recrear vistas ──────────────────────────────────────────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM _mig_view ORDER BY orden LOOP
    IF r.tipo = 'm' THEN
      EXECUTE format('CREATE MATERIALIZED VIEW public.%I AS %s', r.nombre, r.def);
    ELSE
      EXECUTE format('CREATE VIEW public.%I AS %s', r.nombre, r.def);
    END IF;
    RAISE NOTICE 'CREATE VIEW %', r.nombre;
  END LOOP;
END $$;

-- ── Recrear triggers (mismo nombre, función, momento y eventos) ────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT def, nombre, tabla FROM _mig_trg ORDER BY orden LOOP
    EXECUTE r.def;
    RAISE NOTICE 'CREATE TRIGGER % ON %', r.nombre, r.tabla;
  END LOOP;
END $$;

-- ── Verificación: el trigger de sync debe volver a existir ─────────────
SELECT c.relname AS tabla,
       t.tgname AS trigger,
       pg_get_triggerdef(t.oid, true) AS definicion
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
  AND c.relname IN (SELECT DISTINCT tabla FROM _mig_cols)
ORDER BY 1, 2;

NOTIFY pgrst, 'reload schema';
