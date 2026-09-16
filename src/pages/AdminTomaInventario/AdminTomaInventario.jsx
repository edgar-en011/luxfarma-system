import { useState, useEffect, useRef } from 'react';
import AlertaSistemaModal from '../../components/AlertaSistemaModal';
import { useLocation } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../context/AuthContext';
import { aplicarAjusteInventario, cerrarSesionInventario } from '../../utils/inventarioAjustes';
import { cargarKardexReciente, calcularMensajeConteo } from '../../utils/mensajeConteo';
import SmartDateInput from '../../components/SmartDateInput';
import NotaInventarioForm from './NotaInventarioForm';
import HistorialNotas from './HistorialNotas';
import { esRolOperativo } from '../../utils/roles';
import './AdminTomaInventario.css';
import UiIcon from '../../components/UiIcon';

const VISTAS_VALIDAS = ['sesiones', 'historial-persona', 'nota-ingreso', 'nota-salida', 'historial-notas'];

export default function AdminTomaInventario() {
  const { user } = useAuth();
  const location = useLocation();

  const [sesiones, setSesiones] = useState([]);
  const [sesionesActivas, setSesionesActivas] = useState([]);
  const [conteos, setConteos] = useState([]);
  const [sucursales, setSucursales] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [abriendo, setAbriendo] = useState(false);
  const [cerrando, setCerrando] = useState(null);
  const [sucursalSeleccionada, setSucursalSeleccionada] = useState('');
  const [alertaSistema, setAlertaSistema] = useState(null);
  const alertOkBtnRef = useRef(null);
  useEffect(() => {
    if (alertaSistema && alertOkBtnRef.current) alertOkBtnRef.current.focus();
  }, [alertaSistema]);
  const [vistaDetalle, setVistaDetalle] = useState(null);
  const vistaDetalleRef = useRef(null); // ← para acceder en Realtime callback

  // ── Tabs: "Sesiones" (contenido actual, sin cambios) / "Historial por persona" /
  // "Nota de Ingreso" / "Nota de Salida" / "Historial de Notas" ──
  // Si se llega desde Alertas ("Gestionar retiro"), location.state.vista abre
  // directo 'nota-salida' y retiroVencido precarga el form.
  const [vistaActual, setVistaActual] = useState(() => {
    const v = location.state?.vista;
    return VISTAS_VALIDAS.includes(v) ? v : 'sesiones';
  });
  const [retiroVencido, setRetiroVencido] = useState(() => location.state?.retiroVencido || null);

  // Si el Admin hace otro "Gestionar retiro" estando ya en esta ruta, React Router
  // reutiliza el componente — sincronizamos state de navegación.
  useEffect(() => {
    const v = location.state?.vista;
    if (VISTAS_VALIDAS.includes(v)) setVistaActual(v);
    if (location.state?.retiroVencido) setRetiroVencido(location.state.retiroVencido);
  }, [location.state]);

  // ── Historial de conteos por persona (cruza múltiples sesiones) ──
  const [usuariosLista, setUsuariosLista] = useState([]);
  const [usuarioFiltroHistorial, setUsuarioFiltroHistorial] = useState('');
  const [fechaDesdeHistorial, setFechaDesdeHistorial] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [fechaHastaHistorial, setFechaHastaHistorial] = useState(() => new Date().toISOString().slice(0, 10));
  const [sucursalFiltroHistorial, setSucursalFiltroHistorial] = useState('');
  const [historialPersona, setHistorialPersona] = useState([]);
  const [cargandoHistorialPersona, setCargandoHistorialPersona] = useState(false);
  const btnAplicarBusquedaRef = useRef(null);

  // ── Mensaje de conteo enriquecido con Kardex, columna MENSAJE de "Detalle de
  // conteos" (lógica compartida con TomaInventario.jsx, ver src/utils/mensajeConteo.js) ──
  const [kardexRecienteMap, setKardexRecienteMap] = useState({}); // { [id_producto]: { tieneEntrada, tieneSalida } }
  const debounceKardexDetalleRef = useRef(null);

  const mostrarAlerta = (mensaje, tipo = 'info', accionConfirmar = null, textoConfirmar = 'Aceptar', accionCancelar = null, textoCancelar = null) => {
    setAlertaSistema({ mensaje, tipo, accionConfirmar, textoConfirmar, accionCancelar, textoCancelar });
  };

  const cargarDatos = async () => {
    setCargando(true);
    try {
      const { data: dataSuc } = await supabase.from('sucursales').select('*');
      setSucursales((dataSuc || []).filter(s => String(s.activo) === '1' || s.activo === true));

      const { data: dataSesiones } = await supabase
        .from('inventario_sesiones')
        .select('*, sucursales(nombre_comercial), usuarios(nombres, apellidos)')
        .order('fecha_apertura', { ascending: false })
        .limit(30);

      setSesiones(dataSesiones || []);
      setSesionesActivas((dataSesiones || []).filter(s => s.estado === 'ABIERTA'));
    } catch (error) {
      console.error('Error cargando datos:', error);
    } finally {
      setCargando(false);
    }
  };

  const cargarConteos = async (sesion) => {
    const { data } = await supabase
      .from('inventario_conteos')
      .select('*, productos(descripcion, codigo_barras), usuarios(nombres, apellidos)')
      .eq('id_sesion', sesion.id_sesion)
      .order('created_at', { ascending: false });
    setConteos(data || []);
  };

  // "Detalle de conteos": batch para todos los que tienen diferencia, cada vez que se
  // cargan/actualizan los conteos de la sesión que se está viendo — no en las otras
  // dos tablas (Historial de sesiones / Historial por persona).
  useEffect(() => {
    const idSucursalActual = vistaDetalle?.id_sucursal;
    const ids = conteos.filter(c => c.diferencia !== 0).map(c => c.id_producto);
    if (ids.length === 0 || !idSucursalActual) return undefined;
    if (debounceKardexDetalleRef.current) clearTimeout(debounceKardexDetalleRef.current);
    debounceKardexDetalleRef.current = setTimeout(() => {
      cargarKardexReciente(ids, idSucursalActual, setKardexRecienteMap);
    }, 400);
    return () => clearTimeout(debounceKardexDetalleRef.current);
  }, [conteos, vistaDetalle]);

  // Historial de conteos de UNA persona a través de MÚLTIPLES sesiones — a diferencia
  // de cargarConteos (una sola sesión), esto filtra por id_usuario y rango de fechas.
  const cargarHistorialPersona = async () => {
    if (!usuarioFiltroHistorial) { setHistorialPersona([]); return; }
    setCargandoHistorialPersona(true);
    try {
      const desde = new Date(`${fechaDesdeHistorial}T00:00:00`);
      const hasta = new Date(`${fechaHastaHistorial}T23:59:59`);
      let query = supabase
        .from('inventario_conteos')
        .select('*, productos(descripcion), usuarios(nombres, apellidos), inventario_sesiones!inventario_conteos_id_sesion_fkey!inner(fecha_apertura, estado, id_sucursal, sucursales(nombre_comercial))')
        .eq('id_usuario', usuarioFiltroHistorial)
        .gte('created_at', desde.toISOString())
        .lte('created_at', hasta.toISOString())
        .order('created_at', { ascending: false })
        .limit(300);
      if (sucursalFiltroHistorial) query = query.eq('inventario_sesiones.id_sucursal', Number(sucursalFiltroHistorial));
      const { data, error } = await query;
      if (error) throw error;
      setHistorialPersona(data || []);
    } catch (error) {
      console.error('Error cargando historial por persona:', error);
      setHistorialPersona([]);
    } finally {
      setCargandoHistorialPersona(false);
    }
  };

  useEffect(() => {
    supabase.from('usuarios').select('id_usuario, nombres, apellidos, id_rol, activo').then(({ data }) => {
      setUsuariosLista((data || []).filter(u => esRolOperativo(u.id_rol) && (String(u.activo) === '1' || u.activo === true)));
    });
  }, []);

  useEffect(() => {
    if (vistaActual !== 'historial-persona') return;
    cargarHistorialPersona();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vistaActual, usuarioFiltroHistorial, fechaDesdeHistorial, fechaHastaHistorial, sucursalFiltroHistorial]);

  const resumenPersona = {
    total: historialPersona.length,
    conDiferencia: historialPersona.filter(c => c.diferencia !== 0).length,
    aplicados: historialPersona.filter(c => c.aprobado).length,
  };

  useEffect(() => {
    cargarDatos();

    // Realtime en sesiones → detecta apertura/cierre
    const canalSesiones = supabase
      .channel('admin-sesiones-watch')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'inventario_sesiones'
      }, () => {
        cargarDatos();
      })
      .subscribe((status) => {
        console.log('Realtime admin sesiones:', status);
      });

    // Realtime en conteos → actualiza tabla de conteos al instante
    const canalConteos = supabase
      .channel('admin-conteos-watch')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'inventario_conteos'
      }, () => {
        if (vistaDetalleRef.current) {
          cargarConteos(vistaDetalleRef.current);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(canalSesiones);
      supabase.removeChannel(canalConteos);
    };
  }, []);

  const sucursalesDisponibles = sucursales.filter(
    s => !sesionesActivas.find(sa => sa.id_sucursal === s.id_sucursal)
  );

  const abrirSesion = async () => {
    if (!sucursalSeleccionada) return mostrarAlerta('Selecciona una sucursal para continuar.', 'warning');

    setAbriendo(true);
    try {
      const { error } = await supabase.from('inventario_sesiones').insert({
        id_sucursal: Number(sucursalSeleccionada),
        id_usuario_admin: user.id_usuario,
        estado: 'ABIERTA'
      });
      if (error) throw error;
      setSucursalSeleccionada('');
      mostrarAlerta('Sesión de inventario abierta. Los vendedores ya pueden comenzar el conteo.', 'success');
    } catch (error) {
      mostrarAlerta('Error: ' + error.message, 'error');
    } finally {
      setAbriendo(false);
    }
  };

  const verDetalle = (sesion) => {
    setVistaDetalle(sesion);
    vistaDetalleRef.current = sesion;
    cargarConteos(sesion);
  };

  const cerrarDetalle = () => {
    setVistaDetalle(null);
    vistaDetalleRef.current = null;
    setConteos([]);
  };

  const cerrarSesion = (sesion) => {
    const pendientes = conteos.filter(
      c => !c.aprobado && c.diferencia !== 0 && vistaDetalle?.id_sesion === sesion.id_sesion
    );
    const mensajePendientes = pendientes.length > 0
      ? ` Hay ${pendientes.length} conteo(s) con diferencias sin aprobar.`
      : '';

    mostrarAlerta(
      `¿Cerrar la sesión de "${sesion.sucursales?.nombre_comercial}"? Los vendedores ya no podrán registrar conteos.${mensajePendientes}`,
      'warning',
      async () => {
        setCerrando(sesion.id_sesion);
        const resultado = await cerrarSesionInventario(sesion.id_sesion);
        if (resultado.ok) {
          mostrarAlerta('Sesión cerrada correctamente.', 'success');
          if (vistaDetalleRef.current?.id_sesion === sesion.id_sesion) {
            cargarConteos(vistaDetalleRef.current);
          }
        } else {
          mostrarAlerta('Error: ' + resultado.error.message, 'error');
        }
        setCerrando(null);
      },
      'Sí, cerrar sesión',
      () => {},
      'Cancelar'
    );
  };

  const aprobarAjuste = async (conteo) => {
    mostrarAlerta(
      `¿Aplicar ajuste de stock para ${conteo.productos?.descripcion}? La diferencia es ${conteo.diferencia > 0 ? '+' : ''}${conteo.diferencia} unidades.`,
      'warning',
      async () => {
        const resultado = await aplicarAjusteInventario({
          conteo,
          idSucursal: vistaDetalleRef.current?.id_sucursal,
          idUsuario: user.id_usuario,
        });
        if (resultado.ok) {
          mostrarAlerta('Ajuste aplicado al inventario y registrado en Kardex.', 'success');
        } else {
          mostrarAlerta('Error: ' + resultado.error.message, 'error');
        }
      },
      'Sí, aplicar ajuste',
      () => {},
      'Cancelar'
    );
  };

  if (cargando) return <div className="ti-loading">Cargando sesiones de inventario...</div>;

  // Sesiones / Historial por persona usan un ancho de lectura angosto (960px) a propósito
  // — son tarjetas/formularios cortos. Nota de Ingreso/Salida e Historial de Notas son
  // tablas de varias columnas (Fecha, Tipo, N°, Producto, Cantidad, Usuario, Motivo) que
  // sí necesitan el ancho completo de la pantalla para no truncar texto; en vez de
  // ensanchar .ti-container para todas las pestañas (rompiendo el diseño angosto de las
  // otras dos), se agrega esta clase condicional solo cuando corresponde.
  const esVistaAncha = ['nota-ingreso', 'nota-salida', 'historial-notas'].includes(vistaActual);

  return (
    <div className={`ti-container ${esVistaAncha ? 'ti-container-ancho' : ''}`}>

      <AlertaSistemaModal alerta={alertaSistema} onClose={() => setAlertaSistema(null)} />

      <div className="ti-vista-toggle">
        <button
          type="button"
          className={vistaActual === 'sesiones' ? 'active' : ''}
          onClick={() => setVistaActual('sesiones')}
        ><UiIcon name="ClipboardList" size={15} /> Sesiones
        </button>
        <button
          type="button"
          className={vistaActual === 'historial-persona' ? 'active' : ''}
          onClick={() => setVistaActual('historial-persona')}
        ><UiIcon name="BarChart3" size={15} /> Historial por persona
        </button>
        <button
          type="button"
          className={vistaActual === 'nota-ingreso' ? 'active' : ''}
          onClick={() => setVistaActual('nota-ingreso')}
        ><UiIcon name="Download" size={15} /> Nota de Ingreso
        </button>
        <button
          type="button"
          className={vistaActual === 'nota-salida' ? 'active' : ''}
          onClick={() => setVistaActual('nota-salida')}
        ><UiIcon name="Upload" size={15} /> Nota de Salida
        </button>
        <button
          type="button"
          className={vistaActual === 'historial-notas' ? 'active' : ''}
          onClick={() => setVistaActual('historial-notas')}
        ><UiIcon name="BarChart3" size={15} /> Historial de Notas
        </button>
      </div>

      {vistaActual === 'sesiones' && (
        <>
      {/* SESIONES ACTIVAS */}
      {sesionesActivas.length > 0 && (
        <div className="ti-sesiones-activas">
          <h3 className="ti-section-title"><span style={{ width: 10, height: 10, borderRadius: '50%', background: '#22c55e', display: 'inline-block', marginRight: 6 }} />Sesiones activas ({sesionesActivas.length})</h3>
          <div className="ti-sesiones-grid">
            {sesionesActivas.map(s => (
              <div key={s.id_sesion} className="ti-sesion-card activa">
                <div className="ti-sesion-info">
                  <span className="ti-dot dot-green"></span>
                  <div>
                    <strong>{s.sucursales?.nombre_comercial}</strong>
                    <p>Abierta: {new Date(s.fecha_apertura).toLocaleString('es-PE')}</p>
                    <p>Por: {s.usuarios ? `${s.usuarios.nombres} ${s.usuarios.apellidos}` : '---'}</p>
                  </div>
                </div>
                <div className="ti-sesion-acciones">
                  <button className="btn-ti-outline small" onClick={() => verDetalle(s)}><UiIcon name="Eye" size={15} /> Ver conteos
                  </button>
                  <button
                    className="btn-ti-cerrar small"
                    onClick={() => cerrarSesion(s)}
                    disabled={cerrando === s.id_sesion}
                  >
                    {cerrando === s.id_sesion ? 'Cerrando...' : <><UiIcon name="Lock" size={14} /> Cerrar</>}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {sesionesActivas.length === 0 && (
        <div className="ti-estado-banner inactiva">
          <div className="ti-estado-info">
            <span className="ti-dot dot-gray"></span>
            <div>
              <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><UiIcon name="Circle" size={12} /> Sin sesiones activas</strong>
              <p>No hay ninguna sesión de conteo activa en este momento.</p>
            </div>
          </div>
        </div>
      )}

      {/* ABRIR NUEVA SESIÓN */}
      {sucursalesDisponibles.length > 0 && (
        <div className="ti-abrir-card">
          <h3>Abrir nueva sesión de inventario</h3>
          <p>Solo se muestran sucursales sin sesión activa.</p>
          <div className="ti-abrir-row">
            <select value={sucursalSeleccionada} onChange={e => setSucursalSeleccionada(e.target.value)}>
              <option value="">-- Seleccionar sucursal --</option>
              {sucursalesDisponibles.map(s => (
                <option key={s.id_sucursal} value={s.id_sucursal}>{s.nombre_comercial}</option>
              ))}
            </select>
            <button className="btn-ti-abrir" onClick={abrirSesion} disabled={abriendo}>
              {abriendo ? 'Abriendo...' : <><UiIcon name="Unlock" size={15} /> Abrir Sesión</>}
            </button>
          </div>
        </div>
      )}

      {/* DETALLE DE CONTEOS */}
      {vistaDetalle && (
        <div className="ti-detalle-card">
          <div className="ti-detalle-header">
            <div>
              <h3>Conteos — {vistaDetalle.sucursales?.nombre_comercial}</h3>
              <p>{new Date(vistaDetalle.fecha_apertura).toLocaleDateString('es-PE')} · {conteos.length} productos contados</p>
            </div>
            <button className="btn-ti-outline" onClick={cerrarDetalle}><UiIcon name="X" size={15} /> Cerrar</button>
          </div>

          {conteos.length === 0 ? (
            <div className="ti-empty">Ningún vendedor ha registrado conteos aún.</div>
          ) : (
            <table className="ti-table">
              <thead>
                <tr>
                  <th>PRODUCTO</th>
                  <th className="text-center">SISTEMA</th>
                  <th className="text-center">FÍSICO</th>
                  <th className="text-center">DIFERENCIA</th>
                  <th>MENSAJE</th>
                  <th>VENDEDOR</th>
                  <th className="text-center">ACCIÓN</th>
                </tr>
              </thead>
              <tbody>
                {conteos.map(c => {
                  const infoMensaje = calcularMensajeConteo(c.diferencia, c.id_producto, kardexRecienteMap);
                  return (
                  <tr key={c.id_conteo}>
                    <td>
                      <strong>{c.productos?.descripcion || '---'}</strong>
                      <br /><small className="text-muted-ti">Cód: {c.productos?.codigo_barras || '---'}</small>
                    </td>
                    <td className="text-center">{c.cantidad_sistema}</td>
                    <td className="text-center">{c.cantidad_fisica}</td>
                    <td className="text-center">
                      <span className={`dif-badge ${c.diferencia > 0 ? 'dif-pos' : c.diferencia < 0 ? 'dif-neg' : 'dif-ok'}`}>
                        {c.diferencia > 0 ? '+' : ''}{c.diferencia}
                      </span>
                    </td>
                    <td>
                      <span className={`msj-conteo ${infoMensaje.alerta ? 'alerta' : ''}`}>
                        {infoMensaje.alerta ? '' : ''}{infoMensaje.texto}
                      </span>
                    </td>
                    <td>
                      <small>{c.usuarios ? `${c.usuarios.nombres} ${c.usuarios.apellidos}` : '---'}</small>
                      {c.enviado_revision && <><br /><span className="badge-enviado"><UiIcon name="Upload" size={15} /> Enviado</span></>}
                    </td>
                    <td className="text-center">
                      {c.aprobado ? (
                        <span className="badge-aprobado"><UiIcon name="Check" size={15} /> Aplicado</span>
                      ) : c.diferencia !== 0 ? (
                        <button className="btn-aprobar" onClick={() => aprobarAjuste(c)}>Aplicar ajuste</button>
                      ) : (
                        <span className="badge-ok">Sin diferencia</span>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* HISTORIAL DE SESIONES */}
      <div className="ti-historial">
        <h3>Historial de sesiones</h3>
        {sesiones.filter(s => s.estado === 'CERRADA').length === 0 ? (
          <div className="ti-empty">No hay sesiones cerradas aún.</div>
        ) : (
          <table className="ti-table">
            <thead>
              <tr>
                <th>FECHA APERTURA</th>
                <th>SUCURSAL</th>
                <th>ABIERTA POR</th>
                <th className="text-center">ESTADO</th>
                <th>FECHA CIERRE</th>
                <th className="text-center">ACCIONES</th>
              </tr>
            </thead>
            <tbody>
              {sesiones.filter(s => s.estado === 'CERRADA').map(s => (
                <tr key={s.id_sesion}>
                  <td>{new Date(s.fecha_apertura).toLocaleString('es-PE')}</td>
                  <td>{s.sucursales?.nombre_comercial || '---'}</td>
                  <td><small>{s.usuarios ? `${s.usuarios.nombres} ${s.usuarios.apellidos}` : '---'}</small></td>
                  <td className="text-center">
                    <span className="estado-badge estado-cerrada">CERRADA</span>
                  </td>
                  <td><small>{s.fecha_cierre ? new Date(s.fecha_cierre).toLocaleString('es-PE') : '---'}</small></td>
                  <td className="text-center">
                    <button className="btn-ti-outline small" onClick={() => verDetalle(s)}>Ver conteos</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
        </>
      )}

      {vistaActual === 'historial-persona' && (
        <div className="ti-historial-persona">
          <div className="ti-filtros-historial">
            <div className="ti-filtro-campo">
              <label>Usuario</label>
              <select value={usuarioFiltroHistorial} onChange={e => setUsuarioFiltroHistorial(e.target.value)}>
                <option value="">-- Seleccionar usuario --</option>
                {usuariosLista.map(u => (
                  <option key={u.id_usuario} value={u.id_usuario}>{u.nombres} {u.apellidos}</option>
                ))}
              </select>
            </div>
            <div className="ti-filtro-campo">
              <label>Desde</label>
              <SmartDateInput value={fechaDesdeHistorial} onChange={setFechaDesdeHistorial} />
            </div>
            <div className="ti-filtro-campo">
              <label>Hasta</label>
              <SmartDateInput
                value={fechaHastaHistorial}
                onChange={setFechaHastaHistorial}
                onEnterAnio={() => btnAplicarBusquedaRef.current?.focus()}
              />
            </div>
            <div className="ti-filtro-campo">
              <label>Sucursal (opcional)</label>
              <select value={sucursalFiltroHistorial} onChange={e => setSucursalFiltroHistorial(e.target.value)}>
                <option value="">-- Todas --</option>
                {sucursales.map(s => (
                  <option key={s.id_sucursal} value={s.id_sucursal}>{s.nombre_comercial}</option>
                ))}
              </select>
            </div>
            <div className="ti-filtro-campo ti-filtro-campo-boton">
              <label>&nbsp;</label>
              <button ref={btnAplicarBusquedaRef} type="button" className="btn-ti-abrir" onClick={cargarHistorialPersona}><UiIcon name="Search" size={15} /> Aplicar búsqueda
              </button>
            </div>
          </div>

          {!usuarioFiltroHistorial && (
            <div className="ti-empty">Selecciona un usuario para ver su historial de conteos.</div>
          )}

          {usuarioFiltroHistorial && (
            <>
              <div className="ti-resumen-persona">
                <div className="ti-resumen-persona-item">
                  <span className="ti-resumen-persona-label">Total conteos</span>
                  <span className="ti-resumen-persona-num">{resumenPersona.total}</span>
                </div>
                <div className="ti-resumen-persona-item">
                  <span className="ti-resumen-persona-label">Con diferencia</span>
                  <span className="ti-resumen-persona-num">{resumenPersona.conDiferencia}</span>
                </div>
                <div className="ti-resumen-persona-item">
                  <span className="ti-resumen-persona-label">Ya aplicados</span>
                  <span className="ti-resumen-persona-num">{resumenPersona.aplicados}</span>
                </div>
              </div>

              {cargandoHistorialPersona ? (
                <div className="ti-empty">Cargando...</div>
              ) : historialPersona.length === 0 ? (
                <div className="ti-empty">No se encontraron conteos en ese rango.</div>
              ) : (
                <table className="ti-table">
                  <thead>
                    <tr>
                      <th>PRODUCTO</th>
                      <th>FECHA/HORA</th>
                      <th>SUCURSAL</th>
                      <th className="text-center">SISTEMA</th>
                      <th className="text-center">FÍSICO</th>
                      <th className="text-center">DIFERENCIA</th>
                      <th className="text-center">APROBADO</th>
                      <th className="text-center">ENVIADO A ADMIN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historialPersona.map(c => (
                      <tr key={c.id_conteo}>
                        <td><strong>{c.productos?.descripcion || '---'}</strong></td>
                        <td><small>{new Date(c.created_at).toLocaleString('es-PE')}</small></td>
                        <td><small>{c.inventario_sesiones?.sucursales?.nombre_comercial || '---'}</small></td>
                        <td className="text-center">{c.cantidad_sistema}</td>
                        <td className="text-center">{c.cantidad_fisica}</td>
                        <td className="text-center">
                          <span className={`dif-badge ${c.diferencia > 0 ? 'dif-pos' : c.diferencia < 0 ? 'dif-neg' : 'dif-ok'}`}>
                            {c.diferencia > 0 ? '+' : ''}{c.diferencia}
                          </span>
                        </td>
                        <td className="text-center">
                          {c.aprobado ? <span className="badge-aprobado"><UiIcon name="Check" size={15} /> Aplicado</span> : <span className="badge-ok">Pendiente</span>}
                        </td>
                        <td className="text-center">
                          {c.enviado_revision ? <span className="badge-enviado"><UiIcon name="Upload" size={15} /> Enviado</span> : <span className="badge-ok">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      )}

      {vistaActual === 'nota-ingreso' && (
        <NotaInventarioForm tipo="INGRESO" />
      )}

      {vistaActual === 'nota-salida' && (
        <NotaInventarioForm
          key={retiroVencido?.id_lote ? `retiro-${retiroVencido.id_lote}` : 'salida-normal'}
          tipo="SALIDA"
          retiroVencido={retiroVencido}
          onRetiroConsumido={() => setRetiroVencido(null)}
        />
      )}

      {vistaActual === 'historial-notas' && (
        <HistorialNotas />
      )}
    </div>
  );
}