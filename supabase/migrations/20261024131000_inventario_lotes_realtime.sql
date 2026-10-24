-- Permite que los POS conectados reciban cambios de lotes y actualicen solo
-- los productos afectados en su caché offline.
ALTER TABLE public.inventario_lotes REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'inventario_lotes'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.inventario_lotes;
  END IF;
END;
$$;
