-- El resumen del asistente contiene información gerencial y no debe poder
-- invocarse directamente con la anon key. La Edge Function lo ejecuta con
-- service_role después de validar una sesión de administrador.

REVOKE ALL ON FUNCTION public.resumen_asistente_ia(integer, integer, integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.resumen_asistente_ia(integer, integer, integer)
  TO service_role;

COMMENT ON FUNCTION public.resumen_asistente_ia(integer, integer, integer) IS
  'Resumen gerencial exclusivo del Asistente IA; solo se invoca desde la Edge Function validada.';

NOTIFY pgrst, 'reload schema';

