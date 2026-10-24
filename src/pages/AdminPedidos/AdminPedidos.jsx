import { useState, useEffect, useCallback, useRef } from 'react';
import AlertaSistemaModal from '../../components/AlertaSistemaModal';
import { useLocation } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../context/AuthContext';
import { calcularProductosStockBajo, cargarIdsProductosConMovimiento } from '../../utils/stockBajo';
import { leerDraftDeUsuario, escribirDraftDeUsuario, limpiarSessionDraft } from '../../utils/sessionDraft';
import { fetchLaboratorios, suscribirLaboratoriosChanged } from '../../utils/laboratoriosCatalogo';
import { fetchProveedores, suscribirProveedoresChanged } from '../../utils/proveedoresCatalogo';
import SearchableSelect from '../../components/SearchableSelect';
import './AdminPedidos.css';
import LogoLuxFarma from '../../components/LogoLuxFarma';
import UiIcon from '../../components/UiIcon';

// Fase 1 de "Gestionar Pedido Proveedor": armar/listar pedidos futuros a un proveedor
// (BORRADOR→ENVIADO→CANCELADO). La conversión ENVIADO→RECIBIDO (Fase 2) vive en
// AdminCompras.jsx, vía un botón "Cargar desde Pedido" que replica el patrón ya
// existente de "Recuperar Anulados" — no se toca ese archivo en esta fase.

const PEDIDOS_DRAFT_KEY = 'pedidos_nuevo_borrador';

function LogoCargando({ texto }) {
  return (
    <div className="ped-loading-logo">
      <span className="ped-loading-logo-img">
        <LogoLuxFarma variant="icon" size={42} color="red" />
      </span>
      {texto && <span>{texto}</span>}
    </div>
  );
}

const ESTADO_LABEL = { BORRADOR: 'Borrador', ENVIADO: 'Enviado', RECIBIDO: 'Recibido', CANCELADO: 'Cancelado' };

function formatoFactor(n) {
  const x = Number(n) || 1;
  return Number.isInteger(x) ? String(x) : x.toFixed(2);
}

function etiquetaForma(forma) {
  const nombre = forma?.unidades_medida?.nombre || 'UNIDAD';
  const factor = Number(forma?.factor) || 1;
  return factor > 1 ? `${nombre} (×${formatoFactor(factor)})` : nombre;
}

function formaPorDefecto(formas) {
  if (!formas?.length) return { id_medida: '', factor: 1, uMedida: 'UNIDAD', p_compra: 0 };
  const unidad = formas.find((f) => Number(f.factor) === 1) || formas[0];
  return {
    id_medida: unidad.id_medida,
    factor: Number(unidad.factor) || 1,
    uMedida: unidad.unidades_medida?.nombre || 'UNIDAD',
    p_compra: Number(unidad.p_compra) || 0,
  };
}

function filaPedidoNueva(prod) {
  return {
    ui_id: Date.now() + Math.random(),
    id_producto: prod.id_producto,
    descripcion: prod.descripcion,
    cantidad_pedida: 1,
    costo_estimado: 0,
    factor: 1,
    uMedida: 'UNIDAD',
    idMedidaSeleccionada: '',
    formas: [],
    formasCargadas: false,
  };
}

async function fetchFormasPedidos(idsProducto) {
  const ids = [...new Set((idsProducto || []).filter(Boolean))];
  if (ids.length === 0) return {};
  const { data, error } = await supabase
    .from('producto_formas_venta')
    .select('id_forma, id_producto, id_medida, factor, p_compra, unidades_medida(nombre)')
    .in('id_producto', ids)
    .eq('activo', true)
    .order('orden');
  if (error) throw error;
  const map = {};
  for (const f of data || []) {
    (map[f.id_producto] ||= []).push(f);
  }
  return map;
}

function aplicarFormasAFila(fila, formas) {
  const lista = formas || [];
  const def = formaPorDefecto(lista);
  const yaEligio = fila.idMedidaSeleccionada !== '' && fila.idMedidaSeleccionada != null;
  const costoActual = Number(fila.costo_estimado);
  return {
    ...fila,
    formas: lista,
    formasCargadas: true,
    factor: yaEligio ? (Number(fila.factor) || 1) : def.factor,
    uMedida: yaEligio ? (fila.uMedida || def.uMedida) : def.uMedida,
    idMedidaSeleccionada: yaEligio ? fila.idMedidaSeleccionada : def.id_medida,
    costo_estimado: (!Number.isFinite(costoActual) || costoActual === 0) && def.p_compra
      ? def.p_compra
      : fila.costo_estimado,
  };
}

