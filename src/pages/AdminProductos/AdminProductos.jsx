import { useState, useEffect, useCallback, useRef } from 'react';
import AlertaSistemaModal from '../../components/AlertaSistemaModal';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import './AdminProductos.css';
import ProductoFormModal from '../../components/ProductoFormModal';
import SearchableSelect from '../../components/SearchableSelect';
import SmartDateInput from '../../components/SmartDateInput';
import UiIcon from '../../components/UiIcon';
import LogoLuxFarma from '../../components/LogoLuxFarma';
import { filaProductoPrecios } from '../../utils/productoPrecios';
import { resumirStockLotes } from '../../utils/stockLotes';
import { formatSolesUnitario } from '../../utils/precioExacto';
import { formatearPorcentajeGanancia } from '../../utils/porcentajeGanancia';
import {
  fetchLaboratorios,
  normalizarNombreLab,
  notificarLaboratoriosChanged,
  suscribirLaboratoriosChanged,
} from '../../utils/laboratoriosCatalogo';
import { marcarCatalogoOfflineStale } from '../../utils/catalogoCache';
import { fetchAllRows } from '../../utils/supabasePage';

// Pantalla "Productos" — replica de la grilla de gestión de productos del sistema de
// referencia (FxFarma): filtros + tabla + toolbar de acciones sobre una fila
// seleccionada, en vez de íconos por fila como AdminInventario.jsx. Fase 1+2+A+B
// aplicadas (filtros/columnas base, Ubicación/Inafecto/Rec. médica, columnas opcionales,
// filtro de fecha de registro, tabla con scroll interno, y detalle de Precios/
// Similares/Complementarios del producto seleccionado — tabla productos_relacionados).
// Duplicar/Proveedor/Reporte (Fase 3) siguen pendientes.

// Indicador de carga reutilizado en la tabla y en Inversión Global — mismo logo
// de marca con un pulso suave, en vez de un spinner genérico.
function LogoCargando({ texto }) {
  return (
    <div className="prod-loading-logo">
      <span className="prod-loading-logo-img">
        <LogoLuxFarma variant="icon" size={42} color="red" />
      </span>
      {texto && <span>{texto}</span>}
    </div>
  );
}

const esActivoLab = (l) => l.activo === 1 || l.activo === true || String(l.activo) === '1';

