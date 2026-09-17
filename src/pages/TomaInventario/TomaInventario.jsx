import { useState, useEffect, useRef } from 'react';
import AlertaSistemaModal from '../../components/AlertaSistemaModal';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../context/AuthContext';
import SmartDateInput from '../../components/SmartDateInput';
import { aplicarAjusteInventario, cerrarSesionInventario } from '../../utils/inventarioAjustes';
import { cargarKardexReciente, calcularMensajeConteo } from '../../utils/mensajeConteo';
import { filaProductoPrecios } from '../../utils/productoPrecios';
import { formatSolesUnitario } from '../../utils/precioExacto';
import { fetchLaboratorios, suscribirLaboratoriosChanged } from '../../utils/laboratoriosCatalogo';
import { esAdmin as rolEsAdmin } from '../../utils/roles';
import SearchableSelect from '../../components/SearchableSelect';
import LogoCargandoOverlay from '../../components/LogoCargandoOverlay';
import './TomaInventario.css';
import UiIcon from '../../components/UiIcon';

/** Historial aplicado: agrupa por laboratorio → sesiones (fecha). */
function agruparHistorialPorLaboratorio(conteos) {
  const labs = new Map();
  for (const c of conteos) {
    const idLab = c.productos?.id_laboratorio ?? 0;
    const nombreLab = c.productos?.laboratorios?.nombre || 'Sin laboratorio';
    if (!labs.has(idLab)) {
      labs.set(idLab, { idLab, nombreLab, total: 0, sesiones: new Map() });
    }
    const lab = labs.get(idLab);
    lab.total += 1;
    const idSesion = c.id_sesion ?? `c-${c.id_conteo}`;
    if (!lab.sesiones.has(idSesion)) {
      lab.sesiones.set(idSesion, {
        idSesion,
        fecha: c.inventario_sesiones?.fecha_apertura || c.created_at,
        estado: c.inventario_sesiones?.estado,
        sucursal: c.inventario_sesiones?.sucursales?.nombre_comercial,
        conteos: [],
      });
    }
    lab.sesiones.get(idSesion).conteos.push(c);
  }
  return Array.from(labs.values())
    .map((lab) => ({
      ...lab,
      sesiones: Array.from(lab.sesiones.values()).sort(
        (a, b) => new Date(b.fecha) - new Date(a.fecha)
      ),
    }))
    .sort((a, b) => a.nombreLab.localeCompare(b.nombreLab, 'es', { sensitivity: 'base' }));
}

