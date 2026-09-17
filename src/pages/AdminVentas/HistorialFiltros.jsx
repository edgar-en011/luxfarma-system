import SmartDateInput from '../../components/SmartDateInput';
import './AdminVentasExplorar.css';

const RAPIDOS = ['Hoy', 'Ayer', 'Esta semana', 'Este mes', 'Mes pasado'];

/**
 * Filtros del historial: Rápidos (embebidos en página) + Explorar (abre modal fullscreen).
 */
export default function HistorialFiltros({
  modo,
  filtroRapido,
  onFiltroRapido,
  onModoMes,
  onModoTodo,
  onModoRango,
  onPersonalizado,
  fechaDesde,
  fechaHasta,
  onFechaDesde,
  onFechaHasta,
  onAplicarRango,
  aplicandoRango,
  msgRangoFecha,
  filtroSucursal,
  onSucursal,
  sucursales = [],
  filtroVendedor,
  onVendedor,
  vendedores = [],
  busquedaComprobante,
  onBusquedaComprobante,
}) {
  const esPersonalizado = modo === 'rango' && filtroRapido === 'Personalizado';
  // Chips rápidos solo se marcan activos cuando NO hay explorador abierto.
  const chipRapidoActivo = modo === 'rango' ? filtroRapido : null;

  return (
    <div className="av-filtros-card">
      <div className="av-filtros-grupo">
        <span className="av-filtros-label">Rápidos</span>
        {RAPIDOS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => { onModoRango?.(); onFiltroRapido?.(f); }}
            className={`av-chip ${chipRapidoActivo === f ? 'active' : ''}`}
          >
            {f}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onPersonalizado?.()}
          className={`av-chip ${esPersonalizado ? 'active' : ''}`}
        >
          Personalizado
        </button>
      </div>

      <div className="av-filtros-grupo" style={{ marginBottom: '0.95rem' }}>
        <span className="av-filtros-label">Explorar</span>
        <button
          type="button"
          onClick={() => onModoMes?.()}
          className={`av-chip ${modo === 'mes' ? 'active active-explore' : ''}`}
        >
          Mes…
        </button>
        <button
          type="button"
          onClick={() => onModoTodo?.()}
          className={`av-chip ${modo === 'todo' ? 'active active-explore' : ''}`}
        >
          Todo el tiempo
        </button>
      </div>

      <div className={`av-filtros-rango${esPersonalizado ? ' is-personalizado' : ''}`}>
        {esPersonalizado && (
          <p className="av-filtros-rango-hint">
            Elige el rango exacto y pulsa Aplicar para filtrar la tabla.
          </p>
        )}
        <div className="av-filtros-field">
          <label>Desde</label>
          <SmartDateInput
            value={fechaDesde}
            onChange={(val) => onFechaDesde?.(val)}
            className="av-input-apple"
          />
        </div>
        <div className="av-filtros-field">
          <label>Hasta</label>
          <SmartDateInput
            value={fechaHasta}
            onChange={(val) => onFechaHasta?.(val)}
            className="av-input-apple"
          />
        </div>
        <button
          type="button"
          className="av-btn-aplicar"
          onClick={onAplicarRango}
          disabled={aplicandoRango}
        >
          {aplicandoRango ? 'Aplicando…' : 'Aplicar'}
        </button>
        {msgRangoFecha && (
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#b91c1c', alignSelf: 'center' }}>
            {msgRangoFecha}
          </span>
        )}
      </div>

      <div className="av-filtros-extras">
        <div className="av-filtros-field">
          <label>Sucursal</label>
          <select value={filtroSucursal} onChange={(e) => onSucursal?.(e.target.value)} className="av-input-apple">
            <option value="todas">Todas las sedes</option>
            {sucursales.map((s) => (
              <option key={s.id_sucursal} value={s.id_sucursal}>{s.nombre_comercial}</option>
            ))}
          </select>
        </div>
        <div className="av-filtros-field">
          <label>Vendedor</label>
          <select value={filtroVendedor} onChange={(e) => onVendedor?.(e.target.value)} className="av-input-apple">
            <option value="todos">Todos los vendedores</option>
            {vendedores.map((v) => (
              <option key={v.id} value={v.id}>{v.nombre}</option>
            ))}
          </select>
        </div>
        <div style={{ width: 1, height: 38, background: 'var(--lf-border)', margin: '0 0.15rem' }} />
        <div className="av-filtros-field">
          <label>Buscar por N° de boleta/factura</label>
          <input
            type="text"
            placeholder="Ej: NV01-10"
            value={busquedaComprobante}
            onChange={(e) => onBusquedaComprobante?.(e.target.value)}
            className="av-input-apple"
            style={{ width: 220 }}
          />
        </div>
      </div>
    </div>
  );
}
