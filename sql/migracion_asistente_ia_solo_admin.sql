-- Ejecutar en Supabase SQL Editor si no se usan migraciones por CLI.
-- Restringe el resumen gerencial a la Edge Function del Asistente IA.

REVOKE ALL ON FUNCTION public.resumen_asistente_ia(integer, integer, integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.resumen_asistente_ia(integer, integer, integer)
  TO service_role;

COMMENT ON FUNCTION public.resumen_asistente_ia(integer, integer, integer) IS
  'Resumen gerencial exclusivo del Asistente IA; solo se invoca desde la Edge Function validada.';

NOTIFY pgrst, 'reload schema';

