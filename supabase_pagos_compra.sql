-- =====================================================
-- TABLA: pagos_compra
-- Historial de abonos a facturas de crédito
-- Ejecutar en Supabase → SQL Editor
-- =====================================================

CREATE TABLE IF NOT EXISTS pagos_compra (
  id_pago         BIGSERIAL PRIMARY KEY,
  id_compra       BIGINT NOT NULL REFERENCES compras(id_compra) ON DELETE CASCADE,
  monto           NUMERIC(10,2) NOT NULL CHECK (monto > 0),
  fecha_pago      DATE NOT NULL DEFAULT CURRENT_DATE,
  metodo_pago     TEXT NOT NULL DEFAULT 'Efectivo',   -- Efectivo | Transferencia | Cheque | Yape | Otro
  referencia      TEXT,                               -- Nro. de operación, cheque, etc. (opcional)
  observacion     TEXT,
  id_usuario      BIGINT,                             -- quién registró el pago
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice para consultas rápidas por factura
CREATE INDEX IF NOT EXISTS idx_pagos_compra_id_compra ON pagos_compra(id_compra);

-- Comentarios
COMMENT ON TABLE  pagos_compra           IS 'Historial de abonos parciales o totales a facturas de crédito de proveedores';
COMMENT ON COLUMN pagos_compra.id_compra IS 'Referencia a la factura de compra (tabla compras)';
COMMENT ON COLUMN pagos_compra.monto     IS 'Monto abonado en este pago';
