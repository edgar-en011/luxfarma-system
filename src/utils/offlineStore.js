/**
 * Adaptador offline unificado.
 * - Electron → SQLite (main process vía IPC)
 * - Web/PWA → IndexedDB (misma DB luxfarma_offline)
 */

import { isElectronApp } from './electronBridge'

const DB_NAME = 'luxfarma_offline'
/** v5: stores de formas/unidades en web (create-if-missing en upgrade). */
const DB_VERSION = 5
const STORE_VENTAS = 'ventas_pendientes'
const STORE_PRODUCTOS = 'catalogo_productos'
const STORE_FORMAS = 'catalogo_formas'
const STORE_UNIDADES = 'catalogo_unidades'

const LOG = '[offlineStore]'

let migrationPromise = null

function electronDb() {
  return window.electronAPI?.db
}

function abrirIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(STORE_VENTAS)) {
        const sv = db.createObjectStore(STORE_VENTAS, { keyPath: 'id_local', autoIncrement: true })
        sv.createIndex('fecha_creacion', 'fecha_creacion', { unique: false })
        sv.createIndex('sincronizado', 'sincronizado', { unique: false })
      }
      if (!db.objectStoreNames.contains(STORE_PRODUCTOS)) {
        const sp = db.createObjectStore(STORE_PRODUCTOS, { keyPath: 'id_producto' })
        sp.createIndex('descripcion', 'descripcion', { unique: false })
        sp.createIndex('codigo_barras', 'codigo_barras', { unique: false })
      }
      // Stores extra para formas/unidades en web (versión misma; create-if-missing)
      if (!db.objectStoreNames.contains(STORE_FORMAS)) {
        db.createObjectStore(STORE_FORMAS, { keyPath: 'id_forma' })
      }
      if (!db.objectStoreNames.contains(STORE_UNIDADES)) {
        db.createObjectStore(STORE_UNIDADES, { keyPath: 'id_medida' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGetAllPendingRaw() {
  const db = await abrirIdb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_VENTAS, 'readonly')
    const store = tx.objectStore(STORE_VENTAS)
    const idx = store.index('sincronizado')
    const req = idx.getAll(0)
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error)
  })
}

/** One-shot: cola IndexedDB → SQLite en Electron. */
export async function ensureOfflineReady() {
  if (!isElectronApp() || !electronDb()) return { ok: true, electron: false }
  if (migrationPromise) return migrationPromise

  migrationPromise = (async () => {
    await electronDb().init()
    const meta = await electronDb().getMeta('idb_migrated')
    if (meta?.value === '1') {
      console.info(`${LOG} migración IDB→SQLite ya hecha`)
      return { ok: true, electron: true, migrated: false }
    }
    try {
      const pending = await idbGetAllPendingRaw()
      if (pending.length > 0) {
        console.info(`${LOG} migrando ${pending.length} ventas pendientes IDB→SQLite…`)
        const res = await electronDb().importPending(pending)
        console.info(`${LOG} migración OK`, res)
      } else {
        await electronDb().markIdbMigrated()
        console.info(`${LOG} sin pendientes IDB; marcado idb_migrated`)
      }
      return { ok: true, electron: true, migrated: pending.length > 0, count: pending.length }
    } catch (err) {
      console.error(`${LOG} migración IDB falló (se reintentará):`, err)
      migrationPromise = null
      return { ok: false, error: err?.message || String(err) }
    }
  })()

  return migrationPromise
}

export async function guardarVentaOffline(payload) {
  await ensureOfflineReady()
  if (isElectronApp() && electronDb()) {
    const res = await electronDb().enqueueVenta(payload)
    if (res?.error) throw new Error(res.error)
    return res.id_local
  }
  const db = await abrirIdb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_VENTAS, 'readwrite')
    const store = tx.objectStore(STORE_VENTAS)
    const registro = {
      ...payload,
      sincronizado: 0,
      fecha_creacion: new Date().toISOString(),
      intentos: 0,
    }
    const req = store.add(registro)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function obtenerVentasPendientes() {
  await ensureOfflineReady()
  if (isElectronApp() && electronDb()) {
    const res = await electronDb().listPending()
    if (res?.error) throw new Error(res.error)
    return res.rows || []
  }
  return idbGetAllPendingRaw()
}

