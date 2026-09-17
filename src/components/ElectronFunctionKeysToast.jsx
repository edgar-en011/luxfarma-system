import { useEffect, useState } from 'react'
import { isElectronApp, onElectronFunctionKey } from '../utils/electronBridge'

/**
 * Día 1 Electron: solo confirma que F1–F8 llegan desde main.
 * Sin acciones de negocio — el mapeo real (F2=Cobrar, etc.) va en otra sesión.
 *
 * Se monta siempre desde App (sin depender de rol/ruta). Si no hay electronAPI,
 * no se suscribe (Chrome/web intacto).
 */
export default function ElectronFunctionKeysToast() {
  const [toast, setToast] = useState(null)

  useEffect(() => {
    const hasApi = isElectronApp()
    console.info('[ElectronFunctionKeysToast] montado — electronAPI:', hasApi)

    if (!hasApi) {
      // Solo ruido de diagnóstico dentro de Electron; en Chrome es normal.
      if (/Electron/i.test(navigator.userAgent || '')) {
        console.warn(
          '[ElectronFunctionKeysToast] window.electronAPI ausente: el preload no cargó. F1–F8 no tendrán toast.',
        )
      }
      return undefined
    }

    const unsubscribe = onElectronFunctionKey((key) => {
      console.info(`[Electron] Se presionó ${key}`)
      setToast(`Se presionó ${key}`)
    })

    return () => {
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), 2200)
    return () => clearTimeout(t)
  }, [toast])

  if (!toast) return null

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 100000,
        background: 'var(--lf-primary-dark)',
        color: 'var(--lf-bg)',
        padding: '0.75rem 1.25rem',
        borderRadius: 12,
        fontWeight: 700,
        fontSize: '0.95rem',
        boxShadow: '0 12px 40px rgba(31, 26, 27, 0.35)',
        border: '1px solid #3F3F46',
        pointerEvents: 'none',
      }}
    >
      {toast}
    </div>
  )
}
