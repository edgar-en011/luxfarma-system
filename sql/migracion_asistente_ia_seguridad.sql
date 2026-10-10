-- Sesiones efímeras y aisladas para el Asistente IA.
-- Ejecutar una vez en Supabase SQL Editor antes de desplegar la Edge Function.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.asistente_ia_sesiones (
  id_sesion uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_usuario integer NOT NULL REFERENCES public.usuarios(id_usuario) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  usos integer NOT NULL DEFAULT 0 CHECK (usos >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  ultimo_uso_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asistente_ia_sesiones_expira
  ON public.asistente_ia_sesiones (expires_at);

CREATE INDEX IF NOT EXISTS idx_asistente_ia_sesiones_usuario
  ON public.asistente_ia_sesiones (id_usuario);

ALTER TABLE public.asistente_ia_sesiones ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.asistente_ia_sesiones FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.asistente_ia_sesiones IS
  'Tokens efímeros del Asistente IA; solo la Edge Function con service role puede acceder.';

NOTIFY pgrst, 'reload schema';
