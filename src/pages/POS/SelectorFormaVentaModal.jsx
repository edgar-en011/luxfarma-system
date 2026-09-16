import { useEffect, useMemo, useRef, useState } from 'react';
import { formasVentaOrdenadasPorFactor } from '../../utils/carritoPos';
import { formatSolesUnitario } from '../../utils/precioExacto';

/**
 * Mini-selector de forma al re-agregar un producto que ya está en el ticket.
 * Foco inicial en la primera opción (menor factor) para que Enter confirme al toque.
 */
export default function SelectorFormaVentaModal({
  producto,
  formas,
  idsMedidaEnCarrito = [],
  onElegir,
  onCancelar,
}) {
  const ordenadas = useMemo(() => formasVentaOrdenadasPorFactor(formas), [formas]);
  const [idx, setIdx] = useState(0);
  const firstBtnRef = useRef(null);
  const enCarrito = new Set((idsMedidaEnCarrito || []).map(Number));

  useEffect(() => {
    const t = window.setTimeout(() => firstBtnRef.current?.focus(), 20);
    return () => window.clearTimeout(t);
  }, [producto?.id_producto]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancelar?.();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setIdx((i) => {
          const next = e.key === 'ArrowDown'
            ? Math.min(ordenadas.length - 1, i + 1)
            : Math.max(0, i - 1);
          return next;
        });
        return;
      }
      const num = e.key >= '1' && e.key <= '9' ? Number(e.key) - 1 : -1;
      if (num >= 0 && num < ordenadas.length) {
        e.preventDefault();
        e.stopPropagation();
        onElegir?.(ordenadas[num]);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [ordenadas, onCancelar, onElegir]);

  useEffect(() => {
    const btn = document.getElementById(`pos-forma-opt-${idx}`);
    btn?.focus();
  }, [idx]);

  if (!producto || !ordenadas.length) return null;

  return (
    <div
      className="pos-forma-overlay"
      data-keyboard-trap
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancelar?.();
      }}
    >
      <div
        className="pos-forma-box"
        role="dialog"
        aria-modal="true"
        aria-label="Elegir forma de venta"
      >
        <p className="pos-forma-eyebrow">Ya está en el ticket</p>
        <h3 className="pos-forma-title">{producto.descripcion}</h3>
        <p className="pos-forma-hint">1–{ordenadas.length} elige · Enter confirma · Esc cancela</p>
        <div className="pos-forma-list">
          {ordenadas.map((forma, i) => {
            const idMedida = Number(forma.id_medida);
            const nombre = forma.unidades_medida?.nombre || 'UNIDAD';
            const precio = Number(forma.precio_venta) || 0;
            const ya = enCarrito.has(idMedida);
            return (
              <button
                key={`${idMedida}-${i}`}
                id={`pos-forma-opt-${i}`}
                ref={i === 0 ? firstBtnRef : undefined}
                type="button"
                autoFocus={i === 0}
                className={`pos-forma-opt${i === idx ? ' is-on' : ''}`}
                onMouseEnter={() => setIdx(i)}
                onClick={() => onElegir?.(forma)}
              >
                <span className="pos-forma-num">{i + 1}</span>
                <span className="pos-forma-nombre">
                  {nombre}
                  {ya ? <em>ya en ticket</em> : null}
                </span>
                <span className="pos-forma-precio">S/ {formatSolesUnitario(precio)}</span>
              </button>
            );
          })}
        </div>
        <button type="button" className="pos-forma-cancel" data-enter-skip="true" onClick={onCancelar}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
