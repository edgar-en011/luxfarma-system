import { useEffect, useMemo, useRef, useState } from 'react';
import UiIcon from './UiIcon';
import './SearchableSelect.css';

function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizarCodigoBarras(valor) {
  return String(valor ?? '').trim().replace(/\s+/g, '').replace(/\.+$/, '');
}

function esConsultaCodigoBarras(texto) {
  const t = String(texto || '').trim();
  if (!t) return false;
  return /^\d[\d\s.]*$/.test(t) && normalizarCodigoBarras(t).length >= 4;
}

export default function SearchableSelect({
  options = [],
  value = '',
  onChange,
  getOptionValue = (o) => o.value,
  getOptionLabel = (o) => o.label,
  getOptionSearchText,
  getOptionBarcode = (o) => o?.codigo_barras,
  /** Si true, un código de barras numérico exacto (p. ej. lectora) selecciona solo. Default false. */
  autoSelectExactBarcode = false,
  /** Opcional: busca el código en BD si no está en `options` (solo se usa con autoSelectExactBarcode). */
  resolveExactBarcode = null,
  placeholder = 'Buscar...',
  emptyOptionLabel = null,
  emptyOptionValue = '',
  disabled = false,
  className = '',
  style,
  id,
  /** Abre el menú y enfoca el buscador al montar / cuando pasa a true (fila nueva en Compras). */
  autoOpen = false,
  /** Tras elegir una opción (menú abierto + Enter o clic). */
  onElegido,
  /** Enter con el control cerrado (chip): avanzar al siguiente campo. */
  onEnterWhenClosed,
}) {
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);

  const isEmptyValue = String(value ?? '') === String(emptyOptionValue ?? '');

  const selected = useMemo(
    () => options.find((o) => String(getOptionValue(o)) === String(value)) || null,
    [options, value, getOptionValue]
  );
  const selectedLabel = selected ? getOptionLabel(selected) : '';
  // Chip aunque la opción aún no esté en `options` (catálogo recargando): si no, el
  // control parece "Todos" con un value aún seteado y confunde al usuario.
  const mostrarChip = !open && !isEmptyValue;
  const chipLabel = selectedLabel || String(value ?? '');

  const textoBusqueda = (opt) => {
    if (getOptionSearchText) return getOptionSearchText(opt);
    return getOptionLabel(opt);
  };

  const filtradas = useMemo(() => {
    if (!open) return [];
    const q = normalizar(query);
    if (!q) return options;
    const qBarras = autoSelectExactBarcode && esConsultaCodigoBarras(query)
      ? normalizarCodigoBarras(query)
      : '';
    return options.filter((o) => {
      if (normalizar(textoBusqueda(o)).includes(q)) return true;
      if (!qBarras) return false;
      const barras = normalizarCodigoBarras(getOptionBarcode(o));
      return barras === qBarras || (qBarras.length >= 6 && barras.includes(qBarras));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, options, query, getOptionLabel, getOptionSearchText, autoSelectExactBarcode]);

  const items = useMemo(() => {
    const list = filtradas.map((opt) => ({
      kind: 'option',
      key: String(getOptionValue(opt)),
      label: getOptionLabel(opt),
      value: getOptionValue(opt),
      opt,
    }));
    if (emptyOptionLabel != null) {
      return [{ kind: 'empty', key: '__empty__', label: emptyOptionLabel, value: emptyOptionValue }, ...list];
    }
    return list;
  }, [filtradas, emptyOptionLabel, emptyOptionValue, getOptionValue, getOptionLabel]);

  useEffect(() => {
    if (!open) return undefined;
    setHighlight(0);
    const onDoc = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open, value]);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    if (autoOpen && !disabled) setOpen(true);
  }, [autoOpen, disabled]);

  const elegir = (item) => {
    onChange?.(item.value, item.opt);
    setOpen(false);
    setQuery('');
    onElegido?.(item);
  };

  const matchBarcodeExacto = (texto) => {
    if (!esConsultaCodigoBarras(texto)) return null;
    const t = normalizarCodigoBarras(texto);
    return options.find((o) => normalizarCodigoBarras(getOptionBarcode(o)) === t) || null;
  };

  const aplicarProductoBarras = (prod) => {
    if (!prod) return;
    onChange?.(getOptionValue(prod), prod);
    setOpen(false);
    setQuery('');
  };

  useEffect(() => {
    if (!autoSelectExactBarcode || !open) return undefined;
    if (!esConsultaCodigoBarras(query)) return undefined;
    const t = normalizarCodigoBarras(query);
    let cancel = false;
    const timer = setTimeout(async () => {
      const local = matchBarcodeExacto(query);
      if (local) {
        aplicarProductoBarras(local);
        return;
      }
      if (typeof resolveExactBarcode !== 'function') return;
      const remoto = await resolveExactBarcode(t);
      if (cancel || !remoto) return;
      aplicarProductoBarras(remoto);
    }, 350);
    return () => {
      cancel = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, autoSelectExactBarcode, open, options]);

  const limpiar = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onChange?.(emptyOptionValue);
    setQuery('');
    setOpen(true);
  };

  const abrir = () => {
    if (disabled) return;
    setOpen(true);
    setQuery('');
  };

  const onKeyDown = (e) => {
    if (disabled) return;
    // Cerrado: ArrowDown/Space abren el menú. Enter lo deja al MainLayout
    // (avanzar al siguiente campo / submit del formulario padre).
    if (!open && (e.key === 'ArrowDown' || e.key === ' ')) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(items.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (autoSelectExactBarcode) {
        const prod = matchBarcodeExacto(query);
        if (prod) {
          aplicarProductoBarras(prod);
          return;
        }
        if (typeof resolveExactBarcode === 'function' && esConsultaCodigoBarras(query)) {
          e.preventDefault();
          resolveExactBarcode(normalizarCodigoBarras(query)).then((remoto) => {
            if (remoto) aplicarProductoBarras(remoto);
          });
          return;
        }
      }
      if (!String(query).trim()) return;
      const item = items[highlight]?.kind === 'empty'
        ? items.find((i) => i.kind === 'option')
        : items[highlight];
      if (item) elegir(item);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === 'Backspace' && !query && !isEmptyValue) {
      onChange?.(emptyOptionValue);
    }
  };

  return (
    <div
      ref={rootRef}
      className={`ss-root${open ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}${mostrarChip ? ' has-chip' : ''} ${className}`.trim()}
      style={style}
      id={id}
      data-enter-skip={open ? 'true' : undefined}
    >
      <div
        className="ss-control"
        onClick={abrir}
        onKeyDown={(e) => {
          if (!open && (e.key === ' ' || e.key === 'ArrowDown')) {
            e.preventDefault();
            abrir();
            return;
          }
          if (!open && e.key === 'Enter' && onEnterWhenClosed) {
            e.preventDefault();
            e.stopPropagation();
            onEnterWhenClosed();
          }
        }}
        role="button"
        tabIndex={disabled || open ? -1 : 0}
      >
        {!mostrarChip && <span className="ss-icon" aria-hidden><UiIcon name="Search" size={16} /></span>}

        {mostrarChip ? (
          <span className="ss-chip" title={chipLabel}>
            <span className="ss-chip-text" title={chipLabel}>{chipLabel}</span>
            {!disabled && (
              <button
                type="button"
                className="ss-chip-x"
                onClick={limpiar}
                title="Quitar selección"
                aria-label="Quitar selección"
                tabIndex={-1}
                data-enter-skip="true"
              ><UiIcon name="X" size={16} /></button>
            )}
            <span className="ss-chip-chevron" aria-hidden title="Cambiar selección"><UiIcon name="ChevronDown" size={16} /></span>
          </span>
        ) : (
          <>
            <input
              ref={inputRef}
              type="text"
              className="ss-input"
              disabled={disabled}
              placeholder={emptyOptionLabel || placeholder}
              value={open ? query : ''}
              onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
              onFocus={abrir}
              onKeyDown={onKeyDown}
              autoComplete="off"
              role="combobox"
              aria-expanded={open}
              aria-autocomplete="list"
              data-enter-skip="true"
            />
            <span className="ss-chevron" aria-hidden><UiIcon name="ChevronDown" size={16} /></span>
          </>
        )}
      </div>

      {open && !disabled && (
        <ul className="ss-menu" role="listbox">
          {items.length === 0 ? (
            <li className="ss-empty">Sin coincidencias</li>
          ) : (
            items.map((item, idx) => (
              <li
                key={item.key}
                role="option"
                aria-selected={String(item.value) === String(value)}
                className={`ss-option${idx === highlight ? ' is-active' : ''}${String(item.value) === String(value) ? ' is-selected' : ''}${item.kind === 'empty' ? ' is-empty-opt' : ''}`}
                onMouseEnter={() => setHighlight(idx)}
                onMouseDown={(e) => { e.preventDefault(); elegir(item); }}
              >
                {item.label}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
