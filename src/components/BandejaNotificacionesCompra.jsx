import { forwardRef, memo, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import UiIcon from './UiIcon';
import {
  BANDEJA_TAMANO_DEFAULT,
  bandejaTamanoVecino,
  etiquetaBandejaTamano,
} from '../utils/bandejaNotifCompraTamano';
import './BandejaNotificacionesCompra.css';

const LEGIBLES = 2;
const MAX_PILA = 3;
const MAX_VISIBLES = LEGIBLES + MAX_PILA;
const SALIDA_MS = 320;
const ICONO = { sm: 13, md: 15, lg: 17 };

function ajustarNombresAUnaLinea(root) {
  if (!root) return;
  root.querySelectorAll('.bandeja-notif-nombre').forEach((el) => {
    el.style.fontSize = '';
    const base = parseFloat(getComputedStyle(el).fontSize);
    if (!Number.isFinite(base) || base <= 0) return;
    let size = base;
    const min = Math.max(10, base * 0.68);
    while (el.scrollWidth > el.clientWidth + 0.5 && size > min) {
      size -= 0.4;
      el.style.fontSize = `${size}px`;
    }
  });
}

export function BandejaTamanoControl({ tamano = BANDEJA_TAMANO_DEFAULT, onTamano }) {
  const menor = bandejaTamanoVecino(tamano, -1);
  const mayor = bandejaTamanoVecino(tamano, 1);
  return (
    <div className="bandeja-notif-tamano">
      <button
        type="button"
        className="bandeja-notif-tamano-btn"
        disabled={menor === tamano}
        aria-label="Bandeja más pequeña"
        onClick={() => onTamano?.(-1)}
      >
        A−
      </button>
      <span className="bandeja-notif-tamano-lbl">{etiquetaBandejaTamano(tamano)}</span>
      <button
        type="button"
        className="bandeja-notif-tamano-btn"
        disabled={mayor === tamano}
        aria-label="Bandeja más grande"
        onClick={() => onTamano?.(+1)}
      >
        A+
      </button>
    </div>
  );
}

/**
 * 2 tarjetas completas + pila iOS detrás. No se desvanecen por tiempo:
 * solo salen cuando una nueva empuja a la más vieja de la pila, o al desmontar.
 */
const BandejaNotificacionesCompra = memo(forwardRef(function BandejaNotificacionesCompra({
  tamano = BANDEJA_TAMANO_DEFAULT,
}, ref) {
  const [items, setItems] = useState([]);
  const itemsRef = useRef([]);
  const seqRef = useRef(0);
  const timersRef = useRef(new Map());

  const pintar = (next) => {
    itemsRef.current = next;
    setItems(next);
  };

  const limpiarTimer = (id) => {
    const t = timersRef.current.get(id);
    if (t) window.clearTimeout(t);
    timersRef.current.delete(id);
  };

  const quitar = (id) => {
    limpiarTimer(id);
    pintar(itemsRef.current.filter((it) => it.id !== id));
  };

  useImperativeHandle(ref, () => ({
    push({ nombre, cantidad, unidad, subtotal }) {
      const id = ++seqRef.current;
      const prev = itemsRef.current;
      const visibles = prev.filter((x) => !x.saliendo);
      const evict = visibles.length >= MAX_VISIBLES ? visibles[visibles.length - 1] : null;
      const next = [
        { id, nombre, cantidad, unidad, subtotal, saliendo: false },
        ...prev.map((x) => (x.id === evict?.id ? { ...x, saliendo: true } : x)),
      ];
      pintar(next);
      if (evict) {
        limpiarTimer(evict.id);
        timersRef.current.set(evict.id, window.setTimeout(() => quitar(evict.id), SALIDA_MS));
      }
    },
  }));

  useEffect(() => () => {
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current.clear();
  }, []);

  const rootRef = useRef(null);
  useLayoutEffect(() => {
    ajustarNombresAUnaLinea(rootRef.current);
  }, [items, tamano]);

  if (items.length === 0) return null;

  const iconoN = ICONO[tamano] || ICONO.md;

  return (
    <div ref={rootRef} className="bandeja-notif-compra" aria-live="polite" aria-atomic="false">
      {items.map((it, i) => (
        <div
          key={it.id}
          className={`bandeja-notif-slot${i < LEGIBLES ? ' is-legible' : ' is-pila'}${it.saliendo ? ' is-saliendo' : ''}`}
          style={{ '--i': i, '--pila': Math.max(0, i - LEGIBLES) }}
        >
          <article className="bandeja-notif-card" role="status">
            <span className="bandeja-notif-icono" aria-hidden>
              <UiIcon name="Check" size={iconoN} />
            </span>
            <div className="bandeja-notif-texto">
              <p className="bandeja-notif-nombre" title={it.nombre}>{it.nombre}</p>
              <p className="bandeja-notif-meta">
                {it.cantidad} {it.unidad || 'und'}
              </p>
            </div>
            <span className="bandeja-notif-cupon">
              <span className="bandeja-notif-importe">
                <span className="bandeja-notif-moneda">S/</span>
                <span className="bandeja-notif-monto">{Number(it.subtotal || 0).toFixed(2)}</span>
              </span>
            </span>
          </article>
        </div>
      ))}
    </div>
  );
}));

export default BandejaNotificacionesCompra;