export async function marcarSincronizada(id_local, id_venta_supabase) {
  await ensureOfflineReady()
  if (isElectronApp() && electronDb()) {
    return electronDb().markSynced(id_local, id_venta_supabase)
  }
  const db = await abrirIdb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_VENTAS, 'readwrite')
    const store = tx.objectStore(STORE_VENTAS)
    const req = store.get(id_local)
    req.onsuccess = () => {
      const registro = req.result
      if (!registro) return resolve()
      registro.sincronizado = 1
      registro.id_venta_supabase = id_venta_supabase
      registro.fecha_sincronizacion = new Date().toISOString()
      store.put(registro)
      resolve()
    }
    req.onerror = () => reject(req.error)
  })
}

export async function limpiarSincronizadas() {
  await ensureOfflineReady()
  if (isElectronApp() && electronDb()) {
    return electronDb().clearSynced()
  }
  const db = await abrirIdb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_VENTAS, 'readwrite')
    const store = tx.objectStore(STORE_VENTAS)
    const idx = store.index('sincronizado')
    const req = idx.openCursor(1)
    req.onsuccess = (e) => {
      const cursor = e.target.result
      if (cursor) { cursor.delete(); cursor.continue() }
      else resolve()
    }
    req.onerror = () => reject(req.error)
  })
}

export async function contarPendientes() {
  try {
    await ensureOfflineReady()
    if (isElectronApp() && electronDb()) {
      const res = await electronDb().countPending()
      return Number(res?.count || 0)
    }
    const pendientes = await obtenerVentasPendientes()
    return pendientes.length
  } catch { return 0 }
}

export async function persistirCamposVentaPendiente(id_local, campos = {}) {
  await ensureOfflineReady()
  if (isElectronApp() && electronDb()) {
    const res = await electronDb().patchPendingPayload(id_local, campos)
    if (res?.error) throw new Error(res.error)
    return res
  }
  const db = await abrirIdb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_VENTAS, 'readwrite')
    const store = tx.objectStore(STORE_VENTAS)
    const req = store.get(id_local)
    req.onsuccess = () => {
      const registro = req.result
      if (!registro) return resolve()
      Object.assign(registro, campos)
      store.put(registro)
      resolve()
    }
    req.onerror = () => reject(req.error)
  })
}

export async function incrementarIntentos(id_local, lastError = null) {
  await ensureOfflineReady()
  if (isElectronApp() && electronDb()) {
    return electronDb().incrementAttempts(id_local, lastError)
  }
  const db = await abrirIdb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_VENTAS, 'readwrite')
    const store = tx.objectStore(STORE_VENTAS)
    const req = store.get(id_local)
    req.onsuccess = () => {
      const registro = req.result
      if (!registro) return resolve()
      registro.intentos = (registro.intentos || 0) + 1
      if (lastError) registro.last_error = lastError
      store.put(registro)
      resolve()
    }
    req.onerror = () => reject(req.error)
  })
}

/**
 * Guarda snapshot de catálogo (productos + formas + unidades + lotes).
 * Electron → SQLite; web → IndexedDB.
 */
