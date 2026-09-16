import { useEffect, useState } from 'react'
import AlertaSistemaModal from './AlertaSistemaModal'
import './ActualizacionApp.css'

/**
 * Indicador discreto de descarga/instalación + aviso fuerte al terminar.
 * Solo Electron empaquetado (electronAPI.onUpdaterEvent).
 */
export default function ActualizacionApp() {
  const [estado, setEstado] = useState(null)

  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI : null
    if (!api?.onUpdaterEvent) return undefined
    return api.onUpdaterEvent((payload) => {
      if (!payload?.status) return
      if (payload.status === 'error') {
        console.warn('[updater]', payload.error)
        return
      }
      setEstado(payload)
    })
  }, [])

  if (!estado) return null

  const descargando = estado.status === 'downloading' || estado.status === 'available'
  const instalando = estado.status === 'installing'
  const listo = estado.status === 'ready'
  const percent = Math.max(0, Math.min(100, Number(estado.percent || 0)))

  return (
    <>
      {(descargando || instalando) && (
        <div className="sf-update-pill" role="status" aria-live="polite">
          <span className="sf-update-pill-label">
            {instalando ? 'Instalando…' : 'Descargando actualización…'}
          </span>
          <span className="sf-update-pill-bar" aria-hidden="true">
            <span
              className={`sf-update-pill-fill${instalando ? ' pulse' : ''}`}
              style={{ width: instalando ? '100%' : `${percent}%` }}
            />
          </span>
          {!instalando && <span className="sf-update-pill-pct">{Math.round(percent)}%</span>}
        </div>
      )}

      {listo && !estado.acked && (
        <AlertaSistemaModal
          zIndex={100080}
          alerta={{
            tipo: 'success',
            wide: true,
            mensaje: 'Nueva actualización instalada. Cierra y vuelve a abrir el sistema para que los cambios se apliquen.',
            textoBoton: 'Entendido',
          }}
          onClose={() => setEstado((prev) => (prev?.status === 'ready' ? { ...prev, acked: true } : prev))}
        />
      )}
    </>
  )
}
