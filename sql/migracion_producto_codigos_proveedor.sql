-- ═══════════════════════════════════════════════════
-- MIGRACIÓN: códigos de producto por proveedor (import XML compras)
-- Ejecutar en Supabase SQL Editor
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS producto_codigos_proveedor (
  id                BIGSERIAL PRIMARY KEY,
  id_producto       INT NOT NULL REFERENCES productos(id_producto),
  id_proveedor      INT NOT NULL REFERENCES proveedores(id_proveedor),
  codigo_proveedor  TEXT NOT NULL,
  CONSTRAINT uq_producto_codigos_proveedor UNIQUE (id_proveedor, codigo_proveedor)
);

CREATE INDEX IF NOT EXISTS idx_pcp_producto ON producto_codigos_proveedor (id_producto);
CREATE INDEX IF NOT EXISTS idx_pcp_proveedor ON producto_codigos_proveedor (id_proveedor);

ALTER TABLE producto_codigos_proveedor ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all access" ON producto_codigos_proveedor;
CREATE POLICY "Allow all access" ON producto_codigos_proveedor
  FOR ALL TO anon USING (true) WITH CHECK (true);

GRANT ALL ON producto_codigos_proveedor TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE producto_codigos_proveedor_id_seq TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
