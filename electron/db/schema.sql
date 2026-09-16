-- Salud Futura — SQLite local (Electron). Una DB por máquina.
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT
);

CREATE TABLE IF NOT EXISTS productos (
  id_producto INTEGER PRIMARY KEY NOT NULL,
  codigo_barras TEXT,
  descripcion TEXT NOT NULL,
  laboratorio TEXT,
  fraccion REAL,
  fraccion_caja REAL,
  activo INTEGER NOT NULL DEFAULT 1,
  precio_venta REAL NOT NULL DEFAULT 0,
  precio_caja REAL NOT NULL DEFAULT 0,
  costo REAL NOT NULL DEFAULT 0,
  total_stock REAL NOT NULL DEFAULT 0,
  lote_nro TEXT,
  lote_vence TEXT,
  fecha_vence_str TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_productos_descripcion ON productos(descripcion);
CREATE INDEX IF NOT EXISTS idx_productos_barras ON productos(codigo_barras);

CREATE TABLE IF NOT EXISTS unidades_medida (
  id_medida INTEGER PRIMARY KEY NOT NULL,
  nombre TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS producto_formas_venta (
  id_forma INTEGER PRIMARY KEY NOT NULL,
  id_producto INTEGER NOT NULL,
  id_medida INTEGER NOT NULL,
  factor REAL NOT NULL DEFAULT 1,
  precio_venta REAL NOT NULL DEFAULT 0,
  p_compra REAL,
  activo INTEGER NOT NULL DEFAULT 1,
  orden INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (id_producto) REFERENCES productos(id_producto),
  FOREIGN KEY (id_medida) REFERENCES unidades_medida(id_medida)
);

CREATE INDEX IF NOT EXISTS idx_formas_producto ON producto_formas_venta(id_producto);

CREATE TABLE IF NOT EXISTS inventario_lotes_local (
  id_lote INTEGER PRIMARY KEY NOT NULL,
  id_producto INTEGER NOT NULL,
  id_sucursal INTEGER,
  nro_lote TEXT,
  fecha_vencimiento TEXT,
  cantidad_actual REAL NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'VIGENTE',
  FOREIGN KEY (id_producto) REFERENCES productos(id_producto)
);

CREATE INDEX IF NOT EXISTS idx_lotes_producto ON inventario_lotes_local(id_producto, id_sucursal);

CREATE TABLE IF NOT EXISTS ventas_pendientes (
  id_local INTEGER PRIMARY KEY AUTOINCREMENT,
  payload_json TEXT NOT NULL,
  sincronizado INTEGER NOT NULL DEFAULT 0,
  intentos INTEGER NOT NULL DEFAULT 0,
  fecha_creacion TEXT NOT NULL,
  fecha_sincronizacion TEXT,
  id_venta_supabase INTEGER,
  last_error TEXT,
  uuid_venta TEXT
);

CREATE INDEX IF NOT EXISTS idx_ventas_sync ON ventas_pendientes(sincronizado);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ventas_pendientes_uuid
  ON ventas_pendientes(uuid_venta)
  WHERE uuid_venta IS NOT NULL;

CREATE TABLE IF NOT EXISTS stock_reservas_offline (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  id_local INTEGER NOT NULL,
  id_producto INTEGER NOT NULL,
  cantidad_base REAL NOT NULL,
  FOREIGN KEY (id_local) REFERENCES ventas_pendientes(id_local) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reservas_local ON stock_reservas_offline(id_local);
