import { forwardRef, useEffect, useRef, useState } from 'react';
import './TecladoListbox.css';

/**
 * Select de teclado: al recibir foco se abre; ↑/↓ eligen; Enter confirma.
 * Pensado para Tipo de documento en Compras (el select nativo no abre solo).
 */
const TecladoListbox = forwardRef(function TecladoListbox({
  options = [],
  value,
  onChange,
  onConfirmado,
  disabled = false,
  'aria-label': ariaLabel,
}, ref) {
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const setBtnRef = (el) => {
    btnRef.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) ref.current = el;
  };
  const [abierto, setAbierto] = useState(false);
  const [idx, setIdx] = useState(0);

  const iActual = Math.max(0, options.findIndex((o) => String(o.value) === String(value)));
  const etiqueta = options[iActual]?.label || options[0]?.label || '';

  useEffect(() => {
    if (!abierto) return undefined;
    const onDoc = (e) => {
      if (!rootRef.current?.contains(e.target)) setAbierto(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [abierto]);

  const confirmar = (i) => {
    const opt = options[i];
    if (!opt) return;
    onChange?.(opt.value);
    setAbierto(false);
    onConfirmado?.(opt);
  };

  const onKeyDown = (e) => {
    if (disabled) return;
    if (!abierto && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      e.stopPropagation();
      setIdx(iActual >= 0 ? iActual : 0);
      setAbierto(true);
      return;
    }
    if (!abierto) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      setIdx((n) => Math.min(options.length - 1, n + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      setIdx((n) => Math.max(0, n - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      confirmar(idx);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setAbierto(false);
    }
  };

  return (
    <div
      ref={rootRef}
      className={`tlb-root${abierto ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}`}
    >
      <button
        ref={setBtnRef}
        type="button"
        className="tlb-btn"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        aria-label={ariaLabel}
        data-enter-target="true"
        onFocus={() => {
          if (disabled) return;
          setIdx(iActual >= 0 ? iActual : 0);
          setAbierto(true);
        }}
        onKeyDown={onKeyDown}
        onClick={() => { if (!disabled) setAbierto(true); }}
      >
        <span>{etiqueta}</span>
        <span className="tlb-chevron" aria-hidden>▾</span>
      </button>
      {abierto && (
        <ul className="tlb-menu" role="listbox">
          {options.map((opt, i) => (
            <li
              key={opt.value}
              role="option"
              aria-selected={String(opt.value) === String(value)}
              className={`tlb-opt${i === idx ? ' is-on' : ''}${String(opt.value) === String(value) ? ' is-sel' : ''}`}
              onMouseEnter={() => setIdx(i)}
              onMouseDown={(e) => { e.preventDefault(); confirmar(i); }}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

export default TecladoListbox;
