import { contextBridge, ipcRenderer } from 'electron'

/** Debe coincidir con webContents.send en main.js */
const FUNCTION_KEY_CHANNEL = 'function-key'

/**
 * Bridge seguro Main ↔ Renderer.
 * El renderer NUNCA ve ipcRenderer ni Node — solo esta API.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,

  /** Suscribe a F1–F8. Devuelve función para cancelar la suscripción. */
  onFunctionKey: (callback) => {
    if (typeof callback !== 'function') return () => {}
    const handler = (_event, key) => {
      try {
        callback(key)
      } catch (err) {
        console.error('[electronAPI.onFunctionKey]', err)
      }
    }
    ipcRenderer.on(FUNCTION_KEY_CHANNEL, handler)
    return () => {
      ipcRenderer.removeListener(FUNCTION_KEY_CHANNEL, handler)
    }
  },

  /**
   * Imprime ticket térmico vía main (USB / ESC/POS).
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  printTicket: (payload) => ipcRenderer.invoke('print-ticket', payload),

  /** Estado de la impresora (smoke-test / diagnóstico). */
  getPrinterStatus: () => ipcRenderer.invoke('printer-status'),

  /** Configuración de impresora térmica (por máquina). */
  printers: {
    list: () => ipcRenderer.invoke('printers:list'),
    getConfig: () => ipcRenderer.invoke('printers:getConfig'),
    setConfig: (payload) => ipcRenderer.invoke('printers:setConfig', payload),
    test: (payload) => ipcRenderer.invoke('printers:test', payload),
  },

  /** SQLite local (Día 2) — API tipada, no SQL libre desde el renderer. */
  db: {
    init: () => ipcRenderer.invoke('db:init'),
    path: () => ipcRenderer.invoke('db:path'),
    getMeta: (key) => ipcRenderer.invoke('db:getMeta', key),
    setMeta: (key, value) => ipcRenderer.invoke('db:setMeta', key, value),
    catalogCount: () => ipcRenderer.invoke('db:catalogCount'),
    replaceCatalog: (payload) => ipcRenderer.invoke('db:replaceCatalog', payload),
    searchProductos: (termino, limit) => ipcRenderer.invoke('db:searchProductos', termino, limit),
    getFormasVenta: (idProducto) => ipcRenderer.invoke('db:getFormasVenta', idProducto),
    listUnidades: () => ipcRenderer.invoke('db:listUnidades'),
    getProductoStock: (idProducto) => ipcRenderer.invoke('db:getProductoStock', idProducto),
    costosCatalogo: (ids) => ipcRenderer.invoke('db:costosCatalogo', ids),
    enqueueVenta: (payload) => ipcRenderer.invoke('db:enqueueVenta', payload),
    listPending: () => ipcRenderer.invoke('db:listPending'),
    countPending: () => ipcRenderer.invoke('db:countPending'),
    markSynced: (idLocal, idVenta) => ipcRenderer.invoke('db:markSynced', idLocal, idVenta),
    incrementAttempts: (idLocal, lastError) => ipcRenderer.invoke('db:incrementAttempts', idLocal, lastError),
    clearSynced: () => ipcRenderer.invoke('db:clearSynced'),
    importPending: (rows) => ipcRenderer.invoke('db:importPending', rows),
    markIdbMigrated: () => ipcRenderer.invoke('db:markIdbMigrated'),
    patchPendingPayload: (idLocal, campos) => ipcRenderer.invoke('db:patchPendingPayload', idLocal, campos),
  },

  /** Auto-actualización (eventos discreto/listo). Devuelve unsubscribe. */
  onUpdaterEvent: (callback) => {
    if (typeof callback !== 'function') return () => {}
    const handler = (_event, payload) => {
      try { callback(payload) } catch (err) {
        console.error('[electronAPI.onUpdaterEvent]', err)
      }
    }
    ipcRenderer.on('updater:event', handler)
    return () => ipcRenderer.removeListener('updater:event', handler)
  },

  /** Nubefact / SUNAT — HTTP solo en el proceso principal (sin CORS). */
  nubefact: {
    configurado: () => ipcRenderer.invoke('nubefact:configurado'),
    emitir: (datosVenta) => ipcRenderer.invoke('nubefact:emitir', datosVenta),
    consultar: (tipoComprobante, serie, numero) =>
      ipcRenderer.invoke('nubefact:consultar', { tipoComprobante, serie, numero }),
    anular: (payload) => ipcRenderer.invoke('nubefact:anular', payload),
  },
})

console.log('[electron:preload] electronAPI expuesto (print + db + nubefact + updater)')
