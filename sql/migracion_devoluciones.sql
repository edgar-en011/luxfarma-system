-- ============================================
-- MIGRACIÓN: Módulo de Devoluciones / Anulaciones
-- Ejecutar en Supabase SQL Editor
-- ============================================

-- 1. Agregar campo estado a ventas (si no existe)
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS estado TEXT DEFAULT 'EMITIDA';
-- Valores: EMITIDA | ANULADA | CON_NOTA_CREDITO

-- 2. Tabla principal de notas de crédito / anulaciones
CREATE TABLE IF NOT EXISTS notas_credito (
  id_nota          SERIAL PRIMARY KEY,
  id_venta_original INT NOT NULL REFERENCES ventas(id_venta),
  id_sucursal      INT,
  tipo             TEXT NOT NULL DEFAULT 'NOTA_CREDITO', -- ANULACION | NOTA_CREDITO
  motivo           TEXT,
  monto_devuelto   NUMERIC(12,2) DEFAULT 0,
  estado_sunat     TEXT DEFAULT 'PENDIENTE', -- PENDIENTE | ENVIADO | ERROR
  hash_sunat       TEXT,
  procesado_por    INT REFERENCES usuarios(id_usuario),
  id_ticket        INT, -- referencia al ticket de soporte que originó esto
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Detalle de ítems devueltos (para devoluciones parciales)
CREATE TABLE IF NOT EXISTS nota_credito_detalle (
  id               SERIAL PRIMARY KEY,
  id_nota          INT NOT NULL REFERENCES notas_credito(id_nota) ON DELETE CASCADE,
  id_producto      INT,
  nombre_producto  TEXT,
  cantidad_devuelta INT NOT NULL DEFAULT 1,
  precio_unitario  NUMERIC(12,2) DEFAULT 0,
  subtotal_devuelto NUMERIC(12,2) DEFAULT 0,
  id_lote          INT REFERENCES inventario_lotes(id_lote) -- para revertir al lote correcto
);

-- 4. Índices para rendimiento
CREATE INDEX IF NOT EXISTS idx_notas_credito_venta ON notas_credito(id_venta_original);
CREATE INDEX IF NOT EXISTS idx_notas_credito_sucursal ON notas_credito(id_sucursal);
