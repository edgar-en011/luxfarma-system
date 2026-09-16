import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import './PwaUpdateBanner.css';

const SNOOZE_KEY = 'pwa_update_snooze_until';
/** Tras descartar, no insistir hasta pasado este lapso (luego puede mostrar 1 vez más). */
const SNOOZE_MS = 4 * 60 * 60 * 1000; // 4 horas

function leerSnoozeUntil() {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY) || 0);
  } catch {
    return 0;
  }
}

function guardarSnooze() {
  const until = Date.now() + SNOOZE_MS;
  try {
    localStorage.setItem(SNOOZE_KEY, String(until));
  } catch { /* empty */ }
  return until;
}

/**
 * Franja no intrusiva: avisa que hay SW nuevo. Nunca recarga sola
 * (evita cortar una venta en POS). Recargar solo con confirmación del usuario.
 */
export default function PwaUpdateBanner() {
  const [snoozeUntil, setSnoozeUntil] = useState(leerSnoozeUntil);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      // Revisa actualizaciones periódicamente mientras la pestaña sigue abierta.
      if (!registration) return;
      setInterval(() => {
        registration.update().catch(() => {});
      }, 60 * 60 * 1000); // 1 h
    },
  });

  const snoozeActivo = snoozeUntil > nowTick;

  // Cuando hay update pendiente y snooze activo, despertar el banner al vencer.
  useEffect(() => {
    if (!needRefresh || !snoozeActivo) return undefined;
    const left = snoozeUntil - Date.now();
    const t = setTimeout(() => setNowTick(Date.now()), Math.max(left, 1000));
    return () => clearTimeout(t);
  }, [needRefresh, snoozeActivo, snoozeUntil]);

  const visible = needRefresh && !snoozeActivo;
  if (!visible) return null;

  const recargar = () => {
    updateServiceWorker(true);
  };

  const posponer = () => {
    setSnoozeUntil(guardarSnooze());
    setNowTick(Date.now());
  };

  return (
    <div className="pwa-update-banner" role="status" aria-live="polite">
      <span className="pwa-update-banner-text">
        Hay una versión nueva disponible — Recargar para aplicar correcciones
      </span>
      <div className="pwa-update-banner-actions">
        <button type="button" className="pwa-update-btn-reload" onClick={recargar}>
          Recargar ahora
        </button>
        <button type="button" className="pwa-update-btn-later" onClick={posponer}>
          Ahora no
        </button>
      </div>
    </div>
  );
}
