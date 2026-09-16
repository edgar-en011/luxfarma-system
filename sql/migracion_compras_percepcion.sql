-- ═══════════════════════════════════════════════════
-- FIX CRÍTICO: registrar_compra escribe compras.percepcion
-- y esa columna no existía en producción.
-- Idempotente. RLS de `compras` se hereda (no se toca).
-- Pegar en Supabase → SQL Editor → Run.
-- ═══════════════════════════════════════════════════

ALTER TABLE compras
  ADD COLUMN IF NOT EXISTS percepcion NUMERIC NOT NULL DEFAULT 0;

COMMENT ON COLUMN compras.percepcion IS
  'Monto de percepción IGV (SUNAT). El total_compra ya lo incluye.';

NOTIFY pgrst, 'reload schema';
|