export async function guardarCatalogoLocal({
  id_sucursal = null,
  productos = [],
  formas = [],
  unidades = [],
  lotes = [],
} = {}) {
  await ensureOfflineReady()
  if (isElectronApp() && electronDb()) {
    const res = await electronDb().replaceCatalog({
      id_sucursal, productos, formas, unidades, lotes,
    })
    if (res?.error) throw new Error(res.error)
    return res
  }

  const db = await abrirIdb()
  await new Promise((resolve, reject) => {
    const stores = [STORE_PRODUCTOS]
    if (db.objectStoreNames.contains(STORE_FORMAS)) stores.push(STORE_FORMAS)
    if (db.objectStoreNames.contains(STORE_UNIDADES)) stores.push(STORE_UNIDADES)
    const tx = db.transaction(stores, 'readwrite')
    const sp = tx.objectStore(STORE_PRODUCTOS)
    sp.clear()
    productos.forEach((p) => sp.put(p))
    if (db.objectStoreNames.contains(STORE_FORMAS)) {
      const sf = tx.objectStore(STORE_FORMAS)
      sf.clear()
      formas.forEach((f) => {
        if (f.id_forma != null) sf.put(f)
      })
    }
    if (db.objectStoreNames.contains(STORE_UNIDADES)) {
      const su = tx.objectStore(STORE_UNIDADES)
      su.clear()
      unidades.forEach((u) => su.put(u))
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  return { ok: true, total: productos.length }
}

/** Actualiza existencias de productos puntuales sin reemplazar el catálogo completo. */
export async function actualizarStockCatalogoLocal({ id_sucursal = null, productos = [], lotes = [] } = {}) {
  if (!productos.length) return { ok: true, total: 0 }
  await ensureOfflineReady()
  if (isElectronApp() && electronDb()?.replaceCatalogStock) {
    const result = await electronDb().replaceCatalogStock({ id_sucursal, productos, lotes })
    if (result?.error) throw new Error(result.error)
    return result
  }

  const db = await abrirIdb()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PRODUCTOS, 'readwrite')
    const store = tx.objectStore(STORE_PRODUCTOS)
    for (const cambio of productos) {
      const req = store.get(cambio.id_producto)
      req.onsuccess = () => {
        if (!req.result) return
        store.put({
          ...req.result,
          totalStock: Math.max(0, Number(cambio.totalStock) || 0),
          loteActual: cambio.loteActual || null,
          fechaVenceStr: cambio.fechaVenceStr || '',
          ultima_actualizacion: new Date().toISOString(),
        })
      }
      req.onerror = () => reject(req.error)
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  return { ok: true, total: productos.length }
}

export async function buscarProductosOffline(termino) {
  await ensureOfflineReady()
  if (isElectronApp() && electronDb()) {
    const res = await electronDb().searchProductos(termino, 30)
    if (res?.error) {
      console.error(`${LOG} searchProductos:`, res.error)
      return []
    }
    return res.rows || []
  }

  try {
    const db = await abrirIdb()
    const terminoLower = String(termino || '').toLowerCase().trim()
    const todos = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PRODUCTOS, 'readonly')
      const store = tx.objectStore(STORE_PRODUCTOS)
      const req = store.getAll()
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    })
    return todos
      .filter((p) =>
        p.descripcion?.toLowerCase().includes(terminoLower)
        || p.codigo_barras?.toLowerCase().includes(terminoLower))
      .sort((a, b) => {
        const da = String(a.descripcion || '').toLowerCase()
        const db = String(b.descripcion || '').toLowerCase()
        const sa = da.startsWith(terminoLower) ? 0 : (da.split(/[\s\-/]+/).some((w) => w.startsWith(terminoLower)) ? 1 : 2)
        const sb = db.startsWith(terminoLower) ? 0 : (db.split(/[\s\-/]+/).some((w) => w.startsWith(terminoLower)) ? 1 : 2)
        if (sa !== sb) return sa - sb
        return da.localeCompare(db, 'es')
      })
      .slice(0, 30)
      .map((p) => ({
        id_producto: p.id_producto,
        codigo_barras: p.codigo_barras,
        descripcion: p.descripcion,
        laboratorio: p.laboratorio || '',
        laboratorios: p.laboratorio ? { nombre: p.laboratorio } : (p.laboratorios || null),
        fraccionCaja: p.fraccionCaja,
        totalStock: p.totalStock,
        fechaVenceStr: p.fechaVenceStr,
        currentLot: p.loteActual ? { nro_lote: p.loteActual.nro_lote } : null,
        producto_precios: [{ precio_venta: p.precio_venta, precio_caja: p.precio_caja, costo: p.costo }],
        producto_fraccionado_config: [],
      }))
  } catch (err) {
    console.error(`${LOG} búsqueda IDB:`, err)
    return []
  }
}

export async function catalogoTieneDatos() {
  await ensureOfflineReady()
  if (isElectronApp() && electronDb()) {
    const res = await electronDb().catalogCount()
    return Number(res?.count || 0) > 0
  }
  try {
    const db = await abrirIdb()
    const count = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PRODUCTOS, 'readonly')
      const store = tx.objectStore(STORE_PRODUCTOS)
      const req = store.count()
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    return count > 0
  } catch {
    return false
  }
}

