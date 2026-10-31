-- Habilita Realtime postgres_changes en tickets de soporte (y notificaciones).
-- Ejecutar en el SQL Editor de Supabase del proyecto luxfarma.
-- Si la tabla ya está en la publicación, el bloque DO no falla.

ALTER TABLE public.tickets_soporte REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.tickets_soporte;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notificaciones;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
