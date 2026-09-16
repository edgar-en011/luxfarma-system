-- ═══════════════════════════════════════════════════
-- MIGRACIÓN: Sistema de notificaciones + Configuración
-- Ejecutar en Supabase SQL Editor
-- ═══════════════════════════════════════════════════

-- Tabla de notificaciones persistentes
CREATE TABLE IF NOT EXISTS notificaciones (
  id          BIGSERIAL PRIMARY KEY,
  usuario_id  BIGINT REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
  tipo        TEXT NOT NULL DEFAULT 'info'
                CHECK (tipo IN ('warn', 'err', 'ok', 'purp', 'info')),
  categoria   TEXT NOT NULL DEFAULT 'Sistema',
  mensaje     TEXT NOT NULL,
  leido       BOOLEAN NOT NULL DEFAULT FALSE,
  accion_label TEXT,
  accion_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notif_usuario_id  ON notificaciones(usuario_id);
CREATE INDEX IF NOT EXISTS idx_notif_leido       ON notificaciones(leido);
CREATE INDEX IF NOT EXISTS idx_notif_created_at  ON notificaciones(created_at DESC);

-- Tabla de configuración del sistema (fila única, id=1)
CREATE TABLE IF NOT EXISTS configuracion (
  id                   INTEGER PRIMARY KEY DEFAULT 1,
  nombre_farmacia      TEXT    NOT NULL DEFAULT 'Salud Futura',
  ruc                  TEXT    NOT NULL DEFAULT '',
  direccion            TEXT    NOT NULL DEFAULT '',
  modo_mantenimiento   BOOLEAN NOT NULL DEFAULT FALSE,
  ventas_sin_stock     BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insertar fila por defecto solo si no existe
INSERT INTO configuracion (id, nombre_farmacia, ruc, direccion)
VALUES (1, 'Salud Futura', '', '')
ON CONFLICT (id) DO NOTHING;
