-- ═══════════════════════════════════════════════════
-- MIGRACIÓN: Comprobantes SUNAT (Nubefact) + series por sucursal
-- Ejecutar en Supabase SQL Editor
-- NO inserta filas semilla en series_correlativos.
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS series_correlativos (
  id                BIGSERIAL PRIMARY KEY,
  id_sucursal       INT NOT NULL REFERENCES sucursales(id_sucursal),
  tipo_comprobante  INT NOT NULL CHECK (tipo_comprobante IN (1, 2)), -- 1=Factura, 2=Boleta
  serie             TEXT NOT NULL,
  ultimo_numero     INT NOT NULL DEFAULT 0,
  activo            BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_series_sucursal_tipo_activo
  ON series_correlativos (id_sucursal, tipo_comprobante)
  WHERE activo = TRUE;

CREATE INDEX IF NOT EXISTS idx_series_sucursal
  ON series_correlativos (id_sucursal);

ALTER TABLE series_correlativos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all access" ON series_correlativos;
CREATE POLICY "Allow all access" ON series_correlativos
  FOR ALL TO anon USING (true) WITH CHECK (true);

GRANT ALL ON series_correlativos TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE series_correlativos_id_seq TO anon, authenticated;

-- Reserva el siguiente correlativo con lock de fila (evita duplicados).
CREATE OR REPLACE FUNCTION reservar_siguiente_correlativo(
  p_id_sucursal integer,
  p_tipo_comprobante integer
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_id integer;
  v_serie text;
  v_numero integer;
BEGIN
  SELECT id INTO v_id
  FROM series_correlativos
  WHERE id_sucursal = p_id_sucursal
    AND tipo_comprobante = p_tipo_comprobante
    AND activo IS TRUE
  ORDER BY id
  LIMIT 1
  FOR UPDATE;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_SERIE');
  END IF;

  UPDATE series_correlativos
  SET ultimo_numero = COALESCE(ultimo_numero, 0) + 1
  WHERE id = v_id
  RETURNING serie, ultimo_numero INTO v_serie, v_numero;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_id,
    'serie', v_serie,
    'numero', v_numero
  );
END;
$$;

GRANT EXECUTE ON FUNCTION reservar_siguiente_correlativo(integer, integer) TO anon, authenticated;

CREATE TABLE IF NOT EXISTS comprobantes_sunat (
  id                   BIGSERIAL PRIMARY KEY,
  id_venta             INT NOT NULL REFERENCES ventas(id_venta),
  id_sucursal          INT NOT NULL REFERENCES sucursales(id_sucursal),
  tipo_comprobante     INT NOT NULL CHECK (tipo_comprobante IN (1, 2)),
  serie                TEXT,
  numero               INT,
  key_nubefact         TEXT,
  enlace_pdf           TEXT,
  enlace_xml           TEXT,
  aceptada_por_sunat   BOOLEAN NOT NULL DEFAULT FALSE,
  estado_envio         TEXT NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado_envio IN (
      'PENDIENTE', 'ENVIADO', 'ACEPTADO', 'RECHAZADO', 'ERROR', 'REQUIERE_REVISION'
    )),
  mensaje_error        TEXT,
  intentos             INT NOT NULL DEFAULT 0,
  fecha_envio          TIMESTAMPTZ,
  fecha_actualizacion  TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_comprobantes_sunat_venta
  ON comprobantes_sunat (id_venta);

CREATE INDEX IF NOT EXISTS idx_comprobantes_sunat_estado
  ON comprobantes_sunat (estado_envio);

CREATE INDEX IF NOT EXISTS idx_comprobantes_sunat_sucursal
  ON comprobantes_sunat (id_sucursal);

ALTER TABLE comprobantes_sunat ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all access" ON comprobantes_sunat;
CREATE POLICY "Allow all access" ON comprobantes_sunat
  FOR ALL TO anon USING (true) WITH CHECK (true);

GRANT ALL ON comprobantes_sunat TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE comprobantes_sunat_id_seq TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
