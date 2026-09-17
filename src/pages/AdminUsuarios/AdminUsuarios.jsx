import { useState, useEffect, useMemo, useRef } from 'react';
import AlertaSistemaModal from '../../components/AlertaSistemaModal';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../context/AuthContext';
import { hashPassword } from '../../utils/passwordHash';
import './AdminUsuarios.css';
import UiIcon from '../../components/UiIcon';
import PasswordField from '../../components/PasswordField';

function normalizarTextoPersona(valor) {
  return String(valor || '').trim().replace(/\s+/g, ' ');
}

export default function AdminUsuarios() {
  const { user } = useAuth();

  const [rawUsuarios, setRawUsuarios] = useState([]);
  const [sucursales, setSucursales] = useState([]);
  const [roles, setRoles] = useState([]);
  const [cargando, setCargando] = useState(true);

  const [tabActiva, setTabActiva] = useState('usuarios');
  const [busqueda, setBusqueda] = useState('');
  const [sucursalFiltro, setSucursalFiltro] = useState('TODAS');
  const [rolFiltro, setRolFiltro] = useState('TODOS');
  const [estadoFiltro, setEstadoFiltro] = useState('ACTIVOS');

  const [showModalSede, setShowModalSede] = useState(false);
  const [modoEdicionSede, setModoEdicionSede] = useState(false);
  const [guardandoSede, setGuardandoSede] = useState(false);
  const [formSede, setFormSede] = useState({ id_sucursal: null, nombre_comercial: '', direccion: '', telefono: '', activo: true });

  const [showModal, setShowModal] = useState(false);
  const [modoEdicion, setModoEdicion] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const [formUsuario, setFormUsuario] = useState({
    id_usuario: null, nombres: '', apellidos: '', dni: '',
    telefono: '', email: '', clave: '',
    id_rol: '', id_sucursal: '', activo: 1,
  });

  const [alertaSistema, setAlertaSistema] = useState(null);
  const alertOkBtnRef = useRef(null);
  useEffect(() => {
    if (alertaSistema && alertOkBtnRef.current) alertOkBtnRef.current.focus();
  }, [alertaSistema]);
  const mostrarAlerta = (mensaje, tipo = 'info', accionConfirmar = null, textoConfirmar = 'Aceptar', accionCancelar = null, textoCancelar = null) => {
    setAlertaSistema({ mensaje, tipo, accionConfirmar, textoConfirmar, accionCancelar, textoCancelar });
  };

  const cargarDatos = async () => {
    setCargando(true);
    try {
      const [resUsu, resSuc, resRol] = await Promise.all([
        supabase.from('usuarios').select('*').order('nombres', { ascending: true }),
        supabase.from('sucursales').select('*').order('id_sucursal', { ascending: true }),
        supabase.from('roles').select('*'),
      ]);
      if (resUsu.error) throw resUsu.error;
      setRawUsuarios(resUsu.data || []);
      setSucursales(resSuc.data || []);
      setRoles(resRol.data || []);
    } catch (error) {
      mostrarAlerta('Error al cargar usuarios: ' + error.message, 'error');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => { cargarDatos(); }, []);

  const abrirModalNuevaSede = () => {
    setModoEdicionSede(false);
    setFormSede({ id_sucursal: null, nombre_comercial: '', direccion: '', telefono: '', activo: true });
    setShowModalSede(true);
  };

  const abrirModalEditarSede = (s) => {
    setModoEdicionSede(true);
    setFormSede({ id_sucursal: s.id_sucursal, nombre_comercial: s.nombre_comercial || '', direccion: s.direccion || '', telefono: s.telefono || '', activo: s.activo !== false });
    setShowModalSede(true);
  };

  const handleGuardarSede = async (e) => {
    e.preventDefault();
    if (!formSede.nombre_comercial.trim()) return mostrarAlerta('El nombre de la sede es obligatorio.', 'warning');
    setGuardandoSede(true);
    try {
      const payload = {
        nombre_comercial: formSede.nombre_comercial.trim().toUpperCase(),
        direccion: formSede.direccion.trim() || null,
        telefono: formSede.telefono.trim() || null,
        activo: formSede.activo,
      };
      if (modoEdicionSede) {
        const { error } = await supabase.from('sucursales').update(payload).eq('id_sucursal', formSede.id_sucursal);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('sucursales').insert(payload);
        if (error) throw error;
      }
      mostrarAlerta(`Sede ${modoEdicionSede ? 'actualizada' : 'creada'} exitosamente.`, 'success');
      setShowModalSede(false);
      await cargarDatos();
    } catch (error) {
      mostrarAlerta('Error: ' + error.message, 'error');
    } finally { setGuardandoSede(false); }
  };

  const handleToggleSede = (s) => {
    const estadoNuevo = !s.activo;
    mostrarAlerta(
      `¿Seguro que deseas ${estadoNuevo ? 'activar' : 'desactivar'} la sede "${s.nombre_comercial}"?`,
      'warning',
      async () => {
        const { data, error } = await supabase
          .from('sucursales')
          .update({ activo: estadoNuevo })
          .eq('id_sucursal', s.id_sucursal)
          .select('id_sucursal');
        if (error) return mostrarAlerta('Error: ' + error.message, 'error');
        if (!data || data.length === 0) {
          return mostrarAlerta('No se pudo actualizar la sede (0 filas afectadas).', 'error');
        }
        mostrarAlerta(`Sede ${estadoNuevo ? 'activada' : 'desactivada'}.`, 'success');
        await cargarDatos();
      }, `Sí, ${estadoNuevo ? 'activar' : 'desactivar'}`, () => {}, 'Cancelar'
    );
  };

  const usuariosProcesados = useMemo(() => {
    return rawUsuarios.map(usu => {
      const sucObj = sucursales.find(s => Number(s.id_sucursal) === Number(usu.id_sucursal));
      const rolObj = roles.find(r => Number(r.id_rol) === Number(usu.id_rol));
      const nombreDelRol = rolObj ? (rolObj.nombre || rolObj.nombre_rol || rolObj.rol || `Rol ${rolObj.id_rol}`) : 'Sin Rol';

      return {
        ...usu,
        nombreSucursal: sucObj ? sucObj.nombre_comercial : 'Sin Sucursal',
        nombreRol: nombreDelRol,
        estadoTexto: (String(usu.activo) === '1' || usu.activo === true) ? 'ACTIVO' : 'INACTIVO',
      };
    });
  }, [rawUsuarios, sucursales, roles]);

  const usuariosFiltrados = useMemo(() => {
    return usuariosProcesados.filter(u => {
      const busqLimpia = busqueda.toLowerCase().trim();
      const nombreCompleto = `${u.nombres || ''} ${u.apellidos || ''}`.toLowerCase();
      const dniUser = (u.dni || '');

      const matchBusqueda = busqLimpia === '' ||
        nombreCompleto.includes(busqLimpia) ||
        dniUser.includes(busqLimpia);

      let matchSucursal = true;
      if (sucursalFiltro !== 'TODAS') matchSucursal = Number(u.id_sucursal) === Number(sucursalFiltro);

      let matchRol = true;
      if (rolFiltro !== 'TODOS') matchRol = Number(u.id_rol) === Number(rolFiltro);

      let matchEstado = true;
      if (estadoFiltro === 'ACTIVOS') matchEstado = u.estadoTexto === 'ACTIVO';
      if (estadoFiltro === 'INACTIVOS') matchEstado = u.estadoTexto === 'INACTIVO';

      return matchBusqueda && matchSucursal && matchRol && matchEstado;
    });
  }, [usuariosProcesados, busqueda, sucursalFiltro, rolFiltro, estadoFiltro]);

  const kpiTotal = usuariosProcesados.length;
  const kpiActivos = usuariosProcesados.filter(u => u.estadoTexto === 'ACTIVO').length;
  const kpiAdmins = usuariosProcesados.filter(u => (u.nombreRol || '').toUpperCase().includes('ADMIN')).length;

  const abrirModalNuevo = () => {
    setModoEdicion(false);
    setFormUsuario({
      id_usuario: null, nombres: '', apellidos: '', dni: '',
      telefono: '', email: '', clave: '',
      id_rol: '', id_sucursal: '', activo: 1,
    });
    setShowModal(true);
  };

  const abrirModalEditar = (usu) => {
    setModoEdicion(true);
    setFormUsuario({
      id_usuario: usu.id_usuario,
      nombres: usu.nombres || '', apellidos: usu.apellidos || '',
      dni: usu.dni || '', telefono: usu.telefono || '',
      email: usu.email || '',
      clave: '',
      id_rol: usu.id_rol || '', id_sucursal: usu.id_sucursal || '',
      activo: (String(usu.activo) === '1' || usu.activo === true) ? 1 : 0,
    });
    setShowModal(true);
  };

  const handleCambiarEstado = (usu) => {
    const esActivo = (String(usu.activo) === '1' || usu.activo === true);
    const accionTexto = esActivo ? 'desactivar' : 'activar';
    const nuevoEstado = esActivo ? 0 : 1;

    if (usu.id_usuario === user.id_usuario) {
      return mostrarAlerta('Por seguridad, no puedes desactivar tu propia cuenta mientras estás en sesión.', 'warning');
    }

    mostrarAlerta(`¿Estás seguro de ${accionTexto} el acceso al usuario ${usu.nombres || 'seleccionado'}?`, 'warning', async () => {
      try {
        const { data, error } = await supabase
          .from('usuarios')
          .update({ activo: nuevoEstado })
          .eq('id_usuario', usu.id_usuario)
          .select('id_usuario');
        if (error) throw error;
        if (!data || data.length === 0) {
          throw new Error('No se pudo actualizar el usuario (0 filas afectadas).');
        }
        mostrarAlerta(`Usuario ${esActivo ? 'desactivado' : 'activado'} correctamente.`, 'success');
        cargarDatos();
      } catch (error) { mostrarAlerta('Error: ' + error.message, 'error'); }
    }, `Sí, ${accionTexto}`, () => {}, 'Cancelar');
  };

  const handleGuardarUsuario = async (e) => {
    e.preventDefault();

    const nombres = normalizarTextoPersona(formUsuario.nombres).toUpperCase();
    const apellidos = normalizarTextoPersona(formUsuario.apellidos).toUpperCase();

    // Validaciones — ahora DNI es obligatorio (es el login)
    if (!nombres || !formUsuario.dni || !formUsuario.id_rol || !formUsuario.id_sucursal) {
      return mostrarAlerta('Nombres, DNI, Rol y Sucursal son obligatorios.', 'warning');
    }

    if (formUsuario.dni.length !== 8) {
      return mostrarAlerta('El DNI debe tener 8 dígitos.', 'warning');
    }

    if (!modoEdicion && !formUsuario.clave) {
      return mostrarAlerta('Debes asignarle una contraseña inicial al nuevo usuario.', 'warning');
    }

    setGuardando(true);
    try {
      // Pre-check amigable (la BD ya tiene UNIQUE en dni) — mismo patrón que laboratorios.
      let qDup = supabase.from('usuarios').select('id_usuario, nombres, apellidos, dni').eq('dni', formUsuario.dni);
      if (modoEdicion && formUsuario.id_usuario) {
        qDup = qDup.neq('id_usuario', formUsuario.id_usuario);
      }
      const { data: dupDni, error: errDup } = await qDup.limit(1).maybeSingle();
      if (errDup) throw errDup;
      if (dupDni) {
        const nombreDup = `${dupDni.nombres || ''} ${dupDni.apellidos || ''}`.trim() || `Usuario #${dupDni.id_usuario}`;
        return mostrarAlerta(`Ya existe un usuario con el DNI ${formUsuario.dni} (${nombreDup}). No se puede duplicar.`, 'warning');
      }

      const rolId = formUsuario.id_rol ? Number(formUsuario.id_rol) : null;
      const sucId = formUsuario.id_sucursal ? Number(formUsuario.id_sucursal) : null;

      // Payload — sin campo "usuario" porque no existe en la tabla
      const payload = {
        nombres,
        apellidos,
        dni: formUsuario.dni || null,
        telefono: formUsuario.telefono || null,
        email: formUsuario.email || null,
        id_rol: rolId,
        id_sucursal: sucId,
        activo: Number(formUsuario.activo),
      };

      if (formUsuario.clave && formUsuario.clave.trim() !== '') {
        payload.password_hash = await hashPassword(formUsuario.clave.trim());
      }

      if (!modoEdicion) {
        const { data, error } = await supabase.from('usuarios').insert(payload).select('id_usuario');
        if (error) throw error;
        if (!data || data.length === 0) throw new Error('No se creó el usuario (0 filas).');
      } else {
        const { data, error } = await supabase.from('usuarios').update(payload).eq('id_usuario', formUsuario.id_usuario).select('id_usuario');
        if (error) throw error;
        if (!data || data.length === 0) throw new Error('No se actualizó el usuario (0 filas).');
      }

      mostrarAlerta(`Usuario ${modoEdicion ? 'actualizado' : 'creado'} con éxito.`, 'success');
      setShowModal(false);
      await cargarDatos();
    } catch (error) {
      const msg = String(error.message || '');
      if (/usuarios_dni_key|duplicate key|unique/i.test(msg)) {
        mostrarAlerta(`Ya existe un usuario con el DNI ${formUsuario.dni}. No se puede duplicar.`, 'warning');
      } else {
        mostrarAlerta('Error en BD: ' + error.message, 'error');
      }
    } finally {
      setGuardando(false);
    }
  };

  const getIniciales = (nombres, apellidos) => {
    const n = nombres ? nombres.charAt(0) : '';
    const a = apellidos ? apellidos.charAt(0) : '';
    return (n + a).toUpperCase() || 'U';
  };

  if (cargando) return <div className="admin-loading">Cargando base de datos de personal...</div>;

  return (
    <div className="admin-usu-container">

      <AlertaSistemaModal alerta={alertaSistema} onClose={() => setAlertaSistema(null)} />

      {showModal && (
        <div className="modal-overlay-strict" role="dialog" aria-modal="true" data-keyboard-trap>
          <div className="usu-modal-card">
            <div className="usu-modal-header">
              <h3>{modoEdicion ? <><UiIcon name="Pencil" size={15} /> Editar Usuario</> : <><UiIcon name="User" size={15} /> Nuevo Usuario</>}</h3>
              <button type="button" data-enter-skip="true" tabIndex={-1} onClick={() => setShowModal(false)}><UiIcon name="X" size={16} /></button>
            </div>
            <form className="usu-modal-body" onSubmit={handleGuardarUsuario}>

              <div className="usu-divider col-span-2">Datos Personales</div>

              <div className="usu-input-group">
                <label>Nombres *</label>
                <input type="text" required value={formUsuario.nombres} onChange={e => setFormUsuario({...formUsuario, nombres: e.target.value})} placeholder="Ej: Juan Carlos" />
              </div>
              <div className="usu-input-group">
                <label>Apellidos</label>
                <input type="text" value={formUsuario.apellidos} onChange={e => setFormUsuario({...formUsuario, apellidos: e.target.value})} placeholder="Ej: Pérez Gómez" />
              </div>
              <div className="usu-input-group">
                <label>DNI * <small style={{color:'var(--lf-text-muted)', fontWeight:400}}>(usado como usuario para login)</small></label>
                <input type="text" required maxLength="8" value={formUsuario.dni} onChange={e => setFormUsuario({...formUsuario, dni: e.target.value.replace(/\D/g,'')})} placeholder="8 dígitos" style={{backgroundColor: 'var(--lf-bg)', fontWeight: 'bold'}} />
              </div>
              <div className="usu-input-group">
                <label>Teléfono</label>
                <input type="text" value={formUsuario.telefono} onChange={e => setFormUsuario({...formUsuario, telefono: e.target.value})} placeholder="Ej: 999 999 999" />
              </div>
              <div className="usu-input-group col-span-2">
                <label>Email</label>
                <input type="email" value={formUsuario.email} onChange={e => setFormUsuario({...formUsuario, email: e.target.value})} placeholder="usuario@correo.com" />
              </div>

              <div className="usu-divider col-span-2">Accesos al Sistema</div>

              <div className="usu-input-group">
                <label>{modoEdicion ? 'Nueva Contraseña (Opcional)' : 'Contraseña Inicial *'}</label>
                <PasswordField
                  value={formUsuario.clave}
                  onChange={e => setFormUsuario({ ...formUsuario, clave: e.target.value })}
                  placeholder="••••••••"
                  required={!modoEdicion}
                  autoComplete="new-password"
                />
              </div>
              <div className="usu-input-group">
                <label>Rol del Sistema *</label>
                <select required value={formUsuario.id_rol} onChange={e => setFormUsuario({...formUsuario, id_rol: e.target.value})}>
                  <option value="">-- Seleccionar Rol --</option>
                  {roles.map(r => <option key={r.id_rol} value={r.id_rol}>{r.nombre || r.nombre_rol || r.rol || `Rol ${r.id_rol}`}</option>)}
                </select>
              </div>
              <div className="usu-input-group col-span-2">
                <label>Sede Asignada *</label>
                <select required value={formUsuario.id_sucursal} onChange={e => setFormUsuario({...formUsuario, id_sucursal: e.target.value})}>
                  <option value="">-- Asignar Sede --</option>
                  {sucursales.map(s => <option key={s.id_sucursal} value={s.id_sucursal}>{s.nombre_comercial}</option>)}
                </select>
              </div>

              {modoEdicion && (
                <div className="usu-input-group col-span-2">
                  <label>Estado de la cuenta</label>
                  <select value={formUsuario.activo} onChange={e => setFormUsuario({...formUsuario, activo: e.target.value})}>
                    <option value={1}>ACTIVO (Puede acceder)</option>
                    <option value={0}>INACTIVO (Acceso bloqueado)</option>
                  </select>
                </div>
              )}

              <div className="usu-modal-footer col-span-2">
                <button type="button" className="btn-usu-cancel" data-enter-skip="true" tabIndex={-1} onClick={() => setShowModal(false)}>Cancelar</button>
                <button type="submit" className="btn-usu-primary" disabled={guardando}>{guardando ? 'Guardando...' : 'Guardar Usuario'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showModalSede && (
        <div className="modal-overlay-strict" role="dialog" aria-modal="true" data-keyboard-trap>
          <div className="usu-modal-card" style={{maxWidth:'480px'}}>
            <div className="usu-modal-header">
              <h3>{modoEdicionSede ? <><UiIcon name="Pencil" size={15} /> Editar Sede</> : <><UiIcon name="Building2" size={15} /> Nueva Sede</>}</h3>
              <button type="button" data-enter-skip="true" tabIndex={-1} onClick={() => setShowModalSede(false)}><UiIcon name="X" size={16} /></button>
            </div>
            <form className="usu-modal-body" onSubmit={handleGuardarSede} style={{gridTemplateColumns:'1fr'}}>
              <div className="usu-input-group">
                <label>Nombre Comercial *</label>
                <input type="text" required value={formSede.nombre_comercial} onChange={e => setFormSede({...formSede, nombre_comercial: e.target.value})} placeholder="Ej: LuxFarma - SEDE NORTE" />
              </div>
              <div className="usu-input-group">
                <label>Dirección</label>
                <input type="text" value={formSede.direccion} onChange={e => setFormSede({...formSede, direccion: e.target.value})} placeholder="Ej: Av. Los Olivos 123, San Martín de Porres" />
              </div>
              <div className="usu-input-group">
                <label>Teléfono</label>
                <input type="text" value={formSede.telefono} onChange={e => setFormSede({...formSede, telefono: e.target.value})} placeholder="Ej: 01-234-5678" />
              </div>
              {modoEdicionSede && (
                <div className="usu-input-group">
                  <label>Estado</label>
                  <select value={formSede.activo} onChange={e => setFormSede({...formSede, activo: e.target.value === 'true'})}>
                    <option value="true">ACTIVA</option>
                    <option value="false">INACTIVA</option>
                  </select>
                </div>
              )}
              <div className="usu-modal-footer col-span-2">
                <button type="button" className="btn-usu-cancel" data-enter-skip="true" tabIndex={-1} onClick={() => setShowModalSede(false)}>Cancelar</button>
                <button type="submit" className="btn-usu-primary" disabled={guardandoSede}>{guardandoSede ? 'Guardando...' : 'Guardar Sede'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="usu-top-actions">
        <div className="usu-title-area">
          <h2>Gestión de Personal y Sedes</h2>
          <p>Controla los accesos, roles y sedes de tu equipo de trabajo.</p>
        </div>
        <div style={{display:'flex', gap:'0.75rem'}}>
          {tabActiva === 'usuarios'
            ? <button className="btn-usu-add" onClick={abrirModalNuevo}>+ Registrar Usuario</button>
            : <button className="btn-usu-add" onClick={abrirModalNuevaSede}>+ Nueva Sede</button>
          }
        </div>
      </div>

      <div style={{display:'flex', gap:'0', background:'#f4f6f9', borderRadius:'10px', padding:'4px', width:'fit-content', marginBottom:'1rem', border:'1px solid var(--lf-border)'}}>
        <button
          onClick={() => setTabActiva('usuarios')}
          style={{padding:'0.5rem 1.5rem', borderRadius:'8px', border:'none', fontWeight:600, fontSize:'0.85rem', cursor:'pointer',
            background: tabActiva === 'usuarios' ? 'var(--lf-primary-dark)' : 'transparent',
            color: tabActiva === 'usuarios' ? 'white' : 'var(--lf-text-muted)', transition:'all 0.2s'}}
        ><UiIcon name="Users" size={15} /> Personal ({rawUsuarios.length})</button>
        <button
          onClick={() => setTabActiva('sedes')}
          style={{padding:'0.5rem 1.5rem', borderRadius:'8px', border:'none', fontWeight:600, fontSize:'0.85rem', cursor:'pointer',
            background: tabActiva === 'sedes' ? 'var(--lf-primary-dark)' : 'transparent',
            color: tabActiva === 'sedes' ? 'white' : 'var(--lf-text-muted)', transition:'all 0.2s'}}
        ><UiIcon name="Building2" size={15} /> Sedes ({sucursales.length})</button>
      </div>

      {tabActiva === 'usuarios' && (<>

      <div className="usu-kpis-grid">
        <div className="usu-kpi-card">
          <div className="kpi-info"><p>PERSONAL REGISTRADO</p><h2>{kpiTotal}</h2></div>
          <div className="kpi-icon-usu bg-brand-soft"><UiIcon name="Users" size={16} /></div>
        </div>
        <div className="usu-kpi-card">
          <div className="kpi-info"><p>CUENTAS ACTIVAS</p><h2 className="text-green">{kpiActivos}</h2></div>
          <div className="kpi-icon-usu bg-green-soft"><UiIcon name="CheckCircle2" size={16} /></div>
        </div>
        <div className="usu-kpi-card">
          <div className="kpi-info"><p>ADMINISTRADORES</p><h2>{kpiAdmins}</h2></div>
          <div className="kpi-icon-usu bg-orange-soft"><UiIcon name="Crown" size={18} /></div>
        </div>
      </div>

      <div className="usu-filters-bar">
        <div className="search-box-usu">
          <span><UiIcon name="Search" size={16} /></span><input type="text" placeholder="Buscar por nombre o DNI..." value={busqueda} onChange={e => setBusqueda(e.target.value)} />
        </div>
        <select className="select-usu" value={sucursalFiltro} onChange={e => setSucursalFiltro(e.target.value)}>
          <option value="TODAS">Todas las Sedes</option>
          {sucursales.map(s => <option key={s.id_sucursal} value={s.id_sucursal}>{s.nombre_comercial}</option>)}
        </select>
        <select className="select-usu" value={rolFiltro} onChange={e => setRolFiltro(e.target.value)}>
          <option value="TODOS">Todos los Roles</option>
          {roles.map(r => <option key={r.id_rol} value={r.id_rol}>{r.nombre || r.nombre_rol || r.rol || `Rol ${r.id_rol}`}</option>)}
        </select>
        <div className="usu-pills-group">
          <button className={`pill-btn-usu ${estadoFiltro === 'TODOS' ? 'active-dark' : ''}`} onClick={() => setEstadoFiltro('TODOS')}>Todos</button>
          <button className={`pill-btn-usu ${estadoFiltro === 'ACTIVOS' ? 'active-green' : ''}`} onClick={() => setEstadoFiltro('ACTIVOS')}>Activos</button>
          <button className={`pill-btn-usu ${estadoFiltro === 'INACTIVOS' ? 'active-red' : ''}`} onClick={() => setEstadoFiltro('INACTIVOS')}>Inactivos</button>
        </div>
      </div>

      <div className="usu-table-container">
        <table className="usu-table">
          <thead><tr>
            <th>PERSONAL</th><th>DNI / LOGIN</th><th>ROL EN SISTEMA</th><th>SEDE ASIGNADA</th><th>ESTADO</th><th className="text-center">ACCIONES</th>
          </tr></thead>
          <tbody>
            {usuariosFiltrados.length === 0 ? (
              <tr><td colSpan="6" className="empty-usu">No se encontró personal con estos filtros.</td></tr>
            ) : (
              usuariosFiltrados.map(u => (
                <tr key={u.id_usuario} className={u.estadoTexto === 'INACTIVO' ? 'row-inactivo' : ''}>
                  <td>
                    <div className="usu-perfil-cell">
                      <div className="usu-avatar">{getIniciales(u.nombres, u.apellidos)}</div>
                      <div>
                        <strong className="text-dark">{u.nombres || '---'} {u.apellidos || ''}</strong><br/>
                        <small className="text-muted">Tel: {u.telefono || '---'}</small>
                      </div>
                    </div>
                  </td>
                  <td><span className="usu-login-badge">{u.dni || '---'}</span></td>
                  <td><span className={`usu-rol-pill ${(u.nombreRol||'').toUpperCase().includes('ADMIN') ? 'rol-admin' : 'rol-cajero'}`}>{u.nombreRol}</span></td>
                  <td><span className="text-muted font-bold">{u.nombreSucursal}</span></td>
                  <td>
                    <span className={`usu-status-dot ${u.estadoTexto === 'ACTIVO' ? 'bg-green' : 'bg-red'}`}></span>
                    <span className={`font-bold ${u.estadoTexto === 'ACTIVO' ? 'text-green' : 'text-red'}`}>{u.estadoTexto}</span>
                  </td>
                  <td className="text-center usu-actions">
                    <button type="button" className="btn-icon" onClick={() => abrirModalEditar(u)} title="Editar"><UiIcon name="Pencil" size={16} /></button>
                    <button type="button" className="btn-icon" onClick={() => handleCambiarEstado(u)} title={u.estadoTexto === 'ACTIVO' ? 'Bloquear' : 'Activar'}>
                      {u.estadoTexto === 'ACTIVO' ? '' : ''}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      </>)}

      {tabActiva === 'sedes' && (
        <div className="usu-table-container">
          <table className="usu-table">
            <thead><tr>
              <th>#</th><th>NOMBRE DE LA SEDE</th><th>DIRECCIÓN</th><th>TELÉFONO</th>
              <th>USUARIOS</th><th>ESTADO</th><th className="text-center">ACCIONES</th>
            </tr></thead>
            <tbody>
              {sucursales.length === 0 ? (
                <tr><td colSpan="7" className="empty-usu">No hay sedes registradas.</td></tr>
              ) : (
                sucursales.map(s => {
                  const usuariosDeSede = rawUsuarios.filter(u => Number(u.id_sucursal) === Number(s.id_sucursal)).length;
                  return (
                    <tr key={s.id_sucursal}>
                      <td><span className="usu-login-badge">#{String(s.id_sucursal).padStart(2,'0')}</span></td>
                      <td><strong className="text-dark" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><UiIcon name="Building2" size={14} /> {s.nombre_comercial}</strong></td>
                      <td><span className="text-muted">{s.direccion || '—'}</span></td>
                      <td><span className="text-muted">{s.telefono || '—'}</span></td>
                      <td>
                        <span style={{background:'var(--lf-primary-light)',color:'var(--lf-primary)',padding:'2px 10px',borderRadius:'20px',fontWeight:700,fontSize:'0.78rem'}}>
                          {usuariosDeSede} usuario{usuariosDeSede !== 1 ? 's' : ''}
                        </span>
                      </td>
                      <td>
                        <span className={`usu-status-dot ${s.activo !== false ? 'bg-green' : 'bg-red'}`}></span>
                        <span className={`font-bold ${s.activo !== false ? 'text-green' : 'text-red'}`}>
                          {s.activo !== false ? 'ACTIVA' : 'INACTIVA'}
                        </span>
                      </td>
                      <td className="text-center usu-actions">
                        <button type="button" className="btn-icon" onClick={() => abrirModalEditarSede(s)} title="Editar sede"><UiIcon name="Pencil" size={16} /></button>
                        <button type="button" className="btn-icon" onClick={() => handleToggleSede(s)} title={s.activo !== false ? 'Desactivar' : 'Activar'}>
                          {s.activo !== false ? <UiIcon name="Ban" size={16} /> : ''}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

    </div>
  );
}