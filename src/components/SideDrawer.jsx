import { useEffect } from 'react';
import './SideDrawer.css';

/**
 * Drawer lateral reutilizable (slide-in desde la derecha).
 * Misma geometría que TomaInventario / AdminProductos (top: 70px bajo el topbar).
 *
 * Props:
 *   open, onClose, title?, subtitle?, children
 *   width? — override CSS width (ej. '70vw')
 *   closeOnBackdrop? — default true
 */
export default function SideDrawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  width,
  closeOnBackdrop = true,
  headerExtra = null,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        className="side-drawer-backdrop"
        role="presentation"
        onClick={() => { if (closeOnBackdrop) onClose?.(); }}
      />
      <aside
        className="side-drawer"
        style={width ? { width } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Panel lateral'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="side-drawer-header">
          <div className="side-drawer-header-text">
            {title && <h2 className="side-drawer-title">{title}</h2>}
            {subtitle && <p className="side-drawer-subtitle">{subtitle}</p>}
            {headerExtra}
          </div>
          <button
            type="button"
            className="side-drawer-close"
            onClick={onClose}
            title="Cerrar"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>
        <div className="side-drawer-body">
          {children}
        </div>
      </aside>
    </>
  );
}
