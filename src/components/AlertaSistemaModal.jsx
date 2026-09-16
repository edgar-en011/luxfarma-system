import UiIcon from './UiIcon';
import { useEffect, useRef } from 'react'
import './AlertaSistemaModal.css'

/**
 * Modal "Mensaje del sistema" compartido.
 * Enter / Esc → Aceptar (o Esc → Cancelar si hay botón cancelar).
 * Listener en capture a nivel document para no perderse si el foco está fuera
 * (p. ej. otro overlay encima robó el focus).
 *
 * z-index por defecto 100050: debe quedar ENCIMA de formularios/modales de trabajo
 * (ProductoFormModal 100002, labs/relacionados 100003–100004, drawers 100001).
 * Si la alerta queda por debajo, el usuario solo la ve al cerrar el modal — flujo
 * invertido aparente. No usar la clase global `.modal-overlay-strict` aquí: varios
 * CSS de página le ponen z-index más bajo y pelean con el stacking.
 *
 * Props alerta (formas aceptadas):
 *   { mensaje, tipo, accion|accionConfirmar, textoBoton|textoConfirmar,
 *     accionCancelar?, textoCancelar? }
 */
export default function AlertaSistemaModal({
  alerta,
  onClose,
  overlayClassName = '',
  zIndex = 100050,
}) {
  const okRef = useRef(null)

  const mensaje = alerta?.mensaje ?? ''
  const tipo = alerta?.tipo || 'info'
  const textoOk = alerta?.textoBoton || alerta?.textoConfirmar || 'Aceptar'
  const textoCancelar = alerta?.textoCancelar || null
  const onOk = alerta?.accion || alerta?.accionConfirmar || null
  const onCancel = alerta?.accionCancelar || null

  const aceptar = () => {
    try {
      onOk?.()
    } finally {
      onClose?.()
    }
  }

  const cancelar = () => {
    try {
      onCancel?.()
    } finally {
      onClose?.()
    }
  }

  useEffect(() => {
    if (!alerta) return undefined
    const t = setTimeout(() => okRef.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [alerta])

  useEffect(() => {
    if (!alerta) return undefined

    const onKeyDownCapture = (e) => {
      if (e.key !== 'Enter' && e.key !== 'Escape') return
      // No interferir si el usuario escribe en un input de OTRO modal debajo
      // (este overlay bloquea interacción visual, pero por seguridad).
      const tag = e.target?.tagName
      if (tag === 'TEXTAREA' || (tag === 'INPUT' && e.target?.type !== 'button' && e.target?.type !== 'submit')) {
        // Las alertas del sistema no tienen campos; si el foco quedó en un input
        // bajo el overlay, igual cerramos con Enter/Esc (flujo tipado del POS).
      }
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape' && textoCancelar) {
        cancelar()
        return
      }
      aceptar()
    }

    document.addEventListener('keydown', onKeyDownCapture, true)
    return () => document.removeEventListener('keydown', onKeyDownCapture, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alerta, textoCancelar])

  if (!alerta) return null

  const iconoPorTipo = {
    success: 'Check',
    error: 'X',
    warning: 'AlertTriangle',
    info: 'Info',
  }
  const nombreIcono = iconoPorTipo[tipo] || iconoPorTipo.info

  return (
    <div
      className={`asm-overlay ${overlayClassName}`.trim()}
      style={{ zIndex }}
      data-keyboard-trap
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) aceptar()
      }}
    >
      <div className={`asm-card custom-alert-card${alerta.wide ? ' asm-card-wide' : ''}`} role="dialog" aria-modal="true" aria-label="Mensaje del sistema">
        <div className={`asm-icon alert-icon-big ${tipo}`} aria-hidden>
          <UiIcon name={nombreIcono} size={32} strokeWidth={2.6} />
        </div>
        <h3 className="asm-title alert-title-big">Mensaje del sistema</h3>
        <p className="asm-message alert-message-big">{mensaje}</p>
        {alerta.enlace && (
          <a
            className="asm-link"
            href={alerta.enlace}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            {alerta.enlaceLabel || 'Ver PDF'}
          </a>
        )}
        <div className="asm-actions">
          {textoCancelar && (
            <button
              type="button"
              className="asm-btn-cancel alert-btn-cancel"
              data-enter-skip="true"
              tabIndex={-1}
              onClick={cancelar}
            >
              {textoCancelar}
            </button>
          )}
          <button
            type="button"
            ref={okRef}
            className="asm-btn-ok alert-btn-ok"
            onClick={aceptar}
          >
            {textoOk}
          </button>
        </div>
        <p className="asm-hint">Enter · Aceptar</p>
      </div>
    </div>
  )
}
