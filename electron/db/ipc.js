/**
 * Registro de handlers IPC para la DB SQLite local.
 */

import { ipcMain } from 'electron'
import * as sqlite from './sqlite.js'

const LOG = '[electron:db-ipc]'

function wrap(name, fn) {
  return async (_event, ...args) => {
    try {
      return await fn(...args)
    } catch (err) {
      console.error(`${LOG} ${name} ERROR:`, err)
      return { ok: false, error: err?.message || String(err) }
    }
  }
}

export function registerSqliteIpc() {
  ipcMain.handle('db:init', wrap('init', () => sqlite.initSqlite()))
  ipcMain.handle('db:path', wrap('path', () => ({ ok: true, path: sqlite.getDbPath() })))
  ipcMain.handle('db:getMeta', wrap('getMeta', (key) => ({ ok: true, value: sqlite.getMeta(key) })))
  ipcMain.handle('db:setMeta', wrap('setMeta', (key, value) => sqlite.setMeta(key, value)))
  ipcMain.handle('db:catalogCount', wrap('catalogCount', () => ({ ok: true, count: sqlite.catalogCount() })))
  ipcMain.handle('db:replaceCatalog', wrap('replaceCatalog', (payload) => sqlite.replaceCatalog(payload || {})))
  ipcMain.handle('db:replaceCatalogStock', wrap('replaceCatalogStock', (payload) => sqlite.replaceCatalogStock(payload || {})))
  ipcMain.handle('db:searchProductos', wrap('searchProductos', (termino, limit) => ({
    ok: true,
    rows: sqlite.searchProductos(termino, limit),
  })))
  ipcMain.handle('db:getFormasVenta', wrap('getFormasVenta', (idProducto) => ({
    ok: true,
    rows: sqlite.getFormasVenta(idProducto),
  })))
  ipcMain.handle('db:listUnidades', wrap('listUnidades', () => ({
    ok: true,
    rows: sqlite.listUnidades(),
  })))
  ipcMain.handle('db:getProductoStock', wrap('getProductoStock', (idProducto) => ({
    ok: true,
    stock: sqlite.getProductoStock(idProducto),
  })))
  ipcMain.handle('db:costosCatalogo', wrap('costosCatalogo', (ids) => ({
    ok: true,
    rows: sqlite.costosCatalogo(ids || []),
  })))
  ipcMain.handle('db:enqueueVenta', wrap('enqueueVenta', (payload) => sqlite.enqueueVenta(payload)))
  ipcMain.handle('db:listPending', wrap('listPending', () => ({
    ok: true,
    rows: sqlite.listPendingVentas(),
  })))
  ipcMain.handle('db:countPending', wrap('countPending', () => ({
    ok: true,
    count: sqlite.countPending(),
  })))
  ipcMain.handle('db:markSynced', wrap('markSynced', (idLocal, idVenta) => sqlite.markSynced(idLocal, idVenta)))
  ipcMain.handle('db:incrementAttempts', wrap('incrementAttempts', (idLocal, lastError) =>
    sqlite.incrementAttempts(idLocal, lastError)))
  ipcMain.handle('db:clearSynced', wrap('clearSynced', () => sqlite.clearSynced()))
  ipcMain.handle('db:importPending', wrap('importPending', (rows) => sqlite.importPendingFromIdb(rows || [])))
  ipcMain.handle('db:markIdbMigrated', wrap('markIdbMigrated', () => sqlite.markIdbMigrated()))
  ipcMain.handle('db:patchPendingPayload', wrap('patchPendingPayload', (idLocal, campos) =>
    sqlite.patchPendingPayload(idLocal, campos || {})))
  console.log(`${LOG} handlers registrados`)
}
