// ============================================================
// offlineQueue.js — reexporta la cola offline unificada (SQLite / IndexedDB)
// ============================================================

export {
  guardarVentaOffline,
  obtenerVentasPendientes,
  marcarSincronizada,
  limpiarSincronizadas,
  contarPendientes,
  incrementarIntentos,
  persistirCamposVentaPendiente,
  ensureOfflineReady,
} from './offlineStore'
