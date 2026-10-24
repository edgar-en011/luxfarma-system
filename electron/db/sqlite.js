/**
 * SQLite local (better-sqlite3) — proceso main de Electron.
 * Una base por máquina en app.getPath('userData').
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'
import Database from 'better-sqlite3'

const LOG = '[electron:sqlite]'
const SCHEMA_VERSION = '3'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('better-sqlite3').Database | null} */
let db = null

function resolveSchemaPath() {
  const candidates = [
    path.join(__dirname, 'schema.sql'), // electron/db (dev source)
    path.join(__dirname, 'db/schema.sql'), // dist-electron/db (bundle)
    path.join(__dirname, '../db/schema.sql'),
    path.join(process.cwd(), 'electron/db/schema.sql'),
    path.join(process.cwd(), 'dist-electron/db/schema.sql'),
    path.join(app.getAppPath(), 'electron/db/schema.sql'),
    path.join(app.getAppPath(), 'dist-electron/db/schema.sql'),
  ]
  return candidates.find((p) => {
    try { return fs.existsSync(p) } catch { return false }
  })
}

function dbPath() {
  return path.join(app.getPath('userData'), 'luxfarma.sqlite')
}

export function getDbPath() {
  return dbPath()
}

export function initSqlite() {
  if (db) return { ok: true, path: dbPath(), alreadyOpen: true }

  const file = dbPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  console.log(`${LOG} abriendo`, file)

  db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  const schemaPath = resolveSchemaPath()
  if (!schemaPath) {
    console.error(`${LOG} schema.sql no encontrado`)
    throw new Error('schema.sql no encontrado')
  }
  const sql = fs.readFileSync(schemaPath, 'utf8')
  db.exec(sql)

  migrarSchemaSiHaceFalta()
  const ver = getMeta('schema_version')
  if (ver !== SCHEMA_VERSION) {
    setMeta('schema_version', SCHEMA_VERSION)
  }

  console.log(`${LOG} listo`, { path: file, schema_version: SCHEMA_VERSION })
  return { ok: true, path: file }
}

function ensureDb() {
  if (!db) initSqlite()
  return db
}

function tableHasColumn(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all()
  return cols.some((c) => c.name === column)
}

