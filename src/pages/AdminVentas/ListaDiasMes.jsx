import { DIAS_SEMANA_CORTOS, NOMBRES_MES_ES, parseFechaISO } from '../../utils/fechas';
import './AdminVentasExplorar.css';

function formatSoles(n) {
  return `S/ ${Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function diaSemanaDeIso(iso) {
  const p = parseFechaISO(iso);
  if (!p) return '';
  return DIAS_SEMANA_CORTOS[new Date(p.y, p.m - 1, p.d).getDay()];
}

/**
 * Lista vertical de todos los días del mes con total y operaciones.
 * dias: [{ fecha, total, operaciones }]
 */
export default function ListaDiasMes({
  anio,
  mes,
  dias = [],
  diaSeleccionado,
  onSeleccionarDia,
  cargando,
  totalMes = 0,
  opsMes = 0,
  wide = false,
}) {
  return (
    <div className={`av-dias-card${wide ? ' is-wide' : ''}`}>
      <div className="av-dias-header">
        <h3>{NOMBRES_MES_ES[mes - 1]} {anio}</h3>
        <div className="av-dias-kpis">
          <div className="av-dias-kpi">
            <span className="av-dias-kpi-label">Total mes</span>
            <span className="av-dias-kpi-value">{formatSoles(totalMes)}</span>
          </div>
          <div className="av-dias-kpi">
            <span className="av-dias-kpi-label">Operaciones</span>
            <span className="av-dias-kpi-value av-dias-kpi-ops">{opsMes}</span>
          </div>
        </div>
        <p className="av-dias-hint">Clic en un día para ver el detalle</p>
      </div>

      <div className={`av-dias-lista${wide ? ' av-dias-lista-wide' : ''}`}>
        {cargando ? (
          <p style={{ textAlign: 'center', color: 'var(--lf-text-muted)', padding: '2.5rem', gridColumn: '1 / -1' }}>Cargando días…</p>
        ) : (
          dias.map((d) => {
            const sel = diaSeleccionado === d.fecha;
            const cero = Number(d.total) <= 0;
            const nDia = Number(String(d.fecha).slice(8, 10));
            return (
              <button
                key={d.fecha}
                type="button"
                onClick={() => onSeleccionarDia?.(d.fecha)}
                className={`av-dia-row${sel ? ' is-selected' : ''}${cero ? ' is-cero' : ''}`}
              >
                <div className="av-dia-row-meta">
                  <span className="av-dia-nombre">
                    {diaSemanaDeIso(d.fecha)} {nDia}
                  </span>
                  <span className="av-dia-ops">
                    {d.operaciones} {d.operaciones === 1 ? 'op' : 'ops'}
                  </span>
                </div>
                <span className="av-dia-monto">{formatSoles(d.total)}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