export async function obtenerFormasVentaOffline(idProducto) {
  await ensureOfflineReady()
  if (isElectronApp() && electronDb()) {
    const res = await electronDb().getFormasVenta(idProducto)
    if (res?.error) return [{ id_medida: 1, factor: 1, precio_venta: 0, unidades_medida: { nombre: 'UNIDAD' } }]
    return res.rows || []
  }
  try {
    const db = await abrirIdb()
    if (!db.objectStoreNames.contains(STORE_FORMAS)) {
      return [{ id_medida: 1, factor: 1, precio_venta: 0, unidades_medida: { nombre: 'UNIDAD' } }]
    }
    const todas = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_FORMAS, 'readonly')
      const req = tx.objectStore(STORE_FORMAS).getAll()
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    })
    const formas = todas
      .filter((f) => f.id_producto === idProducto && f.activo !== false && f.activo !== 0)
      .sort((a, b) => (a.orden || 0) - (b.orden || 0))
    if (!formas.length) {
      return [{ id_medida: 1, factor: 1, precio_venta: 0, unidades_medida: { nombre: 'UNIDAD' } }]
    }
    return formas.map((f) => ({
      ...f,
      unidades_medida: f.unidades_medida || { id_medida: f.id_medida, nombre: f.medida_nombre || 'UNIDAD' },
    }))
  } catch {
    return [{ id_medida: 1, factor: 1, precio_venta: 0, unidades_medida: { nombre: 'UNIDAD' } }]
  }
}

export async function obtenerUnidadesOffline() {
  await ensureOfflineReady()
  if (isElectronApp() && electronDb()) {
    const res = await electronDb().listUnidades()
    return res?.rows || []
  }
  try {
    const db = await abrirIdb()
    if (!db.objectStoreNames.contains(STORE_UNIDADES)) return []
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_UNIDADES, 'readonly')
      const req = tx.objectStore(STORE_UNIDADES).getAll()
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    })
  } catch {
    return []
  }
}

export async function obtenerStockLocalProducto(idProducto) {
  await ensureOfflineReady()
  if (isElectronApp() && electronDb()) {
    const res = await electronDb().getProductoStock(idProducto)
    return Number(res?.stock || 0)
  }
  try {
    const db = await abrirIdb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PRODUCTOS, 'readonly')
      const req = tx.objectStore(STORE_PRODUCTOS).get(idProducto)
      req.onsuccess = () => resolve(Number(req.result?.totalStock || 0))
      req.onerror = () => reject(req.error)
    })
  } catch {
    return 0
  }
}

export async function obtenerCostosCatalogoLocal(ids) {
  const lista = [...new Set((ids || []).map((id) => Number(id)).filter(Boolean))]
  const map = new Map()
  if (!lista.length) return map
  await ensureOfflineReady()
  if (isElectronApp() && electronDb()?.costosCatalogo) {
    const res = await electronDb().costosCatalogo(lista)
    for (const row of res?.rows || []) {
      map.set(Number(row.id_producto), Number(row.costo) || 0)
    }
    return map
  }
  try {
    const db = await abrirIdb()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PRODUCTOS, 'readonly')
      const store = tx.objectStore(STORE_PRODUCTOS)
      let pending = lista.length
      if (!pending) {
        resolve()
        return
      }
      for (const id of lista) {
        const req = store.get(id)
        req.onsuccess = () => {
          const p = req.result
          if (p) map.set(id, Number(p.costo ?? p.producto_precios?.[0]?.costo) || 0)
          pending -= 1
          if (pending === 0) resolve()
        }
        req.onerror = () => reject(req.error)
      }
    })
  } catch (err) {
    console.error(`${LOG} costos locales:`, err)
  }
  return map
}

export async function setMetaLocal(key, value) {
  if (isElectronApp() && electronDb()) {
    return electronDb().setMeta(key, value)
  }
  return { ok: true }
}

export async function getMetaLocal(key) {
  if (isElectronApp() && electronDb()) {
    const res = await electronDb().getMeta(key)
    return res?.value ?? null
  }
  return null
}

export { isElectronApp }