// Tabla de conteo por laboratorio — agrega Principio Activo y Requiere Receta (columnas
// confirmadas en la BD real). Filas sin "Físico" lleno se resaltan en rojo.
// Flujo de teclado: escribir cantidad → Enter guarda ESA fila y salta al Físico del
// siguiente producto (mismo patrón POS). Ya no hay auto-guardado al tipear (debounce).
function TablaConteoProductos({ productos, guardandoFilas, kardexRecienteMap, onCampoChange, onGuardarFila, onEnterUltimaFila }) {
  // Un ref por fila (indexado por posición) para poder saltar al siguiente campo Físico
  // con Enter, sin depender de ids que cambian entre renders.
  const fisicoInputRefs = useRef([]);
  // Si un re-render (guardar / crear sesión) remonta la tabla, reaplicamos el foco aquí.
  const pendingFocusIndexRef = useRef(null);

  useEffect(() => {
    const idx = pendingFocusIndexRef.current;
    if (idx == null) return;
    const el = fisicoInputRefs.current[idx];
    if (!el || el.disabled) return;
    el.focus();
    try { el.select(); } catch { /* ignore */ }
    pendingFocusIndexRef.current = null;
  }, [productos, guardandoFilas]);

  const enfocarFisico = (index) => {
    if (index == null || index < 0) {
      pendingFocusIndexRef.current = null;
      onEnterUltimaFila?.();
      return;
    }
    pendingFocusIndexRef.current = index;
    const el = fisicoInputRefs.current[index];
    if (el && !el.disabled) {
      el.focus();
      try { el.select(); } catch { /* ignore */ }
      // Si el foco pegó, limpiamos; si no (remount inminente), el useEffect lo reintenta.
      if (document.activeElement === el) pendingFocusIndexRef.current = null;
    }
  };

  const handleCambioFisico = (producto, valor) => {
    onCampoChange(producto.id_producto, 'cantidadFisica', valor);
  };

  const handleEnterFisico = (e, producto, index) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    e.stopPropagation();
    // Evita que el Enter global de MainLayout también mueva el foco (compite con este
    // flujo y puede aterrizar en el × del SearchableSelect / vaciar el laboratorio).
    e.nativeEvent?.stopImmediatePropagation?.();
    // Leer el valor del input (el state del padre puede ir un tick atrasado).
    const valor = e.currentTarget.value;
    onCampoChange(producto.id_producto, 'cantidadFisica', valor);

    // Enfocar SIGUIENTE ya (síncrono), antes del save async que puede re-renderizar.
    const haySiguiente = index + 1 < productos.length;
    if (haySiguiente) enfocarFisico(index + 1);
    else enfocarFisico(-1);

    if (valor !== '') {
      onGuardarFila({ ...producto, cantidadFisica: valor });
    }
  };

  // Blur: guarda solo si hay valor (seguridad al salir del campo con Tab/clic),
  // sin el auto-envío al tipear que antes confundía el flujo.
  const handleBlurFisico = (producto, valor) => {
    if (valor === '' || valor == null) return;
    onGuardarFila({ ...producto, cantidadFisica: valor });
  };

  return (
    <div className="ti-v-table-scroll">
      <table className="ti-v-table ti-v-table-densa">
        <thead>
          <tr>
            <th>PRODUCTO</th>
            <th>PRINCIPIO ACTIVO</th>
            <th className="text-center">RECETA</th>
            <th className="text-center">STOCK EN SISTEMA</th>
            <th className="text-center">FÍSICO</th>
            <th className="text-center">DIFERENCIA</th>
            <th>LOTE / F.VENCE</th>
            <th>PRECIO</th>
            <th>MENSAJE</th>
          </tr>
        </thead>
        <tbody>
          {productos.map((p, index) => {
            const fisicaNum = parseInt(p.cantidadFisica);
            const tieneValor = p.cantidadFisica !== '' && !isNaN(fisicaNum);
            const diferencia = tieneValor ? fisicaNum - (p.stock_sistema || 0) : null;
            const infoMensaje = tieneValor ? calcularMensajeConteo(diferencia, p.id_producto, kardexRecienteMap) : null;
            const disabledFila = !!guardandoFilas[p.id_producto];
            return (
              <tr key={p.id_producto} className={!tieneValor ? 'ti-v-fila-sin-fisico' : ''}>
                <td>
                  <strong>{p.descripcion}</strong>
                  <br /><small>Cód: {p.codigo_barras || 'Sin código'}</small>
                </td>
                <td className="ti-v-td-principio-activo">
                  <small title={p.principio_activo || ''}>{p.principio_activo || '—'}</small>
                </td>
                <td className="text-center">
                  <span
                    className={`mini-flag ti-v-flag-receta ${p.requiere_receta ? 'on' : ''}`}
                    title={p.requiere_receta ? 'Requiere receta médica' : 'No requiere receta'}
                  >
                    {p.requiere_receta ? '℞' : '—'}
                  </span>
                </td>
                <td className="text-center">{p.stock_sistema}</td>
                <td className="text-center">
                  <input
                    ref={el => { fisicoInputRefs.current[index] = el; }}
                    type="number"
                    min="0"
                    placeholder="0"
                    className="ti-v-input-fisico-fila"
                    data-enter-skip="true"
                    value={p.cantidadFisica}
                    disabled={disabledFila}
                    onChange={e => handleCambioFisico(p, e.target.value)}
                    onKeyDown={e => handleEnterFisico(e, p, index)}
                    onBlur={e => handleBlurFisico(p, e.currentTarget.value)}
                  />
                </td>
                <td className="text-center">
                  {tieneValor ? (
                    <span className={`dif-badge-v ${diferencia > 0 ? 'pos' : diferencia < 0 ? 'neg' : 'ok'}`}>
                      {diferencia > 0 ? '+' : ''}{diferencia}
                    </span>
                  ) : '—'}
                </td>
                <td>
                  <div className="ti-v-lote-vence-stack">
                    <input
                      type="text"
                      placeholder="Lote (opcional)"
                      className="ti-v-input-lote-fila"
                      value={p.nroLoteConteo}
                      disabled={disabledFila}
                      onChange={e => onCampoChange(p.id_producto, 'nroLoteConteo', e.target.value)}
                      onBlur={() => onGuardarFila(p)}
                    />
                    <SmartDateInput
                      value={p.fechaVencimientoConteo}
                      readOnly={disabledFila}
                      onChange={val => {
                        onCampoChange(p.id_producto, 'fechaVencimientoConteo', val);
                        if (val) onGuardarFila(p, { fecha_vencimiento_conteo: val });
                      }}
                    />
                  </div>
                </td>
                <td>
                  <small className="ti-v-precio-tipo">Venta</small>
                  <br />{formatSolesUnitario(p.precio_venta)}
                </td>
                <td>
                  {infoMensaje ? (
                    <span className={`ti-v-msj-conteo ${infoMensaje.alerta ? 'alerta' : ''}`}>
                      {infoMensaje.alerta ? '' : ''}{infoMensaje.texto}
                    </span>
                  ) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Filtro laboratorio/texto en sessionStorage por usuario. No se acopla a la sesión
// de inventario (crearla al 1er Enter no debe resetear el lab). Logout limpia la clave.
const FILTRO_STORAGE_KEY = 'ti_v_filtro_conteo';
function leerFiltroGuardado() {
  try {
    const raw = sessionStorage.getItem(FILTRO_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function limpiarFiltroGuardado() {
  try { sessionStorage.removeItem(FILTRO_STORAGE_KEY); } catch { /* ignore */ }
}

export default function TomaInventario() {
  const { user } = useAuth();

  const [sesionActiva, setSesionActiva] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [mensaje, setMensaje] = useState(null);
  const [conteosHoy, setConteosHoy] = useState([]);
  const sesionRef = useRef(null); // ← para acceder en el callback de Realtime

  // ── Modal de confirmación con estilo (reemplaza window.confirm) — mismo patrón
  // que AdminTomaInventario.jsx ──
  const [alertaSistema, setAlertaSistema] = useState(null);
  const alertOkBtnRef = useRef(null);
  useEffect(() => {
    if (alertaSistema && alertOkBtnRef.current) alertOkBtnRef.current.focus();
  }, [alertaSistema]);

  // ── Conteo por laboratorio — filtro se hidrata UNA vez por usuario; el persist
  // no corre hasta hidratar (evita pisar el lab con '' al montar / Strict Mode).
  const [laboratorios, setLaboratorios] = useState([]);
  const [laboratorioSeleccionado, setLaboratorioSeleccionado] = useState('');
  const [productosLaboratorio, setProductosLaboratorio] = useState([]);
  const [cargandoLaboratorio, setCargandoLaboratorio] = useState(false);
  const [filtroNombreLaboratorio, setFiltroNombreLaboratorio] = useState('');
  const [guardandoFilas, setGuardandoFilas] = useState({}); // { [id_producto]: true }
  // Tabla de conteo solo visible con sesión ABIERTA o tras "Iniciar conteo" explícito.
  // Evita que, al cerrar, un refetch deje Físico vacío y diferencias falsas (-stock).
  const [tablaConteoActiva, setTablaConteoActiva] = useState(false);
  const debounceLaboratorioRef = useRef(null);
  const aplicarCambiosBtnRef = useRef(null);
  // Intent del usuario (lab elegido). Fuente de verdad frente a re-renders/refetch.
  const laboratorioFiltroRef = useRef('');
  const filtroHidratadoRef = useRef(false);

  const elegirLaboratorio = (valor) => {
    const next = valor == null || valor === '' ? '' : String(valor);
    laboratorioFiltroRef.current = next;
    setLaboratorioSeleccionado(next);
  };

  // Solo hidrata/limpia al cambiar de usuario — NUNCA al crear sesionActiva.
  useEffect(() => {
    if (!user?.id_usuario) {
      filtroHidratadoRef.current = false;
      laboratorioFiltroRef.current = '';
      setLaboratorioSeleccionado('');
      setFiltroNombreLaboratorio('');
      setProductosLaboratorio([]);
      limpiarFiltroGuardado();
      return;
    }
    const saved = leerFiltroGuardado();
    if (saved && Number(saved.idUsuario) === Number(user.id_usuario)) {
      const lab = saved.laboratorioSeleccionado != null && saved.laboratorioSeleccionado !== ''
        ? String(saved.laboratorioSeleccionado)
        : '';
      laboratorioFiltroRef.current = lab;
      setLaboratorioSeleccionado(lab);
      setFiltroNombreLaboratorio(saved.filtroNombreLaboratorio || '');
    } else {
      laboratorioFiltroRef.current = '';
      setLaboratorioSeleccionado('');
      setFiltroNombreLaboratorio('');
      limpiarFiltroGuardado();
    }
    filtroHidratadoRef.current = true;
  }, [user?.id_usuario]);

  // Persiste solo después de hidratar; escribe siempre el ref (intent real del usuario).
  useEffect(() => {
    if (!user?.id_usuario || !filtroHidratadoRef.current) return;
    const lab = laboratorioFiltroRef.current || laboratorioSeleccionado || '';
    try {
      sessionStorage.setItem(FILTRO_STORAGE_KEY, JSON.stringify({
        idUsuario: user.id_usuario,
        laboratorioSeleccionado: lab,
        filtroNombreLaboratorio,
      }));
    } catch {
      // sessionStorage no disponible (ej. navegación privada) — no bloquea el flujo.
    }
  }, [laboratorioSeleccionado, filtroNombreLaboratorio, user?.id_usuario]);

  // ── Aprobación automática: aplica el ajuste de stock directamente, sin pasar por
  // revisión del Admin (ver src/utils/inventarioAjustes.js) ──
  const esAdmin = rolEsAdmin(user?.id_rol);
  const [aplicandoCambios, setAplicandoCambios] = useState(false);
  const [overlayAplicar, setOverlayAplicar] = useState(null); // { mensaje, exito }
  const [borrandoTodos, setBorrandoTodos] = useState(false);

  // Nombre del Admin para el mensaje de "Sin sesión activa" del Vendedor — solo se
  // consulta si hace falta (Admin no necesita este dato para su propio mensaje).
  const [nombreAdmin, setNombreAdmin] = useState(null);
  useEffect(() => {
    if (esAdmin) return;
    supabase.from('usuarios').select('nombres, apellidos, activo').eq('id_rol', 2).then(({ data }) => {
      const admins = (data || []).filter(u => String(u.activo) === '1' || u.activo === true);
      if (admins.length === 1) setNombreAdmin(`${admins[0].nombres} ${admins[0].apellidos}`);
    });
  }, [esAdmin]);

  const mostrarMensaje = (texto, tipo = 'success') => {
    setMensaje({ texto, tipo });
    setTimeout(() => setMensaje(null), 3000);
  };

  const mostrarAlerta = (mensajeTexto, tipo = 'info', accionConfirmar = null, textoConfirmar = 'Aceptar', accionCancelar = null, textoCancelar = null) => {
    setAlertaSistema({ mensaje: mensajeTexto, tipo, accionConfirmar, textoConfirmar, accionCancelar, textoCancelar });
  };

  const resetUISinSesion = () => {
    setSesionActiva(null);
    sesionRef.current = null;
    setConteosHoy([]);
    setProductosLaboratorio([]);
    setTablaConteoActiva(false);
    setGuardandoFilas({});
  };

  const cargarSesion = async () => {
    try {
      if (!user?.id_sucursal) {
        resetUISinSesion();
        return;
      }

      const { data, error } = await supabase
        .from('inventario_sesiones')
        .select('*, sucursales(nombre_comercial)')
        .eq('estado', 'ABIERTA')
        .eq('id_sucursal', user.id_sucursal)
        .limit(1);

      if (error) throw error;

      const sesion = data && data.length > 0 ? data[0] : null;
      if (sesion) {
        setSesionActiva(sesion);
        sesionRef.current = sesion;
        setTablaConteoActiva(true);
        cargarConteosHoy(sesion.id_sesion);
      } else {
        // Sin sesión ABIERTA: no dejar tabla fantasma con Físico vacío.
        resetUISinSesion();
      }
    } catch (err) {
      console.error('Error cargando sesión:', err);
      resetUISinSesion();
    } finally {
      setCargando(false);
    }
  };

  // Crea (o recupera, si otra pestaña/petición ganó la carrera del índice único parcial
  // en inventario_sesiones) la sesión ABIERTA de la sucursal del Admin, solo en el
  // momento en que realmente va a guardar su primer conteo — nunca al solo entrar/montar.
  const obtenerOcrearSesion = async () => {
    if (sesionActiva) return sesionActiva;
    if (!esAdmin || !user?.id_sucursal) return null;

    const { data: nueva, error: errorInsert } = await supabase
      .from('inventario_sesiones')
      .insert({ id_sucursal: user.id_sucursal, id_usuario_admin: user.id_usuario, estado: 'ABIERTA' })
      .select('*, sucursales(nombre_comercial)')
      .single();

    let sesion = null;
    if (errorInsert?.code === '23505') {
      const { data: existenteAhora } = await supabase
        .from('inventario_sesiones')
        .select('*, sucursales(nombre_comercial)')
        .eq('estado', 'ABIERTA')
        .eq('id_sucursal', user.id_sucursal)
        .limit(1);
      sesion = existenteAhora && existenteAhora.length > 0 ? existenteAhora[0] : null;
    } else if (!errorInsert) {
      sesion = nueva || null;
    }

    if (sesion) {
      setSesionActiva(sesion);
      sesionRef.current = sesion;
      setTablaConteoActiva(true);
      // Reafirmar filtro: crear sesión no debe dejar el selector en "Todos".
      const labIntent = laboratorioFiltroRef.current;
      if (labIntent) setLaboratorioSeleccionado(labIntent);
    }
    return sesion;
  };

  const cargarConteosHoy = async (idSesion) => {
    const { data } = await supabase
      .from('inventario_conteos')
      .select('*, productos(descripcion, activo, producto_precios(precio_venta, costo))')
      .eq('id_sesion', idSesion)
      .eq('id_usuario', user.id_usuario)
      .order('created_at', { ascending: false });
    setConteosHoy(data || []);
  };

  // ── Mensaje de conteo enriquecido con Kardex (lógica compartida con
  // AdminTomaInventario.jsx, ver src/utils/mensajeConteo.js) ──
  const [kardexRecienteMap, setKardexRecienteMap] = useState({}); // { [id_producto]: { tieneEntrada, tieneSalida } }
  const debounceKardexLaboratorioRef = useRef(null);
  const debounceKardexConteosRef = useRef(null);

  // Batch solo para las filas con Físico ya ingresado, debounced igual que
  // cargarProductosLaboratorio.
  useEffect(() => {
    const idSucursalActual = sesionActiva?.id_sucursal || (esAdmin ? user?.id_sucursal : null);
    const idsConDiferencia = productosLaboratorio
      .filter(p => p.cantidadFisica !== '' && !isNaN(parseInt(p.cantidadFisica)))
      .map(p => p.id_producto);
    if (idsConDiferencia.length === 0) return undefined;
    if (debounceKardexLaboratorioRef.current) clearTimeout(debounceKardexLaboratorioRef.current);
    debounceKardexLaboratorioRef.current = setTimeout(() => {
      cargarKardexReciente(idsConDiferencia, idSucursalActual, setKardexRecienteMap);
    }, 400);
    return () => clearTimeout(debounceKardexLaboratorioRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productosLaboratorio, sesionActiva]);

  // "Mis conteos de esta sesión": batch para todos los que ya tienen diferencia.
  useEffect(() => {
    const idSucursalActual = sesionActiva?.id_sucursal || (esAdmin ? user?.id_sucursal : null);
    const ids = conteosHoy.filter(c => c.diferencia !== 0).map(c => c.id_producto);
    if (ids.length === 0 || !idSucursalActual) return undefined;
    if (debounceKardexConteosRef.current) clearTimeout(debounceKardexConteosRef.current);
    debounceKardexConteosRef.current = setTimeout(() => {
      cargarKardexReciente(ids, idSucursalActual, setKardexRecienteMap);
    }, 400);
    return () => clearTimeout(debounceKardexConteosRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conteosHoy, sesionActiva]);

  // Resumen de la sesión en soles — igual criterio que Kardex pero valorizado con el
  // costo ACTUAL del producto (inventario_conteos no guarda el precio del momento del
  // conteo). Si el precio cambió a mitad de sesión, esto usa el precio vigente ahora.
  const resumenSoles = conteosHoy.reduce((acc, c) => {
    const costo = Number(filaProductoPrecios(c.productos?.producto_precios)?.costo) || 0;
    const diferencia = Number(c.diferencia) || 0;
    const valor = diferencia * costo;
    if (diferencia > 0) {
      acc.cantIngresos += 1;
      acc.totalIngresos += valor;
    } else if (diferencia < 0) {
      acc.cantSalidas += 1;
      acc.totalSalidas += valor;
    }
    return acc;
  }, { cantIngresos: 0, totalIngresos: 0, cantSalidas: 0, totalSalidas: 0 });

  useEffect(() => {
    cargarSesion();

    // Realtime en inventario_sesiones → detecta cuando admin abre/cierra
    const canalSesion = supabase
      .channel('vendedor-sesion-watch')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'inventario_sesiones'
      }, () => {
        cargarSesion();
      })
      .subscribe((status) => {
        console.log('Realtime sesiones:', status);
      });

    // Realtime en inventario_conteos → actualiza lista de conteos propios
    const canalConteos = supabase
      .channel('vendedor-conteos-watch')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'inventario_conteos'
      }, () => {
        if (sesionRef.current) cargarConteosHoy(sesionRef.current.id_sesion);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(canalSesion);
      supabase.removeChannel(canalConteos);
    };
  }, []);

  // Catálogo de laboratorios (solo activos en el filtro de conteo) — carga inicial +
  // refresh cuando Gestionar Laboratorios (u otro alta) notifica cambios.
  const esActivoLabLocal = (l) => l.activo === 1 || l.activo === true || String(l.activo) === '1';
  useEffect(() => {
    fetchLaboratorios()
      .then((labs) => setLaboratorios(labs.filter(esActivoLabLocal)))
      .catch(() => setLaboratorios([]));
  }, []);

  useEffect(() => suscribirLaboratoriosChanged(() => {
    fetchLaboratorios()
      .then((labs) => setLaboratorios(labs.filter(esActivoLabLocal)))
      .catch(() => {});
  }), []);

  // Trae productos por laboratorio y/o texto (cualquiera de los dos solo, o ambos
  // combinados) + su stock de sistema (batch) + los conteos ya guardados en esta
  // sesión para precargar el campo Físico
  const cargarProductosLaboratorio = async (idLaboratorio, textoFiltro) => {
    const idSucursalActual = sesionActiva?.id_sucursal || (esAdmin ? user?.id_sucursal : null);
    if (!idSucursalActual || (!idLaboratorio && !textoFiltro)) { setProductosLaboratorio([]); return; }
    setCargandoLaboratorio(true);
    try {
      // Solo activos — un producto desactivado no debe contarse en sesión física.
      let query = supabase
        .from('productos')
        .select('id_producto, descripcion, codigo_barras, principio_activo, requiere_receta, producto_precios(precio_venta, costo)')
        .eq('activo', 1)
        .order('descripcion', { ascending: true })
        .limit(200);
      if (idLaboratorio) query = query.eq('id_laboratorio', idLaboratorio);
      // Antes solo filtraba por descripcion: buscar un código de barras no devolvía nada.
      // Ahora también nombre (descripcion), código y principio activo.
      if (textoFiltro) {
        const t = String(textoFiltro).replace(/[%_,]/g, ' ').replace(/\s+/g, ' ').trim();
        if (t) {
          query = query.or(
            `descripcion.ilike.%${t}%,codigo_barras.ilike.%${t}%,principio_activo.ilike.%${t}%`
          );
        }
      }
      const { data: prods, error: errProds } = await query;
      if (errProds) throw errProds;

      const ids = (prods || []).map(p => p.id_producto);
      if (ids.length === 0) { setProductosLaboratorio([]); return; }

      const [{ data: lotes }, { data: conteosExistentes }] = await Promise.all([
        supabase
          .from('inventario_lotes')
          .select('id_producto, cantidad_actual')
          .in('id_producto', ids)
          .eq('id_sucursal', idSucursalActual)
          .eq('estado', 'VIGENTE'),
        sesionActiva
          ? supabase
              .from('inventario_conteos')
              .select('id_producto, cantidad_fisica, nro_lote_conteo, fecha_vencimiento_conteo')
              .eq('id_sesion', sesionActiva.id_sesion)
              .in('id_producto', ids)
          : Promise.resolve({ data: [] }),
      ]);

      const stockMap = {};
      (lotes || []).forEach(l => {
        stockMap[l.id_producto] = (stockMap[l.id_producto] || 0) + Number(l.cantidad_actual || 0);
      });
      const conteoMap = {};
      (conteosExistentes || []).forEach(c => { conteoMap[c.id_producto] = c; });

      const lista = (prods || []).map(p => {
        const conteoPrevio = conteoMap[p.id_producto];
        return {
          ...p,
          stock_sistema: stockMap[p.id_producto] || 0,
          precio_venta: Number(filaProductoPrecios(p.producto_precios)?.precio_venta) || 0,
          cantidadFisica: conteoPrevio?.cantidad_fisica !== undefined ? String(conteoPrevio.cantidad_fisica) : '',
          nroLoteConteo: conteoPrevio?.nro_lote_conteo || '',
          fechaVencimientoConteo: conteoPrevio?.fecha_vencimiento_conteo || '',
        };
      });
      // A-Z por nombre (es) — refuerza el .order del servidor por si el embed altera el orden.
      lista.sort((a, b) =>
        String(a.descripcion || '').localeCompare(String(b.descripcion || ''), 'es', { sensitivity: 'base' })
      );
      setProductosLaboratorio(lista);
    } catch (error) {
      mostrarMensaje('Error cargando productos del laboratorio: ' + error.message, 'error');
    } finally {
      setCargandoLaboratorio(false);
    }
  };

  useEffect(() => {
    // Sin conteo activo no auto-cargar: tras cerrar sesión el lab sigue en el filtro
    // y un debounce volvería a montar la tabla con Físico vacío.
    if (!tablaConteoActiva) return undefined;
    const labActual = laboratorioFiltroRef.current || laboratorioSeleccionado;
    if (!labActual && filtroNombreLaboratorio.trim().length < 2) {
      setProductosLaboratorio([]);
      return undefined;
    }
    if (debounceLaboratorioRef.current) clearTimeout(debounceLaboratorioRef.current);
    debounceLaboratorioRef.current = setTimeout(() => {
      const lab = laboratorioFiltroRef.current || laboratorioSeleccionado;
      cargarProductosLaboratorio(lab, filtroNombreLaboratorio.trim());
    }, 400);
    return () => clearTimeout(debounceLaboratorioRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laboratorioSeleccionado, filtroNombreLaboratorio, tablaConteoActiva]);

  const iniciarConteoLaboratorio = () => {
    const lab = laboratorioFiltroRef.current || laboratorioSeleccionado;
    const texto = filtroNombreLaboratorio.trim();
    if (!lab && texto.length < 2) {
      mostrarMensaje('Elige un laboratorio o escribe al menos 2 caracteres para iniciar.', 'info');
      return;
    }
    setTablaConteoActiva(true);
    void cargarProductosLaboratorio(lab, texto);
  };

  const actualizarCampoFilaLaboratorio = (idProducto, campo, valor) => {
    setProductosLaboratorio(prev => prev.map(p => p.id_producto === idProducto ? { ...p, [campo]: valor } : p));
  };

  // Lote/F.Vence son opcionales: solo se guardan junto con el conteo si ya hay una
  // cantidad física ingresada (son metadata del conteo, no tiene sentido guardarlos solos).
  const guardarConteoFila = async (producto, extraOverride = {}) => {
    if (producto.cantidadFisica === '') return;
    setGuardandoFilas(prev => ({ ...prev, [producto.id_producto]: true }));
    const resultado = await guardarConteoParaProducto(producto, producto.cantidadFisica, {
      nro_lote_conteo: producto.nroLoteConteo || null,
      fecha_vencimiento_conteo: producto.fechaVencimientoConteo || null,
      ...extraOverride,
    });
    if (resultado.ok) mostrarMensaje('Conteo guardado.');
    setGuardandoFilas(prev => ({ ...prev, [producto.id_producto]: false }));
  };

  // Lógica de guardado compartida: valida y hace upsert en inventario_conteos (insert
  // o update en una sola operación atómica, según la constraint UNIQUE en
  // (id_sesion, id_producto)) — recarga "Mis conteos de esta sesión" al final. Antes
  // hacía un SELECT para decidir entre insert/update por separado, lo cual era una
  // ventana de carrera: dos guardados disparados casi al mismo tiempo para la misma
  // fila (ej. el debounce de Físico y su blur) podían ver ambos "no existe" e insertar
  // cada uno su propia fila, duplicando el conteo.
  // opciones.omitirRefresh: en "Aplicar cambios" (N productos) evita N× cargarConteosHoy
  // + tormenta Realtime que dejaba el overlay colgado antes de cerrar la sesión.
  const guardarConteoParaProducto = async (producto, cantidadFisicaStr, extra = {}, opciones = {}) => {
    const fisica = parseInt(cantidadFisicaStr);
    if (isNaN(fisica) || fisica < 0) {
      mostrarMensaje('Ingresa una cantidad válida.', 'error');
      return { ok: false };
    }
    try {
      const sesion = await obtenerOcrearSesion();
      if (!sesion) {
        mostrarMensaje('No hay una sesión de inventario activa.', 'error');
        return { ok: false };
      }

      const diferencia = fisica - (producto.stock_sistema || 0);

      const { data: conteoGuardado, error } = await supabase
        .from('inventario_conteos')
        .upsert({
          id_sesion: sesion.id_sesion,
          id_producto: producto.id_producto,
          id_usuario: user.id_usuario,
          cantidad_sistema: producto.stock_sistema || 0,
          cantidad_fisica: fisica,
          diferencia,
          aprobado: false,
          ...extra,
        }, { onConflict: 'id_sesion,id_producto' })
        .select()
        .single();
      if (error) throw error;

      if (!opciones.omitirRefresh) cargarConteosHoy(sesion.id_sesion);
      return { ok: true, conteo: conteoGuardado, sesion };
    } catch (error) {
      mostrarMensaje('Error: ' + error.message, 'error');
      return { ok: false };
    }
  };

  // Un array de productos "califica" para aplicar cambios cuando TODOS tienen un valor
  // en Físico — un campo vacío bloquea, "0" cuenta como lleno (mismo criterio que ya
  // usaba cada fila individualmente para mostrar la diferencia).
  const todosConFisico = (lista) =>
    lista.length > 0 && lista.every(p => p.cantidadFisica !== '' && !isNaN(parseInt(p.cantidadFisica)));

  // Aprobación automática: re-guarda cada fila visible y aplica ajuste de stock.
  // Flujo estricto: procesar → cerrar sesión (verificado en BD) → actualizar UI local
  // → flash de éxito → quitar overlay. Nunca await de recargas pesadas con el overlay puesto.
  const aplicandoLockRef = useRef(false);
  const ejecutarAplicarCambios = async (listaProductos) => {
    if (aplicandoLockRef.current) {
      console.warn('[ConteoFisico] Aplicar ignorado: ya hay una aplicación en curso');
      return;
    }
    aplicandoLockRef.current = true;
    setAplicandoCambios(true);
    setOverlayAplicar({ mensaje: 'Aplicando cambios de inventario...', exito: false });

    const idSesionCerrar = sesionRef.current?.id_sesion ?? sesionActiva?.id_sesion ?? null;
    const idSucursal = sesionRef.current?.id_sucursal || sesionActiva?.id_sucursal || user?.id_sucursal;
    let exitosos = 0;

    try {
      console.log('[ConteoFisico] Aplicar INICIO', {
        productos: listaProductos.length,
        idSesionCerrar,
        idSucursal,
      });

      for (let i = 0; i < listaProductos.length; i++) {
        const producto = listaProductos[i];
        setOverlayAplicar({
          mensaje: `Aplicando ${i + 1} de ${listaProductos.length}...`,
          exito: false,
        });
        const resultado = await guardarConteoParaProducto(
          producto,
          producto.cantidadFisica,
          {
            nro_lote_conteo: producto.nroLoteConteo || null,
            fecha_vencimiento_conteo: producto.fechaVencimientoConteo || null,
          },
          { omitirRefresh: true }
        );
        if (!resultado.ok) {
          console.warn('[ConteoFisico] Guardar falló', producto.id_producto, resultado);
          continue;
        }
        if (resultado.conteo && resultado.conteo.diferencia !== 0 && !resultado.conteo.aprobado) {
          const ajuste = await aplicarAjusteInventario({
            conteo: resultado.conteo,
            idSucursal: resultado.sesion?.id_sucursal || idSucursal,
            idUsuario: user.id_usuario,
          });
          if (ajuste.ok) exitosos++;
          else console.warn('[ConteoFisico] Ajuste falló', producto.id_producto, ajuste.error);
        } else {
          exitosos++;
        }
      }

      console.log('[ConteoFisico] Aplicar conteos FIN', { exitosos, total: listaProductos.length });

      if (exitosos <= 0) {
        throw new Error('No se pudo aplicar ningún conteo.');
      }
      if (!idSesionCerrar) {
        throw new Error('No hay id de sesión de inventario para cerrar.');
      }

      setOverlayAplicar({ mensaje: 'Cerrando sesión de conteo...', exito: false });
      console.log('[ConteoFisico] Cerrar sesión REQUEST', idSesionCerrar);
      const cierre = await cerrarSesionInventario(idSesionCerrar);
      console.log('[ConteoFisico] Cerrar sesión RESPONSE', cierre);
      if (!cierre.ok) {
        throw new Error(cierre.error?.message || 'No se pudo cerrar la sesión de conteo.');
      }

      // Estado local YA alineado con BD. NO recargar productos: sin sesión la tabla
      // no debe reaparecer con Físico vacío (diferencias falsas / riesgo de re-guardar 0).
      resetUISinSesion();

      const mensajeFinal = `Cambios aplicados en ${exitosos} de ${listaProductos.length} producto(s). Sesión de conteo cerrada.`;
      setOverlayAplicar({ mensaje: mensajeFinal, exito: true });
      await new Promise((r) => setTimeout(r, 900));
      mostrarMensaje(mensajeFinal);
      console.log('[ConteoFisico] Aplicar OK completo');
    } catch (err) {
      console.error('[ConteoFisico] Aplicar ERROR', err);
      mostrarMensaje(err?.message || 'Error al aplicar cambios.', 'error');
    } finally {
      setOverlayAplicar(null);
      setAplicandoCambios(false);
      aplicandoLockRef.current = false;
    }
  };

  const aplicarCambiosFiltro = (listaProductos) => {
    if (!todosConFisico(listaProductos)) return;
    if (aplicandoCambios || aplicandoLockRef.current) return;
    const snapshot = [...listaProductos];
    mostrarAlerta(
      `¿Aplicar los cambios de stock de ${snapshot.length} producto(s)? Esta acción no se puede deshacer. Al finalizar se cerrará automáticamente la sesión de conteo.`,
      'warning',
      // Sync kickoff: AlertaSistemaModal NO awaita promesas; no devolver async aquí
      // evita dobles Enter y deja el trabajo desacoplado del cierre del modal.
      () => { void ejecutarAplicarCambios(snapshot); },
      'Sí, aplicar cambios',
      () => {},
      'Cancelar'
    );
  };

  // Borra en bloque los conteos ya guardados del laboratorio actualmente filtrado (para
  // cuando el usuario se equivocó de laboratorio completo) — un solo DELETE por
  // id_sesion + id_producto IN (...), no un loop de deletes individuales. Los conteos ya
  // aprobados (aprobado: true) NUNCA se borran: su ajuste de stock ya quedó reflejado en
  // inventario_lotes/kardex_movimientos vía aplicarAjusteInventario, y borrar solo la
  // fila de inventario_conteos dejaría ese movimiento sin respaldo. inventarioAjustes.js
  // no tiene ninguna función de reversión, así que esos quedan fuera y se avisa cuántos.
  const borrarTodosLaboratorio = async () => {
    if (!sesionActiva || productosLaboratorio.length === 0) {
      mostrarMensaje('No hay conteos guardados en este laboratorio para borrar.', 'info');
      return;
    }
    const ids = productosLaboratorio.map(p => p.id_producto);
    const { data: conteosExistentes, error } = await supabase
      .from('inventario_conteos')
      .select('id_conteo, aprobado')
      .eq('id_sesion', sesionActiva.id_sesion)
      .in('id_producto', ids);

    if (error) {
      mostrarMensaje('Error: ' + error.message, 'error');
      return;
    }
    if (!conteosExistentes || conteosExistentes.length === 0) {
      mostrarMensaje('No hay conteos guardados en este laboratorio para borrar.', 'info');
      return;
    }

    const borrables = conteosExistentes.filter(c => !c.aprobado);
    const yaAplicados = conteosExistentes.length - borrables.length;
    if (borrables.length === 0) {
      mostrarMensaje('Todos los conteos de este laboratorio ya fueron aplicados al stock — no hay nada que borrar.', 'info');
      return;
    }

    const avisoAplicados = yaAplicados > 0
      ? ` ${yaAplicados} de ${conteosExistentes.length} conteo(s) ya fueron aplicados al stock y no se borrarán.`
      : '';
    mostrarAlerta(
      `¿Borrar ${borrables.length} conteo(s) guardados de este laboratorio?${avisoAplicados} Esta acción no se puede deshacer.`,
      'warning',
      async () => {
        setBorrandoTodos(true);
        const { error: errorDelete } = await supabase
          .from('inventario_conteos')
          .delete()
          .in('id_conteo', borrables.map(c => c.id_conteo));
        if (errorDelete) {
          mostrarMensaje('Error: ' + errorDelete.message, 'error');
        } else {
          mostrarMensaje(`${borrables.length} conteo(s) borrados.`);
          cargarProductosLaboratorio(laboratorioSeleccionado, filtroNombreLaboratorio.trim());
          if (sesionActiva) cargarConteosHoy(sesionActiva.id_sesion);
        }
        setBorrandoTodos(false);
      },
      'Sí, borrar',
      () => {},
      'Cancelar'
    );
  };

  // Reutiliza la misma lógica de cierre que AdminTomaInventario.jsx (extraída a
  // cerrarSesionInventario en src/utils/inventarioAjustes.js) — cierra sin salir de
  // "Conteo Físico" ni navegar a la pantalla de administración de sesiones.
  const cerrarSesionActual = () => {
    if (!sesionActiva) return;
    const pendientes = conteosHoy.filter(c => !c.aprobado && c.diferencia !== 0);
    const mensajePendientes = pendientes.length > 0
      ? ` Hay ${pendientes.length} conteo(s) con diferencias sin aprobar.`
      : '';
    mostrarAlerta(
      `¿Cerrar la sesión de "${sesionActiva.sucursales?.nombre_comercial}"? Los vendedores ya no podrán registrar conteos.${mensajePendientes}`,
      'warning',
      async () => {
        const resultado = await cerrarSesionInventario(sesionActiva.id_sesion);
        if (resultado.ok) {
          mostrarMensaje('Sesión cerrada correctamente.');
          resetUISinSesion();
          // Cierre manual: sí limpia el filtro (el usuario abandona el conteo).
          laboratorioFiltroRef.current = '';
          setLaboratorioSeleccionado('');
          setFiltroNombreLaboratorio('');
          limpiarFiltroGuardado();
        } else {
          mostrarMensaje('Error: ' + resultado.error.message, 'error');
        }
      },
      'Sí, cerrar sesión',
      () => {},
      'Cancelar'
    );
  };

  // Un conteo ya aprobado (aprobado === true) significa que su ajuste de stock ya se
  // aplicó — borrarlo dejaría el stock ajustado sin el conteo que lo originó, así que
  // esa opción ni siquiera se muestra en "En curso" (solo pendientes).
  // ── Historial (drawer): solo aprobado === true, agrupado por laboratorio → sesión.
  // Sidebar "En curso": solo aprobado === false de la sesión actual. ──
  const [mostrarHistorialPropio, setMostrarHistorialPropio] = useState(false);
  const [fechaDesdeHistorialPropio, setFechaDesdeHistorialPropio] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [fechaHastaHistorialPropio, setFechaHastaHistorialPropio] = useState(() => new Date().toISOString().slice(0, 10));
  const [historialPropio, setHistorialPropio] = useState([]);
  const [cargandoHistorialPropio, setCargandoHistorialPropio] = useState(false);
  const [labHistorialExpandido, setLabHistorialExpandido] = useState(null);

  const cargarHistorialPropio = async () => {
    setCargandoHistorialPropio(true);
    try {
      const desde = new Date(`${fechaDesdeHistorialPropio}T00:00:00`);
      const hasta = new Date(`${fechaHastaHistorialPropio}T23:59:59`);
      const { data, error } = await supabase
        .from('inventario_conteos')
        .select('*, productos(descripcion, id_laboratorio, laboratorios(nombre)), inventario_sesiones!inventario_conteos_id_sesion_fkey!inner(fecha_apertura, estado, id_sucursal, sucursales(nombre_comercial))')
        .eq('id_usuario', user.id_usuario)
        .eq('aprobado', true)
        .gte('created_at', desde.toISOString())
        .lte('created_at', hasta.toISOString())
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      setHistorialPropio(data || []);
    } catch (error) {
      console.error('Error cargando mi historial de conteos:', error);
      setHistorialPropio([]);
    } finally {
      setCargandoHistorialPropio(false);
    }
  };

  useEffect(() => {
    if (!mostrarHistorialPropio) return;
    cargarHistorialPropio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mostrarHistorialPropio, fechaDesdeHistorialPropio, fechaHastaHistorialPropio]);

  const historialPorLaboratorio = agruparHistorialPorLaboratorio(historialPropio);
  const resumenHistorialPropio = {
    total: historialPropio.length,
    conDiferencia: historialPropio.filter(c => c.diferencia !== 0).length,
    laboratorios: historialPorLaboratorio.length,
  };
  const conteosEnCurso = conteosHoy.filter(c => !c.aprobado);

  const eliminarConteo = (conteo) => {
    mostrarAlerta(
      `¿Eliminar el conteo de "${conteo.productos?.descripcion}"? Esta acción no se puede deshacer.`,
      'warning',
      async () => {
        const { error } = await supabase.from('inventario_conteos').delete().eq('id_conteo', conteo.id_conteo);
        if (!error) {
          mostrarMensaje('Conteo eliminado.');
          cargarConteosHoy(sesionActiva.id_sesion);
        } else {
          mostrarMensaje('Error: ' + error.message, 'error');
        }
      },
      'Sí, eliminar',
      () => {},
      'Cancelar'
    );
  };

  if (cargando) return <div className="ti-v-loading">Verificando sesión activa...</div>;

  if (!sesionActiva && !esAdmin) {
    return (
      <>
        {overlayAplicar && (
          <LogoCargandoOverlay mensaje={overlayAplicar.mensaje} exito={!!overlayAplicar.exito} />
        )}
        <div className="ti-v-sin-sesion">
          <div className="ti-v-sin-sesion-card">
            <span className="ti-v-icon-big"><UiIcon name="Lock" size={16} /></span>
            <h2>Sin sesión activa</h2>
            <p>El administrador aún no ha abierto una sesión de inventario.<br />Consulta con {nombreAdmin || 'tu administrador'} para continuar.</p>
            <button onClick={cargarSesion} style={{ marginTop: '1rem', padding: '0.5rem 1.5rem', background: 'var(--lf-primary)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '0.9rem' }}><UiIcon name="RefreshCw" size={15} /> Verificar nuevamente
            </button>
          </div>
        </div>
      </>
    );
  }

  const bloqueResumen = (
    <div className="ti-v-resumen-soles">
      <h3>Resumen de la sesión (S/.)</h3>
      <div className="ti-v-resumen-grid">
        <div className="ti-v-resumen-item pos">
          <span className="ti-v-resumen-label">Cant. Ingresos</span>
          <span className="ti-v-resumen-num">{resumenSoles.cantIngresos}</span>
        </div>
        <div className="ti-v-resumen-item pos">
          <span className="ti-v-resumen-label">Total S/. Ingresos</span>
          <span className="ti-v-resumen-num">S/ {resumenSoles.totalIngresos.toFixed(2)}</span>
        </div>
        <div className="ti-v-resumen-item neg">
          <span className="ti-v-resumen-label">Cant. Salidas</span>
          <span className="ti-v-resumen-num">{resumenSoles.cantSalidas}</span>
        </div>
        <div className="ti-v-resumen-item neg">
          <span className="ti-v-resumen-label">Total S/. Salidas</span>
          <span className="ti-v-resumen-num">S/ {resumenSoles.totalSalidas.toFixed(2)}</span>
        </div>
      </div>
      <p className="ti-v-resumen-nota">Valorizado a precio de costo actual — puede diferir del costo vigente al momento exacto de cada conteo si el precio cambió durante la sesión.</p>
    </div>
  );

  const bloqueEnCurso = (
    <div className="ti-v-historial">
      <div className="ti-v-historial-header">
        <h3>En curso / pendientes ({conteosEnCurso.length})</h3>
        {esAdmin && sesionActiva && (
          <button className="ti-v-btn-cerrar-sesion" onClick={cerrarSesionActual}><UiIcon name="Lock" size={15} /> Cerrar esta sesión
          </button>
        )}
      </div>
      {conteosEnCurso.length === 0 ? (
        <p className="ti-v-empty">No hay conteos pendientes en esta sesión.</p>
      ) : (
        <div className="ti-v-conteo-mini-lista">
          {conteosEnCurso.map(c => (
            <div key={c.id_conteo} className="ti-v-conteo-mini-card ti-v-conteo-mini-card-readonly">
              <div className="ti-v-conteo-mini-top">
                <strong title={c.productos?.descripcion || '---'}>{c.productos?.descripcion || '---'}</strong>
                <button
                  className="ti-v-btn-eliminar-mini"
                  title="Eliminar conteo"
                  onClick={() => eliminarConteo(c)}
                ><UiIcon name="Trash2" size={16} /></button>
              </div>
              <div className="ti-v-conteo-mini-cifras">
                <span>Sistema {c.cantidad_sistema} → Físico {c.cantidad_fisica}</span>
                <span className={`dif-badge-v ${c.diferencia > 0 ? 'pos' : c.diferencia < 0 ? 'neg' : 'ok'}`}>
                  {c.diferencia > 0 ? '+' : ''}{c.diferencia}
                </span>
              </div>
              {c.diferencia !== 0 && (() => {
                const infoMensaje = calcularMensajeConteo(c.diferencia, c.id_producto, kardexRecienteMap);
                return (
                  <div className={`ti-v-msj-conteo mini ${infoMensaje.alerta ? 'alerta' : ''}`}>
                    {infoMensaje.texto}
                  </div>
                );
              })()}
              <div className="ti-v-conteo-mini-accion">
                {c.diferencia !== 0 ? (
                  <span className="badge-pendiente-v">Pendiente</span>
                ) : (
                  <span className="badge-sindif-v">Sin diferencia</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const bloqueHistorialPropio = (
    <div className="ti-v-historial">
      <button
        type="button"
        className="ti-v-btn-toggle-historial-propio"
        onClick={() => setMostrarHistorialPropio(true)}
      ><UiIcon name="BarChart3" size={15} /> Historial
      </button>
    </div>
  );

  const drawerHistorialPropio = mostrarHistorialPropio && (
    <>
      <div className="ti-v-drawer-backdrop" onClick={() => setMostrarHistorialPropio(false)} />
      <div className="ti-v-drawer">
        <div className="ti-v-drawer-header">
          <h3><UiIcon name="BarChart3" size={15} /> Historial</h3>
          <button type="button" onClick={() => setMostrarHistorialPropio(false)}><UiIcon name="X" size={16} /></button>
        </div>
        <div className="ti-v-drawer-body">
          <div className="ti-v-historial-propio-filtros">
            <div className="ti-v-filtro-campo">
              <label>Desde</label>
              <SmartDateInput value={fechaDesdeHistorialPropio} onChange={setFechaDesdeHistorialPropio} />
            </div>
            <div className="ti-v-filtro-campo">
              <label>Hasta</label>
              <SmartDateInput value={fechaHastaHistorialPropio} onChange={setFechaHastaHistorialPropio} />
            </div>
          </div>

          <div className="ti-v-resumen-persona">
            <div className="ti-v-resumen-persona-item">
              <span className="ti-v-resumen-persona-label">Aplicados</span>
              <span className="ti-v-resumen-persona-num">{resumenHistorialPropio.total}</span>
            </div>
            <div className="ti-v-resumen-persona-item">
              <span className="ti-v-resumen-persona-label">Con diferencia</span>
              <span className="ti-v-resumen-persona-num">{resumenHistorialPropio.conDiferencia}</span>
            </div>
            <div className="ti-v-resumen-persona-item">
              <span className="ti-v-resumen-persona-label">Laboratorios</span>
              <span className="ti-v-resumen-persona-num">{resumenHistorialPropio.laboratorios}</span>
            </div>
          </div>

          {cargandoHistorialPropio ? (
            <p className="ti-v-empty">Cargando...</p>
          ) : historialPorLaboratorio.length === 0 ? (
            <p className="ti-v-empty">No hay conteos aplicados en ese rango.</p>
          ) : (
            <div className="ti-v-historial-labs">
              {historialPorLaboratorio.map((lab) => {
                const abierto = labHistorialExpandido === lab.idLab;
                return (
                  <div key={lab.idLab || lab.nombreLab} className={`ti-v-hist-lab ${abierto ? 'is-open' : ''}`}>
                    <button
                      type="button"
                      className="ti-v-hist-lab-toggle"
                      onClick={() => setLabHistorialExpandido(abierto ? null : lab.idLab)}
                    >
                      <span className="ti-v-hist-lab-nombre">{lab.nombreLab}</span>
                      <span className="ti-v-hist-lab-meta">{lab.total} conteo{lab.total === 1 ? '' : 's'}</span>
                      <UiIcon name={abierto ? 'ChevronUp' : 'ChevronDown'} size={16} />
                    </button>
                    {abierto && (
                      <div className="ti-v-hist-lab-body">
                        {lab.sesiones.map((ses) => (
                          <div key={ses.idSesion} className="ti-v-hist-sesion">
                            <div className="ti-v-hist-sesion-header">
                              <strong>
                                {ses.fecha
                                  ? new Date(ses.fecha).toLocaleDateString('es-PE', {
                                    day: '2-digit', month: 'short', year: 'numeric',
                                  })
                                  : 'Sin fecha'}
                              </strong>
                              <small>
                                {ses.sucursal || '—'}
                                {ses.estado ? ` · ${ses.estado}` : ''}
                                {` · ${ses.conteos.length} producto${ses.conteos.length === 1 ? '' : 's'}`}
                              </small>
                            </div>
                            <div className="ti-v-drawer-table-scroll ti-v-hist-sesion-tabla">
                              <table className="ti-v-table ti-v-table-drawer">
                                <thead>
                                  <tr>
                                    <th>PRODUCTO</th>
                                    <th>FECHA/HORA</th>
                                    <th className="text-center">STOCK EN SISTEMA</th>
                                    <th className="text-center">FÍSICO</th>
                                    <th className="text-center">DIFERENCIA</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {ses.conteos.map((c) => (
                                    <tr key={c.id_conteo}>
                                      <td><strong>{c.productos?.descripcion || '---'}</strong></td>
                                      <td><small>{new Date(c.created_at).toLocaleString('es-PE')}</small></td>
                                      <td className="text-center">{c.cantidad_sistema}</td>
                                      <td className="text-center">{c.cantidad_fisica}</td>
                                      <td className="text-center">
                                        <span className={`dif-badge-v ${c.diferencia > 0 ? 'pos' : c.diferencia < 0 ? 'neg' : 'ok'}`}>
                                          {c.diferencia > 0 ? '+' : ''}{c.diferencia}
                                        </span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );

  const progresoTotal = productosLaboratorio.length;
  const progresoContados = productosLaboratorio.filter(p => p.cantidadFisica !== '' && !isNaN(parseInt(p.cantidadFisica))).length;
  const habilitadoAplicar = todosConFisico(productosLaboratorio);

  const contenidoLaboratorio = (
    <div className="ti-v-categoria-card">
      <h3>Filtrar por laboratorio y/o nombre / código</h3>
      <SearchableSelect
        className="ti-v-categoria-select"
        options={laboratorios}
        value={laboratorioSeleccionado}
        onChange={elegirLaboratorio}
        getOptionValue={(l) => l.id_laboratorio}
        getOptionLabel={(l) => l.nombre}
        placeholder="Buscar laboratorio..."
        emptyOptionLabel="-- Todos los laboratorios --"
      />

      <input
        type="text"
        className="ti-v-categoria-select"
        style={{ marginTop: '0.6rem' }}
        placeholder="Buscar por nombre, código de barras o principio activo..."
        value={filtroNombreLaboratorio}
        onChange={e => setFiltroNombreLaboratorio(e.target.value)}
      />

      {!tablaConteoActiva && (
        <div className="ti-v-iniciar-conteo">
          <p className="ti-v-empty" style={{ marginBottom: '0.75rem' }}>
            {sesionActiva
              ? 'Elige un laboratorio (o busca por nombre/código) y pulsa Iniciar conteo para cargar la tabla.'
              : 'No hay sesión de conteo abierta. Elige un laboratorio (o busca) y pulsa Iniciar conteo para comenzar una nueva toma — la sesión se abrirá al guardar el primer Físico.'}
          </p>
          <button
            type="button"
            className="ti-v-btn-aplicar-todos"
            onClick={iniciarConteoLaboratorio}
            disabled={!laboratorioSeleccionado && filtroNombreLaboratorio.trim().length < 2}
          >
            Iniciar conteo
          </button>
        </div>
      )}

      {tablaConteoActiva && cargandoLaboratorio && <p className="ti-v-empty">Buscando productos...</p>}

      {tablaConteoActiva && !cargandoLaboratorio && !laboratorioSeleccionado && filtroNombreLaboratorio.trim().length < 2 && (
        <p className="ti-v-empty">Elige un laboratorio o escribe al menos 2 caracteres (nombre, código o principio activo).</p>
      )}

      {tablaConteoActiva && !cargandoLaboratorio && (laboratorioSeleccionado || filtroNombreLaboratorio.trim().length >= 2) && productosLaboratorio.length === 0 && (
        <p className="ti-v-empty">No se encontraron productos.</p>
      )}

      {tablaConteoActiva && !cargandoLaboratorio && productosLaboratorio.length > 0 && (
        <>
          <div className="ti-v-progreso-bloque">
            <div className="ti-v-progreso-header">
              <span className="ti-v-progreso-texto">{progresoContados} de {progresoTotal} productos contados</span>
              <div className="ti-v-progreso-acciones">
                <button
                  type="button"
                  className="ti-v-btn-borrar-todos"
                  onClick={borrarTodosLaboratorio}
                  disabled={borrandoTodos}
                >
                  {borrandoTodos ? 'Borrando...' : 'Borrar todos'}
                </button>
                <button
                  ref={aplicarCambiosBtnRef}
                  className="ti-v-btn-aplicar-todos"
                  onClick={() => aplicarCambiosFiltro(productosLaboratorio)}
                  disabled={!habilitadoAplicar || aplicandoCambios}
                >
                  {aplicandoCambios ? 'Aplicando...' : habilitadoAplicar ? 'Aplicar cambios' : 'Completa el campo Físico de todos los productos'}
                </button>
              </div>
            </div>
            <div className="ti-v-progreso-track">
              <div className="ti-v-progreso-fill" style={{ width: `${progresoTotal > 0 ? (progresoContados / progresoTotal) * 100 : 0}%` }} />
            </div>
          </div>
          <TablaConteoProductos
            productos={productosLaboratorio}
            guardandoFilas={guardandoFilas}
            kardexRecienteMap={kardexRecienteMap}
            onCampoChange={actualizarCampoFilaLaboratorio}
            onGuardarFila={guardarConteoFila}
            onEnterUltimaFila={() => {
              if (aplicarCambiosBtnRef.current && !aplicarCambiosBtnRef.current.disabled) {
                aplicarCambiosBtnRef.current.focus();
              }
            }}
          />
        </>
      )}
    </div>
  );

  return (
    <div className="ti-v-container">

      {mensaje && (
        <div className={`ti-v-toast ${mensaje.tipo}`}>
          {mensaje.texto}
        </div>
      )}

      {drawerHistorialPropio}

      {overlayAplicar && (
        <LogoCargandoOverlay
          mensaje={overlayAplicar.mensaje}
          exito={!!overlayAplicar.exito}
        />
      )}

      <AlertaSistemaModal alerta={alertaSistema} onClose={() => setAlertaSistema(null)} />

      <div className="ti-v-banner">
        {sesionActiva ? (
          <>
            <span className="ti-v-dot-green"></span>
            <div>
              <strong>Sesión abierta — {sesionActiva.sucursales?.nombre_comercial}</strong>
              <span>Registra la cantidad física de cada producto</span>
            </div>
          </>
        ) : (
          <>
            <span className="ti-v-dot-gray"></span>
            <div>
              <strong>Sesión se abrirá al registrar tu primer conteo</strong>
              <span>Aún no hay una sesión de inventario abierta para tu sucursal</span>
            </div>
          </>
        )}
      </div>

      <div className="ti-v-categoria-layout">
        <div className="ti-v-categoria-main">{contenidoLaboratorio}</div>
        <div className="ti-v-sidebar-categoria">
          {bloqueResumen}
          {bloqueEnCurso}
          {bloqueHistorialPropio}
        </div>
      </div>
    </div>
  );
}
