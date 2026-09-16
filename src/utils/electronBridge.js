/**
 * Helpers para la capa Electron (aditiva).
 * En Chrome/web: window.electronAPI no existe → fallbacks normales.
 */

export function isElectronApp() {
  return typeof window !== 'undefined' && !!window.electronAPI?.isElectron
}

/**
 * Suscribe a F1–F8 enviadas desde el main process.
 * @param {(key: string) => void} callback
 * @returns {() => void} unsubscribe
 */
export function onElectronFunctionKey(callback) {
  if (!isElectronApp() || typeof window.electronAPI.onFunctionKey !== 'function') {
    return () => {}
  }
  return window.electronAPI.onFunctionKey(callback)
}

/**
 * Imprime ticket: Electron/USB si está disponible; si no o falla → window.print().
 * @param {object} payload — datos del ticket (o { test: true })
 * @param {{ fallbackPrint?: () => void }} [opts]
 * @returns {Promise<{ ok: boolean, via: 'thermal'|'window.print', error?: string }>}
 */
export async function printTicket(payload, opts = {}) {
  const fallback = typeof opts.fallbackPrint === 'function'
    ? opts.fallbackPrint
    : () => { window.print() }

  if (!isElectronApp() || typeof window.electronAPI.printTicket !== 'function') {
    fallback()
    return { ok: true, via: 'window.print' }
  }

  try {
    const result = await window.electronAPI.printTicket(payload)
    if (result?.ok) {
      console.info('[printTicket] OK vía térmica ESC/POS', result)
      return { ok: true, via: 'thermal' }
    }
    console.error(
      // El fallback lo decide quien llama: el cierre de caja pasa uno vacío
      // justo para que nunca aparezca el diálogo de impresión de Windows.
      '[printTicket] Térmica falló → ejecutando fallback del llamador',
      '\n  step:', result?.step,
      '\n  interface:', result?.interface,
      '\n  error:', result?.error,
    )
    fallback()
    return { ok: false, via: 'window.print', error: result?.error }
  } catch (err) {
    console.error('[printTicket] Error IPC → fallback del llamador:', err)
    fallback()
    return { ok: false, via: 'window.print', error: err?.message || String(err) }
  }
}

/** API de configuración de impresoras (solo Electron). */
export function getPrintersApi() {
  if (!isElectronApp() || !window.electronAPI?.printers) return null
  return window.electronAPI.printers
}

/** Nubefact vía proceso principal (sin CORS). */
export function getNubefactApi() {
  if (!isElectronApp() || !window.electronAPI?.nubefact) return null
  return window.electronAPI.nubefact
}