function migrarSchemaSiHaceFalta() {
  if (!tableHasColumn('ventas_pendientes', 'uuid_venta')) {
    db.exec('ALTER TABLE ventas_pendientes ADD COLUMN uuid_venta TEXT')
  }
  if (!tableHasColumn('productos', 'laboratorio')) {
    db.exec('ALTER TABLE productos ADD COLUMN laboratorio TEXT')
  }
  if (!tableHasColumn('productos', 'costo')) {
    db.exec('ALTER TABLE productos ADD COLUMN costo REAL NOT NULL DEFAULT 0')
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_ventas_pendientes_uuid
      ON ventas_pendientes(uuid_venta)
      WHERE uuid_venta IS NOT NULL
  `)
}

export function getMeta(key) {
  const row = ensureDb().prepare('SELECT value FROM meta WHERE key = ?').get(key)
  return row?.value ?? null
}

export function setMeta(key, value) {
  ensureDb()
    .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value == null ? null : String(value))
  return { ok: true }
}

export function catalogCount() {
  const row = ensureDb().prepare('SELECT COUNT(*) AS n FROM productos').get()
  return Number(row?.n || 0)
}

/**
 * Reemplaza catálogo local (productos, formas, unidades, lotes) y re-aplica
 * reservas de ventas pendientes no sincronizadas.
 */
export function replaceCatalog({
  id_sucursal = null,
  productos = [],
  formas = [],
  unidades = [],
  lotes = [],
} = {}) {
  const database = ensureDb()
  const tx = database.transaction(() => {
    database.exec(`
      DELETE FROM stock_reservas_offline;
      DELETE FROM inventario_lotes_local;
      DELETE FROM producto_formas_venta;
      DELETE FROM unidades_medida;
      DELETE FROM productos;
    `)

    const insU = database.prepare(
      'INSERT INTO unidades_medida (id_medida, nombre, activo) VALUES (@id_medida, @nombre, @activo)',
    )
    for (const u of unidades) {
      insU.run({
        id_medida: u.id_medida,
        nombre: u.nombre || String(u.id_medida),
        activo: u.activo == null ? 1 : Number(u.activo) ? 1 : 0,
      })
    }

    const insP = database.prepare(`
      INSERT INTO productos (
        id_producto, codigo_barras, descripcion, laboratorio, fraccion, fraccion_caja, activo,
        precio_venta, precio_caja, costo, total_stock, lote_nro, lote_vence, fecha_vence_str, updated_at
      ) VALUES (
        @id_producto, @codigo_barras, @descripcion, @laboratorio, @fraccion, @fraccion_caja, @activo,
        @precio_venta, @precio_caja, @costo, @total_stock, @lote_nro, @lote_vence, @fecha_vence_str, @updated_at
      )
    `)
    const now = new Date().toISOString()
    for (const p of productos) {
      insP.run({
        id_producto: p.id_producto,
        codigo_barras: p.codigo_barras || '',
        descripcion: p.descripcion || '',
        laboratorio: p.laboratorio || '',
        fraccion: p.fraccion ?? null,
        fraccion_caja: p.fraccionCaja ?? p.fraccion_caja ?? 1,
        activo: p.activo == null ? 1 : Number(p.activo) ? 1 : 0,
        precio_venta: Number(p.precio_venta || 0),
        precio_caja: Number(p.precio_caja || 0),
        costo: Number(p.costo || 0),
        total_stock: Number(p.totalStock ?? p.total_stock ?? 0),
        lote_nro: p.loteActual?.nro_lote || p.lote_nro || null,
        lote_vence: p.loteActual?.fecha_vencimiento || p.lote_vence || null,
        fecha_vence_str: p.fechaVenceStr || p.fecha_vence_str || '',
        updated_at: p.ultima_actualizacion || now,
      })
    }

    const insF = database.prepare(`
      INSERT INTO producto_formas_venta (
        id_forma, id_producto, id_medida, factor, precio_venta, p_compra, activo, orden
      ) VALUES (
        @id_forma, @id_producto, @id_medida, @factor, @precio_venta, @p_compra, @activo, @orden
      )
    `)
    for (const f of formas) {
      if (f.id_forma == null) continue
      insF.run({
        id_forma: f.id_forma,
        id_producto: f.id_producto,
        id_medida: f.id_medida,
        factor: Number(f.factor || 1),
        precio_venta: Number(f.precio_venta || 0),
        p_compra: f.p_compra == null ? null : Number(f.p_compra),
        activo: f.activo === false || f.activo === 0 ? 0 : 1,
        orden: Number(f.orden || 0),
      })
    }

    const insL = database.prepare(`
      INSERT INTO inventario_lotes_local (
        id_lote, id_producto, id_sucursal, nro_lote, fecha_vencimiento, cantidad_actual, estado
      ) VALUES (
        @id_lote, @id_producto, @id_sucursal, @nro_lote, @fecha_vencimiento, @cantidad_actual, @estado
      )
    `)
    for (const l of lotes) {
      if (l.id_lote == null) continue
      insL.run({
        id_lote: l.id_lote,
        id_producto: l.id_producto,
        id_sucursal: l.id_sucursal ?? id_sucursal,
        nro_lote: l.nro_lote || null,
        fecha_vencimiento: l.fecha_vencimiento || null,
        cantidad_actual: Number(l.cantidad_actual || 0),
        estado: l.estado || 'VIGENTE',
      })
    }

    setMeta('id_sucursal', id_sucursal == null ? '' : String(id_sucursal))
    setMeta('last_full_sync_at', now)

    // Re-aplicar reservas de ventas aún pendientes
    const pendientes = database.prepare(
      'SELECT id_local, payload_json FROM ventas_pendientes WHERE sincronizado = 0',
    ).all()
    for (const row of pendientes) {
      let payload
      try { payload = JSON.parse(row.payload_json) } catch { continue }
      applyReservasForVenta(database, row.id_local, payload?.carrito || [])
    }
  })

  tx()
  console.log(`${LOG} replaceCatalog`, {
    productos: productos.length,
    formas: formas.length,
    unidades: unidades.length,
    lotes: lotes.length,
    id_sucursal,
  })
  return { ok: true, total: productos.length }
}

function recalcProductoStock(database, idProducto) {
  const row = database.prepare(`
    SELECT COALESCE(SUM(cantidad_actual), 0) AS s
    FROM inventario_lotes_local
    WHERE id_producto = ? AND estado = 'VIGENTE' AND cantidad_actual > 0
      AND (fecha_vencimiento IS NULL OR date(fecha_vencimiento) >= date('now', 'localtime'))
  `).get(idProducto)
  const total = Number(row?.s || 0)
  const lote = database.prepare(`
    SELECT nro_lote, fecha_vencimiento FROM inventario_lotes_local
    WHERE id_producto = ? AND estado = 'VIGENTE' AND cantidad_actual > 0
      AND (fecha_vencimiento IS NULL OR date(fecha_vencimiento) >= date('now', 'localtime'))
    ORDER BY (fecha_vencimiento IS NULL), fecha_vencimiento ASC
    LIMIT 1
  `).get(idProducto)
  let fechaVenceStr = ''
  if (lote?.fecha_vencimiento) {
    const [year, month] = String(lote.fecha_vencimiento).split('-')
    fechaVenceStr = `${month}/${year}`
  }
  database.prepare(`
    UPDATE productos SET total_stock = ?, lote_nro = ?, lote_vence = ?, fecha_vence_str = ?, updated_at = ?
    WHERE id_producto = ?
  `).run(
    total,
    lote?.nro_lote || null,
    lote?.fecha_vencimiento || null,
    fechaVenceStr,
    new Date().toISOString(),
    idProducto,
  )
  return total
}

/** Descuenta FEFO en lotes locales y registra reservas. */
function applyReservasForVenta(database, idLocal, carrito, idsFiltrados = null) {
  const ids = idsFiltrados ? [...idsFiltrados] : null
  if (ids?.length) {
    const placeholders = ids.map(() => '?').join(',')
    database.prepare(`DELETE FROM stock_reservas_offline WHERE id_local = ? AND id_producto IN (${placeholders})`).run(idLocal, ...ids)
  } else {
    database.prepare('DELETE FROM stock_reservas_offline WHERE id_local = ?').run(idLocal)
  }
  const touched = new Set()
  const insR = database.prepare(
    'INSERT INTO stock_reservas_offline (id_local, id_producto, cantidad_base) VALUES (?, ?, ?)',
  )

  for (const item of carrito || []) {
    const idProducto = item.id_producto
    if (idsFiltrados && !idsFiltrados.has(Number(idProducto))) continue
    let restante = Number(item.cantidad || 0) * Number(item.factor || 1)
    if (!idProducto || restante <= 0) continue

    const lotes = database.prepare(`
      SELECT id_lote, cantidad_actual FROM inventario_lotes_local
      WHERE id_producto = ? AND estado = 'VIGENTE' AND cantidad_actual > 0
        AND (fecha_vencimiento IS NULL OR date(fecha_vencimiento) >= date('now', 'localtime'))
      ORDER BY (fecha_vencimiento IS NULL), fecha_vencimiento ASC
    `).all(idProducto)

    let descontado = 0
    for (const lote of lotes) {
      if (restante <= 0) break
      const take = Math.min(restante, Number(lote.cantidad_actual))
      const nueva = Number(lote.cantidad_actual) - take
      database.prepare(`
        UPDATE inventario_lotes_local
        SET cantidad_actual = ?, estado = ?
        WHERE id_lote = ?
      `).run(nueva, nueva <= 0 ? 'AGOTADO' : 'VIGENTE', lote.id_lote)
      restante -= take
      descontado += take
    }
    if (descontado > 0) {
      insR.run(idLocal, idProducto, descontado)
      touched.add(idProducto)
    }
  }
  for (const id of touched) recalcProductoStock(database, id)
}

/** Actualiza lotes de productos afectados sin reemplazar todo el catálogo. */
export function replaceCatalogStock({ id_sucursal = null, productos = [], lotes = [] } = {}) {
  const database = ensureDb()
  const ids = [...new Set(productos.map((p) => Number(p.id_producto)).filter(Number.isFinite))]
  if (!ids.length) return { ok: true, total: 0 }
  const idsSet = new Set(ids)
  const databaseTx = database.transaction(() => {
    const placeholders = ids.map(() => '?').join(',')
    database.prepare(`DELETE FROM inventario_lotes_local WHERE id_producto IN (${placeholders})`).run(...ids)
    const insLote = database.prepare(`
      INSERT INTO inventario_lotes_local (id_lote, id_producto, id_sucursal, nro_lote, fecha_vencimiento, cantidad_actual, estado)
      VALUES (@id_lote, @id_producto, @id_sucursal, @nro_lote, @fecha_vencimiento, @cantidad_actual, @estado)
    `)
    for (const lote of lotes) {
      if (lote.id_lote == null || !idsSet.has(Number(lote.id_producto))) continue
      insLote.run({
        id_lote: lote.id_lote,
        id_producto: lote.id_producto,
        id_sucursal: lote.id_sucursal ?? id_sucursal,
        nro_lote: lote.nro_lote || null,
        fecha_vencimiento: lote.fecha_vencimiento || null,
        cantidad_actual: Math.max(0, Number(lote.cantidad_actual) || 0),
        estado: lote.estado || 'VIGENTE',
      })
    }
    for (const id of ids) recalcProductoStock(database, id)
    const pendientes = database.prepare('SELECT id_local, payload_json FROM ventas_pendientes WHERE sincronizado = 0').all()
    for (const row of pendientes) {
      let payload
      try { payload = JSON.parse(row.payload_json) } catch { continue }
      applyReservasForVenta(database, row.id_local, payload?.carrito || [], idsSet)
    }
    setMeta('last_stock_sync_at', new Date().toISOString())
  })
  databaseTx()
  return { ok: true, total: ids.length }
}

export function searchProductos(termino, limit = 30) {
  const t = String(termino || '').trim().toLowerCase()
  if (t.length < 1) return []
  const like = `%${t}%`
  const starts = `${t}%`
  const rows = ensureDb().prepare(`
    SELECT * FROM productos
    WHERE activo = 1 AND (
      LOWER(descripcion) LIKE ? OR LOWER(IFNULL(codigo_barras,'')) LIKE ?
    )
    ORDER BY
      CASE WHEN LOWER(IFNULL(codigo_barras,'')) = ? THEN 0
           WHEN LOWER(descripcion) LIKE ? THEN 1
           ELSE 2 END,
      descripcion
    LIMIT ?
  `).all(like, like, t, starts, limit)

  return rows.map((p) => ({
    id_producto: p.id_producto,
    codigo_barras: p.codigo_barras,
    descripcion: p.descripcion,
    laboratorio: p.laboratorio || '',
    laboratorios: p.laboratorio ? { nombre: p.laboratorio } : null,
    fraccionCaja: p.fraccion_caja,
    totalStock: p.total_stock,
    fechaVenceStr: p.fecha_vence_str,
    currentLot: p.lote_nro ? { nro_lote: p.lote_nro } : null,
    producto_precios: [{ precio_venta: p.precio_venta, precio_caja: p.precio_caja, costo: p.costo }],
    producto_fraccionado_config: [],
  }))
}

export function getFormasVenta(idProducto) {
  const rows = ensureDb().prepare(`
    SELECT f.*, u.nombre AS medida_nombre
    FROM producto_formas_venta f
    LEFT JOIN unidades_medida u ON u.id_medida = f.id_medida
    WHERE f.id_producto = ? AND f.activo = 1
    ORDER BY f.orden ASC, f.id_forma ASC
  `).all(idProducto)

  if (!rows.length) {
    return [{ id_medida: 1, factor: 1, precio_venta: 0, unidades_medida: { nombre: 'UNIDAD' } }]
  }
  return rows.map((f) => ({
    id_forma: f.id_forma,
    id_producto: f.id_producto,
    id_medida: f.id_medida,
    factor: Number(f.factor || 1),
    precio_venta: Number(f.precio_venta || 0),
    p_compra: f.p_compra,
    activo: !!f.activo,
    orden: f.orden,
    unidades_medida: { id_medida: f.id_medida, nombre: f.medida_nombre || 'UNIDAD' },
  }))
}

export function listUnidades() {
  return ensureDb().prepare(
    'SELECT id_medida, nombre, activo FROM unidades_medida WHERE activo = 1 ORDER BY id_medida',
  ).all()
}

export function getProductoStock(idProducto) {
  const row = ensureDb().prepare('SELECT total_stock FROM productos WHERE id_producto = ?').get(idProducto)
  return Number(row?.total_stock || 0)
}

export function costosCatalogo(ids = []) {
  const lista = [...new Set((ids || []).map((id) => Number(id)).filter(Boolean))]
  if (!lista.length) return []
  const ph = lista.map(() => '?').join(',')
  return ensureDb()
    .prepare(`SELECT id_producto, costo FROM productos WHERE id_producto IN (${ph})`)
    .all(...lista)
    .map((r) => ({ id_producto: r.id_producto, costo: Number(r.costo) || 0 }))
}

export function enqueueVenta(payload) {
  const database = ensureDb()
  const fecha = new Date().toISOString()
  const uuid = payload?.uuid_venta || null
  const info = database.transaction(() => {
    const r = database.prepare(`
      INSERT INTO ventas_pendientes (payload_json, sincronizado, intentos, fecha_creacion, uuid_venta)
      VALUES (?, 0, 0, ?, ?)
    `).run(JSON.stringify(payload || {}), fecha, uuid)
    const idLocal = Number(r.lastInsertRowid)
    applyReservasForVenta(database, idLocal, payload?.carrito || [])
    return idLocal
  })()
  console.log(`${LOG} enqueueVenta id_local=`, info, 'uuid_venta=', uuid)
  return { ok: true, id_local: info }
}

export function listPendingVentas() {
  const rows = ensureDb().prepare(`
    SELECT id_local, payload_json, sincronizado, intentos, fecha_creacion, id_venta_supabase, last_error, uuid_venta
    FROM ventas_pendientes WHERE sincronizado = 0 ORDER BY id_local ASC
  `).all()
  return rows.map((r) => {
    let payload = {}
    try { payload = JSON.parse(r.payload_json) } catch { /* empty */ }
    return {
      ...payload,
      id_local: r.id_local,
      sincronizado: r.sincronizado,
      intentos: r.intentos,
      fecha_creacion: r.fecha_creacion,
      id_venta_supabase: r.id_venta_supabase,
      last_error: r.last_error,
      uuid_venta: payload.uuid_venta || r.uuid_venta || null,
    }
  })
}

/** Persiste campos en el JSON local (p. ej. uuid generado para colas viejas). */
export function patchPendingPayload(idLocal, campos = {}) {
  const database = ensureDb()
  const row = database.prepare(
    'SELECT payload_json, uuid_venta FROM ventas_pendientes WHERE id_local = ?',
  ).get(idLocal)
  if (!row) return { ok: false, error: 'no_encontrada' }
  let payload = {}
  try { payload = JSON.parse(row.payload_json) } catch { /* empty */ }
  const merged = { ...payload, ...campos }
  const uuid = merged.uuid_venta || row.uuid_venta || null
  database.prepare(`
    UPDATE ventas_pendientes
    SET payload_json = ?, uuid_venta = ?
    WHERE id_local = ?
  `).run(JSON.stringify(merged), uuid, idLocal)
  return { ok: true }
}

export function countPending() {
  const row = ensureDb().prepare(
    'SELECT COUNT(*) AS n FROM ventas_pendientes WHERE sincronizado = 0',
  ).get()
  return Number(row?.n || 0)
}

export function markSynced(idLocal, idVentaSupabase) {
  const database = ensureDb()
  database.transaction(() => {
    database.prepare(`
      UPDATE ventas_pendientes
      SET sincronizado = 1, id_venta_supabase = ?, fecha_sincronizacion = ?, last_error = NULL
      WHERE id_local = ?
    `).run(idVentaSupabase ?? null, new Date().toISOString(), idLocal)
    database.prepare('DELETE FROM stock_reservas_offline WHERE id_local = ?').run(idLocal)
  })()
  return { ok: true }
}

export function incrementAttempts(idLocal, lastError = null) {
  ensureDb().prepare(`
    UPDATE ventas_pendientes
    SET intentos = intentos + 1, last_error = ?
    WHERE id_local = ?
  `).run(lastError, idLocal)
  return { ok: true }
}

export function clearSynced() {
  ensureDb().prepare('DELETE FROM ventas_pendientes WHERE sincronizado = 1').run()
  return { ok: true }
}

/** Importa filas de IndexedDB (one-shot migración). */
export function importPendingFromIdb(rows = []) {
  const database = ensureDb()
  let imported = 0
  const tx = database.transaction(() => {
    for (const row of rows) {
      const { id_local: _ignore, ...rest } = row
      const payload = { ...rest }
      delete payload.sincronizado
      delete payload.fecha_sincronizacion
      delete payload.id_venta_supabase
      const fecha = row.fecha_creacion || new Date().toISOString()
      const r = database.prepare(`
        INSERT INTO ventas_pendientes (payload_json, sincronizado, intentos, fecha_creacion, uuid_venta)
        VALUES (?, 0, ?, ?, ?)
      `).run(JSON.stringify(payload), Number(row.intentos || 0), fecha, payload.uuid_venta || null)
      applyReservasForVenta(database, Number(r.lastInsertRowid), payload.carrito || [])
      imported++
    }
    setMeta('idb_migrated', '1')
  })
  tx()
  console.log(`${LOG} importPendingFromIdb`, { imported })
  return { ok: true, imported }
}

export function markIdbMigrated() {
  setMeta('idb_migrated', '1')
  return { ok: true }
}

export function closeSqlite() {
  if (db) {
    try { db.close() } catch { /* empty */ }
    db = null
  }
}
