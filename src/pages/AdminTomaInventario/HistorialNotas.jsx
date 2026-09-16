import { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import SmartDateInput from '../../components/SmartDateInput';
import './NotaInventarioForm.css';
import UiIcon from '../../components/UiIcon';

export default function HistorialNotas() {
  const [fechaDesde, setFechaDesde] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [fechaHasta, setFechaHasta] = useState(() => new Date().toISOString().slice(0, 10));
  const [filtroTipo, setFiltroTipo] = useState('TODOS');
  const [notas, setNotas] = useState([]);
  const [cargando, setCargando] = useState(true);

  const cargarNotas = async () => {
    setCargando(true);
    try {
      let query = supabase
        .from('notas_inventario')
        .select('*, productos(descripcion, codigo_barras), usuarios(nombres, apellidos)')
        .gte('fecha', fechaDesde)
        .lte('fecha', fechaHasta)
        .order('created_at', { ascending: false })
        .limit(300);
      if (filtroTipo !== 'TODOS') query = query.eq('tipo', filtroTipo);
      const { data, error } = await query;
      if (error) throw error;
      setNotas(data || []);
    } catch (error) {
      console.error('Error cargando historial de notas:', error);
      setNotas([]);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargarNotas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fechaDesde, fechaHasta, filtroTipo]);

  return (
    <div className="nota-inv-container">
      <div className="nota-inv-header">
        <h3><UiIcon name="BarChart3" size={15} /> Historial de Notas</h3>
      </div>

      <div className="hist-notas-filtros">
        <div className="nota-inv-group">
          <label>Desde</label>
          <SmartDateInput value={fechaDesde} onChange={setFechaDesde} />
        </div>
        <div className="nota-inv-group">
          <label>Hasta</label>
          <SmartDateInput value={fechaHasta} onChange={setFechaHasta} />
        </div>
        <div className="hist-notas-pills">
          <button className={`hist-notas-pill ${filtroTipo === 'TODOS' ? 'active' : ''}`} onClick={() => setFiltroTipo('TODOS')}>Todos</button>
          <button className={`hist-notas-pill ${filtroTipo === 'INGRESO' ? 'active-ingreso' : ''}`} onClick={() => setFiltroTipo('INGRESO')}><UiIcon name="Download" size={15} /> Ingresos</button>
          <button className={`hist-notas-pill ${filtroTipo === 'SALIDA' ? 'active-salida' : ''}`} onClick={() => setFiltroTipo('SALIDA')}><UiIcon name="Upload" size={15} /> Salidas</button>
        </div>
      </div>

      {cargando ? (
        <p className="nota-inv-empty">Cargando historial...</p>
      ) : notas.length === 0 ? (
        <p className="nota-inv-empty">No se encontraron notas en ese rango.</p>
      ) : (
        <div className="hist-notas-table-scroll">
          <table className="hist-notas-table">
            <thead>
              <tr>
                <th>FECHA</th>
                <th>TIPO</th>
                <th>N°</th>
                <th>PRODUCTO</th>
                <th className="text-right">CANTIDAD</th>
                <th>USUARIO</th>
                <th>MOTIVO</th>
              </tr>
            </thead>
            <tbody>
              {notas.map(n => (
                <tr key={n.id_nota}>
                  <td className="text-muted">{new Date(n.fecha + 'T12:00:00').toLocaleDateString('es-PE')}</td>
                  <td>
                    <span className={`hist-notas-badge ${n.tipo === 'INGRESO' ? 'ingreso' : 'salida'}`}>
                      {n.tipo === 'INGRESO' ? <><UiIcon name="Download" size={14} /> Ingreso</> : <><UiIcon name="Upload" size={14} /> Salida</>}
                    </span>
                  </td>
                  <td className="font-bold">{String(n.numero_correlativo).padStart(4, '0')}</td>
                  <td>
                    <strong>{n.productos?.descripcion || '---'}</strong>
                    <br /><small className="text-muted">Cód: {n.productos?.codigo_barras || '---'}</small>
                  </td>
                  <td className="text-right font-bold">{n.cantidad}</td>
                  <td className="text-muted">
                    <span className="hist-notas-truncate" title={n.usuarios ? `${n.usuarios.nombres} ${n.usuarios.apellidos || ''}` : '---'}>
                      {n.usuarios ? `${n.usuarios.nombres} ${(n.usuarios.apellidos || '').split(' ')[0]}` : '---'}
                    </span>
                  </td>
                  <td className="text-muted">
                    <span className="hist-notas-truncate" title={n.motivo || 'Sin motivo'} style={!n.motivo ? { fontStyle: 'italic', color: '#cbd5e1' } : undefined}>
                      {n.motivo || 'Sin motivo'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
