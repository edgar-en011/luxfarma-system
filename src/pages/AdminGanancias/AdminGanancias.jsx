import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { supabase } from '../../supabaseClient';
import LogoLuxFarma from '../../components/LogoLuxFarma';
import SmartDateInput from '../../components/SmartDateInput';
import UiIcon from '../../components/UiIcon';
import { formatearPorcentajeGanancia } from '../../utils/porcentajeGanancia';
import { hoyLocal, NOMBRES_MES_ES, rangoFechasRapido } from '../../utils/fechas';
import { agruparSerieGanancias, cargarReporteGanancias } from '../../utils/reporteGanancias';
import './AdminGanancias.css';

const RAPIDOS = ['Hoy', 'Ayer', 'Esta semana', 'Este mes', 'Mes pasado', 'Personalizado'];
const PAGE = 15;

function soles(n) {
  return Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function etiquetaPeriodo(periodo, modo) {
  if (modo === 'mes' && /^\d{4}-\d{2}$/.test(periodo)) {
    const [y, m] = periodo.split('-');
    return `${NOMBRES_MES_ES[Number(m) - 1]?.slice(0, 3) || m} ${y}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(periodo)) {
    const [, m, d] = periodo.split('-');
    return `${Number(d)}/${Number(m)}`;
  }
  return periodo;
}

export default function AdminGanancias() {
  const inicial = rangoFechasRapido('Hoy');
  const [filtro, setFiltro] = useState('Hoy');
  const [fechaDesde, setFechaDesde] = useState(inicial.fechaDesde);
  const [fechaHasta, setFechaHasta] = useState(inicial.fechaHasta);
  const [reporte, setReporte] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [pagina, setPagina] = useState(1);

  const aplicarRapido = (nombre) => {
    setFiltro(nombre);
    if (nombre === 'Personalizado') return;
    const r = rangoFechasRapido(nombre);
    setFechaDesde(r.fechaDesde);
    setFechaHasta(r.fechaHasta);
  };

  const cargar = useCallback(async () => {
    if (!fechaDesde || !fechaHasta || fechaDesde > fechaHasta) {
      setError('Revisa el rango de fechas.');
      setReporte(null);
      return;
    }
    setCargando(true);
    setError('');
    try {
      const data = await cargarReporteGanancias(supabase, { fechaDesde, fechaHasta });
      setReporte(data);
      setPagina(1);
    } catch (err) {
      const msg = String(err.message || err);
      setError(
        msg.includes('reporte_ganancias') || msg.includes('Could not find')
          ? 'Falta ejecutar en Supabase: sql/migracion_reporte_ganancias.sql'
          : msg,
      );
      setReporte(null);
    } finally {
      setCargando(false);
    }
  }, [fechaDesde, fechaHasta]);

  useEffect(() => {
    if (filtro === 'Personalizado') return;
    cargar();
  }, [cargar, filtro]);

  const serieVista = useMemo(() => {
    if (!reporte) return { modo: 'dia', puntos: [] };
    return agruparSerieGanancias(reporte.serie, fechaDesde, fechaHasta);
  }, [reporte, fechaDesde, fechaHasta]);

  const productosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const lista = reporte?.productos || [];
    if (!q) return lista;
    return lista.filter((p) => String(p.descripcion || '').toLowerCase().includes(q));
  }, [reporte, busqueda]);

  const totalPaginas = Math.max(1, Math.ceil(productosFiltrados.length / PAGE));
  const paginaSafe = Math.min(pagina, totalPaginas);
  const filas = productosFiltrados.slice((paginaSafe - 1) * PAGE, paginaSafe * PAGE);
  const chartData = serieVista.puntos.map((p) => ({
    ...p,
    label: etiquetaPeriodo(p.periodo, serieVista.modo),
  }));

  return (
    <div className="gan-container">
      <div className="gan-top">
        <div className="gan-brand">
          <LogoLuxFarma variant="icon" size={44} color="red" className="gan-logo" />
          <div>
            <p className="gan-eyebrow">Ventas</p>
            <h2 className="gan-title">Ganancias</h2>
            <p className="gan-sub">Diario resumido del rango · costo congelado al vender</p>
          </div>
        </div>
      </div>

      <div className="gan-filtros">
        <div className="gan-chips">
          <span className="gan-chip-label">Rápidos</span>
          {RAPIDOS.map((nombre) => (
            <button
              key={nombre}
              type="button"
              className={`gan-chip${filtro === nombre ? ' is-on' : ''}`}
              onClick={() => aplicarRapido(nombre)}
            >
              {nombre}
            </button>
          ))}
        </div>
        {filtro === 'Personalizado' && (
          <div className="gan-rango">
            <div>
              <label>Desde</label>
              <SmartDateInput value={fechaDesde} onChange={setFechaDesde} />
            </div>
            <div>
              <label>Hasta</label>
              <SmartDateInput value={fechaHasta} onChange={setFechaHasta} />
            </div>
            <button type="button" className="gan-chip is-on" onClick={cargar}>Aplicar</button>
          </div>
        )}
      </div>

      {cargando ? (
        <div className="gan-loading">
          <LogoLuxFarma variant="icon" size={42} color="red" />
          <span>Calculando ganancias…</span>
        </div>
      ) : error ? (
        <div className="gan-error">{error}</div>
      ) : (
        <>
          <div className="gan-kpis">
            <div className="gan-kpi navy">
              <span className="gan-kpi-label">Ventas</span>
              <p className="gan-kpi-valor">S/ {soles(reporte?.ventas)}</p>
            </div>
            <div className="gan-kpi blue">
              <span className="gan-kpi-label">Costo</span>
              <p className="gan-kpi-valor">S/ {soles(reporte?.costo)}</p>
            </div>
            <div className="gan-kpi teal">
              <span className="gan-kpi-label">Ganancia</span>
              <p className="gan-kpi-valor">S/ {soles(reporte?.ganancia)}</p>
            </div>
            <div className="gan-kpi green">
              <span className="gan-kpi-label">Indic (%)</span>
              <p className="gan-kpi-valor">{formatearPorcentajeGanancia(reporte?.ventas, reporte?.costo)}</p>
            </div>
          </div>

          <div className="gan-chart">
            <h3>
              Evolución de la ganancia
              {' · '}
              {serieVista.modo === 'mes' ? 'por mes' : 'por día'}
              {reporte?.operaciones ? ` · ${reporte.operaciones} ops` : ''}
            </h3>
            {chartData.length === 0 ? (
              <p className="gan-empty">No hay ventas en este rango.</p>
            ) : (
              <ResponsiveContainer width="100%" height={128}>
                <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="ganArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--lf-success)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--lf-success)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--lf-border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--lf-text-muted)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--lf-text-muted)' }} />
                  <Tooltip
                    formatter={(v) => [`S/ ${soles(v)}`, 'Ganancia']}
                    labelStyle={{ fontWeight: 700 }}
                  />
                  <Area type="monotone" dataKey="ganancia" stroke="var(--lf-success)" fill="url(#ganArea)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="gan-tabla-card">
            <div className="gan-tabla-head">
              <div>
                <p className="gan-eyebrow">Por producto</p>
                <strong>{productosFiltrados.length} productos</strong>
              </div>
              <div className="gan-search">
                <UiIcon name="Search" size={16} />
                <input
                  type="search"
                  placeholder="Buscar producto…"
                  value={busqueda}
                  onChange={(e) => { setBusqueda(e.target.value); setPagina(1); }}
                />
              </div>
            </div>
            <div className="gan-tabla-wrap">
              <table className="gan-table">
                <colgroup>
                  <col className="gan-col-prod" />
                  <col className="gan-col-num" />
                  <col className="gan-col-num" />
                  <col className="gan-col-num" />
                  <col className="gan-col-num" />
                  <col className="gan-col-pct" />
                </colgroup>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th className="gan-num" title="Unidades base">Cant.</th>
                    <th className="gan-num">Ventas S/</th>
                    <th className="gan-num">Costo S/</th>
                    <th className="gan-num">Ganancia S/</th>
                    <th className="gan-pct">%</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="gan-empty">Sin productos vendidos en este rango.</td>
                    </tr>
                  ) : filas.map((p) => (
                    <tr key={p.id_producto}>
                      <td>{p.descripcion}</td>
                      <td className="gan-num">{Number(p.cantidad).toLocaleString('es-PE', { maximumFractionDigits: 2 })}</td>
                      <td className="gan-num">{soles(p.ventas)}</td>
                      <td className="gan-num">{soles(p.costo)}</td>
                      <td className={`gan-num ${p.ganancia >= 0 ? 'gan-pos' : 'gan-neg'}`}>{soles(p.ganancia)}</td>
                      <td className="gan-pct">{formatearPorcentajeGanancia(p.ventas, p.costo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="gan-pager">
              <span>{fechaDesde === hoyLocal() && fechaHasta === hoyLocal() ? 'Hoy' : `${fechaDesde} → ${fechaHasta}`}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" disabled={paginaSafe <= 1} onClick={() => setPagina(paginaSafe - 1)}>Anterior</button>
                <span>Pág. {paginaSafe} / {totalPaginas}</span>
                <button type="button" disabled={paginaSafe >= totalPaginas} onClick={() => setPagina(paginaSafe + 1)}>Siguiente</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
