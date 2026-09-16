import { useState, useEffect, useRef } from 'react';
import AlertaSistemaModal from '../../components/AlertaSistemaModal';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../supabaseClient';
import './VentasPerdidas.css';
import UiIcon from '../../components/UiIcon';

/** Mapea estado BD → badge visual (leyenda: En proceso / Atendido / Pendiente revisión). */
function badgeEstado(estadoRaw) {
  const e = (estadoRaw || 'Pendiente').trim().toLowerCase();
  if (e === 'atendido' || e === 'revisado' || e === 'resuelto') {
    return { label: 'Atendido', cls: 'green' };
  }
  if (e === 'en proceso' || e.includes('proceso')) {
    return { label: 'En proceso', cls: 'blue' };
  }
  return { label: 'Pendiente revisión', cls: 'yellow' };
}

export default function VentasPerdidas() {
  const { user } = useAuth();

  const [ventasPerdidas, setVentasPerdidas] = useState([]);
  const [loading, setLoading] = useState(true);

  // Sistema de alertas
  const [alertaSistema, setAlertaSistema] = useState(null);
  const alertOkBtnRef = useRef(null);
  useEffect(() => {
    if (alertaSistema && alertOkBtnRef.current) alertOkBtnRef.current.focus();
  }, [alertaSistema]);
  const mostrarAlerta = (mensaje, tipo = 'info') => {
    setAlertaSistema({ mensaje, tipo });
  };

  // Formulario libre
  const [productoInput, setProductoInput] = useState('');
  const [cantidadInput, setCantidadInput] = useState('');
  const [motivoInput, setMotivoInput] = useState('Falta de stock');
  const [registrando, setRegistrando] = useState(false);

  // Filtros (solo presentación / filtrado local)
  const [filtro, setFiltro] = useState('Todos');
  const [busqueda, setBusqueda] = useState('');

  const motivosOpciones = ["Falta de stock", "Sin catálogo", "Precio elevado", "No tenemos la presentación", "Otro"];

  useEffect(() => {
    cargarHistorial();
  }, []);

  const cargarHistorial = async () => {
    try {
      // 1. Obtener a qué hora abrió la caja para aislar la data de su turno actual
      const { data: turno } = await supabase
        .from('caja_turnos')
        .select('apertura_at')
        .eq('id_usuario_vendedor', user.id_usuario)
        .eq('estado', 'ABIERTO')
        .maybeSingle();

      if (!turno) {
        setLoading(false);
        return; // No hay turno abierto
      }

      // 2. Traer solo las ventas perdidas de ESTE usuario y de ESTE turno
      const { data, error } = await supabase
        .from('ventas_perdidas')
        .select('*')
        .eq('id_usuario', user.id_usuario)
        .gte('created_at', turno.apertura_at)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setVentasPerdidas(data || []);
    } catch (error) {
      console.error("Error cargando ventas perdidas:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleRegistrarManual = async (e) => {
    e.preventDefault();
    if (!productoInput.trim() || !cantidadInput)
      return mostrarAlerta('Completa el producto y la cantidad antes de registrar.', 'warning');

    setRegistrando(true);
    try {
      await supabase.from('ventas_perdidas').insert({
        id_sucursal: user.id_sucursal,
        id_usuario: user.id_usuario,
        nombre_producto: productoInput.toUpperCase(),
        cantidad_solicitada: Number(cantidadInput),
        motivo: motivoInput
      });

      setProductoInput('');
      setCantidadInput('');
      setMotivoInput('Falta de stock');
      mostrarAlerta('Venta perdida registrada correctamente.', 'success');
      cargarHistorial();
    } catch (error) {
      mostrarAlerta("Error al registrar: " + error.message, 'error');
    } finally {
      setRegistrando(false);
    }
  };

  // Filtrado local (motivo + búsqueda de producto)
  const q = busqueda.trim().toLowerCase();
  const dataFiltrada = ventasPerdidas.filter(vp => {
    if (filtro === 'Sin stock' && vp.motivo !== 'Falta de stock') return false;
    if (q && !(vp.nombre_producto || '').toLowerCase().includes(q)) return false;
    return true;
  });

  return (
    <div className="vp-page-container">

      {/* MODAL DE ALERTA */}
      <AlertaSistemaModal alerta={alertaSistema} onClose={() => setAlertaSistema(null)} />
      
      <div className="vp-info-banner">
        <div className="vp-info-icon" aria-hidden="true">i</div>
        <div className="vp-info-text">
          <strong>¿Qué es esto?</strong>
          <p>Registra aquí los productos que un cliente pidió y no pudiste vender. El administrador revisará y tomará acción.</p>
        </div>
      </div>

      {/* FORMULARIO LIBRE */}
      <div className="vp-card">
        <div className="vp-card-title-row">
          <h3 className="vp-card-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            Registrar venta perdida
          </h3>
          <span className="vp-chip-safe">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            No interrumpe la venta activa
          </span>
        </div>

        <form className="vp-manual-form" onSubmit={handleRegistrarManual}>
          <div className="vp-form-group">
            <label htmlFor="vp-producto">Producto solicitado</label>
            <input
              id="vp-producto"
              type="text"
              placeholder="Ej: Ibuprofeno 400mg, Paracetamol..."
              value={productoInput}
              onChange={(e) => setProductoInput(e.target.value)}
              required
            />
          </div>
          <div className="vp-form-group">
            <label htmlFor="vp-cantidad">Cantidad</label>
            <input
              id="vp-cantidad"
              type="number"
              placeholder="0"
              min="1"
              value={cantidadInput}
              onChange={(e) => setCantidadInput(e.target.value)}
              required
            />
          </div>
          <div className="vp-form-group">
            <label htmlFor="vp-motivo">Motivo</label>
            <select
              id="vp-motivo"
              value={motivoInput}
              onChange={(e) => setMotivoInput(e.target.value)}
            >
              {motivosOpciones.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="vp-form-actions">
            <button type="submit" className="vp-btn-submit" disabled={registrando}>
              {registrando ? 'Registrando…' : 'Confirmar registro'}
            </button>
          </div>
        </form>
      </div>

      {/* HISTORIAL */}
      <div className="vp-card vp-card-table">
        <div className="vp-table-header">
          <h3>Historial de este turno</h3>
          <div className="vp-filters-bar">
            <div className="vp-search-box">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                placeholder="Buscar producto..."
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                aria-label="Buscar producto"
              />
            </div>
            <div className="vp-filter-group">
              <button type="button" className={`vp-filter-btn ${filtro === 'Todos' ? 'active' : ''}`} onClick={() => setFiltro('Todos')}>Todos</button>
              <button type="button" className={`vp-filter-btn ${filtro === 'Sin stock' ? 'active' : ''}`} onClick={() => setFiltro('Sin stock')}>Sin stock</button>
            </div>
          </div>
        </div>

        <div className="vp-table-wrap">
          {loading ? (
            <div className="vp-empty-state">
              <p>Cargando tu historial de este turno…</p>
            </div>
          ) : dataFiltrada.length === 0 ? (
            <div className="vp-empty-state">
              <div className="vp-empty-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                </svg>
              </div>
              <h4>
                {ventasPerdidas.length === 0
                  ? 'Sin ventas perdidas en este turno'
                  : 'Ningún resultado con estos filtros'}
              </h4>
              <p>
                {ventasPerdidas.length === 0
                  ? 'Cuando un cliente pida algo que no puedas vender, regístralo arriba. El admin lo verá y te responderá aquí.'
                  : 'Prueba con otro término de búsqueda o cambia el filtro de motivo.'}
              </p>
            </div>
          ) : (
            <table className="vp-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="col-center">Cant.</th>
                  <th>Motivo</th>
                  <th>Fecha / hora</th>
                  <th>Estado</th>
                  <th>Mensaje del admin</th>
                </tr>
              </thead>
              <tbody>
                {dataFiltrada.map((vp) => {
                  const est = badgeEstado(vp.estado);
                  return (
                    <tr key={vp.id_vp || vp.id_venta_perdida}>
                      <td>
                        <strong className="vp-prod-name">{vp.nombre_producto}</strong>
                        <span className="vp-prod-meta">Ingresado manualmente</span>
                      </td>
                      <td className="col-center">
                        <span className="vp-cant">{vp.cantidad_solicitada}</span>
                      </td>
                      <td>
                        <span className={`vp-badge-motivo ${vp.motivo === 'Falta de stock' ? 'red' : 'yellow'}`}>
                          {vp.motivo}
                        </span>
                      </td>
                      <td className="vp-fecha">
                        {new Date(vp.created_at).toLocaleDateString('es-PE')} · {new Date(vp.created_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td>
                        <span className={`vp-badge-estado ${est.cls}`}>{est.label}</span>
                      </td>
                      <td>
                        {vp.mensaje_admin ? (
                          <div className="vp-admin-msg">
                            <strong>Admin</strong>
                            <p>&ldquo;{vp.mensaje_admin}&rdquo;</p>
                          </div>
                        ) : (
                          <span className="vp-admin-empty">— Sin mensaje aún</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="vp-footer-legend">
          <span className="legend-item"><span className="legend-dot blue" aria-hidden="true" /> En proceso</span>
          <span className="legend-item"><span className="legend-dot green" aria-hidden="true" /> Atendido</span>
          <span className="legend-item"><span className="legend-dot yellow" aria-hidden="true" /> Pendiente revisión</span>
          <span className="legend-note">El mensaje del admin se actualiza en tiempo real.</span>
        </div>
      </div>
    </div>
  );
}
