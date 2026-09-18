/**
 * Sanitización de campos de monto (soles).
 * Solo UI: no altera lógica de negocio ni persistencia.
 */

const BLOQUEADOS_KEY = new Set(['e', 'E', '+', ',']);

/**
 * Limpia texto pegado o tipado a un monto válido.
 * @param {string|number|null|undefined} raw
 * @param {{ allowNegative?: boolean, maxDecimals?: number }} [opts]
 * @returns {string}
 */
export function sanitizeMonto(raw, opts = {}) {
  const allowNegative = !!opts.allowNegative;
  const maxDecimals = opts.maxDecimals ?? 2;

  if (raw == null) return '';
  let s = String(raw).replace(/,/g, ''); // comas no permitidas
  s = s.replace(/[eE+\s]/g, '');

  let negative = false;
  if (allowNegative && s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }
  // Cualquier otro guion (en medio) se elimina
  s = s.replace(/-/g, '');

  // Solo dígitos y un punto
  let out = '';
  let sawDot = false;
  for (const ch of s) {
    if (ch >= '0' && ch <= '9') {
      if (sawDot) {
        const dec = out.split('.')[1] || '';
        if (dec.length >= maxDecimals) continue;
      }
      out += ch;
    } else if (ch === '.' && !sawDot) {
      out += '.';
      sawDot = true;
    }
  }

  if (negative && (out !== '' || raw === '-' || String(raw).trim() === '-')) {
    return out === '' ? '-' : `-${out}`;
  }
  return out;
}

/**
 * Formatea a 2 decimales al salir del campo. Vacío queda vacío.
 * @param {string|number|null|undefined} value
 * @param {{ allowNegative?: boolean }} [opts]
 * @returns {string}
 */
export function formatMontoBlur(value, opts = {}) {
  const allowNegative = !!opts.allowNegative;
  if (value === '' || value == null || value === '-' || value === '.' || value === '-.') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  if (!allowNegative && n < 0) return '0.00';
  return n.toFixed(2);
}

export function isMontoVacio(value) {
  return value === '' || value == null || value === '-' || value === '.' || value === '-.';
}

/**
 * Props listas para un <input> de monto controlado.
 * @param {object} cfg
 * @param {string|number} cfg.value
 * @param {(next: string) => void} cfg.onChange
 * @param {boolean} [cfg.allowNegative]
 * @param {import('react').FocusEventHandler} [cfg.onBlurExtra]
 * @param {import('react').KeyboardEventHandler} [cfg.onKeyDownExtra]
 */
export function bindMontoInput({
  value,
  onChange,
  allowNegative = false,
  onBlurExtra,
  onKeyDownExtra,
}) {
  const opts = { allowNegative };

  return {
    type: 'text',
    inputMode: 'decimal',
    autoComplete: 'off',
    spellCheck: false,
    value: value === null || value === undefined ? '' : String(value),
    onChange: (e) => {
      onChange(sanitizeMonto(e.target.value, opts));
    },
    onPaste: (e) => {
      e.preventDefault();
      const text = e.clipboardData?.getData('text') ?? '';
      onChange(sanitizeMonto(text, opts));
    },
    onKeyDown: (e) => {
      if (BLOQUEADOS_KEY.has(e.key)) {
        e.preventDefault();
      }
      if (e.key === '-' || e.key === 'Minus' || e.key === 'Subtract') {
        if (!allowNegative) {
          e.preventDefault();
        } else {
          const el = e.currentTarget;
          const start = el.selectionStart ?? 0;
          const end = el.selectionEnd ?? 0;
          const hasSel = start !== end;
          // Solo al inicio; si ya hay signo o el cursor no está al inicio, bloquear
          if (!hasSel && start !== 0) e.preventDefault();
          if (!hasSel && String(value).startsWith('-') && start === 0) e.preventDefault();
        }
      }
      onKeyDownExtra?.(e);
    },
    onWheel: (e) => {
      e.currentTarget.blur();
    },
    onFocus: (e) => {
      try {
        e.target.select();
      } catch {
        /* ignore */
      }
    },
    onBlur: (e) => {
      const formatted = formatMontoBlur(e.target.value, opts);
      if (formatted !== String(value ?? '')) onChange(formatted);
      onBlurExtra?.(e);
    },
  };
}
