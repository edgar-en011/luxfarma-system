-- ═══════════════════════════════════════════════════
-- Proveedores: columna activo (no se borran; se desactivan).
-- Si ya existe como 0/1 (integer), NO hay que correr nada:
-- la app ya trata 1 = activo y 0 = inactivo.
-- Idempotente. Pegar en Supabase → SQL Editor → Run.
-- ═══════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'proveedores'
      AND column_name = 'activo'
  ) THEN
    ALTER TABLE proveedores
      ADD COLUMN activo BOOLEAN NOT NULL DEFAULT true;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
