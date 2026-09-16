import { useState, useEffect } from 'react';
import AlertaSistemaModal from '../../components/AlertaSistemaModal';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../context/AuthContext';
import { useAppData } from '../../context/AppDataContext';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { cargarAlertasMiCaja } from '../../utils/alertasMiCaja';
import { esRolCaja, esAdmin } from '../../utils/roles';
import { buildCierreCajaPayload, printTicketCierreCaja } from '../../utils/ticketCierreCaja';
import { cargarVentasDelTurno as fetchVentasDelTurno } from '../../utils/ventasDelTurno';
import './Dashboard.css';
import UiIcon from '../../components/UiIcon';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const { refrescarSeccion } = useAppData();
  const navigate = useNavigate();
  const { dispararHintLogout } = useOutletContext();
  
  const [turnoActivo, setTurnoActivo] = useState(null);
  const [loadingTurno, setLoadingTurno] = useState(true);
  
  // === ESTADO PARA ALERTAS BONITAS 100% GARANTIZADAS ===
  const [alertaSistema, setAlertaSistema] = useState(null);

  const mostrarAlerta = (mensaje, tipo = 'info', accion = null) => {
    setAlertaSistema({ mensaje, tipo, accion });
  };

  // Estados de Apertura
  const [montoApertura, setMontoApertura] = useState('');
  const [abriendoCaja, setAbriendoCaja] = useState(false);
  const [siguienteTurno, setSiguienteTurno] = useState('...');
  
  // Estados de Cierre
  const [showCierreModal, setShowCierreModal] = useState(false);
  const [efectivoFisico, setEfectivoFisico] = useState('');
  const [yapeVerificado, setYapeVerificado] = useState('');
  const [cerrandoCaja, setCerrandoCaja] = useState(false);
  
  const [showBanner, setShowBanner] = useState(true); 
  const [ventasHoy, setVentasHoy] = useState([]);
  const [alertas, setAlertas] = useState([]);
  const [cargandoAlertas, setCargandoAlertas] = useState(false);
  const [totalesPagos, setTotalesPagos] = useState({ efectivo: 0, yape: 0, tarjeta: 0 });

  const fechaActual = new Date();
  const horaFormateada = fechaActual.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
  const fechaCorta = fechaActual.toLocaleDateString('es-PE', { day: 'numeric', month: 'short', year: 'numeric' });
  const fechaLarga = fechaActual.toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });

  useEffect(() => {
    verificarTurno();
  }, []);

  // Alertas de inventario (stock bajo / por vencer) — misma vista para Vendedor y
  // Admin cuando usan Mi Caja con turno abierto; filtradas a su sucursal.
  useEffect(() => {
    if (!turnoActivo || user?.id_sucursal == null) {
      setAlertas([]);
      return undefined;
    }
    let cancelado = false;
    setCargandoAlertas(true);
    cargarAlertasMiCaja(user.id_sucursal)
      .then((lista) => { if (!cancelado) setAlertas(lista); })
      .catch((err) => { console.error('Error cargando alertas Mi Caja:', err); })
      .finally(() => { if (!cancelado) setCargandoAlertas(false); });
    return () => { cancelado = true; };
  }, [turnoActivo, user?.id_sucursal]);

  const irATicketSinStock = (alerta) => {
    navigate('/soporte', {
      state: {
        ticketPredefinido: {
          asunto: `Sin stock: ${alerta.producto}`,
          descripcion: `Solicito reposición o revisión de stock.\n\nProducto: ${alerta.producto}\nDetalle: ${alerta.detalle}\nSucursal: ${user?.sucursales?.nombre_comercial || user?.id_sucursal || '—'}\n\n(Generado desde Mi Caja → Alertas del inventario)`,
          prioridad: 'ALTA',
        },
      },
    });
  };

  const verificarTurno = async () => {
    // Si está offline, intentar recuperar turno del localStorage
    if (!navigator.onLine) {
      const turnoGuardado = localStorage.getItem('saludFutura_turnoActivo');
      if (turnoGuardado) {
        const turno = JSON.parse(turnoGuardado);
        setTurnoActivo(turno);
      }
      setLoadingTurno(false);
      return;
    }
    try {
      const { data } = await supabase
        .from('caja_turnos')
        .select('*')
        .eq('id_usuario_vendedor', user.id_usuario)
        .eq('estado', 'ABIERTO')
        .maybeSingle();
      if (data) {
        setTurnoActivo(data);
        // Guardar turno en localStorage para uso offline
        localStorage.setItem('saludFutura_turnoActivo', JSON.stringify(data));
        cargarVentasDelTurno(data.id_turno);
      } else {
        localStorage.removeItem('saludFutura_turnoActivo');
        const { data: maxData } = await supabase
          .from('caja_turnos')
          .select('id_turno')
          .order('id_turno', { ascending: false })
          .limit(1)
          .maybeSingle();
        setSiguienteTurno(maxData ? maxData.id_turno + 1 : 1);
      }
    } catch (error) {
      console.error("Error verificando turno:", error);
      // Si falla, intentar recuperar del localStorage
      const turnoGuardado = localStorage.getItem('saludFutura_turnoActivo');
      if (turnoGuardado) {
        setTurnoActivo(JSON.parse(turnoGuardado));
      }
    } finally {
      setLoadingTurno(false);
    }
  };

  const cargarVentasDelTurno = async (idTurno) => {
    try {
      const r = await fetchVentasDelTurno(supabase, idTurno);
      setTotalesPagos(r.totalesPagos);
      setVentasHoy(r.ventas);
    } catch (error) { console.error("Error cargando ventas:", error); }
  };

  const handleAbrirCaja = async (e) => {
    e.preventDefault();
    if (!montoApertura || isNaN(montoApertura) || Number(montoApertura) < 0) return;
    setAbriendoCaja(true);
    try {
      const { data, error } = await supabase.from('caja_turnos').insert([{ id_sucursal: user.id_sucursal, id_usuario_vendedor: user.id_usuario, monto_apertura: Number(montoApertura), estado: 'ABIERTO' }]).select().single();
      if (error) throw error;
      setTurnoActivo(data);
      setShowBanner(true);
      setVentasHoy([]); setTotalesPagos({ efectivo: 0, yape: 0, tarjeta: 0 });
    } catch (error) {
      mostrarAlerta("Error de Supabase: " + error.message, 'error');
    } finally {
      setAbriendoCaja(false);
    }
  };

  // Cierre siempre directo: el voucher registra faltante/sobrante; ya no se pide
  // el "código del día" (fricción cliente-side, sin validación real en Supabase).
  const procesarCierreCaja = async (e) => {
    e.preventDefault();
    if (efectivoFisico === '' || yapeVerificado === '') return mostrarAlerta("Por favor, ingresa ambos montos.", 'error');

    const cajaInicial = Number(turnoActivo.monto_apertura);
    const fisico = Number(efectivoFisico);
    const yapeFisico = Number(yapeVerificado);
    const esperadoEfectivo = cajaInicial + totalesPagos.efectivo;
    const esperadoYape = totalesPagos.yape;
    const diferenciaTotal = (fisico - esperadoEfectivo) + (yapeFisico - esperadoYape);

    ejecutarCierreReal(fisico, esperadoEfectivo, diferenciaTotal, yapeFisico, esperadoYape, '');
  };

  /**
   * Voucher de cierre por el MISMO camino que el ticket de venta: en Electron sale
   * en ESC/POS directo a la térmica configurada, sin diálogo de impresión. Antes
   * abría una ventana con window.print() y Windows pedía elegir impresora.
   */
  const imprimirTicketCierre = async (turno, totPagos, efectivoReal, yapeReal, difTotal, observacion) => {
    const payload = buildCierreCajaPayload({
      turno,
      totalesPagos: totPagos,
      efectivoReal,
      yapeReal,
      difTotal,
      observacion,
      user,
    });
    return printTicketCierreCaja(payload);
  };

  const ejecutarCierreReal = async (efectivoReal, esperadoEfec, difTotal, yapeReal, esperadoYape, observacion) => {
    setCerrandoCaja(true);
    try {
      const { data: turnoCerrado, error } = await supabase.from('caja_turnos').update({ 
        estado: 'CERRADO', cierre_at: new Date().toISOString(), efectivo_real: efectivoReal, total_efectivo_esperado: esperadoEfec, yape_real: yapeReal, total_yape_esperado: esperadoYape, diferencia_total: difTotal, observacion: observacion, requiere_autorizacion: !!observacion
      }).eq('id_turno', turnoActivo.id_turno).select('id_turno, estado');
      
      if (error) throw error;
      if (!turnoCerrado || turnoCerrado.length === 0) {
        throw new Error('No se pudo cerrar el turno (0 filas actualizadas). Verifica que el turno siga abierto.');
      }

      // Invalidar caché de turnos abiertos YA (antes de navegar al Admin Dashboard).
      // Sin esto, la rama "Hoy" de AdminDashboard puede pintar appData.turnos stale
      // si Realtime no llega a tiempo — el Admin seguiría apareciendo "en turno".
      await refrescarSeccion('turnos');
      
      // Voucher a la térmica. El turno ya está cerrado, así que un fallo de papel
      // no aborta el flujo: se avisa dentro del mismo aviso de cierre.
      const impresion = await imprimirTicketCierre(
        turnoActivo, totalesPagos, efectivoReal, yapeReal, difTotal, observacion,
      );

      setShowCierreModal(false);

      const avisoImpresion = impresion.ok
        ? ''
        : `\n\nOJO: no se pudo imprimir el voucher (${impresion.error}). `
          + 'Revisa que la térmica esté encendida y seleccionada en Configuración → Impresora.';
      const tipoAviso = impresion.ok ? 'success' : 'error';

      if (esRolCaja(user.id_rol)) {
        mostrarAlerta("Turno cerrado exitosamente. El sistema cerrará tu sesión." + avisoImpresion, tipoAviso, () => {
          localStorage.removeItem('saludFutura_turnoActivo');
          logout(); navigate('/login');
        });
      } else {
        localStorage.removeItem('saludFutura_turnoActivo');
        mostrarAlerta("Turno cerrado exitosamente." + avisoImpresion, tipoAviso, () => {
          dispararHintLogout();
          navigate('/admin-dashboard');
        });
      }

    } catch (error) {
      mostrarAlerta("Error al cerrar el turno: " + error.message, 'error');
    } finally {
      setCerrandoCaja(false);
    }
  };

  // Dashboard.jsx es una ruta COMPARTIDA (ROLES_CAJA_Y_ADMIN), pero /pos y
  // /ventas-perdidas solo están registradas para el Vendedor (rol 3) — un Admin que
  // navegara ahí directo es rebotado por ProtectedRoute a /admin-dashboard, sin
  // llegar nunca a destino. "Nueva venta" y "Venta perdida" necesitan la ruta
  // equivalente de Admin: /admin-pos, y la pestaña VENTAS_PERDIDAS de
  // AdminAlertas.jsx (mismo patrón location.state?.tab que ya usa esa pantalla).
  const irANuevaVenta = () => navigate(esAdmin(user.id_rol) ? '/admin-pos' : '/pos');
  const irAVentaPerdida = () => {
    if (esAdmin(user.id_rol)) navigate('/admin-alertas', { state: { tab: 'VENTAS_PERDIDAS' } });
    else navigate('/ventas-perdidas');
  };

  if (loadingTurno) return <p style={{ padding: '2rem' }}>Cargando información del turno...</p>;
  const totalVentas = ventasHoy.reduce((acc, venta) => acc + Number(venta.total), 0);
  // Efectivo físico esperado en gaveta = apertura + solo pagos EFECTIVO del turno
  // (mismo criterio que el cuadre al cerrar). Yape/Tarjeta no entran aquí.
  const cajaActualEfectivo = turnoActivo
    ? Number(turnoActivo.monto_apertura || 0) + Number(totalesPagos.efectivo || 0)
    : 0;
  // Suma de cobros del turno por todos los métodos (Mixto ya viene desglosado en
  // efectivo/yape/tarjeta al cargar ventas). No incluye monto de apertura.
  const totalCobradoTodosMetodos =
    Number(totalesPagos.efectivo || 0)
    + Number(totalesPagos.yape || 0)
    + Number(totalesPagos.tarjeta || 0);

  return (
    <div className="dashboard-container">
      
      <AlertaSistemaModal alerta={alertaSistema} onClose={() => setAlertaSistema(null)} />

      {/* MODAL DE CIERRE DE CAJA CON MONTOS ESPERADOS VISIBLES */}
      {showCierreModal && (
        <div className="modal-overlay-strict" role="dialog" aria-modal="true" data-keyboard-trap>
          <div className="apertura-modal-modern">
            <button type="button" className="btn-close-abs" data-enter-skip="true" tabIndex={-1} onClick={() => setShowCierreModal(false)}><UiIcon name="X" size={16} /></button>
            <div className="apertura-header-modern" style={{backgroundColor: '#022b5e', padding: '2rem 2.5rem'}}>
              <div className="circle-decoration circle-1"></div><div className="circle-decoration circle-2"></div>
              <p className="header-label" style={{color: '#bfdbfe'}}>CIERRE DE TURNO (CIEGO)</p>
              <h2 className="header-monto" style={{fontSize: '1.8rem', marginTop: '10px'}}>Declaración de Saldos</h2>
              <p className="header-subtitle" style={{color: '#bfdbfe', marginTop: '10px'}}>{user?.sucursales?.nombre_comercial} · {horaFormateada}</p>
            </div>
            <form className="apertura-body-modern" onSubmit={procesarCierreCaja}>
              <div className="badge-ready" style={{backgroundColor: '#fef2f2', color: '#b91c1c'}}><span style={{fontWeight: 'bold', marginRight: '5px'}}><UiIcon name="AlertTriangle" size={16} /></span> Conteo de fin de turno</div>

              {/* Resumen del sistema para referencia */}
              <div style={{background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:'10px',padding:'0.8rem 1rem',marginBottom:'1rem'}}>
                <p style={{fontSize:'0.65rem',fontWeight:700,color:'#94a3b8',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:'0.5rem'}}>VENTAS DEL TURNO (SISTEMA)</p>
                <div style={{display:'flex',gap:'1rem',flexWrap:'wrap'}}>
                  <div style={{flex:1,minWidth:'80px'}}>
                    <p style={{fontSize:'0.65rem',color:'#64748b',margin:0}}>Apertura</p>
                    <p style={{fontWeight:700,color:'#0f172a',margin:0}}>S/ {Number(turnoActivo?.monto_apertura||0).toFixed(2)}</p>
                  </div>
                  <div style={{flex:1,minWidth:'80px'}}>
                    <p style={{fontSize:'0.65rem',color:'#64748b',margin:0}}>Efectivo ventas</p>
                    <p style={{fontWeight:700,color:'#16a34a',margin:0}}>S/ {totalesPagos.efectivo.toFixed(2)}</p>
                  </div>
                  <div style={{flex:1,minWidth:'80px'}}>
                    <p style={{fontSize:'0.65rem',color:'#64748b',margin:0}}>Efectivo esperado</p>
                    <p style={{fontWeight:800,color:'#b91c1c',margin:0}}>S/ {(Number(turnoActivo?.monto_apertura||0) + totalesPagos.efectivo).toFixed(2)}</p>
                  </div>
                  <div style={{flex:1,minWidth:'80px'}}>
                    <p style={{fontSize:'0.65rem',color:'#64748b',margin:0}}>Yape esperado</p>
                    <p style={{fontWeight:800,color:'#7c3aed',margin:0}}>S/ {totalesPagos.yape.toFixed(2)}</p>
                  </div>
                </div>
              </div>

              <p style={{fontSize: '0.85rem', color: '#475569', marginBottom: '1rem', lineHeight: '1.4'}}>Cuenta el dinero de la gaveta y verifica el total de Yape en el celular. <strong>Ingresa los montos exactos.</strong></p>
              <div className="input-section-modern" style={{marginBottom: '1rem'}}>
                <label>EFECTIVO TOTAL EN CAJA (Billetes y monedas)</label>
                <div className="input-row-modern" style={{borderBottomColor: '#b91c1c'}}><span className="currency-modern" style={{color: '#b91c1c'}}>S/</span><input type="number" step="0.10" placeholder="0.00" value={efectivoFisico} onChange={(e) => setEfectivoFisico(e.target.value)} required autoFocus style={{color: '#b91c1c'}} /></div>
                {efectivoFisico !== '' && (
                  <small style={{color: Number(efectivoFisico) === (Number(turnoActivo?.monto_apertura||0) + totalesPagos.efectivo) ? '#16a34a' : '#b91c1c', fontWeight:600}}>
                    Esperado: S/ {(Number(turnoActivo?.monto_apertura||0) + totalesPagos.efectivo).toFixed(2)}
                    &nbsp;— Diferencia: {(Number(efectivoFisico) - (Number(turnoActivo?.monto_apertura||0) + totalesPagos.efectivo)) >= 0 ? '+' : ''}S/ {(Number(efectivoFisico) - (Number(turnoActivo?.monto_apertura||0) + totalesPagos.efectivo)).toFixed(2)}
                  </small>
                )}
              </div>
              <div className="input-section-modern">
                <label>MONTO TOTAL VERIFICADO EN YAPE</label>
                <div className="input-row-modern" style={{borderBottomColor: '#8b5cf6'}}><span className="currency-modern" style={{color: '#8b5cf6', fontWeight: 'bold'}}>Y</span><input type="number" step="0.10" placeholder="0.00" value={yapeVerificado} onChange={(e) => setYapeVerificado(e.target.value)} required style={{color: '#8b5cf6'}} /></div>
                {yapeVerificado !== '' && (
                  <small style={{color: Math.abs(Number(yapeVerificado) - totalesPagos.yape) <= 0.01 ? '#16a34a' : '#b91c1c', fontWeight:600}}>
                    Esperado: S/ {totalesPagos.yape.toFixed(2)}
                    &nbsp;— Diferencia: {(Number(yapeVerificado) - totalesPagos.yape) >= 0 ? '+' : ''}S/ {(Number(yapeVerificado) - totalesPagos.yape).toFixed(2)}
                  </small>
                )}
              </div>
              <div className="action-buttons-modern" style={{marginTop: '2rem'}}>
                <button type="submit" className="btn-primary-modern" style={{backgroundColor: '#b91c1c'}} disabled={cerrandoCaja}>
                  {cerrandoCaja ? 'Procesando cierre...' : <><UiIcon name="Printer" size={15} /> Finalizar, Cuadrar e Imprimir</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL DE APERTURA EXACTO AL DISEÑO */}
      {!turnoActivo && (
        <div className="modal-overlay-strict" role="dialog" aria-modal="true" data-keyboard-trap>
          <div className="apertura-modal-modern">
            <div className="apertura-header-modern">
              <div className="circle-decoration circle-1"></div>
              <div className="circle-decoration circle-2"></div>
              <p className="header-label">APERTURA DE CAJA</p>
              <h2 className="header-monto">S/ {montoApertura ? Number(montoApertura).toFixed(2) : '0.00'}</h2>
              <p className="header-subtitle">{user?.sucursales?.nombre_comercial} · {horaFormateada} a.m. · {fechaCorta}</p>
            </div>
            
            <form className="apertura-body-modern" onSubmit={handleAbrirCaja}>
              <div className="badge-ready">
                <svg className="icon-check" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg> 
                Listo para registrar
              </div>
              
              <div className="info-grid-modern">
                <div className="info-item"><label>VENDEDOR</label><p>{user.nombres} {user.apellidos.split(' ')[0]}</p></div>
                <div className="info-item"><label>TURNO N°</label><p>#{String(siguienteTurno).padStart(3, '0')}</p></div>
                <div className="info-item"><label>SEDE</label><p>{user?.sucursales?.nombre_comercial}</p></div>
                <div className="info-item"><label>HORA</label><p>{horaFormateada} a.m.</p><small className="date-small">{fechaLarga}</small></div>
              </div>
              
              <div className="input-section-modern" style={{marginTop: '1.5rem'}}>
                <label>MONTO DE APERTURA</label>
                <div className="input-row-modern golden-bottom">
                  <span className="currency-modern">S/</span>
                  <input type="number" step="0.10" placeholder="0" value={montoApertura} onChange={(e) => setMontoApertura(e.target.value)} required autoFocus/>
                </div>
              </div>
              
              <div className="action-buttons-modern" style={{marginTop: '2rem'}}>
                <button type="submit" className="btn-primary-modern" disabled={abriendoCaja}>{abriendoCaja ? 'Abriendo...' : 'Confirmar apertura'}</button>
                <button type="button" className="btn-secondary-modern" data-enter-skip="true" tabIndex={-1} onClick={() => { if (esAdmin(user?.id_rol)) navigate('/admin-dashboard'); }} disabled={abriendoCaja}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DASHBOARD PRINCIPAL */}
      <div className={`dashboard-content ${(!turnoActivo || showCierreModal || alertaSistema) ? 'blurred' : ''}`}>
        <div className="dashboard-header-row">
          <div className="welcome-section">
            <h1 className="welcome-title"><UiIcon name="Users" size={22} /> Buenos días, {user.nombres}</h1>
            <p className="subtitle">Turno activo desde las {turnoActivo ? new Date(turnoActivo.apertura_at).toLocaleTimeString('es-PE', {hour: '2-digit', minute:'2-digit'}) : '--:--'} · {user?.sucursales?.nombre_comercial}</p>
          </div>
          {turnoActivo && showBanner && (
            <div className="success-banner">
              <div className="banner-icon-bg"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></div>
              <div className="banner-text">
                <strong>¡Caja abierta! Tu turno comenzó a las {new Date(turnoActivo.apertura_at).toLocaleTimeString('es-PE', {hour: '2-digit', minute:'2-digit'})}</strong>
                <span>Apertura: S/ {Number(turnoActivo.monto_apertura).toFixed(2)} · Ya puedes realizar ventas</span>
              </div>
              <button className="banner-close" onClick={() => setShowBanner(false)}><UiIcon name="X" size={16} /></button>
            </div>
          )}
        </div>

        <div className="stats-grid">
          <div className="stat-card border-blue"><div className="stat-card-content"><div><p>VENTAS HOY</p><h3>S/ {totalVentas.toFixed(2)}</h3></div><div className="icon-box blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg></div></div><small className="trend up"><UiIcon name="TrendingUp" size={12} /> 0% más que ayer</small></div>
          <div className="stat-card border-yellow">
            <div className="stat-card-content">
              <div>
                <p>CAJA ACTUAL</p>
                <h3>S/ {cajaActualEfectivo.toFixed(2)}</h3>
              </div>
              <div className="icon-box yellow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg></div>
            </div>
            <small className="trend neutral">Efectivo en caja (apertura + efectivo)</small>
            <small className="trend neutral" style={{ display: 'block', marginTop: 4, color: '#64748b' }}>
              Total cobrado (todos los métodos): <strong style={{ color: '#0f172a' }}>S/ {totalCobradoTodosMetodos.toFixed(2)}</strong>
            </small>
          </div>
          <div className="stat-card border-green"><div className="stat-card-content"><div><p>TICKETS EMITIDOS</p><h3>{ventasHoy.length}</h3></div><div className="icon-box green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg></div></div><small className="trend neutral">En este turno</small></div>
          <div className="stat-card border-red"><div className="stat-card-content"><div><p>ALERTAS ACTIVAS</p><h3>{alertas.length}</h3></div><div className="icon-box red"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg></div></div><small className="trend neutral">Requieren atención</small></div>
        </div>

        <div className="middle-grid">
          <div className="panel">
            <div className="panel-header"><h3>Mi turno</h3><span className="badge-active"><span className="dot"></span> Activo</span></div>
            <div className="turno-info-grid">
              <div className="t-info"><span className="t-icon"><UiIcon name="Timer" size={16} /></span><label>Apertura</label><p>{turnoActivo ? new Date(turnoActivo.apertura_at).toLocaleTimeString('es-PE', {hour: '2-digit', minute:'2-digit'}) : '--:--'}</p></div>
              <div className="t-info"><span className="t-icon"><UiIcon name="CreditCard" size={16} /></span><label>Apertura caja</label><p>S/ {turnoActivo ? Number(turnoActivo.monto_apertura).toFixed(2) : '0.00'}</p></div>
              <div className="t-info"><span className="t-icon"><UiIcon name="User" size={16} /></span><label>Turno N°</label><p>#{String(turnoActivo?.id_turno || '---').padStart(4, '0')}</p></div>
            </div>
          </div>
          <div className="panel">
            <h3 className="panel-title-center">Acciones rápidas</h3>
            <div className="actions-grid">
              <button className="btn-outline" onClick={irANuevaVenta}><UiIcon name="Monitor" size={15} /> Nueva venta</button>
              <button className="btn-outline" onClick={irAVentaPerdida}><UiIcon name="XCircle" size={15} /> Venta perdida</button>
              <button className="btn-outline full-width" onClick={() => setShowCierreModal(true)}><UiIcon name="CreditCard" size={15} /> Cerrar mi caja al terminar el turno</button>
            </div>
          </div>
        </div>

        <div className="bottom-grid">
          <div className="panel panel-no-padding">
            <div className="panel-header-padded"><h3>Mis ventas de hoy</h3><button className="btn-small-gray" onClick={() => navigate('/mis-ventas')}>Ver todas</button></div>
            <div className="table-responsive">
              <table className="table-ventas">
                <thead><tr><th>COMPROBANTE</th><th>CLIENTE</th><th>MÉTODO</th><th>TOTAL</th><th>HORA</th></tr></thead>
                <tbody>
                  {ventasHoy.length === 0 ? (
                    <tr><td colSpan="5" className="empty-state">No hay ventas registradas aún.</td></tr>
                  ) : (
                    ventasHoy.map((venta, index) => (
                      <tr key={index}><td className="text-blue font-bold">{venta.comprobante}</td><td>{venta.cliente}</td><td><span className={`badge-pay ${venta.metodo.toLowerCase()}`}>{venta.metodo}</span></td><td className="font-bold">S/ {Number(venta.total).toFixed(2)}</td><td className="text-muted">{venta.hora}</td></tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="panel-footer"><span className="text-muted">{ventasHoy.length} ventas en este turno</span><strong className="text-dark">Total: S/ {totalVentas.toFixed(2)}</strong></div>
          </div>
          <div className="panel panel-alertas-inventario">
            <div className="panel-header">
              <h3>Alertas del inventario</h3>
              <span className="badge-alert-count">{alertas.length} activas</span>
            </div>
            <div className="alert-list">
              {cargandoAlertas ? (
                <p className="empty-state">Cargando alertas…</p>
              ) : alertas.length === 0 ? (
                <p className="empty-state">No hay alertas pendientes en tu sucursal.</p>
              ) : (
                alertas.map((alerta, index) => (
                  <div key={`${alerta.tipo}-${alerta.id_producto}-${alerta.badge}-${index}`} className={`alert-item ${alerta.tipo}`}>
                    <div className="alert-icon">!</div>
                    <div className="alert-content">
                      <strong>{alerta.producto} — {alerta.titulo}</strong>
                      <p>{alerta.detalle}</p>
                      {alerta.accion === 'ticket' && esRolCaja(user?.id_rol) && (
                        <button
                          type="button"
                          className="alert-btn-ticket"
                          onClick={() => irATicketSinStock(alerta)}
                        >
                          Enviar ticket
                        </button>
                      )}
                    </div>
                    <div className="alert-badge">{alerta.badge}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}