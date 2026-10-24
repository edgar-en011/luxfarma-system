ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.usuario_actual_activo()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.usuarios u WHERE u.auth_user_id = auth.uid() AND lower(u.activo::text) IN ('1', 'true'))
$$;

CREATE OR REPLACE FUNCTION public.es_admin_actual()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.usuarios u WHERE u.auth_user_id = auth.uid() AND u.id_rol = 2 AND lower(u.activo::text) IN ('1', 'true'))
$$;

CREATE OR REPLACE FUNCTION public.id_usuario_actual()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id_usuario FROM public.usuarios u WHERE u.auth_user_id = auth.uid() AND lower(u.activo::text) IN ('1', 'true') LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.sucursal_usuario_actual()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id_sucursal FROM public.usuarios u WHERE u.auth_user_id = auth.uid() AND lower(u.activo::text) IN ('1', 'true') LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.usuario_actual_activo() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.es_admin_actual() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.id_usuario_actual(), public.sucursal_usuario_actual() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.usuario_actual_activo(), public.es_admin_actual(), public.id_usuario_actual(), public.sucursal_usuario_actual() TO authenticated;

ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS usuarios_select_auth ON public.usuarios;
DROP POLICY IF EXISTS usuarios_insert_admin ON public.usuarios;
DROP POLICY IF EXISTS usuarios_update_admin ON public.usuarios;
DROP POLICY IF EXISTS usuarios_delete_admin ON public.usuarios;
CREATE POLICY usuarios_select_auth ON public.usuarios FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid() OR public.es_admin_actual());
CREATE POLICY usuarios_insert_admin ON public.usuarios FOR INSERT TO authenticated
  WITH CHECK (public.es_admin_actual());
CREATE POLICY usuarios_update_admin ON public.usuarios FOR UPDATE TO authenticated
  USING (public.es_admin_actual()) WITH CHECK (public.es_admin_actual());
CREATE POLICY usuarios_delete_admin ON public.usuarios FOR DELETE TO authenticated
  USING (public.es_admin_actual());

REVOKE ALL ON TABLE public.usuarios FROM anon, authenticated;
DO $$
DECLARE columnas text;
BEGIN
  SELECT string_agg(format('%I', column_name), ', ' ORDER BY ordinal_position)
    INTO columnas
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'usuarios' AND column_name <> 'password_hash';
  EXECUTE format('GRANT SELECT (%s) ON public.usuarios TO authenticated', columnas);
END;
$$;
GRANT INSERT (dni, nombres, apellidos, telefono, email, id_rol, id_sucursal, activo, password_hash)
  ON public.usuarios TO authenticated;
GRANT UPDATE (dni, nombres, apellidos, telefono, email, id_rol, id_sucursal, activo, password_hash, auth_user_id)
  ON public.usuarios TO authenticated;
GRANT DELETE ON public.usuarios TO authenticated;

-- Las tablas de negocio requieren una sesión de Auth válida. Las tablas que
-- poseen id_sucursal quedan limitadas a la sede; las tablas compartidas siguen
-- accesibles a cuentas activas para conservar los flujos actuales.
DO $$
DECLARE
  tabla record;
  politica record;
  tiene_sucursal boolean;
BEGIN
  FOR tabla IN
    SELECT t.tablename
    FROM pg_tables t
    WHERE t.schemaname = 'public'
      AND t.tablename NOT IN ('usuarios', 'asistente_ia_sesiones', 'asistente_ia_feedback', 'notificaciones', 'notificaciones_descartes')
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = tabla.tablename AND c.column_name = 'id_sucursal'
    ) INTO tiene_sucursal;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tabla.tablename);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', tabla.tablename);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', tabla.tablename);
    FOR politica IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = tabla.tablename LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', politica.policyname, tabla.tablename);
    END LOOP;
    IF tiene_sucursal AND tabla.tablename <> 'sucursales' THEN
      EXECUTE format(
        'CREATE POLICY luxfarma_access ON public.%I FOR ALL TO authenticated USING (public.es_admin_actual() OR (public.usuario_actual_activo() AND (id_sucursal = public.sucursal_usuario_actual() OR id_sucursal IS NULL))) WITH CHECK (public.es_admin_actual() OR (public.usuario_actual_activo() AND id_sucursal = public.sucursal_usuario_actual()))',
        tabla.tablename
      );
    ELSE
      EXECUTE format(
        'CREATE POLICY luxfarma_access ON public.%I FOR ALL TO authenticated USING (public.usuario_actual_activo()) WITH CHECK (public.usuario_actual_activo())',
        tabla.tablename
      );
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

CREATE TABLE IF NOT EXISTS public.notificaciones_descartes (
  clave text PRIMARY KEY,
  firma text NOT NULL DEFAULT '',
  modo text NOT NULL DEFAULT 'unico',
  descartado_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notificaciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.notificaciones FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notificaciones TO authenticated;
DO $$
DECLARE politica record;
BEGIN
  FOR politica IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notificaciones' LOOP
    EXECUTE format('DROP POLICY %I ON public.notificaciones', politica.policyname);
  END LOOP;
END;
$$;
DROP POLICY IF EXISTS luxfarma_notificaciones_select ON public.notificaciones;
DROP POLICY IF EXISTS luxfarma_notificaciones_write ON public.notificaciones;
CREATE POLICY luxfarma_notificaciones_select ON public.notificaciones FOR SELECT TO authenticated
  USING (public.es_admin_actual() OR (public.usuario_actual_activo() AND (usuario_id IS NULL OR usuario_id = public.id_usuario_actual())));
CREATE POLICY luxfarma_notificaciones_write ON public.notificaciones FOR ALL TO authenticated
  USING (public.es_admin_actual() OR (public.usuario_actual_activo() AND (usuario_id IS NULL OR usuario_id = public.id_usuario_actual())))
  WITH CHECK (public.es_admin_actual() OR (public.usuario_actual_activo() AND (usuario_id IS NULL OR usuario_id = public.id_usuario_actual())));

ALTER TABLE public.notificaciones_descartes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.notificaciones_descartes FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notificaciones_descartes TO authenticated;
DROP POLICY IF EXISTS luxfarma_descartes_admin ON public.notificaciones_descartes;
CREATE POLICY luxfarma_descartes_admin ON public.notificaciones_descartes FOR ALL TO authenticated
  USING (public.es_admin_actual()) WITH CHECK (public.es_admin_actual());

DO $$
DECLARE secuencia regclass;
BEGIN
  secuencia := pg_get_serial_sequence('public.usuarios', 'id_usuario');
  IF secuencia IS NOT NULL THEN
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO authenticated', secuencia);
  END IF;
END;
$$;

COMMENT ON COLUMN public.usuarios.auth_user_id IS 'Enlace a Supabase Auth; las contraseñas se validan en auth-cuenta.';
