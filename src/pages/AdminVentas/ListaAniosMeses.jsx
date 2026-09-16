import './AdminVentasExplorar.css';

function formatSoles(n) {
  return `S/ ${Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Lista de años o de meses (según nivel).
 * items: [{ key, label, total, operaciones }]
 */
export default function ListaAniosMeses({
  titulo,
  subtitulo,
  items = [],
  seleccionado,
  onSeleccionar,
  cargando,
  emptyText = 'Sin datos',
}) {
  return (
    <div className="av-drill-card">
      <div className="av-drill-header">
        <h3>{titulo}</h3>
        {subtitulo && <p>{subtitulo}</p>}
      </div>
      <div>
        {cargando ? (
          <p style={{ textAlign: 'center', color: '#94a3b8', padding: '2.5rem' }}>Cargando…</p>
        ) : items.length === 0 ? (
          <p style={{ textAlign: 'center', color: '#94a3b8', padding: '2.5rem' }}>{emptyText}</p>
        ) : (
          items.map((it) => {
            const sel = seleccionado === it.key;
            const cero = Number(it.total) <= 0;
            return (
              <button
                key={it.key}
                type="button"
                onClick={() => onSeleccionar?.(it)}
                className={`av-drill-row${sel ? ' is-selected' : ''}${cero ? ' is-cero' : ''}`}
              >
                <div className="av-drill-meta">
                  <span className="av-drill-label">{it.label}</span>
                  <span className="av-drill-ops">{it.operaciones} ops</span>
                </div>
                <strong className="av-drill-monto">
                  {formatSoles(it.total)}
                </strong>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
