import VentasStackedBarChart from './VentasStackedBarChart';
import { formatearFechaLargaPE } from '../../utils/fechas';
import './AdminVentasExplorar.css';

function formatSoles(n) {
  return `S/ ${Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Panel de detalle del día (cabecera + gráfico + leyenda + tabla).
 * Pensado para vivir en la columna derecha del explorador a pantalla completa.
 */
export default function PanelDiaVentas({
  fechaIso,
  total = 0,
  operaciones = 0,
  chartData = [],
  vendedoresChart = [],
  cargando,
  children,
}) {
  if (!fechaIso) {
    return (
      <div className="av-panel-dia av-panel-dia-empty">
        <p>Selecciona un día</p>
        <p style={{ margin: '6px 0 0', fontSize: 13 }}>
          El gráfico por hora y los comprobantes aparecerán aquí.
        </p>
      </div>
    );
  }

  const titulo = formatearFechaLargaPE(fechaIso);
  const tituloCap = titulo.charAt(0).toUpperCase() + titulo.slice(1);

  return (
    <div className="av-panel-dia av-panel-dia-embed">
      <div className="av-panel-cabecera">
        <div>
          <p className="av-panel-eyebrow">Detalle del día</p>
          <h3 className="av-panel-titulo">{tituloCap}</h3>
          <div className="av-panel-kpis">
            <div className="av-panel-kpi-card">
              <span className="av-panel-kpi-label">Total día</span>
              <span className="av-panel-kpi-value">{formatSoles(total)}</span>
            </div>
            <div className="av-panel-kpi-card muted">
              <span className="av-panel-kpi-label">Operaciones</span>
              <span className="av-panel-kpi-value">{operaciones}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="av-panel-dia-scroll">
        <section className="av-panel-seccion">
          <p className="av-panel-seccion-titulo">Ventas por hora</p>
          <div className="av-panel-chart-wrap">
            {cargando ? (
              <p style={{ textAlign: 'center', color: '#94a3b8', padding: '2rem' }}>Cargando gráfico…</p>
            ) : (
              <VentasStackedBarChart data={chartData} vendedores={vendedoresChart} />
            )}
          </div>
          {!cargando && vendedoresChart.length > 0 && (
            <div className="av-panel-leyenda">
              {vendedoresChart.map((v) => (
                <span key={v.id} className="av-leyenda-item">
                  <span className="av-leyenda-dot" style={{ background: v.color }} />
                  {v.nombre}
                </span>
              ))}
            </div>
          )}
        </section>

        <section className="av-panel-seccion" style={{ borderBottom: 'none' }}>
          <p className="av-panel-seccion-titulo">Comprobantes del día</p>
          <div className="av-panel-tabla-wrap">{children}</div>
        </section>
      </div>
    </div>
  );
}