export default function AdminPedidos() {
  const { user } = useAuth();
  const location = useLocation();
  const borradorInicial = leerDraftDeUsuario(PEDIDOS_DRAFT_KEY, user?.id_usuario, null);
  const tieneBorradorInicial = !!(
    borradorInicial
    && ((borradorInicial.carritoPedido || []).length > 0 || borradorInicial.proveedorNuevo)
  );

  const [cargandoCatalogos, setCargandoCatalogos] = useState(true);
  const [proveedores, setProveedores] = useState([]);

  // ── Vista: 'lista' (listado + filtros) o 'nuevo' (armar pedido) ─────────────────
  // Si hay borrador a medias, volvemos directo a "nuevo" (sin modal).
  const [vista, setVista] = useState(() => (
    tieneBorradorInicial && borradorInicial?.vista === 'nuevo' ? 'nuevo' : 'lista'
  ));

  // ── Listado de pedidos ───────────────────────────────────────────────────────
  const [pedidos, setPedidos] = useState([]);
  const [cargandoPedidos, setCargandoPedidos] = useState(true);
  const [filtroProveedor, setFiltroProveedor] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('');
  const [pedidoSeleccionado, setPedidoSeleccionado] = useState(null);

  // ── Drawer "Ver Detalle" de un pedido ya guardado ───────────────────────────
  const [mostrarDetalle, setMostrarDetalle] = useState(false);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [detalleItems, setDetalleItems] = useState([]);

  // ── Armar pedido nuevo (carrito simple: producto + cantidad + costo estimado) ──
  const [proveedorNuevo, setProveedorNuevo] = useState(() => borradorInicial?.proveedorNuevo || '');
  const [carritoPedido, setCarritoPedido] = useState(() => borradorInicial?.carritoPedido || []);
  const [busquedaProducto, setBusquedaProducto] = useState('');
  const [resultadosBusqueda, setResultadosBusqueda] = useState([]);
  const [buscandoProducto, setBuscandoProducto] = useState(false);
  const [guardandoPedido, setGuardandoPedido] = useState(false);
  const precargaAplicada = useRef(false);

  // ── Productos por laboratorio (ayuda a decidir QUÉ pedir, independiente de a quién) ──
  const [laboratorios, setLaboratorios] = useState([]);
  const [laboratorioFiltro, setLaboratorioFiltro] = useState(() => borradorInicial?.laboratorioFiltro || '');
  const [productosPorLaboratorio, setProductosPorLaboratorio] = useState([]);
  const [cargandoProductosLab, setCargandoProductosLab] = useState(false);

  // ── Alertas (mismo patrón que AdminProductos.jsx) ───────────────────────────
  const [alertaSistema, setAlertaSistema] = useState(null);
  const mostrarAlerta = (mensaje, tipo = 'info', accionConfirmar = null, textoConfirmar = 'Aceptar', accionCancelar = null, textoCancelar = null) => {
    setAlertaSistema({ mensaje, tipo, accionConfirmar, textoConfirmar, accionCancelar, textoCancelar });
  };
  const alertOkBtnRef = useRef(null);
  useEffect(() => {
    if (alertaSistema && alertOkBtnRef.current) alertOkBtnRef.current.focus();
  }, [alertaSistema]);

  // ════════════════════════════════════════
  // CARGA DE DATOS
  // ════════════════════════════════════════

  useEffect(() => {
    Promise.all([
      fetchProveedores({ soloActivos: true }),
      fetchLaboratorios(),
    ]).then(([provs, labs]) => {
      setProveedores(provs || []);
      setLaboratorios(labs.filter(l => String(l.activo) === '1' || l.activo === true));
      setCargandoCatalogos(false);
    });
  }, []);

  useEffect(() => suscribirLaboratoriosChanged(async () => {
    try {
      const labs = await fetchLaboratorios();
      setLaboratorios(labs.filter(l => String(l.activo) === '1' || l.activo === true));
    } catch {
      /* ignore */
    }
  }), []);

  useEffect(() => suscribirProveedoresChanged(async () => {
    try {
      const provs = await fetchProveedores({ soloActivos: true });
      setProveedores(provs || []);
    } catch {
      /* ignore */
    }
  }), []);

  const cargarPedidos = useCallback(async () => {
    setCargandoPedidos(true);
    try {
      let query = supabase
        .from('pedidos_proveedor')
        .select('id_pedido, estado, fecha_pedido, fecha_envio, observaciones, id_proveedor, proveedores(razon_social), pedido_proveedor_detalle(cantidad_pedida, costo_estimado)')
        .order('id_pedido', { ascending: false });
      if (filtroProveedor) query = query.eq('id_proveedor', filtroProveedor);
      if (filtroEstado) query = query.eq('estado', filtroEstado);
      const { data, error } = await query;
      if (error) throw error;
      setPedidos(data || []);
    } catch (err) {
      mostrarAlerta('Error al cargar pedidos: ' + err.message, 'error');
    }
    setCargandoPedidos(false);
  }, [filtroProveedor, filtroEstado]);

  useEffect(() => { cargarPedidos(); }, [cargarPedidos]);

  useEffect(() => {
    setPedidoSeleccionado(null);
    setMostrarDetalle(false);
  }, [filtroProveedor, filtroEstado]);

  // Auto-guarda el pedido en curso (silencioso). Limpieza solo al guardar OK o descartar.
  // Incluye idUsuario para no cruzar borradores/filtro lab entre usuarios.
  useEffect(() => {
    if (!user?.id_usuario) return;
    escribirDraftDeUsuario(PEDIDOS_DRAFT_KEY, user.id_usuario, {
      vista,
      proveedorNuevo,
      carritoPedido,
      laboratorioFiltro,
    });
  }, [user?.id_usuario, vista, proveedorNuevo, carritoPedido, laboratorioFiltro]);

  const limpiarBorradorPedido = () => {
    limpiarSessionDraft(PEDIDOS_DRAFT_KEY);
    setProveedorNuevo('');
    setCarritoPedido([]);
    setBusquedaProducto('');
    setResultadosBusqueda([]);
    setLaboratorioFiltro('');
  };

  // Precarga desde AdminProductos.jsx: "📋 Pedir a Proveedor" navega acá con el
  // producto seleccionado ya en el state — se abre directo la vista "nuevo pedido"
  // con ese producto agregado al carrito (el proveedor lo elige el usuario).
  useEffect(() => {
    if (precargaAplicada.current) return;
    const prod = location.state?.productoPredefinido;
    if (!prod) return;
    precargaAplicada.current = true;
    setVista('nuevo');
    setCarritoPedido(prev => {
      if (prev.some(p => p.id_producto === prod.id_producto)) return prev;
      return [...prev, filaPedidoNueva(prod)];
    });
  }, [location.state]);

  // Buscador de productos para agregar al carrito (mismo patrón de debounce que
  // ModalBuscarRelacionado en AdminProductos.jsx)
  useEffect(() => {
    if (vista !== 'nuevo' || !busquedaProducto.trim()) { setResultadosBusqueda([]); return undefined; }
    const t = setTimeout(async () => {
      setBuscandoProducto(true);
      try {
        const idsEnCarrito = carritoPedido.map(p => p.id_producto);
        const terminoSeguro = busquedaProducto.trim().replace(/[,()]/g, " ");
        const { data } = await supabase
          .from('productos')
          .select('id_producto, codigo_barras, descripcion, laboratorios(nombre)')
          .or(`descripcion.ilike.%${terminoSeguro}%,codigo_barras.ilike.%${terminoSeguro}%`)
          .eq('activo', 1)
          .limit(15);
        setResultadosBusqueda((data || []).filter(p => !idsEnCarrito.includes(p.id_producto)));
      } finally {
        setBuscandoProducto(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [busquedaProducto, vista, carritoPedido]);

  // Productos de un laboratorio, con su stock — consulta directa a productos filtrando
  // por id_laboratorio (mismo patrón que ya usa AdminProductos.jsx), sin cruce con
  // historial de compras/proveedores. Ayuda a decidir QUÉ pedir, independiente de a
  // quién se le va a comprar (ese es el selector de Proveedor, que se queda igual).
  useEffect(() => {
    if (!laboratorioFiltro) { setProductosPorLaboratorio([]); return undefined; }
    let cancelado = false;
    (async () => {
      setCargandoProductosLab(true);
      const { data } = await supabase
        .from('productos')
        .select('id_producto, codigo_barras, descripcion, stock_minimo, inventario_lotes(cantidad_actual, estado)')
        .eq('id_laboratorio', laboratorioFiltro)
        .eq('activo', 1)
        .order('descripcion', { ascending: true });
      if (cancelado) return;
      // stockActual (mostrado en la columna) sigue incluyendo VENCIDO — es el stock
      // físico total, informativo. bajoMinimo usa el criterio único del sistema
      // (calcularProductosStockBajo: solo VIGENTE, stock_minimo o 3, solo productos
      // con movimiento) en vez del `stockActual < stock_minimo` de antes.
      const lotesFlat = (data || []).flatMap(prod =>
        (prod.inventario_lotes || []).map(l => ({ id_producto: prod.id_producto, cantidad_actual: l.cantidad_actual, estado: l.estado }))
      );
      const idsMovimiento = await cargarIdsProductosConMovimiento();
      const stockBajoIds = new Set(calcularProductosStockBajo(data, lotesFlat, idsMovimiento).map(item => Number(item.id_producto)));
      const lista = (data || []).map(prod => {
        const stockActual = (prod.inventario_lotes || [])
          .filter(l => ['VIGENTE', 'VENCIDO'].includes(l.estado))
          .reduce((s, l) => s + Number(l.cantidad_actual), 0);
        return {
          id_producto: prod.id_producto,
          codigo_barras: prod.codigo_barras,
          descripcion: prod.descripcion,
          stock_minimo: Number(prod.stock_minimo) || 0,
          stockActual,
          bajoMinimo: stockBajoIds.has(Number(prod.id_producto)),
        };
      });
      setProductosPorLaboratorio(lista);
      setCargandoProductosLab(false);
    })();
    return () => { cancelado = true; };
  }, [laboratorioFiltro]);

  // Carga las formas de venta (unidad / caja + factor) de cada línea que aún no las tiene.
  useEffect(() => {
    if (vista !== 'nuevo') return undefined;
    const pendientes = carritoPedido.filter((f) => !f.formasCargadas && f.id_producto);
    if (pendientes.length === 0) return undefined;
    let cancelado = false;
    (async () => {
      try {
        const map = await fetchFormasPedidos(pendientes.map((f) => f.id_producto));
        if (cancelado) return;
        setCarritoPedido((prev) => prev.map((f) => {
          if (f.formasCargadas) return f;
          return aplicarFormasAFila(f, map[f.id_producto] || []);
        }));
      } catch {
        if (cancelado) return;
        setCarritoPedido((prev) => prev.map((f) => (
          f.formasCargadas ? f : { ...f, formasCargadas: true, formas: f.formas || [] }
        )));
      }
    })();
    return () => { cancelado = true; };
  }, [vista, carritoPedido]);

  // ════════════════════════════════════════
  // ARMAR PEDIDO NUEVO
  // ════════════════════════════════════════

  // Reabre el armado sin borrar el borrador — si había productos a medias, siguen ahí.
  const abrirNuevoPedido = () => {
    setVista('nuevo');
  };

  // Solo vuelve al listado; el borrador permanece para cuando se reabra "Nuevo Pedido".
  const cancelarNuevoPedido = () => {
    setVista('lista');
  };

  // Descarte explícito del pedido en curso (confirma y limpia sessionStorage).
  const descartarNuevoPedido = () => {
    if (carritoPedido.length === 0 && !proveedorNuevo) {
      setVista('lista');
      return;
    }
    mostrarAlerta(
      '¿Descartar el pedido en curso? Se perderán los productos agregados.',
      'warning',
      () => {
        limpiarBorradorPedido();
        setVista('lista');
      },
      'Sí, descartar',
      null,
      'Volver'
    );
  };

  const agregarProductoCarrito = (prod) => {
    setCarritoPedido((prev) => {
      if (prev.some((p) => p.id_producto === prod.id_producto)) return prev;
      return [...prev, filaPedidoNueva(prod)];
    });
    setBusquedaProducto('');
    setResultadosBusqueda([]);
  };

  const actualizarFilaCarrito = (ui_id, campo, valor) => {
    setCarritoPedido(prev => prev.map(f => f.ui_id === ui_id ? { ...f, [campo]: valor } : f));
  };

  const cambiarMedidaFila = (ui_id, idMedida) => {
    setCarritoPedido((prev) => prev.map((f) => {
      if (f.ui_id !== ui_id) return f;
      const forma = (f.formas || []).find((x) => String(x.id_medida) === String(idMedida));
      if (!forma) {
        return { ...f, idMedidaSeleccionada: '', factor: 1, uMedida: 'UNIDAD' };
      }
      const pCompra = Number(forma.p_compra) || 0;
      return {
        ...f,
        idMedidaSeleccionada: forma.id_medida,
        factor: Number(forma.factor) || 1,
        uMedida: forma.unidades_medida?.nombre || 'UNIDAD',
        costo_estimado: pCompra > 0 ? pCompra : f.costo_estimado,
      };
    }));
  };

  const eliminarFilaCarrito = (ui_id) => {
    setCarritoPedido(prev => prev.filter(f => f.ui_id !== ui_id));
  };

  const totalEstimadoCarrito = carritoPedido.reduce((s, f) => s + (Number(f.cantidad_pedida) || 0) * (Number(f.costo_estimado) || 0), 0);

  const unidadesDeFila = (f) => (Number(f.cantidad_pedida) || 0) * (Number(f.factor) || 1);

  const guardarPedido = async () => {
    if (!proveedorNuevo) return mostrarAlerta('Elige un proveedor para el pedido.', 'warning');
    if (carritoPedido.length === 0) return mostrarAlerta('Agrega al menos un producto al pedido.', 'warning');
    if (carritoPedido.some((f) => !(Number(f.cantidad_pedida) > 0))) {
      return mostrarAlerta('Cada producto del pedido debe tener una cantidad mayor a 0.', 'warning');
    }
    const sucursalId = user.id_sucursal || user.sucursales?.id_sucursal || null;
    if (!sucursalId) return mostrarAlerta('Tu usuario no tiene una sucursal asignada. Contacta al administrador.', 'warning');

    setGuardandoPedido(true);
    try {
      const { data: nuevoPedido, error: errP } = await supabase
        .from('pedidos_proveedor')
        .insert({
          id_proveedor: proveedorNuevo,
          id_sucursal: sucursalId,
          id_usuario_creacion: user.id_usuario,
          estado: 'BORRADOR',
        })
        .select()
        .single();
      if (errP) throw errP;

      const detalles = carritoPedido.map((f) => {
        const factor = Number(f.factor) || 1;
        const qty = Number(f.cantidad_pedida) || 0;
        const costoForma = Number(f.costo_estimado) || 0;
        return {
          id_pedido: nuevoPedido.id_pedido,
          id_producto: f.id_producto,
          cantidad_pedida: qty * factor,
          costo_estimado: factor ? Number((costoForma / factor).toFixed(4)) : costoForma,
        };
      });
      const { error: errD } = await supabase.from('pedido_proveedor_detalle').insert(detalles);
      if (errD) throw errD;

      mostrarAlerta('Pedido guardado como borrador.', 'success');
      limpiarBorradorPedido();
      setVista('lista');
      cargarPedidos();
    } catch (err) {
      mostrarAlerta('Error al guardar el pedido: ' + err.message, 'error');
    }
    setGuardandoPedido(false);
  };

  // ════════════════════════════════════════
  // DETALLE / TRANSICIONES DE ESTADO
  // ════════════════════════════════════════

  const abrirDetallePedido = async (pedido) => {
    setPedidoSeleccionado(pedido);
    setMostrarDetalle(true);
    setCargandoDetalle(true);
    try {
      const { data } = await supabase
        .from('pedido_proveedor_detalle')
        .select('id_pedido_detalle, cantidad_pedida, costo_estimado, productos(descripcion, codigo_barras)')
        .eq('id_pedido', pedido.id_pedido);
      setDetalleItems(data || []);
    } finally {
      setCargandoDetalle(false);
    }
  };

  const cerrarDrawerDetalle = () => setMostrarDetalle(false);

  const marcarEnviado = (pedido) => {
    mostrarAlerta(`¿Marcar el pedido #${pedido.id_pedido} como ENVIADO al proveedor?`, 'warning', async () => {
      try {
        const { error } = await supabase.from('pedidos_proveedor').update({ estado: 'ENVIADO', fecha_envio: new Date().toISOString() }).eq('id_pedido', pedido.id_pedido);
        if (error) throw error;
        cargarPedidos();
      } catch (err) {
        mostrarAlerta('Error: ' + err.message, 'error');
      }
    }, 'Sí, marcar enviado');
  };

  const cancelarPedido = (pedido) => {
    mostrarAlerta(`¿Cancelar el pedido #${pedido.id_pedido}? Esta acción no se puede deshacer.`, 'warning', async () => {
      try {
        const { error } = await supabase.from('pedidos_proveedor').update({ estado: 'CANCELADO' }).eq('id_pedido', pedido.id_pedido);
        if (error) throw error;
        cargarPedidos();
      } catch (err) {
        mostrarAlerta('Error: ' + err.message, 'error');
      }
    }, 'Sí, cancelar pedido', null, 'Volver');
  };

  // ════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════

  if (cargandoCatalogos) return <div className="admin-ped-loading">Conectando con la base de datos...</div>;

  return (
    <div className="admin-ped-container">

      <AlertaSistemaModal alerta={alertaSistema} onClose={() => setAlertaSistema(null)} />

      {vista === 'lista' ? (
        <>
          <div className="ped-top-bar">
            <div className="ped-title-area">
              <h2>Pedidos a Proveedor</h2>
              <p>Órdenes de compra futuras, antes de que la mercadería llegue</p>
            </div>
            <div className="ped-toolbar">
              <button type="button" className="btn-ped-primary" onClick={abrirNuevoPedido}>+ Nuevo Pedido</button>
              <button type="button" className="btn-ped-outline" disabled={!pedidoSeleccionado} onClick={() => abrirDetallePedido(pedidoSeleccionado)}><UiIcon name="Search" size={15} /> Ver Detalle</button>
              <button type="button" className="btn-ped-outline" disabled={!pedidoSeleccionado || pedidoSeleccionado.estado !== 'BORRADOR'} onClick={() => marcarEnviado(pedidoSeleccionado)}><UiIcon name="Upload" size={15} /> Marcar Enviado</button>
              <button type="button" className="btn-ped-outline btn-ped-danger" disabled={!pedidoSeleccionado || !['BORRADOR', 'ENVIADO'].includes(pedidoSeleccionado.estado)} onClick={() => cancelarPedido(pedidoSeleccionado)}><UiIcon name="X" size={15} /> Cancelar Pedido</button>
            </div>
          </div>

          <div className="ped-filters-bar">
            <div className="ped-campo-filtro">
              <label>Proveedor</label>
              <SearchableSelect
                className="ped-select"
                options={proveedores}
                value={filtroProveedor}
                onChange={setFiltroProveedor}
                getOptionValue={(p) => p.id_proveedor}
                getOptionLabel={(p) => p.razon_social}
                getOptionSearchText={(p) => `${p.razon_social} ${p.ruc || ''}`}
                placeholder="Buscar proveedor..."
                emptyOptionLabel="Todos"
              />
            </div>
            <div className="ped-campo-filtro">
              <label>Estado</label>
              <select className="ped-select" value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
                <option value="">Todos</option>
                <option value="BORRADOR">Borrador</option>
                <option value="ENVIADO">Enviado</option>
                <option value="RECIBIDO">Recibido</option>
                <option value="CANCELADO">Cancelado</option>
              </select>
            </div>
          </div>

          <div className="ped-table-container">
            <div className="ped-table-scroll">
              <table className="ped-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Proveedor</th>
                    <th>Fecha</th>
                    <th>Items</th>
                    <th>Total Estimado</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {cargandoPedidos ? (
                    <tr><td colSpan={6} className="empty-ped"><LogoCargando texto="Cargando pedidos..." /></td></tr>
                  ) : pedidos.length === 0 ? (
                    <tr><td colSpan={6} className="empty-ped">No hay pedidos registrados con estos filtros.</td></tr>
                  ) : (
                    pedidos.map(p => {
                      const totalEst = (p.pedido_proveedor_detalle || []).reduce((s, d) => s + (Number(d.cantidad_pedida) || 0) * (Number(d.costo_estimado) || 0), 0);
                      return (
                        <tr
                          key={p.id_pedido}
                          className={pedidoSeleccionado?.id_pedido === p.id_pedido ? 'ped-row-selected' : ''}
                          onClick={() => setPedidoSeleccionado(p)}
                        >
                          <td className="font-bold">#{p.id_pedido}</td>
                          <td>{p.proveedores?.razon_social || '---'}</td>
                          <td>{new Date(p.fecha_pedido).toLocaleDateString('es-PE')}</td>
                          <td className="text-center">{(p.pedido_proveedor_detalle || []).length}</td>
                          <td>S/ {totalEst.toFixed(2)}</td>
                          <td><span className={`ped-badge-estado est-${p.estado.toLowerCase()}`}>{ESTADO_LABEL[p.estado]}</span></td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="ped-top-bar">
            <div className="ped-title-area">
              <h2>Nuevo Pedido a Proveedor</h2>
              <p>Elige el proveedor y arma la lista de productos a pedir</p>
            </div>
            <div className="ped-toolbar">
              <button type="button" className="btn-ped-outline" onClick={cancelarNuevoPedido}>← Volver al listado</button>
              <button type="button" className="btn-ped-outline btn-ped-danger" onClick={descartarNuevoPedido}><UiIcon name="X" size={15} /> Descartar pedido</button>
            </div>
          </div>

          <div className="ped-builder-zonas">

            {/* (a) Datos del pedido — a quién (Proveedor) y qué ayuda a decidir (Laboratorio) */}
            <div className="ped-card">
              <h3 className="ped-card-titulo">Datos del pedido</h3>
              <div className="ped-fila-datos-pedido">
                <div className="ped-campo-filtro">
                  <label>Proveedor</label>
                  <SearchableSelect
                    className="ped-select"
                    options={proveedores}
                    value={proveedorNuevo}
                    onChange={setProveedorNuevo}
                    getOptionValue={(p) => p.id_proveedor}
                    getOptionLabel={(p) => p.razon_social}
                    getOptionSearchText={(p) => `${p.razon_social} ${p.ruc || ''}`}
                    placeholder="Buscar proveedor..."
                    emptyOptionLabel="Selecciona un proveedor..."
                  />
                </div>
                <div className="ped-campo-filtro">
                  <label>Laboratorio (para ayudar a decidir qué pedir)</label>
                  <SearchableSelect
                    className="ped-select"
                    options={laboratorios}
                    value={laboratorioFiltro}
                    onChange={setLaboratorioFiltro}
                    getOptionValue={(l) => l.id_laboratorio}
                    getOptionLabel={(l) => l.nombre}
                    placeholder="Buscar laboratorio..."
                    emptyOptionLabel="-- Ninguno --"
                  />
                </div>
              </div>
            </div>

            {/* (b) Productos del laboratorio elegido — con stock, para decidir qué agregar */}
            {laboratorioFiltro && (
              <div className="ped-card">
                <div className="ped-card-header">
                  <h3 className="ped-card-titulo"><UiIcon name="FlaskConical" size={15} /> Productos de este laboratorio</h3>
                </div>
                <div className="ped-lab-scroll">
                  {cargandoProductosLab ? (
                    <div className="ped-detalle-cargando"><LogoCargando texto="Cargando productos..." /></div>
                  ) : productosPorLaboratorio.length === 0 ? (
                    <p className="text-muted ped-lab-msg">Este laboratorio no tiene productos activos registrados.</p>
                  ) : (
                    <table className="ped-lab-tabla">
                      <thead>
                        <tr>
                          <th className="col-codigo">Código</th>
                          <th className="col-producto">Producto</th>
                          <th className="col-stock-actual text-center">Stock Actual</th>
                          <th className="col-stock-minimo text-center">Stock Mínimo</th>
                          <th className="col-accion"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {productosPorLaboratorio.map(item => {
                          const bajoMinimo = item.bajoMinimo;
                          const yaEnCarrito = carritoPedido.some(f => f.id_producto === item.id_producto);
                          return (
                            <tr key={item.id_producto} className={bajoMinimo ? 'ped-row-bajo-stock' : ''}>
                              <td className="col-codigo text-muted ped-td-truncate">{item.codigo_barras || '---'}</td>
                              <td className="col-producto ped-td-truncate" title={item.descripcion}>{item.descripcion}</td>
                              <td className={`col-stock-actual text-center font-bold ${bajoMinimo ? 'text-red' : ''}`}>{item.stockActual}</td>
                              <td className="col-stock-minimo text-center text-muted">{item.stock_minimo}</td>
                              <td className="col-accion text-center">
                                {yaEnCarrito ? (
                                  <span className="ped-ya-en-pedido">En el pedido</span>
                                ) : (
                                  <button type="button" className="btn-ped-agregar-lab" onClick={() => agregarProductoCarrito({ id_producto: item.id_producto, descripcion: item.descripcion })}>+ Agregar</button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

            {/* (c) Buscador manual — agregar cualquier producto sin pasar por el filtro de laboratorio */}
            <div className="ped-card">
              <h3 className="ped-card-titulo">Buscar y agregar producto</h3>
              <div className="ped-search-box">
                <span><UiIcon name="Search" size={16} /></span>
                <input type="text" placeholder="Buscar producto por nombre o código para agregar..." value={busquedaProducto} onChange={e => setBusquedaProducto(e.target.value)} />
              </div>
              {busquedaProducto.trim() && (
                <div className="ped-resultados-busqueda">
                  {buscandoProducto && <p className="text-muted ped-resultados-msg">Buscando...</p>}
                  {!buscandoProducto && resultadosBusqueda.length === 0 && <p className="text-muted ped-resultados-msg">Sin resultados.</p>}
                  {resultadosBusqueda.map(p => (
                    <div key={p.id_producto} className="ped-resultado-fila" onClick={() => agregarProductoCarrito(p)}>
                      <div>
                        <strong>{p.descripcion}</strong>
                        <br /><small className="text-muted">Cód: {p.codigo_barras || '---'} · {p.laboratorios?.nombre || 'Genérico'}</small>
                      </div>
                      <span className="ped-resultado-add">+</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* (d) Carrito del pedido — el resultado final, claramente destacado del resto */}
            <div className="ped-card ped-card-carrito">
              <h3 className="ped-card-titulo"><UiIcon name="ShoppingCart" size={15} /> Carrito del pedido</h3>
              <div className="ped-carrito-tabla-wrap">
                <table className="ped-carrito-tabla">
                  <thead>
                    <tr>
                      <th className="col-producto">Producto</th>
                      <th className="col-medida">Pedir en</th>
                      <th className="col-cantidad">Cantidad</th>
                      <th className="col-costo">Costo Estimado</th>
                      <th className="col-subtotal">Subtotal</th>
                      <th className="col-eliminar"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {carritoPedido.length === 0 ? (
                      <tr><td colSpan={6} className="empty-ped">Busca y agrega productos arriba.</td></tr>
                    ) : (
                      carritoPedido.map((f) => {
                        const factor = Number(f.factor) || 1;
                        const qty = Number(f.cantidad_pedida) || 0;
                        const und = unidadesDeFila(f);
                        const formas = f.formas || [];
                        return (
                          <tr key={f.ui_id}>
                            <td className="col-producto ped-td-truncate" title={f.descripcion}>{f.descripcion}</td>
                            <td className="col-medida">
                              {formas.length > 0 ? (
                                <select
                                  className="ped-input-carrito ped-select-medida"
                                  value={f.idMedidaSeleccionada || ''}
                                  onChange={(e) => cambiarMedidaFila(f.ui_id, e.target.value)}
                                >
                                  {formas.map((forma) => (
                                    <option key={forma.id_forma} value={forma.id_medida}>
                                      {etiquetaForma(forma)}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <span className="text-muted">{f.uMedida || 'UNIDAD'}</span>
                              )}
                            </td>
                            <td className="col-cantidad">
                              <input type="number" min="1" className="ped-input-carrito" value={f.cantidad_pedida} onChange={(e) => actualizarFilaCarrito(f.ui_id, 'cantidad_pedida', e.target.value)} />
                              {factor > 1 && (
                                <small className="ped-equiv-unidades">{qty} × {formatoFactor(factor)} = {und} und</small>
                              )}
                            </td>
                            <td className="col-costo">
                              <input type="number" min="0" step="0.01" className="ped-input-carrito" value={f.costo_estimado} onChange={(e) => actualizarFilaCarrito(f.ui_id, 'costo_estimado', e.target.value)} />
                              {factor > 1 && <small className="ped-equiv-unidades">por {String(f.uMedida || 'caja').toLowerCase()}</small>}
                            </td>
                            <td className="col-subtotal">S/ {(qty * (Number(f.costo_estimado) || 0)).toFixed(2)}</td>
                            <td className="col-eliminar"><button type="button" className="btn-ped-eliminar-fila" onClick={() => eliminarFilaCarrito(f.ui_id)}><UiIcon name="Trash2" size={16} /></button></td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="ped-builder-footer">
                <span className="ped-total-estimado">Total estimado: <strong>S/ {totalEstimadoCarrito.toFixed(2)}</strong></span>
                <button type="button" className="btn-ped-primary" disabled={guardandoPedido} onClick={guardarPedido}>
                  {guardandoPedido ? 'Guardando...' : <><UiIcon name="Save" size={15} /> Guardar como Borrador</>}
                </button>
              </div>
            </div>

          </div>
        </>
      )}

      {/* ── DRAWER: Ver Detalle de un pedido ya guardado ── */}
      {mostrarDetalle && pedidoSeleccionado && (
        <div className="ped-drawer">
          <div className="ped-drawer-header">
            <h3><UiIcon name="ClipboardList" size={15} /> Pedido #{pedidoSeleccionado.id_pedido} — {pedidoSeleccionado.proveedores?.razon_social}</h3>
            <button type="button" onClick={cerrarDrawerDetalle}><UiIcon name="X" size={16} /></button>
          </div>
          <div className="ped-drawer-body">
            {cargandoDetalle ? (
              <div className="ped-detalle-cargando"><LogoCargando texto="Cargando detalle..." /></div>
            ) : (
              <div className="ped-detalle-section-scroll">
                <table className="ped-carrito-tabla">
                  <thead>
                    <tr><th>Producto</th><th>Cantidad</th><th>Costo Estimado</th><th>Subtotal</th></tr>
                  </thead>
                  <tbody>
                    {detalleItems.map(d => (
                      <tr key={d.id_pedido_detalle}>
                        <td>{d.productos?.descripcion || '---'}</td>
                        <td>{d.cantidad_pedida} und</td>
                        <td>S/ {Number(d.costo_estimado).toFixed(2)}</td>
                        <td>S/ {(Number(d.cantidad_pedida) * Number(d.costo_estimado)).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
