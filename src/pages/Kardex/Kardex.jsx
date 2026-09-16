import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import './Kardex.css';
import SmartDateInput from '../../components/SmartDateInput';
import UiIcon from '../../components/UiIcon';

export default function Kardex() {
  const [movimientos, setMovimientos] = useState([]);
  const [_productos, setProductos] = useState([]);
  const [cargando, setCargando] = useState(true);

  const [busqueda, setBusqueda] = useState('');
  const [tipoFiltro, setTipoFiltro] = useState('TODOS');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [paginaActual, setPaginaActual] = useState(1);
  const filasPorPagina = 12;

  const cargarDatos = async () => {
    setCargando(true);
    try {
      const { data: movs } = await supabase
        .from('kardex_movimientos')
        .select(`
          *,
          productos (descripcion, codigo_barras),
          usuarios (nombres, apellidos)
        `)
        .order('created_at', { ascending: false });

      setMovimientos(movs || []);

      const { data: prods } = await supabase
        .from('productos')
        .select('id_producto, descripcion, codigo_barras')
        .eq('activo', 1);
      setProductos(prods || []);

    } catch (error) {
      console.error('Error cargando kardex:', error);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => { cargarDatos(); }, []);

  const movimientosFiltrados = useMemo(() => {
    return movimientos.filter(m => {
      const desc = m.productos?.descripcion?.toLowerCase() || '';
      const cod = m.productos?.codigo_barras || '';
      const busqLimpia = busqueda.toLowerCase().trim();

      const coincideBusqueda = busqLimpia === '' || desc.includes(busqLimpia) || cod.includes(busqLimpia);
      const coincideTipo = tipoFiltro === 'TODOS' || m.tipo === tipoFiltro;

      let coincideFecha = true;
      if (fechaDesde) coincideFecha = coincideFecha && new Date(m.created_at) >= new Date(fechaDesde);
      if (fechaHasta) coincideFecha = coincideFecha && new Date(m.created_at) <= new Date(fechaHasta + 'T23:59:59');

      return coincideBusqueda && coincideTipo && coincideFecha;
    });
  }, [movimientos, busqueda, tipoFiltro, fechaDesde, fechaHasta]);

  const totalEntradas = movimientosFiltrados.filter(m => m.tipo === 'ENTRADA').reduce((acc, m) => acc + Number(m.cantidad || 0), 0);
  const totalSalidas = movimientosFiltrados.filter(m => m.tipo === 'SALIDA').reduce((acc, m) => acc + Number(m.cantidad || 0), 0);
  const totalAjustes = movimientosFiltrados.filter(m => m.tipo === 'AJUSTE').length;

  const indexOfLast = paginaActual * filasPorPagina;
  const indexOfFirst = indexOfLast - filasPorPagina;
  const movsPagina = movimientosFiltrados.slice(indexOfFirst, indexOfLast);
  const totalPaginas = Math.ceil(movimientosFiltrados.length / filasPorPagina);

  const exportarExcel = () => {
    const enc = "FECHA,PRODUCTO,CÓDIGO,TIPO,CANTIDAD,SALDO,LOTE,USUARIO\n";
    const filas = movimientosFiltrados.map(m => {
      const fecha = new Date(m.created_at).toLocaleDateString('es-PE');
      const prod = m.productos?.descripcion || '';
      const cod = m.productos?.codigo_barras || '';
      const usuario = m.usuarios ? `${m.usuarios.nombres} ${m.usuarios.apellidos}` : 'Sistema';
      return `"${fecha}","${prod}","${cod}","${m.tipo}",${m.cantidad},${m.saldo || 0},"${m.id_lote || '---'}","${usuario}"`;
    }).join('\n');
    const blob = new Blob(['\uFEFF' + enc + filas], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Kardex_SaludFutura_${new Date().toLocaleDateString('es-PE')}.csv`;
    link.click();
  };

  const getTipoBadge = (tipo) => {
    if (tipo === 'ENTRADA') return <span className="kardex-badge entrada">Entrada</span>;
    if (tipo === 'SALIDA') return <span className="kardex-badge salida">Salida</span>;
    if (tipo === 'AJUSTE') return <span className="kardex-badge ajuste">Ajuste</span>;
    return <span className="kardex-badge">{tipo}</span>;
  };

  const getCantidadColor = (tipo, cantidad) => {
    if (tipo === 'ENTRADA') return <span className="cant-entrada">+{cantidad}</span>;
    if (tipo === 'SALIDA') return <span className="cant-salida">-{cantidad}</span>;
    return <span className="cant-ajuste">{cantidad > 0 ? `+${cantidad}` : cantidad}</span>;
  };

  if (cargando) return <div className="kardex-loading">Cargando kardex...</div>;

  return (
    <div className="kardex-container">

      <div className="kardex-top">
        <div className="kardex-title-area">
          <p>{movimientosFiltrados.length} movimientos registrados</p>
        </div>
        <button className="btn-kardex-outline" onClick={exportarExcel}><UiIcon name="Download" size={15} /> Exportar Excel</button>
      </div>

      {/* KPIs */}
      <div className="kardex-kpis">
        <div className="kardex-kpi-card border-blue">
          <div className="kpi-icon-k bg-blue-soft"><UiIcon name="ClipboardList" size={16} /></div>
          <div className="kpi-info-k">
            <p>TOTAL MOVIMIENTOS</p>
            <h2>{movimientosFiltrados.length}</h2>
            <span>en el período</span>
          </div>
        </div>
        <div className="kardex-kpi-card border-green">
          <div className="kpi-icon-k bg-green-soft"><UiIcon name="Download" size={16} /></div>
          <div className="kpi-info-k">
            <p>ENTRADAS</p>
            <h2>+{totalEntradas}</h2>
            <span>unidades ingresadas</span>
          </div>
        </div>
        <div className="kardex-kpi-card border-red">
          <div className="kpi-icon-k bg-red-soft"><UiIcon name="Upload" size={16} /></div>
          <div className="kpi-info-k">
            <p>SALIDAS</p>
            <h2>-{totalSalidas}</h2>
            <span>unidades despachadas</span>
          </div>
        </div>
        <div className="kardex-kpi-card border-yellow">
          <div className="kpi-icon-k bg-yellow-soft"><UiIcon name="Settings" size={16} /></div>
          <div className="kpi-info-k">
            <p>AJUSTES</p>
            <h2>{totalAjustes}</h2>
            <span>correcciones de stock</span>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="kardex-filters">
        <div className="search-box-kardex">
          <span><UiIcon name="Search" size={16} /></span>
          <input
            type="text"
            placeholder="Buscar producto o código..."
            value={busqueda}
            onChange={e => { setBusqueda(e.target.value); setPaginaActual(1); }}
          />
        </div>
        <select className="select-kardex" value={tipoFiltro} onChange={e => { setTipoFiltro(e.target.value); setPaginaActual(1); }}>
          <option value="TODOS">Todos los tipos</option>
          <option value="ENTRADA">Entradas</option>
          <option value="SALIDA">Salidas</option>
          <option value="AJUSTE">Ajustes</option>
        </select>
        <div className="fecha-group">
          <label>Desde</label>
          <SmartDateInput value={fechaDesde} onChange={(val) => { setFechaDesde(val); setPaginaActual(1); }} />
        </div>
        <div className="fecha-group">
          <label>Hasta</label>
          <SmartDateInput value={fechaHasta} onChange={(val) => { setFechaHasta(val); setPaginaActual(1); }} />
        </div>
        <button className="btn-limpiar" onClick={() => { setBusqueda(''); setTipoFiltro('TODOS'); setFechaDesde(''); setFechaHasta(''); setPaginaActual(1); }}><UiIcon name="X" size={15} /> Limpiar
        </button>
      </div>

      {/* Tabla */}
      <div className="kardex-table-container">
        <table className="kardex-table">
          <thead>
            <tr>
              <th>FECHA</th>
              <th>PRODUCTO</th>
              <th className="text-center">TIPO</th>
              <th className="text-center">CANTIDAD</th>
              <th className="text-center">SALDO</th>
              <th>LOTE</th>
              <th>USUARIO</th>
              <th>OBSERVACIÓN</th>
            </tr>
          </thead>
          <tbody>
            {movsPagina.length === 0 ? (
              <tr><td colSpan="7" className="empty-kardex">No se encontraron movimientos con estos filtros.</td></tr>
            ) : (
              movsPagina.map(m => (
                <tr key={m.id_mov}>
                  <td>
                    <span className="fecha-principal">{new Date(m.created_at).toLocaleDateString('es-PE')}</span>
                    <br />
                    <small className="text-muted-k">{new Date(m.created_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}</small>
                  </td>
                  <td>
                    <strong className="prod-nombre">{m.productos?.descripcion || '---'}</strong>
                    <br />
                    <small className="text-muted-k">Cód: {m.productos?.codigo_barras || '---'}</small>
                  </td>
                  <td className="text-center">{getTipoBadge(m.tipo)}</td>
                  <td className="text-center font-bold">{getCantidadColor(m.tipo, m.cantidad)}</td>
                  <td className="text-center">
                    <strong>{m.saldo ?? '---'}</strong>
                  </td>
                  <td><small>{m.id_lote || '---'}</small></td>
                  <td>
                    <small>{m.usuarios ? `${m.usuarios.nombres} ${m.usuarios.apellidos}` : 'Sistema'}</small>
                  </td>
                  <td>
                    <small style={{ color: '#64748b' }}>{m.observacion || '—'}</small>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Paginación */}
        <div className="kardex-pagination">
          <span className="text-muted-k">
            Mostrando <strong>{movsPagina.length === 0 ? 0 : indexOfFirst + 1} - {Math.min(indexOfLast, movimientosFiltrados.length)}</strong> de <strong>{movimientosFiltrados.length}</strong>
          </span>
          <div className="page-controls-k">
            <button disabled={paginaActual === 1} onClick={() => setPaginaActual(1)}>«</button>
            <button disabled={paginaActual === 1} onClick={() => setPaginaActual(p => p - 1)}>‹</button>
            {Array.from({ length: Math.min(5, totalPaginas) }, (_, i) => {
              const num = Math.max(1, paginaActual - 2) + i;
              if (num > totalPaginas) return null;
              return <button key={num} className={paginaActual === num ? 'active' : ''} onClick={() => setPaginaActual(num)}>{num}</button>;
            })}
            <button disabled={paginaActual === totalPaginas || totalPaginas === 0} onClick={() => setPaginaActual(p => p + 1)}>›</button>
            <button disabled={paginaActual === totalPaginas || totalPaginas === 0} onClick={() => setPaginaActual(totalPaginas)}>»</button>
          </div>
        </div>
      </div>
    </div>
  );
}