// Modal de búsqueda para "Agregar Similar"/"Agregar Complemento" — mismo patrón que
// TablaFormasVenta.jsx (sección hija autocontenida, con su propio estado, ligada a un
// id_producto). Buscador con debounce de 400ms + lista de resultados, clic para
// insertar directo en productos_relacionados. Excluye al propio producto base y a los
// que ya están en la relación (para no ofrecer agregar un duplicado).
function ModalBuscarRelacionado({ visible, tipo, idProductoBase, idsYaRelacionados, onAgregado, onClose, mostrarAlerta }) {
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [agregandoId, setAgregandoId] = useState(null);

  useEffect(() => {
    if (!visible) { setBusqueda(''); setResultados([]); }
  }, [visible]);

  useEffect(() => {
    if (!visible || !busqueda.trim()) { setResultados([]); return undefined; }
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const terminoSeguro = busqueda.trim().replace(/[,()]/g, " ");
        const { data } = await supabase
          .from('productos')
          .select('id_producto, codigo_barras, descripcion, laboratorios(nombre)')
          .or(`descripcion.ilike.%${terminoSeguro}%,codigo_barras.ilike.%${terminoSeguro}%`)
          .eq('activo', 1)
          .neq('id_producto', idProductoBase)
          .limit(15);
        setResultados((data || []).filter(p => !idsYaRelacionados.includes(p.id_producto)));
      } finally {
        setBuscando(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [busqueda, visible, idProductoBase, idsYaRelacionados]);

  const seleccionar = async (prod) => {
    if (agregandoId) return;
    setAgregandoId(prod.id_producto);
    try {
      const { error } = await supabase.from('productos_relacionados').insert({
        id_producto: idProductoBase,
        id_producto_relacionado: prod.id_producto,
        tipo,
      });
      if (error) throw error;
      onAgregado();
      onClose();
    } catch (error) {
      mostrarAlerta('Error al agregar: ' + error.message, 'error');
    } finally {
      setAgregandoId(null);
    }
  };

  if (!visible) return null;

  return (
    <div className="modal-overlay-strict" style={{ zIndex: 100036 }}>
      <div className="prod-modal-relacionado">
        <div className="prod-modal-relacionado-header">
          <h3>{tipo === 'SIMILAR' ? 'Agregar Similar' : <><UiIcon name="Plus" size={15} /> Agregar Complemento</>}</h3>
          <button type="button" onClick={onClose}><UiIcon name="X" size={16} /></button>
        </div>
        <div className="prod-search-box">
          <span><UiIcon name="Search" size={16} /></span>
          <input type="text" autoFocus placeholder="Buscar por nombre o código..." value={busqueda} onChange={e => setBusqueda(e.target.value)} />
        </div>
        <div className="prod-modal-relacionado-resultados">
          {buscando && <p className="text-muted prod-modal-relacionado-msg">Buscando...</p>}
          {!buscando && busqueda.trim() && resultados.length === 0 && <p className="text-muted prod-modal-relacionado-msg">Sin resultados.</p>}
          {!buscando && !busqueda.trim() && <p className="text-muted prod-modal-relacionado-msg">Escribe para buscar un producto.</p>}
          {resultados.map(p => (
            <div key={p.id_producto} className="prod-modal-relacionado-fila" onClick={() => seleccionar(p)}>
              <div>
                <strong>{p.descripcion}</strong>
                <br /><small className="text-muted">Cód: {p.codigo_barras || '---'} · {p.laboratorios?.nombre || 'Genérico'}</small>
              </div>
              <span className="prod-modal-relacionado-add">{agregandoId === p.id_producto ? '...' : '+'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Fase C punto 1 "Ver Precio Proveedores" — pivote por proveedor del mismo dato que la
// sección "Proveedores de este producto" (Fase C punto 3): compra_detalle → compras →
// proveedores, filtrado por id_proveedor en vez de por id_producto. Autocontenido (su
// propio catálogo de proveedores, su propio historial), mismo patrón que
// ModalBuscarRelacionado — no depende del producto seleccionado en la pantalla.
function ModalPrecioProveedores({ visible, onClose }) {
  const [proveedores, setProveedores] = useState([]);
  const [proveedorSeleccionado, setProveedorSeleccionado] = useState('');
  const [historial, setHistorial] = useState([]);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (!visible) return;
    supabase.from('proveedores').select('*').then(({ data }) => {
      setProveedores((data || []).filter(p => String(p.activo) === '1' || p.activo === true));
    });
  }, [visible]);

  // La carga va envuelta en una función async interna (no setState directo en el cuerpo
  // del efecto) para que React la trate como una suscripción a un callback externo, no
  // como una actualización síncrona en cascada.
  useEffect(() => {
    if (!visible || !proveedorSeleccionado) return;
    let cancelado = false;
    (async () => {
      setCargando(true);
      const { data } = await supabase
        .from('compra_detalle')
        .select('cantidad, costo_unitario, subtotal, productos(descripcion, codigo_barras), compras!inner(fecha_compra, nro_documento, id_proveedor)')
        .eq('compras.id_proveedor', proveedorSeleccionado)
        .order('id_compra_det', { ascending: false })
        .limit(200);
      if (!cancelado) { setHistorial(data || []); setCargando(false); }
    })();
    return () => { cancelado = true; };
  }, [visible, proveedorSeleccionado]);

  if (!visible) return null;

  // Reset al cerrar (no vía efecto) — el componente sigue montado entre aperturas
  // (el padre lo renderiza siempre, este "if (!visible) return null" solo esconde el
  // contenido), así que sin esto la próxima apertura mostraría el proveedor/historial
  // de la vez anterior.
  const cerrar = () => {
    setProveedorSeleccionado('');
    setHistorial([]);
    onClose();
  };

  return (
    <div className="modal-overlay-strict" style={{ zIndex: 100036 }}>
      <div className="prod-modal-proveedores">
        <div className="prod-modal-relacionado-header">
          <h3><UiIcon name="Building2" size={15} /> Ver Precio Proveedores</h3>
          <button type="button" onClick={cerrar}><UiIcon name="X" size={16} /></button>
        </div>

        <SearchableSelect
          className="prod-select"
          options={proveedores}
          value={proveedorSeleccionado}
          onChange={setProveedorSeleccionado}
          getOptionValue={(p) => p.id_proveedor}
          getOptionLabel={(p) => p.razon_social}
          getOptionSearchText={(p) => `${p.razon_social} ${p.ruc || ''}`}
          placeholder="Buscar proveedor..."
          emptyOptionLabel="-- Selecciona un proveedor --"
        />

        <div className="prod-modal-proveedores-tabla">
          {!proveedorSeleccionado ? (
            <p className="prod-modal-relacionado-msg text-muted">Elige un proveedor para ver su historial de precios.</p>
          ) : cargando ? (
            <div className="prod-detalle-cargando"><LogoCargando texto="Cargando historial..." /></div>
          ) : (
            <table className="prod-table">
              <thead>
                <tr><th>PRODUCTO</th><th>CÓDIGO</th><th>FECHA</th><th>N° DOC.</th><th className="text-center">CANT.</th><th className="text-center">P.UNIT</th><th className="text-center">SUBTOTAL</th></tr>
              </thead>
              <tbody>
                {historial.length === 0 ? (
                  <tr><td colSpan="7" className="empty-prod">Sin compras registradas a este proveedor.</td></tr>
                ) : (
                  historial.map((h, i) => (
                    <tr key={i}>
                      <td><strong className="text-dark">{h.productos?.descripcion || '---'}</strong></td>
                      <td className="text-muted">{h.productos?.codigo_barras || '---'}</td>
                      <td>{h.compras?.fecha_compra ? new Date(h.compras.fecha_compra).toLocaleDateString('es-PE') : '---'}</td>
                      <td className="text-muted">{h.compras?.nro_documento || '---'}</td>
                      <td className="text-center">{h.cantidad}</td>
                      <td className="text-center">{formatSolesUnitario(h.costo_unitario)}</td>
                      <td className="text-center font-bold">S/ {Number(h.subtotal).toFixed(2)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// "Gestionar Laboratorios" — CRUD de la tabla laboratorios propia (id_laboratorio NO es
// autogenerado, mismo patrón manual max(id)+1 que ya usa este archivo/ProductoFormModal
// para productos). Mismo espíritu de selección de fila que el toolbar principal de
// AdminProductos (clic para elegir, Modificar/Desactivar|Activar actúan sobre la fila).
// No se eliminan laboratorios: se desactivan (activo=0) — desaparecen de los selects de
// productos nuevos, pero siguen visibles aquí para reactivar y los productos ya
// existentes mantienen su laboratorio asignado.
function ModalGestionarLaboratorios({ visible, onClose, mostrarAlerta, onCambio }) {
  const [laboratorios, setLaboratorios] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [labSeleccionado, setLabSeleccionado] = useState(null);
  const [formAbierto, setFormAbierto] = useState(false); // false | 'nuevo' | 'editar'
  const [nombreForm, setNombreForm] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [togglingActivo, setTogglingActivo] = useState(false);

  const cargarLaboratorios = async () => {
    setCargando(true);
    try {
      setLaboratorios(await fetchLaboratorios());
    } catch {
      setLaboratorios([]);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    if (!visible) return;
    cargarLaboratorios();
    setLabSeleccionado(null);
    setFormAbierto(false);
    setBusqueda('');
  }, [visible]);

  const filtrados = laboratorios.filter(l =>
    normalizarNombreLab(l.nombre).includes(normalizarNombreLab(busqueda))
  );

  const abrirNuevo = () => { setNombreForm(''); setFormAbierto('nuevo'); };
  const abrirEditar = () => { if (!labSeleccionado) return; setNombreForm(labSeleccionado.nombre); setFormAbierto('editar'); };

  const existeNombreLab = (nombre, excluirId = null) => {
    const clave = normalizarNombreLab(nombre);
    return laboratorios.some(l =>
      normalizarNombreLab(l.nombre) === clave &&
      (excluirId == null || Number(l.id_laboratorio) !== Number(excluirId))
    );
  };

  const ejecutarGuardarForm = async (nombreLimpio) => {
    const nombreGuardar = nombreLimpio.replace(/\s+/g, ' ').trim().toUpperCase();
    setGuardando(true);
    try {
      if (formAbierto === 'nuevo') {
        // Revalidar contra BD por si otro usuario creó el mismo nombre mientras tanto.
        const actuales = await fetchLaboratorios();
        if (actuales.some(l => normalizarNombreLab(l.nombre) === normalizarNombreLab(nombreGuardar))) {
          setLaboratorios(actuales);
          return mostrarAlerta('Este laboratorio ya existe.', 'warning');
        }
        const { data: maxData } = await supabase.from('laboratorios').select('id_laboratorio').order('id_laboratorio', { ascending: false }).limit(1).single();
        const nuevoId = (maxData?.id_laboratorio || 0) + 1;
        const { error } = await supabase.from('laboratorios').insert({ id_laboratorio: nuevoId, nombre: nombreGuardar, activo: 1 });
        if (error) throw error;
        mostrarAlerta('Laboratorio agregado.', 'success');
      } else {
        const { error } = await supabase.from('laboratorios').update({ nombre: nombreGuardar }).eq('id_laboratorio', labSeleccionado.id_laboratorio);
        if (error) throw error;
        mostrarAlerta('Laboratorio modificado.', 'success');
      }
      setFormAbierto(false);
      setLabSeleccionado(null);
      await cargarLaboratorios();
      notificarLaboratoriosChanged();
      onCambio?.();
    } catch (error) {
      mostrarAlerta('Error: ' + error.message, 'error');
    } finally {
      setGuardando(false);
    }
  };

  const guardarForm = () => {
    const nombre = nombreForm.replace(/\s+/g, ' ').trim();
    if (!nombre) return mostrarAlerta('Escribe un nombre para el laboratorio.', 'warning');

    if (formAbierto === 'nuevo') {
      if (existeNombreLab(nombre)) return mostrarAlerta('Este laboratorio ya existe.', 'warning');
      mostrarAlerta(
        `¿Confirmas crear el laboratorio '${nombre.toUpperCase()}'?`,
        'warning',
        () => { ejecutarGuardarForm(nombre); },
        'Sí, crear',
        () => {},
        'Cancelar'
      );
      return;
    }

    if (existeNombreLab(nombre, labSeleccionado?.id_laboratorio)) {
      return mostrarAlerta('Este laboratorio ya existe.', 'warning');
    }
    ejecutarGuardarForm(nombre);
  };

  const toggleActivo = async (lab) => {
    if (!lab || togglingActivo) return;
    const valorPrevio = lab.activo;
    const nuevoValor = esActivoLab(lab) ? 0 : 1;
    setTogglingActivo(true);
    setLaboratorios(prev => prev.map(l => l.id_laboratorio === lab.id_laboratorio ? { ...l, activo: nuevoValor } : l));
    if (labSeleccionado?.id_laboratorio === lab.id_laboratorio) {
      setLabSeleccionado(prev => ({ ...prev, activo: nuevoValor }));
    }
    // .select() confirma que el UPDATE realmente tocó la fila (RLS/silent no-op).
    const { data, error } = await supabase
      .from('laboratorios')
      .update({ activo: nuevoValor })
      .eq('id_laboratorio', lab.id_laboratorio)
      .select('id_laboratorio, activo')
      .maybeSingle();
    if (error || !data) {
      setLaboratorios(prev => prev.map(l => l.id_laboratorio === lab.id_laboratorio ? { ...l, activo: valorPrevio } : l));
      if (labSeleccionado?.id_laboratorio === lab.id_laboratorio) {
        setLabSeleccionado(prev => ({ ...prev, activo: valorPrevio }));
      }
      mostrarAlerta('Error al actualizar: ' + (error?.message || 'No se pudo guardar el cambio en la base de datos.'), 'error');
    } else {
      const activoConfirmado = data.activo;
      setLaboratorios(prev => prev.map(l => l.id_laboratorio === lab.id_laboratorio ? { ...l, activo: activoConfirmado } : l));
      if (labSeleccionado?.id_laboratorio === lab.id_laboratorio) {
        setLabSeleccionado(prev => ({ ...prev, activo: activoConfirmado }));
      }
      notificarLaboratoriosChanged();
      onCambio?.();
      mostrarAlerta(
        esActivoLab({ activo: activoConfirmado })
          ? `"${lab.nombre}" activado. Ya aparece en los selectores de producto.`
          : `"${lab.nombre}" desactivado. Ya no aparece al crear/editar productos; sigue visible aquí para reactivarlo.`,
        'success'
      );
    }
    setTogglingActivo(false);
  };

  const confirmarToggleActivoSeleccionado = () => {
    if (!labSeleccionado) return;
    const activar = !esActivoLab(labSeleccionado);
    mostrarAlerta(
      activar
        ? `¿Activar "${labSeleccionado.nombre}"? Volverá a aparecer en los selectores al crear/editar productos.`
        : `¿Desactivar "${labSeleccionado.nombre}"? Dejará de aparecer al crear/editar productos nuevos. Los productos que ya lo tienen asignado no se modifican y puedes reactivarlo desde aquí.`,
      'warning',
      () => { toggleActivo(labSeleccionado); },
      activar ? 'Sí, activar' : 'Sí, desactivar',
      () => {},
      'Cancelar'
    );
  };

  if (!visible) return null;

  return (
    <div className="modal-overlay-strict" style={{ zIndex: 100037 }}>
      <div className="prod-modal-labs">
        <div className="prod-modal-relacionado-header">
          <h3><UiIcon name="Settings" size={15} /> Gestionar Laboratorios</h3>
          <button type="button" onClick={onClose}><UiIcon name="X" size={16} /></button>
        </div>

        <div className="prod-search-box">
          <span><UiIcon name="Search" size={16} /></span>
          <input type="text" placeholder="Buscar laboratorio..." value={busqueda} onChange={e => setBusqueda(e.target.value)} />
        </div>

        <div className="prod-labs-toolbar">
          <button type="button" className="btn-prod-primary" onClick={abrirNuevo}>+ Agregar</button>
          <button type="button" className="btn-prod-outline" disabled={!labSeleccionado} onClick={abrirEditar}><UiIcon name="Pencil" size={15} /> Modificar</button>
          <button
            type="button"
            className={`btn-prod-outline ${labSeleccionado && esActivoLab(labSeleccionado) ? 'btn-prod-danger' : 'btn-prod-success'}`}
            disabled={!labSeleccionado || togglingActivo}
            onClick={confirmarToggleActivoSeleccionado}
          >
            <UiIcon name={labSeleccionado && esActivoLab(labSeleccionado) ? 'Ban' : 'CheckCircle2'} size={15} />
            {labSeleccionado && !esActivoLab(labSeleccionado) ? ' Activar' : ' Desactivar'}
          </button>
        </div>

        {formAbierto && (
          <div className="prod-labs-form-inline">
            <input
              type="text"
              autoFocus
              placeholder="Nombre del laboratorio"
              value={nombreForm}
              onChange={e => setNombreForm(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); guardarForm(); } }}
            />
            <button type="button" className="btn-prod-primary" disabled={guardando} onClick={guardarForm}>{guardando ? '...' : (formAbierto === 'nuevo' ? 'Guardar' : 'Modificar')}</button>
            <button type="button" className="btn-prod-outline" onClick={() => setFormAbierto(false)}>Cancelar</button>
          </div>
        )}

        <div className="prod-labs-lista">
          {cargando ? (
            <div className="prod-detalle-cargando"><LogoCargando texto="Cargando..." /></div>
          ) : filtrados.length === 0 ? (
            <p className="text-muted" style={{ textAlign: 'center', padding: '1.5rem' }}>Sin resultados.</p>
          ) : (
            <table className="prod-table">
              <thead>
                <tr><th>NOMBRE</th><th className="text-center" style={{ width: 90 }}>ACTIVO</th></tr>
              </thead>
              <tbody>
                {filtrados.map(l => (
                  <tr
                    key={l.id_laboratorio}
                    className={[
                      labSeleccionado?.id_laboratorio === l.id_laboratorio ? 'prod-row-selected' : '',
                      !esActivoLab(l) ? 'prod-lab-inactivo' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => setLabSeleccionado(l)}
                  >
                    <td>
                      {l.nombre}
                      {!esActivoLab(l) && <span className="prod-lab-badge-inactivo">Inactivo</span>}
                    </td>
                    <td className="text-center" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={esActivoLab(l)}
                        disabled={togglingActivo}
                        title={esActivoLab(l) ? 'Desactivar laboratorio' : 'Activar laboratorio'}
                        onChange={() => toggleActivo(l)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminProductos() {
  const navigate = useNavigate();

  // ── Catálogos auxiliares ────────────────────────────────────────
  const [diccionarios, setDiccionarios] = useState({ familias: [], laboratorios: [] });
  const [cargandoCatalogos, setCargandoCatalogos] = useState(true);
  // Ubicación no tiene tabla propia (texto libre) — el selector del filtro se arma con
  // los valores distintos que ya existen en productos.ubicacion, no con un catálogo.
  const [ubicacionesDistintas, setUbicacionesDistintas] = useState([]);

  // ── Datos paginados ─────────────────────────────────────────────
  const [productos, setProductos] = useState([]);
  const [totalProductos, setTotalProductos] = useState(0);
  const [cargandoTabla, setCargandoTabla] = useState(false);

  // ── Filtros ─────────────────────────────────────────────────────
  const [busquedaInput, setBusquedaInput] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [laboratorioFiltro, setLaboratorioFiltro] = useState('TODOS');
  const [showModalGestionarLabs, setShowModalGestionarLabs] = useState(false);
  const [dptoFiltro, setDptoFiltro] = useState('TODOS');
  const [principioActivoInput, setPrincipioActivoInput] = useState('');
  const [principioActivo, setPrincipioActivo] = useState('');
  const [soloRotar, setSoloRotar] = useState(false);
  const [stockFiltro, setStockFiltro] = useState('TODOS'); // 'TODOS' | 'CON_STOCK' | 'SIN_STOCK'
  const [ubicacionFiltro, setUbicacionFiltro] = useState('TODAS');
  const [inafectoFiltro, setInafectoFiltro] = useState('TODOS'); // 'TODOS' | 'SI' | 'NO'
  const [recetaFiltro, setRecetaFiltro] = useState('TODOS'); // 'TODOS' | 'SI' | 'NO'
  // "Activos" por defecto — antes la lista traía TODOS (activos e inactivos) sin
  // distinción visual clara más allá del checkbox ACTIVO de la fila, lo que hacía
  // parecer que "Eliminar" no había hecho nada cuando en realidad solo desactivó el
  // producto (soft-delete, ver handleToggleEstadoSeleccionado).
  const [estadoFiltro, setEstadoFiltro] = useState('ACTIVOS'); // 'ACTIVOS' | 'INACTIVOS' | 'TODOS'
  // productos no tiene fecha de última modificación (confirmado por SQL) — este filtro
  // usa created_at (fecha de registro/creación), por eso se etiqueta así y no como
  // "última modificación" para no prometer algo que no es.
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [paginaActual, setPaginaActual] = useState(1);
  const [filasPorPagina, setFilasPorPagina] = useState(12);

  // ── Columnas opcionales de la tabla — confirmadas por SQL contra productos: Dpto
  // (id_familia), Principio Activo, Presentac (id_presentacion → presentaciones.nombre)
  // y Dolencia (dolencias) ya existían; "Código I." se mapea a cod_digemid (Código
  // DIGEMID, el registro sanitario peruano). "Vadim" y "CodInfo/Ticket" se descartaron
  // por no tener ninguna columna real que les corresponda. Dpto empieza marcado para no
  // cambiar lo que ya se veía antes de esta fase; el resto arranca oculto.
  const [columnasVisibles, setColumnasVisibles] = useState({
    dpto: true,
    principioActivo: false,
    presentacion: false,
    dolencia: false,
    codigoI: false,
  });
  const toggleColumna = (clave) => setColumnasVisibles(prev => ({ ...prev, [clave]: !prev[clave] }));
  const [filtrosAvanzadosAbiertos, setFiltrosAvanzadosAbiertos] = useState(false);
  const [columnasPopoverAbierto, setColumnasPopoverAbierto] = useState(false);
  const columnasPopoverRef = useRef(null);

  useEffect(() => {
    if (!columnasPopoverAbierto) return undefined;
    const onDoc = (e) => {
      if (!columnasPopoverRef.current?.contains(e.target)) setColumnasPopoverAbierto(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [columnasPopoverAbierto]);

  const filtrosAvanzadosActivos = [
    ubicacionFiltro !== 'TODAS',
    inafectoFiltro !== 'TODOS',
    recetaFiltro !== 'TODOS',
    estadoFiltro !== 'ACTIVOS',
    Boolean(fechaDesde),
    Boolean(fechaHasta),
  ].filter(Boolean).length;

  const columnasOpcionalesActivas = Object.values(columnasVisibles).filter(Boolean).length;

  // ── Selección de fila (la toolbar de Modificar/Ver Detalle/Pedir a Proveedor actúa
  // sobre esta — no son íconos por fila como en AdminInventario.jsx) ──
  const [productoSeleccionado, setProductoSeleccionado] = useState(null);

  // ── Selección MÚLTIPLE (checkboxes propios, distintos del indicador visual ACTIVO de
  // cada fila) — solo para Activar/Desactivar en bloque. No existía ningún patrón de
  // selección múltiple en el resto del sistema (se revisó antes de construir este), así
  // que se arma desde cero acá. Un Set de id_producto, no un array, para que
  // toggle/consulta de pertenencia sean O(1) sin importar cuántas filas tenga la página.
  const [seleccionados, setSeleccionados] = useState(new Set());
  const toggleSeleccion = (idProducto) => {
    setSeleccionados(prev => {
      const next = new Set(prev);
      if (next.has(idProducto)) next.delete(idProducto); else next.add(idProducto);
      return next;
    });
  };

  // ── Fase B: Detalle del producto seleccionado (Precios / Similares / Complementarios)
  // — se carga bajo demanda con el botón "Ver Detalle" de la toolbar, no automáticamente
  // al seleccionar la fila (evita disparar 3 consultas extra en cada clic). Se oculta
  // solo cuando la selección se pierde (ver el useEffect más abajo). ──
  const [mostrarDetalle, setMostrarDetalle] = useState(false);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [detallePrecios, setDetallePrecios] = useState(null);
  const [productosSimilares, setProductosSimilares] = useState([]);
  const [productosComplementarios, setProductosComplementarios] = useState([]);
  // Fase C punto 3 "Consulta Precios Productos Proveedores" — 4ta sección del mismo
  // panel de Ver Detalle: historial completo (sin límite) de compras de ESTE producto,
  // con su proveedor — mismo query que ya usa AdminCompras.jsx (línea ~399-404) para su
  // mini-historial de 3 filas, acá sin el .limit(3).
  const [historialProveedoresProducto, setHistorialProveedoresProducto] = useState([]);
  const [modalSimilarAbierto, setModalSimilarAbierto] = useState(false);
  const [modalComplementoAbierto, setModalComplementoAbierto] = useState(false);
  // Fase C punto 1 "Ver Precio Proveedores" — no depende de productoSeleccionado, tiene
  // su propio selector de proveedor (ver ModalPrecioProveedores).
  const [modalPrecioProveedoresAbierto, setModalPrecioProveedoresAbierto] = useState(false);

  useEffect(() => {
    if (!productoSeleccionado) setMostrarDetalle(false);
  }, [productoSeleccionado]);

  // ── Inversión Global — totales de TODO el catálogo (no cambian con la fila
  // seleccionada ni con los filtros activos de la tabla; sin filtro de sucursal,
  // Productos no tiene ese selector) ──
  const [inversionGlobal, setInversionGlobal] = useState({ costo: 0, venta: 0 });
  const [cargandoInversion, setCargandoInversion] = useState(true);

  // ── Modal Agregar/Modificar (reutiliza ProductoFormModal tal cual) ──────────────
  const [showModal, setShowModal] = useState(false);
  const [modoEdicion, setModoEdicion] = useState(false);
  const [productoEnEdicion, setProductoEnEdicion] = useState(null);

  // ── Alertas ─────────────────────────────────────────────────────
  const [alertaSistema, setAlertaSistema] = useState(null);
  const mostrarAlerta = (mensaje, tipo = 'info', accionConfirmar = null, textoConfirmar = 'Aceptar', accionCancelar = null, textoCancelar = null) => {
    setAlertaSistema({ mensaje, tipo, accionConfirmar, textoConfirmar, accionCancelar, textoCancelar });
  };
  const alertOkBtnRef = useRef(null);
  useEffect(() => {
    if (alertaSistema && alertOkBtnRef.current) alertOkBtnRef.current.focus();
  }, [alertaSistema]);

  // Trae los valores distintos ya usados en productos.ubicacion (texto libre, sin
  // catálogo propio) — se relee después de guardar un producto por si se escribió una
  // ubicación nueva.
  const cargarUbicacionesDistintas = async () => {
    const { data } = await supabase.from('productos').select('ubicacion').not('ubicacion', 'is', null).neq('ubicacion', '');
    const distintas = [...new Set((data || []).map(p => p.ubicacion))].sort((a, b) => a.localeCompare(b));
    setUbicacionesDistintas(distintas);
  };

  // Inversión Global: valoriza el stock físico actual (lotes VIGENTE con
  // cantidad_actual > 0) a precio de costo y a precio de venta, respetando los MISMOS
  // filtros que cargarPagina() aplica a la tabla (si se filtra por un laboratorio, esto
  // muestra solo la inversión de ese laboratorio) — NO depende de la fila seleccionada
  // ni de la página actual. productos!inner(...) es necesario para poder filtrar sobre
  // la tabla embebida vía PostgREST (sin el "!inner" no se puede usar .eq('productos.…')).
  const cargarInversionGlobal = useCallback(async () => {
    setCargandoInversion(true);
    try {
      // "Sin Stock" son productos con stock TOTAL en 0 — por definición no aportan nada
      // a la valorización, no hace falta ni consultar.
      if (stockFiltro === 'SIN_STOCK') {
        setInversionGlobal({ costo: 0, venta: 0 });
        return;
      }

      const data = await fetchAllRows(() => {
        let q = supabase
          .from('inventario_lotes')
          .select('cantidad_actual, estado, fecha_vencimiento, productos!inner(producto_precios(costo, precio_venta))')
          .eq('estado', 'VIGENTE')
          .gt('cantidad_actual', 0);

        if (busqueda.trim()) {
          const terminoSeguro = busqueda.trim().replace(/[,()]/g, ' ');
          q = q.or(`descripcion.ilike.%${terminoSeguro}%,codigo_barras.ilike.%${terminoSeguro}%`, { foreignTable: 'productos' });
        }
        if (laboratorioFiltro !== 'TODOS') q = q.eq('productos.id_laboratorio', laboratorioFiltro);
        if (dptoFiltro !== 'TODOS') q = q.eq('productos.id_familia', dptoFiltro);
        if (principioActivo.trim()) q = q.ilike('productos.principio_activo', `%${principioActivo.trim()}%`);
        if (soloRotar) q = q.eq('productos.rotar', true);
        if (ubicacionFiltro !== 'TODAS') q = q.eq('productos.ubicacion', ubicacionFiltro);
        if (inafectoFiltro !== 'TODOS') q = q.eq('productos.inafecto', inafectoFiltro === 'SI');
        if (recetaFiltro !== 'TODOS') q = q.eq('productos.requiere_receta', recetaFiltro === 'SI');
        if (fechaDesde) q = q.gte('productos.created_at', new Date(`${fechaDesde}T00:00:00`).toISOString());
        if (fechaHasta) q = q.lte('productos.created_at', new Date(`${fechaHasta}T23:59:59`).toISOString());
        if (estadoFiltro !== 'TODOS') q = q.eq('productos.activo', estadoFiltro === 'ACTIVOS' ? 1 : 0);
        return q;
      });

      let costo = 0, venta = 0;
      (data || []).forEach(lote => {
        const cant = resumirStockLotes([lote]).disponible;
        const fp = filaProductoPrecios(lote.productos?.producto_precios);
        const costoUnit = Number(fp?.costo) || 0;
        const ventaUnit = Number(fp?.precio_venta) || 0;
        // Sin costo (bonificación / dato faltante) no entra a la valorización:
        // sumar solo la venta inflaba utilidad y el % global.
        if (costoUnit <= 0 || ventaUnit <= 0) return;
        costo += cant * costoUnit;
        venta += cant * ventaUnit;
      });
      setInversionGlobal({ costo, venta });
    } catch (error) {
      console.error('Error cargando inversión global:', error);
    } finally {
      setCargandoInversion(false);
    }
  }, [busqueda, laboratorioFiltro, dptoFiltro, principioActivo, soloRotar, stockFiltro, ubicacionFiltro, inafectoFiltro, recetaFiltro, estadoFiltro, fechaDesde, fechaHasta]);

  // Auto-aplicado igual que cargarPagina — reacciona a cualquier cambio de filtro, sin
  // esperar al botón "Buscar" (que también la llama de forma explícita).
  useEffect(() => {
    if (!cargandoCatalogos) cargarInversionGlobal();
  }, [cargarInversionGlobal, cargandoCatalogos]);

  // ── 1. Cargar catálogos auxiliares (una sola vez) ───────────────
  useEffect(() => {
    const init = async () => {
      setCargandoCatalogos(true);
      try {
        const [resFam, labs] = await Promise.all([
          supabase.from('familias').select('*'),
          fetchLaboratorios(),
        ]);
        setDiccionarios({
          familias: (resFam.data || []).filter(f => String(f.activo) === '1' || f.activo === true),
          // Laboratorios se guarda COMPLETO (activos e inactivos): se usa tanto para
          // resolver el nombre de la columna Laboratorio de la tabla (donde un producto
          // ya existente puede tener asignado un laboratorio desactivado y debe seguir
          // mostrando su nombre real, no "Genérico") como para el filtro de abajo, que
          // sí se limita a activos en el render.
          laboratorios: labs,
        });
        await cargarUbicacionesDistintas();
      } finally {
        setCargandoCatalogos(false);
      }
    };
    init();
  }, []);

  const recargarCatalogoLaboratorios = useCallback(async () => {
    try {
      const data = await fetchLaboratorios();
      setDiccionarios(prev => ({ ...prev, laboratorios: data }));
    } catch {
      /* silencioso: el filtro se refresca en el próximo intento */
    }
  }, []);

  // Si se crea/edita un lab desde Gestionar (u otro modal), el filtro de Productos
  // se actualiza sin recargar la página.
  useEffect(() => suscribirLaboratoriosChanged(recargarCatalogoLaboratorios), [recargarCatalogoLaboratorios]);

  // ── 2. Cargar página de productos (cuando cambian filtros/página) ───────────────
  // A diferencia de AdminInventario.jsx, esta pantalla NO filtra por sucursal (el Stock
  // que se pide es la suma de TODAS las sucursales). Sí excluye inactivos POR DEFECTO
  // (estadoFiltro==='ACTIVOS') — el checkbox ACTIVO de la fila sigue disponible para
  // reactivar, pero solo se ve una vez que el usuario cambia el filtro Estado a
  // "Inactivos" o "Todos" (ver handleToggleEstadoSeleccionado y estadoFiltro).
  const cargarPagina = useCallback(async () => {
    setCargandoTabla(true);
    try {
      const aplicarFiltrosProducto = (qBase) => {
        let q = qBase;
        if (estadoFiltro !== 'TODOS') q = q.eq('activo', estadoFiltro === 'ACTIVOS' ? 1 : 0);
        if (busqueda.trim()) {
          const terminoSeguro = busqueda.trim().replace(/[,()]/g, ' ');
          q = q.or(`descripcion.ilike.%${terminoSeguro}%,codigo_barras.ilike.%${terminoSeguro}%`);
        }
        if (laboratorioFiltro !== 'TODOS') q = q.eq('id_laboratorio', laboratorioFiltro);
        if (dptoFiltro !== 'TODOS') q = q.eq('id_familia', dptoFiltro);
        if (principioActivo.trim()) q = q.ilike('principio_activo', `%${principioActivo.trim()}%`);
        if (soloRotar) q = q.eq('rotar', true);
        if (ubicacionFiltro !== 'TODAS') q = q.eq('ubicacion', ubicacionFiltro);
        if (inafectoFiltro !== 'TODOS') q = q.eq('inafecto', inafectoFiltro === 'SI');
        if (recetaFiltro !== 'TODOS') q = q.eq('requiere_receta', recetaFiltro === 'SI');
        if (fechaDesde) q = q.gte('created_at', new Date(`${fechaDesde}T00:00:00`).toISOString());
        if (fechaHasta) q = q.lte('created_at', new Date(`${fechaHasta}T23:59:59`).toISOString());
        return q;
      };

      const selectCols = '*, inventario_lotes(cantidad_actual, estado, fecha_vencimiento), presentaciones(nombre)';
      const mapearProducto = (prod) => {
        const stockTotal = resumirStockLotes(prod.inventario_lotes || []).disponible;
        const labObj = diccionarios.laboratorios.find(l => Number(l.id_laboratorio) === Number(prod.id_laboratorio));
        const famObj = diccionarios.familias.find(f => Number(f.idfamilia) === Number(prod.id_familia));
        return {
          ...prod,
          stockTotal,
          nombreLaboratorio: labObj?.nombre || 'Genérico',
          nombreDpto: famObj?.nombre || 'Sin categoría',
          nombrePresentacion: prod.presentaciones?.nombre || '---',
        };
      };

      const aplicarStockCliente = (lista) => {
        if (stockFiltro === 'CON_STOCK') return lista.filter(p => p.stockTotal > 0);
        if (stockFiltro === 'SIN_STOCK') return lista.filter(p => p.stockTotal <= 0);
        return lista;
      };

      // Laboratorio concreto (u otros filtros de stock en cliente): traer TODAS las
      // filas paginando de a 1000. PostgREST si no pagina se corta y faltan productos
      // + la inversión queda corta.
      const traerCompleto = laboratorioFiltro !== 'TODOS' || stockFiltro !== 'TODOS';

      let filtrados;
      let count;

      if (traerCompleto) {
        const data = await fetchAllRows(() =>
          aplicarFiltrosProducto(
            supabase.from('productos').select(selectCols),
          ).order('descripcion', { ascending: true }),
        );
        const procesados = (data || []).map(mapearProducto);
        filtrados = aplicarStockCliente(procesados);
        count = filtrados.length;
        const MAX_SIN_PAGINAR = 250;
        if (count > MAX_SIN_PAGINAR) {
          const desde = (paginaActual - 1) * filasPorPagina;
          filtrados = filtrados.slice(desde, desde + filasPorPagina);
        }
      } else {
        const desde = (paginaActual - 1) * filasPorPagina;
        const hasta = desde + filasPorPagina - 1;
        const { data, count: c, error } = await aplicarFiltrosProducto(
          supabase.from('productos').select(selectCols, { count: 'exact' }),
        ).order('descripcion', { ascending: true }).range(desde, hasta);
        if (error) throw error;
        filtrados = aplicarStockCliente((data || []).map(mapearProducto));
        count = c || 0;
      }

      setProductos(filtrados);
      setTotalProductos(count || 0);
      setProductoSeleccionado(null);
      setSeleccionados(new Set());
    } catch (err) {
      mostrarAlerta('Error al cargar productos: ' + err.message, 'error');
    } finally {
      setCargandoTabla(false);
    }
  }, [paginaActual, filasPorPagina, busqueda, laboratorioFiltro, dptoFiltro, principioActivo, soloRotar, stockFiltro, ubicacionFiltro, inafectoFiltro, recetaFiltro, estadoFiltro, fechaDesde, fechaHasta, diccionarios]);

  useEffect(() => {
    if (!cargandoCatalogos) cargarPagina();
  }, [cargarPagina, cargandoCatalogos]);

  // ── Debounce de los dos filtros de texto libre ──────────────────
  useEffect(() => {
    const t = setTimeout(() => { setBusqueda(busquedaInput); setPaginaActual(1); }, 400);
    return () => clearTimeout(t);
  }, [busquedaInput]);
  useEffect(() => {
    const t = setTimeout(() => { setPrincipioActivo(principioActivoInput); setPaginaActual(1); }, 400);
    return () => clearTimeout(t);
  }, [principioActivoInput]);

  // Botón "Buscar" — adicional al auto-aplicado (que sigue funcionando igual), para
  // quien prefiera ajustar varios filtros y disparar la búsqueda de una sola vez, sin
  // esperar el debounce de los campos de texto.
  const handleBuscarManual = () => {
    setPaginaActual(1);
    setBusqueda(busquedaInput);
    setPrincipioActivo(principioActivoInput);
    cargarPagina();
    cargarInversionGlobal();
  };

  const totalPaginas = Math.ceil(totalProductos / filasPorPagina);
  const indexOfFirst = (paginaActual - 1) * filasPorPagina + 1;
  const indexOfLast = Math.min(paginaActual * filasPorPagina, totalProductos);
  // 7 columnas fijas (Selección, Código, Producto, Laboratorio, Stock, Stock Mínimo,
  // Activo) + las opcionales que estén tildadas — usado para el colSpan de la fila "sin
  // resultados".
  const totalColumnas = 7 + Object.values(columnasVisibles).filter(Boolean).length;

  const getPageNumbers = () => {
    const maxPages = 5;
    let start = Math.max(1, paginaActual - Math.floor(maxPages / 2));
    let end = Math.min(totalPaginas, start + maxPages - 1);
    if (end - start + 1 < maxPages) start = Math.max(1, end - maxPages + 1);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  };

  // ── Exportar Excel (CSV) — trae TODOS los productos (sin paginar), mismo patrón que
  // AdminInventario.jsx, con las columnas que pide esta pantalla ──────────────────
  const exportarExcel = async () => {
    mostrarAlerta('Preparando exportación...', 'info');
    try {
      let allData = [], from = 0;
      while (true) {
        const { data, error } = await supabase
          .from('productos')
          .select('codigo_barras, descripcion, id_familia, id_laboratorio, stock_minimo, activo, inventario_lotes(cantidad_actual, estado, fecha_vencimiento)')
          .range(from, from + 999);
        if (error) throw error;
        allData = [...allData, ...(data || [])];
        if (!data || data.length < 1000) break;
        from += 1000;
      }
      const encabezados = "CÓDIGO,PRODUCTO,DPTO,LABORATORIO,STOCK,STOCK MÍNIMO,ACTIVO\n";
      const filas = allData.map(p => {
        const stock = resumirStockLotes(p.inventario_lotes || []).disponible;
        const famObj = diccionarios.familias.find(f => Number(f.idfamilia) === Number(p.id_familia));
        const labObj = diccionarios.laboratorios.find(l => Number(l.id_laboratorio) === Number(p.id_laboratorio));
        const activoTxt = (p.activo === 1 || p.activo === true || String(p.activo) === '1') ? 'SI' : 'NO';
        return `"${p.codigo_barras || ''}","${p.descripcion}","${famObj?.nombre || ''}","${labObj?.nombre || ''}",${stock},${p.stock_minimo || 0},${activoTxt}`;
      }).join("\n");
      const blob = new Blob(["﻿" + encabezados + filas], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `Productos_LuxFarma.csv`; link.click();
      setAlertaSistema(null);
    } catch (err) { mostrarAlerta('Error al exportar: ' + err.message, 'error'); }
  };

  // ── Modal Agregar / Modificar ────────────────────────────────────
  const abrirModalNuevo = () => {
    setModoEdicion(false);
    setProductoEnEdicion(null);
    setShowModal(true);
  };

  const abrirModalModificar = () => {
    if (!productoSeleccionado) return;
    setModoEdicion(true);
    setProductoEnEdicion(productoSeleccionado);
    setShowModal(true);
  };

  // ── Toggle inline del checkbox "Activo" — directo desde la tabla, sin confirmación
  // (el checkbox ACTIVO de la tabla ya NO dispara este cambio — pasó a ser un indicador
  // de solo lectura, ver columna ACTIVO más abajo). La única vía para cambiar el estado
  // es este botón de la toolbar, con confirmación previa.
  const esActivo = (p) => p.activo === 1 || p.activo === true || String(p.activo) === '1';

  // ── Objetivos de Activar/Desactivar: si hay checkboxes de selección tildados (Tarea
  // 2, selección múltiple), esos mandan; si no hay ninguno, cae al producto elegido con
  // un clic en la fila (mismo flujo de un producto a la vez que ya existía). Con 2+
  // objetivos de estados MIXTOS (algunos activos, algunos inactivos) la acción queda
  // deshabilitada — no tiene sentido aplicar "activar" y "desactivar" a la vez.
  const objetivosToggle = seleccionados.size > 0
    ? productos.filter(p => seleccionados.has(p.id_producto))
    : (productoSeleccionado ? [productoSeleccionado] : []);
  const estadosEnJuego = new Set(objetivosToggle.map(esActivo));
  const toggleEsAmbiguo = estadosEnJuego.size > 1;
  const toggleActiva = estadosEnJuego.size === 1 ? !estadosEnJuego.values().next().value : null;

  // ── Activar/Desactivar desde la toolbar (con confirmación) — un solo UPDATE con
  // .in(...) para 1 o N productos a la vez, optimista sobre la tabla local con reversión
  // si falla, y un solo mensaje de confirmación/éxito acorde a la cantidad. Antes este
  // botón se llamaba "Eliminar" y siempre decía "eliminado" sin importar el estado, lo
  // cual confundía porque el producto seguía apareciendo en la lista (no es un borrado
  // real, ver estadoFiltro más arriba).
  const handleToggleEstadoSeleccionado = () => {
    if (objetivosToggle.length === 0 || toggleEsAmbiguo) return;
    const estabaActivo = !toggleActiva;
    const n = objetivosToggle.length;
    const ids = objetivosToggle.map(p => p.id_producto);
    const activoPrevioPorId = new Map(objetivosToggle.map(p => [p.id_producto, p.activo]));
    const nuevoValor = estabaActivo ? 0 : 1;

    const mensajeConfirm = estabaActivo
      ? (n > 1
          ? `¿Desactivar estos ${n} productos? Dejarán de aparecer en la lista por defecto.`
          : `¿Desactivar "${objetivosToggle[0].descripcion}"? Dejará de aparecer en la lista por defecto — puedes reactivarlo cambiando el filtro Estado a "Inactivos" o "Todos".`)
      : (n > 1
          ? `¿Activar estos ${n} productos? Volverán a aparecer en la lista por defecto y estarán disponibles para vender.`
          : `¿Activar "${objetivosToggle[0].descripcion}"? Volverá a aparecer en la lista por defecto y estará disponible para vender.`);

    mostrarAlerta(mensajeConfirm, 'warning', async () => {
      setProductos(prev => prev.map(p => ids.includes(p.id_producto) ? { ...p, activo: nuevoValor } : p));
      const { data, error } = await supabase
        .from('productos')
        .update({ activo: nuevoValor })
        .in('id_producto', ids)
        .select('id_producto');
      if (error || !data || data.length !== ids.length) {
        setProductos(prev => prev.map(p => ids.includes(p.id_producto) ? { ...p, activo: activoPrevioPorId.get(p.id_producto) } : p));
        mostrarAlerta(
          'Error al actualizar: ' + (error?.message || `Solo se actualizaron ${data?.length || 0} de ${ids.length} productos.`),
          'error'
        );
        return;
      }
      mostrarAlerta(
        n > 1 ? `${n} productos ${estabaActivo ? 'desactivados' : 'activados'}.` : `Producto ${estabaActivo ? 'desactivado' : 'activado'}.`,
        'success'
      );
      setSeleccionados(new Set());
      marcarCatalogoOfflineStale();
      cargarPagina();
    }, estabaActivo ? 'Sí, desactivar' : 'Sí, activar', () => {}, 'Cancelar');
  };

  // ── Fase B: Similares/Complementarios — relación SIMÉTRICA (un solo registro por
  // par): se busca en ambas columnas (id_producto o id_producto_relacionado = el
  // producto actual) y se toma "el otro lado" de la fila que matcheó, así agregar
  // "B similar a A" hace que B también aparezca al entrar a A o a B indistintamente. ──
  const cargarRelacionados = async (idProd, tipo) => {
    const { data: rels } = await supabase
      .from('productos_relacionados')
      .select('id_relacion, id_producto, id_producto_relacionado')
      .eq('tipo', tipo)
      .or(`id_producto.eq.${idProd},id_producto_relacionado.eq.${idProd}`);

    const pares = (rels || []).map(r => ({
      id_relacion: r.id_relacion,
      id_producto_otro: r.id_producto === idProd ? r.id_producto_relacionado : r.id_producto,
    }));
    if (pares.length === 0) return [];

    const idsOtros = pares.map(p => p.id_producto_otro);
    const { data: prods } = await supabase
      .from('productos')
      .select('id_producto, codigo_barras, descripcion, stock_minimo, laboratorios(nombre), presentaciones(nombre), inventario_lotes(cantidad_actual, estado, fecha_vencimiento), producto_precios(costo)')
      .in('id_producto', idsOtros);

    return pares
      .map(par => {
        const prod = (prods || []).find(p => p.id_producto === par.id_producto_otro);
        if (!prod) return null;
        const stockTotal = resumirStockLotes(prod.inventario_lotes || []).disponible;
        return {
          id_relacion: par.id_relacion,
          id_producto: prod.id_producto,
          codigo_barras: prod.codigo_barras,
          descripcion: prod.descripcion,
          nombreLaboratorio: prod.laboratorios?.nombre || 'Genérico',
          nombrePresentacion: prod.presentaciones?.nombre || '---',
          stockTotal,
          stock_minimo: prod.stock_minimo || 0,
          costo: Number(filaProductoPrecios(prod.producto_precios)?.costo) || 0,
        };
      })
      .filter(Boolean);
  };

  // Carga las 4 secciones del producto seleccionado (Precios, Similares,
  // Complementarios, Proveedores) de una sola vez, bajo demanda desde "Ver Detalle".
  const cargarDetalleProducto = async () => {
    if (!productoSeleccionado) return;
    setCargandoDetalle(true);
    try {
      const idProd = productoSeleccionado.id_producto;
      const [resPrecio, similares, complementarios, resProveedores] = await Promise.all([
        supabase.from('producto_precios').select('costo, precio_venta, precio_caja, ganancia').eq('id_producto', idProd).limit(1).maybeSingle(),
        cargarRelacionados(idProd, 'SIMILAR'),
        cargarRelacionados(idProd, 'COMPLEMENTARIO'),
        // Mismo query que ya usa AdminCompras.jsx (línea ~399-404) para su mini-historial
        // de 3 filas, acá sin el .limit(3) — Fase C punto 3.
        supabase
          .from('compra_detalle')
          .select('cantidad, costo_unitario, subtotal, compras(fecha_compra, nro_documento, proveedores(razon_social))')
          .eq('id_producto', idProd)
          .order('id_compra_det', { ascending: false }),
      ]);
      setDetallePrecios(resPrecio.data || null);
      setProductosSimilares(similares);
      setProductosComplementarios(complementarios);
      setHistorialProveedoresProducto(resProveedores.data || []);
      setMostrarDetalle(true);
    } catch (error) {
      mostrarAlerta('Error al cargar el detalle: ' + error.message, 'error');
    } finally {
      setCargandoDetalle(false);
    }
  };

  // Quita una relación (soft nada — se borra directo, es solo un vínculo, no un
  // registro de negocio) y refresca ambas listas + precios de una vez.
  const eliminarRelacionado = (idRelacion, tipo) => {
    mostrarAlerta(`¿Quitar este ${tipo === 'SIMILAR' ? 'similar' : 'complemento'}?`, 'warning', async () => {
      const { error } = await supabase.from('productos_relacionados').delete().eq('id_relacion', idRelacion);
      if (error) return mostrarAlerta('Error: ' + error.message, 'error');
      cargarDetalleProducto();
    }, 'Sí, quitar', () => {}, 'Cancelar');
  };

  const cerrarDrawerDetalle = () => setMostrarDetalle(false);

  if (cargandoCatalogos) return <div className="admin-loading">Conectando con la base de datos...</div>;

  return (
    <div className="admin-prod-container">

      <AlertaSistemaModal alerta={alertaSistema} onClose={() => setAlertaSistema(null)} />

      <ProductoFormModal
        visible={showModal}
        modo={modoEdicion ? 'editar' : 'nuevo'}
        productoInicial={productoEnEdicion}
        onClose={() => setShowModal(false)}
        onGuardado={() => { cargarPagina(); cargarUbicacionesDistintas(); cargarInversionGlobal(); }}
        mostrarAlerta={mostrarAlerta}
      />

      <div className="prod-zona-superior">
      <div className="prod-top-bar">
        <div className="prod-title-area">
          <p className="prod-eyebrow">Catálogo</p>
          <h2>Productos</h2>
          <p>{totalProductos.toLocaleString()} productos en catálogo</p>
        </div>
        <div className="prod-toolbar">
          <button type="button" className="btn-prod-primary" onClick={abrirModalNuevo}>+ Agregar</button>
          <button type="button" className="btn-prod-outline" disabled={!productoSeleccionado} onClick={abrirModalModificar}><UiIcon name="Pencil" size={15} /> Modificar</button>
          <button
            type="button"
            className={`btn-prod-outline ${toggleActiva ? 'btn-prod-success' : 'btn-prod-danger'}`}
            disabled={objetivosToggle.length === 0 || toggleEsAmbiguo}
            title={toggleEsAmbiguo ? 'La selección tiene productos activos e inactivos mezclados — elige solo de un tipo.' : undefined}
            onClick={handleToggleEstadoSeleccionado}
          >
            {toggleEsAmbiguo
              ? 'Selección mixta'
              : <>
                  <UiIcon name={toggleActiva ? 'CheckCircle2' : 'Ban'} size={15} />
                  {toggleActiva ? ' Activar' : ' Desactivar'}
                  {objetivosToggle.length > 1 ? ` (${objetivosToggle.length})` : ''}
                </>}
          </button>
          <button type="button" className="btn-prod-outline" disabled={!productoSeleccionado || cargandoDetalle} onClick={cargarDetalleProducto}>{cargandoDetalle ? '...' : <><UiIcon name="Search" size={15} /> Ver Detalle</>}</button>
          <button type="button" className="btn-prod-outline" onClick={() => setModalPrecioProveedoresAbierto(true)}><UiIcon name="Building2" size={15} /> Precio Proveedores</button>
          <button
            type="button"
            className="btn-prod-outline"
            disabled={!productoSeleccionado}
            onClick={() => navigate('/admin-pedidos', { state: { productoPredefinido: { id_producto: productoSeleccionado.id_producto, descripcion: productoSeleccionado.descripcion } } })}
          ><UiIcon name="ClipboardList" size={15} /> Pedir a Proveedor
          </button>
          <button type="button" className="btn-prod-outline" onClick={exportarExcel}><UiIcon name="Download" size={15} /> Exportar Excel</button>
        </div>
      </div>

      {/* INVERSIÓN GLOBAL — totales del catálogo filtrado; solo presentación visual */}
      <div className="prod-kpis-grid">
        {cargandoInversion ? (
          <div className="prod-kpis-loading"><LogoCargando texto="Calculando valorización de stock..." /></div>
        ) : (
          <>
            <div className="prod-kpi-card border-navy">
              <div className="prod-kpi-icon bg-navy-soft"><UiIcon name="Package" size={16} /></div>
              <div className="prod-kpi-info">
                <span className="prod-kpi-label">P. Compra (Inversión)</span>
                <strong className="prod-kpi-valor">S/ {inversionGlobal.costo.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
              </div>
            </div>
            <div className="prod-kpi-card border-blue">
              <div className="prod-kpi-icon bg-brand-soft"><UiIcon name="Tags" size={16} /></div>
              <div className="prod-kpi-info">
                <span className="prod-kpi-label">P. Venta Aprox</span>
                <strong className="prod-kpi-valor">S/ {inversionGlobal.venta.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
              </div>
            </div>
            <div className="prod-kpi-card border-teal">
              <div className="prod-kpi-icon bg-teal-soft"><UiIcon name="TrendingUp" size={16} /></div>
              <div className="prod-kpi-info">
                <span className="prod-kpi-label">Utilidad Aprox</span>
                <strong className="prod-kpi-valor">S/ {(inversionGlobal.venta - inversionGlobal.costo).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
              </div>
            </div>
            <div className="prod-kpi-card border-green">
              <div className="prod-kpi-icon bg-green-soft">%</div>
              <div className="prod-kpi-info">
                <span className="prod-kpi-label">% Ganancia (Indic)</span>
                <strong className="prod-kpi-valor">{formatearPorcentajeGanancia(inversionGlobal.venta, inversionGlobal.costo)}</strong>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="prod-filters-bar">
        <div className="prod-filtros-grupo-header">
          <span className="prod-filtros-grupo-titulo">Búsqueda</span>
        </div>
        <div className="prod-filtros-fila">
          <div className="prod-campo-filtro">
            <label>Código o Producto</label>
            <div className="prod-search-box"><span><UiIcon name="Search" size={16} /></span><input type="text" placeholder="Buscar..." value={busquedaInput} onChange={e => setBusquedaInput(e.target.value)} /></div>
          </div>
          <div className="prod-campo-filtro prod-campo-filtro-lab">
            <label>Marca / Laboratorio</label>
            <div className="prod-lab-filtro-row">
              <SearchableSelect
                className="prod-select"
                options={diccionarios.laboratorios.filter(esActivoLab)}
                value={laboratorioFiltro}
                onChange={(val) => { setLaboratorioFiltro(val); setPaginaActual(1); }}
                getOptionValue={(l) => l.id_laboratorio}
                getOptionLabel={(l) => l.nombre}
                placeholder="Buscar laboratorio..."
                emptyOptionLabel="Todos"
                emptyOptionValue="TODOS"
              />
              <button
                type="button"
                className="btn-prod-outline prod-lab-gestionar-btn"
                onClick={() => setShowModalGestionarLabs(true)}
              ><UiIcon name="Settings" size={15} /> Gestionar Laboratorios
              </button>
            </div>
          </div>
          <div className="prod-campo-filtro">
            <label>Dpto / Categoría</label>
            <select className="prod-select" value={dptoFiltro} onChange={e => { setDptoFiltro(e.target.value); setPaginaActual(1); }}>
              <option value="TODOS">Todos</option>
              {diccionarios.familias.map(f => <option key={f.idfamilia} value={f.idfamilia}>{f.nombre}</option>)}
            </select>
          </div>
          <div className="prod-campo-filtro">
            <label>Principio Activo</label>
            <div className="prod-search-box"><span><UiIcon name="FlaskConical" size={16} /></span><input type="text" placeholder="Buscar..." value={principioActivoInput} onChange={e => setPrincipioActivoInput(e.target.value)} /></div>
          </div>
        </div>

        <div className="prod-filtros-avanzados-toggle-row">
          <button
            type="button"
            className={`prod-mas-filtros-btn${filtrosAvanzadosAbiertos ? ' is-open' : ''}${filtrosAvanzadosActivos > 0 ? ' has-active' : ''}`}
            onClick={() => setFiltrosAvanzadosAbiertos((v) => !v)}
          >
            Más filtros {filtrosAvanzadosAbiertos ? <UiIcon name="ChevronUp" size={14} /> : <UiIcon name="ChevronDown" size={14} />}
            {filtrosAvanzadosActivos > 0 && (
              <span className="prod-mas-filtros-badge">{filtrosAvanzadosActivos}</span>
            )}
          </button>
        </div>

        {filtrosAvanzadosAbiertos && (
          <div className="prod-filtros-avanzados">
            <div className="prod-filtros-fila">
              <div className="prod-campo-filtro">
                <label>Ubicación</label>
                <select className="prod-select" value={ubicacionFiltro} onChange={e => { setUbicacionFiltro(e.target.value); setPaginaActual(1); }}>
                  <option value="TODAS">Todas</option>
                  {ubicacionesDistintas.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div className="prod-campo-filtro">
                <label>Inafecto</label>
                <select className="prod-select" value={inafectoFiltro} onChange={e => { setInafectoFiltro(e.target.value); setPaginaActual(1); }}>
                  <option value="TODOS">Todos</option>
                  <option value="SI">Sí</option>
                  <option value="NO">No</option>
                </select>
              </div>
              <div className="prod-campo-filtro">
                <label>Rec. médica</label>
                <select className="prod-select" value={recetaFiltro} onChange={e => { setRecetaFiltro(e.target.value); setPaginaActual(1); }}>
                  <option value="TODOS">Todos</option>
                  <option value="SI">Sí</option>
                  <option value="NO">No</option>
                </select>
              </div>
              <div className="prod-campo-filtro">
                <label>Estado</label>
                <select className="prod-select" value={estadoFiltro} onChange={e => { setEstadoFiltro(e.target.value); setPaginaActual(1); }}>
                  <option value="ACTIVOS">Activos</option>
                  <option value="INACTIVOS">Inactivos</option>
                  <option value="TODOS">Todos</option>
                </select>
              </div>
              <div className="prod-campo-filtro">
                <label>Fecha de registro — Desde</label>
                <SmartDateInput value={fechaDesde} onChange={v => { setFechaDesde(v); setPaginaActual(1); }} />
              </div>
              <div className="prod-campo-filtro">
                <label>Fecha de registro — Hasta</label>
                <SmartDateInput value={fechaHasta} onChange={v => { setFechaHasta(v); setPaginaActual(1); }} />
              </div>
            </div>
          </div>
        )}

        <div className="prod-filtros-fila prod-filtros-fila-final">
          <div className="prod-columnas-dropdown" ref={columnasPopoverRef}>
            <button
              type="button"
              className={`prod-columnas-trigger${columnasPopoverAbierto ? ' is-open' : ''}`}
              onClick={() => setColumnasPopoverAbierto((v) => !v)}
            >
              Columnas
              {columnasOpcionalesActivas > 0 && (
                <span className="prod-columnas-count">{columnasOpcionalesActivas}</span>
              )}
              <span className="prod-columnas-chevron">{columnasPopoverAbierto ? <UiIcon name="ChevronUp" size={14} /> : <UiIcon name="ChevronDown" size={14} />}</span>
            </button>
            {columnasPopoverAbierto && (
              <div className="prod-columnas-menu" role="menu">
                <p className="prod-columnas-menu-title">Columnas visibles</p>
                {[
                  { key: 'dpto', label: 'Dpto' },
                  { key: 'principioActivo', label: 'Principio Activo' },
                  { key: 'presentacion', label: 'Presentac' },
                  { key: 'dolencia', label: 'Dolencia' },
                  { key: 'codigoI', label: 'Código I.' },
                ].map((col) => (
                  <label key={col.key} className={`prod-columnas-option${columnasVisibles[col.key] ? ' is-on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={columnasVisibles[col.key]}
                      onChange={() => toggleColumna(col.key)}
                    />
                    <span>{col.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="prod-pills-group" role="group" aria-label="Filtros rápidos de stock">
            <button
              type="button"
              className={`prod-pill${soloRotar ? ' is-active' : ''}`}
              onClick={() => { setSoloRotar((v) => !v); setPaginaActual(1); }}
            >
              Rotar
            </button>
            <button
              type="button"
              className={`prod-pill${stockFiltro === 'TODOS' ? ' is-active dark' : ''}`}
              onClick={() => { setStockFiltro('TODOS'); setPaginaActual(1); }}
            >
              Todos
            </button>
            <button
              type="button"
              className={`prod-pill${stockFiltro === 'CON_STOCK' ? ' is-active green' : ''}`}
              onClick={() => { setStockFiltro('CON_STOCK'); setPaginaActual(1); }}
            >
              Con Stock
            </button>
            <button
              type="button"
              className={`prod-pill${stockFiltro === 'SIN_STOCK' ? ' is-active red' : ''}`}
              onClick={() => { setStockFiltro('SIN_STOCK'); setPaginaActual(1); }}
            >
              Sin Stock
            </button>
          </div>

          <button type="button" className="btn-prod-buscar" onClick={handleBuscarManual}><UiIcon name="Search" size={15} /> Buscar</button>
        </div>
      </div>
      </div>

      <div className="prod-table-container" style={{ position: 'relative' }}>
        {cargandoTabla && (
          <div className="prod-table-loading-overlay">
            <LogoCargando texto="Cargando..." />
          </div>
        )}
        <div className="prod-table-scroll">
          <table className="prod-table">
            <thead>
              <tr>
                <th className="col-select text-center">
                  <input
                    type="checkbox"
                    checked={productos.length > 0 && productos.every(p => seleccionados.has(p.id_producto))}
                    onChange={() => setSeleccionados(prev => {
                      const todosMarcados = productos.length > 0 && productos.every(p => prev.has(p.id_producto));
                      if (todosMarcados) return new Set();
                      const next = new Set(prev);
                      productos.forEach(p => next.add(p.id_producto));
                      return next;
                    })}
                    title="Seleccionar todos los de esta página"
                  />
                </th>
                <th className="col-codigo">CÓDIGO</th>
                <th className="col-producto">PRODUCTO</th>
                {columnasVisibles.dpto && <th className="col-dpto">DPTO</th>}
                {columnasVisibles.principioActivo && <th className="col-principio-activo">PRINCIPIO ACTIVO</th>}
                {columnasVisibles.presentacion && <th className="col-presentacion">PRESENTAC</th>}
                <th className="col-laboratorio">LABORATORIO</th>
                {columnasVisibles.dolencia && <th className="col-dolencia">DOLENCIA</th>}
                {columnasVisibles.codigoI && <th className="col-codigo-i">CÓDIGO I.</th>}
                <th className="col-stock text-center">STOCK</th>
                <th className="col-stock-minimo text-center">STOCK MÍNIMO</th>
                <th className="col-activo text-center">ACTIVO</th>
              </tr>
            </thead>
            <tbody>
              {productos.length === 0 && !cargandoTabla ? (
                <tr><td colSpan={totalColumnas} className="empty-prod">No se encontraron productos con estos filtros.</td></tr>
              ) : (
                productos.map(p => (
                  <tr
                    key={p.id_producto}
                    className={productoSeleccionado?.id_producto === p.id_producto ? 'prod-row-selected' : ''}
                    onClick={() => setProductoSeleccionado(p)}
                  >
                    <td className="col-select text-center" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={seleccionados.has(p.id_producto)} onChange={() => toggleSeleccion(p.id_producto)} />
                    </td>
                    <td className="col-codigo text-muted prod-td-truncate" title={p.codigo_barras || ''}>{p.codigo_barras || '---'}</td>
                    <td className="col-producto prod-td-truncate" title={p.descripcion}><strong className="text-dark">{p.descripcion}</strong></td>
                    {columnasVisibles.dpto && <td className="col-dpto prod-td-truncate" title={p.nombreDpto}>{p.nombreDpto}</td>}
                    {columnasVisibles.principioActivo && <td className="col-principio-activo prod-td-truncate" title={p.principio_activo || ''}>{p.principio_activo || '---'}</td>}
                    {columnasVisibles.presentacion && <td className="col-presentacion prod-td-truncate" title={p.nombrePresentacion}>{p.nombrePresentacion}</td>}
                    <td className="col-laboratorio prod-td-truncate" title={p.nombreLaboratorio}>{p.nombreLaboratorio}</td>
                    {columnasVisibles.dolencia && <td className="col-dolencia prod-td-truncate" title={p.dolencias || ''}>{p.dolencias || '---'}</td>}
                    {columnasVisibles.codigoI && <td className="col-codigo-i prod-td-truncate" title={p.cod_digemid || ''}>{p.cod_digemid || '---'}</td>}
                    <td className="col-stock text-center font-bold">{p.stockTotal}</td>
                    <td className="col-stock-minimo text-center text-muted">{p.stock_minimo || 0}</td>
                    <td className="col-activo text-center">
                      <span className={`prod-badge-activo${esActivo(p) ? ' is-on' : ' is-off'}`}>
                        {esActivo(p) ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="prod-pagination">
          <span className="text-muted">Mostrando <strong>{productos.length === 0 ? 0 : indexOfFirst} - {indexOfLast}</strong> de <strong>{totalProductos.toLocaleString()}</strong></span>
          <div className="page-controls">
            <button disabled={paginaActual === 1} onClick={() => setPaginaActual(1)}>«</button>
            <button disabled={paginaActual === 1} onClick={() => setPaginaActual(p => p - 1)}>‹</button>
            {getPageNumbers().map(num => <button key={num} className={paginaActual === num ? 'active' : ''} onClick={() => setPaginaActual(num)}>{num}</button>)}
            <button disabled={paginaActual === totalPaginas || totalPaginas === 0} onClick={() => setPaginaActual(p => p + 1)}>›</button>
            <button disabled={paginaActual === totalPaginas || totalPaginas === 0} onClick={() => setPaginaActual(totalPaginas)}>»</button>
          </div>
          <div className="page-rows">
            <span className="text-muted">Filas por pág: </span>
            <select value={filasPorPagina} onChange={e => { setFilasPorPagina(Number(e.target.value)); setPaginaActual(1); }}>
              <option value={12}>12</option><option value={24}>24</option><option value={50}>50</option><option value={100}>100</option>
            </select>
          </div>
        </div>
      </div>

      {/* FASE B/C — Detalle del producto seleccionado, ahora como drawer lateral (no
          empuja el contenido de la página hacia abajo) — la tabla principal sigue
          visible e interactiva detrás. Cada sección tiene su propio scroll interno
          (.prod-detalle-section-scroll) para que ninguna crezca sin límite (el caso real
          que forzaba esto: "Proveedores de este producto" trae el historial COMPLETO de
          compras, sin .limit()). Solo visible después de elegir una fila Y pulsar
          "Ver Detalle" (no automático al clic de la fila, para no disparar 4 consultas
          extra en cada selección). */}
      {mostrarDetalle && productoSeleccionado && (
        <div className="prod-drawer">
          <div className="prod-drawer-header">
            <h3><UiIcon name="ClipboardList" size={15} /> Detalle — {productoSeleccionado.descripcion}</h3>
            <button type="button" onClick={cerrarDrawerDetalle}><UiIcon name="X" size={16} /></button>
          </div>
          <div className="prod-drawer-body">
            {cargandoDetalle ? (
              <div className="prod-detalle-cargando"><LogoCargando texto="Cargando detalle..." /></div>
            ) : (
              <>
                <div className="prod-detalle-section">
                  <h3><UiIcon name="Wallet" size={15} /> Detalle de Precios</h3>
                  <div className="prod-detalle-section-scroll">
                    <table className="prod-table">
                      <thead>
                        <tr>
                          <th>COSTO</th>
                          <th>PRECIO VENTA</th>
                          {Number(detallePrecios?.precio_caja) > 0 && <th>PRECIO CAJA</th>}
                          <th>GANANCIA</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>{formatSolesUnitario(detallePrecios?.costo || 0)}</td>
                          <td className="font-bold">{formatSolesUnitario(detallePrecios?.precio_venta || 0)}</td>
                          {Number(detallePrecios?.precio_caja) > 0 && <td>{formatSolesUnitario(detallePrecios.precio_caja)}</td>}
                          <td className="text-green">{formatSolesUnitario(detallePrecios?.ganancia || 0)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="prod-detalle-section">
                  <div className="prod-detalle-section-header">
                    <h3><UiIcon name="RefreshCw" size={15} /> Productos Similares</h3>
                    <button type="button" className="btn-prod-outline" onClick={() => setModalSimilarAbierto(true)}>+ Agregar Similar</button>
                  </div>
                  <div className="prod-detalle-section-scroll">
                    <table className="prod-table">
                      <thead>
                        <tr>
                          <th>CÓDIGO</th><th>PRODUCTO</th><th>LABORATORIO</th><th>PRESENTACIÓN</th>
                          <th className="text-center">STOCK</th><th className="text-center">STOCK MÍNIMO</th>
                          <th className="text-center">P.COSTO</th><th className="text-center">ACCIÓN</th>
                        </tr>
                      </thead>
                      <tbody>
                        {productosSimilares.length === 0 ? (
                          <tr><td colSpan="8" className="empty-prod">Sin productos similares agregados.</td></tr>
                        ) : (
                          productosSimilares.map(p => (
                            <tr key={p.id_relacion}>
                              <td className="text-muted">{p.codigo_barras || '---'}</td>
                              <td><strong className="text-dark">{p.descripcion}</strong></td>
                              <td>{p.nombreLaboratorio}</td>
                              <td>{p.nombrePresentacion}</td>
                              <td className="text-center font-bold">{p.stockTotal}</td>
                              <td className="text-center text-muted">{p.stock_minimo}</td>
                              <td className="text-center text-muted">{formatSolesUnitario(p.costo)}</td>
                              <td className="text-center">
                                <button type="button" className="btn-prod-eliminar-fila" onClick={() => eliminarRelacionado(p.id_relacion, 'SIMILAR')}><UiIcon name="Trash2" size={16} /></button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="prod-detalle-section">
                  <div className="prod-detalle-section-header">
                    <h3><UiIcon name="Plus" size={15} /> Productos Complementarios</h3>
                    <button type="button" className="btn-prod-outline" onClick={() => setModalComplementoAbierto(true)}>+ Agregar Complemento</button>
                  </div>
                  <div className="prod-detalle-section-scroll">
                    <table className="prod-table">
                      <thead>
                        <tr>
                          <th>CÓDIGO</th><th>PRODUCTO</th><th>LABORATORIO</th><th>PRESENTACIÓN</th>
                          <th className="text-center">STOCK</th><th className="text-center">STOCK MÍNIMO</th>
                          <th className="text-center">P.COSTO</th><th className="text-center">ACCIÓN</th>
                        </tr>
                      </thead>
                      <tbody>
                        {productosComplementarios.length === 0 ? (
                          <tr><td colSpan="8" className="empty-prod">Sin productos complementarios agregados.</td></tr>
                        ) : (
                          productosComplementarios.map(p => (
                            <tr key={p.id_relacion}>
                              <td className="text-muted">{p.codigo_barras || '---'}</td>
                              <td><strong className="text-dark">{p.descripcion}</strong></td>
                              <td>{p.nombreLaboratorio}</td>
                              <td>{p.nombrePresentacion}</td>
                              <td className="text-center font-bold">{p.stockTotal}</td>
                              <td className="text-center text-muted">{p.stock_minimo}</td>
                              <td className="text-center text-muted">{formatSolesUnitario(p.costo)}</td>
                              <td className="text-center">
                                <button type="button" className="btn-prod-eliminar-fila" onClick={() => eliminarRelacionado(p.id_relacion, 'COMPLEMENTARIO')}><UiIcon name="Trash2" size={16} /></button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Fase C punto 3 "Consulta Precios Productos Proveedores" — historial
                    completo (sin límite) de a quién y a qué precio se le compró este
                    producto — es justo la sección que podía crecer sin límite antes;
                    ahora acotada por .prod-detalle-section-scroll como las demás. */}
                <div className="prod-detalle-section">
                  <h3><UiIcon name="Building2" size={15} /> Proveedores de este producto</h3>
                  <div className="prod-detalle-section-scroll">
                    <table className="prod-table">
                      <thead>
                        <tr><th>PROVEEDOR</th><th>FECHA</th><th>N° DOC.</th><th className="text-center">CANT.</th><th className="text-center">P.UNIT</th><th className="text-center">SUBTOTAL</th></tr>
                      </thead>
                      <tbody>
                        {historialProveedoresProducto.length === 0 ? (
                          <tr><td colSpan="6" className="empty-prod">Sin compras registradas a ningún proveedor.</td></tr>
                        ) : (
                          historialProveedoresProducto.map((h, i) => (
                            <tr key={i}>
                              <td><strong className="text-dark">{h.compras?.proveedores?.razon_social || '---'}</strong></td>
                              <td>{h.compras?.fecha_compra ? new Date(h.compras.fecha_compra).toLocaleDateString('es-PE') : '---'}</td>
                              <td className="text-muted">{h.compras?.nro_documento || '---'}</td>
                              <td className="text-center">{h.cantidad}</td>
                              <td className="text-center">{formatSolesUnitario(h.costo_unitario)}</td>
                              <td className="text-center font-bold">S/ {Number(h.subtotal).toFixed(2)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <ModalBuscarRelacionado
        visible={modalSimilarAbierto}
        tipo="SIMILAR"
        idProductoBase={productoSeleccionado?.id_producto}
        idsYaRelacionados={productosSimilares.map(p => p.id_producto)}
        onAgregado={cargarDetalleProducto}
        onClose={() => setModalSimilarAbierto(false)}
        mostrarAlerta={mostrarAlerta}
      />
      <ModalBuscarRelacionado
        visible={modalComplementoAbierto}
        tipo="COMPLEMENTARIO"
        idProductoBase={productoSeleccionado?.id_producto}
        idsYaRelacionados={productosComplementarios.map(p => p.id_producto)}
        onAgregado={cargarDetalleProducto}
        onClose={() => setModalComplementoAbierto(false)}
        mostrarAlerta={mostrarAlerta}
      />
      <ModalPrecioProveedores
        visible={modalPrecioProveedoresAbierto}
        onClose={() => setModalPrecioProveedoresAbierto(false)}
      />
      <ModalGestionarLaboratorios
        visible={showModalGestionarLabs}
        onClose={() => setShowModalGestionarLabs(false)}
        mostrarAlerta={mostrarAlerta}
        onCambio={() => { recargarCatalogoLaboratorios(); cargarPagina(); }}
      />
    </div>
  );
}
