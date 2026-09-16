import { useState, useRef, useEffect } from 'react';

// Navegación por teclado (↑/↓/Enter) sobre una lista de resultados de búsqueda —
// extraído de AdminCompras.jsx y POS.jsx, que tenían la misma lógica duplicada
// (resaltar la primera fila al cambiar resultados, mover el resaltado con flechas,
// hacer scroll para mantenerla visible, y confirmar con Enter). Lo que SÍ difiere
// entre pantallas (qué pasa al seleccionar, si hay confirmación en dos pasos como en
// AdminCompras) se queda en cada caller vía onSeleccionar/onNavigate/onResultsChange,
// para no forzar un comportamiento único que no le sirva a todos los usos.
export default function useBuscadorTeclado(resultados, onSeleccionar, { onNavigate, onResultsChange } = {}) {
  const [filaResaltada, setFilaResaltada] = useState(-1);
  const rowRefs = useRef([]);
  const idResaltadoRef = useRef(null);

  const idDeResultado = (p) => (p == null ? null : (p.id_producto ?? p.id ?? null));

  const recordarIdResaltado = (id) => {
    idResaltadoRef.current = id ?? null;
  };

  useEffect(() => {
    if (resultados.length === 0) {
      setFilaResaltada(-1);
      onResultsChange?.();
      return;
    }
    const id = idResaltadoRef.current;
    const idx = id != null
      ? resultados.findIndex((p) => String(idDeResultado(p)) === String(id))
      : -1;
    const i = idx >= 0 ? idx : 0;
    setFilaResaltada(i);
    onResultsChange?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultados]);

  useEffect(() => {
    if (filaResaltada >= 0) {
      rowRefs.current[filaResaltada]?.scrollIntoView({ block: 'nearest' });
      const id = idDeResultado(resultados[filaResaltada]);
      if (id != null) idResaltadoRef.current = id;
    }
  }, [filaResaltada, resultados]);

  const handleKeyDown = (e) => {
    if (resultados.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      setFilaResaltada((prev) => {
        const next = Math.min(prev + 1, resultados.length - 1);
        return next;
      });
      const base = filaResaltada < 0 ? 0 : filaResaltada;
      const next = Math.min(base + 1, resultados.length - 1);
      onNavigate?.(resultados[next], next);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      setFilaResaltada((prev) => {
        const next = Math.max(prev - 1, 0);
        return next;
      });
      const next = Math.max(filaResaltada < 0 ? 0 : filaResaltada - 1, 0);
      onNavigate?.(resultados[next], next);
    } else if (e.key === 'Enter') {
      if (filaResaltada < 0 || filaResaltada >= resultados.length) return;
      e.preventDefault();
      e.stopPropagation();
      onSeleccionar(resultados[filaResaltada]);
    }
  };

  return { filaResaltada, setFilaResaltada, rowRefs, handleKeyDown, recordarIdResaltado };
}
