import { useEffect } from 'react';
import './FullScreenModal.css';

/**
 * Modal de pantalla casi completa (overlay + panel grande).
 * Cierre: X, Esc, o clic en el backdrop.
 */
export default function FullScreenModal({
  open,
  onClose,
  title,
  subtitle,
  eyebrow,
  toolbar = null,
  children,
  closeOnBackdrop = true,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fs-modal-backdrop"
      role="presentation"
      onClick={() => { if (closeOnBackdrop) onClose?.(); }}
    >
      <div
        className="fs-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Ventana'}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="fs-modal-header">
          <div className="fs-modal-header-text">
            {eyebrow && <p className="fs-modal-eyebrow">{eyebrow}</p>}
            {title && <h2 className="fs-modal-title">{title}</h2>}
            {subtitle && <p className="fs-modal-subtitle">{subtitle}</p>}
          </div>
          <button
            type="button"
            className="fs-modal-close"
            onClick={onClose}
            title="Cerrar"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </header>
        {toolbar && <div className="fs-modal-toolbar">{toolbar}</div>}
        <div className="fs-modal-body">{children}</div>
      </div>
    </div>
  );
}
