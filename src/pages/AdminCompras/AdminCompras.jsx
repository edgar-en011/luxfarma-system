import { useState, useEffect, useRef, useMemo } from 'react';
import AlertaSistemaModal from '../../components/AlertaSistemaModal';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../context/AuthContext';
import './AdminCompras.css';
import { useLocation } from 'react-router-dom';
import SmartDateInput from '../../components/SmartDateInput';
import TablaFormasVenta from '../../components/TablaFormasVenta';
import ProductoFormModal from '../../components/ProductoFormModal';
import ModalAgregarProductoCompra from '../../components/ModalAgregarProductoCompra';
import '../../components/ProductoFormModal.css';
import SearchableSelect from '../../components/SearchableSelect';
import TecladoListbox from '../../components/TecladoListbox';
import UiIcon from '../../components/UiIcon';
import { hoyLocal } from '../../utils/fechas';
import { filaProductoPrecios } from '../../utils/productoPrecios';
import { buscarProductosCompra } from '../../utils/buscarProductosCompra';
import { leerDraftDeUsuario, escribirDraftDeUsuario, limpiarSessionDraft } from '../../utils/sessionDraft';
import { redondear2 } from '../../utils/dinero';
import { parsePrecio, formatSolesUnitario } from '../../utils/precioExacto';
import { formatearPorcentajeGanancia } from '../../utils/porcentajeGanancia';
import { assertEscritura } from '../../utils/supaWrite';
import { notificarProveedoresChanged, suscribirProveedoresChanged, esProveedorActivo } from '../../utils/proveedoresCatalogo';
import LogoCargandoOverlay from '../../components/LogoCargandoOverlay';
import LogoLuxFarma from '../../components/LogoLuxFarma';
import { parsearFacturaXML } from '../../services/facturaXmlParser';
import { emparejarItemXml, crearConstructorIndiceSimilitud, sugerirProductosPorSimilitud } from '../../services/compraXmlMatch';
import {
  listarCatalogoProductosXml,
  buscarProductoPorCodigoBarras,
  guardarVinculoCodigoProveedor,
} from '../../services/productoCodigosProveedor';
import { marcarCatalogoOfflineStale } from '../../utils/catalogoCache';
import { nombreLaboratorioDeProducto } from '../../utils/guardarProductoCatalogo';
import { armarPayloadRegistrarCompra } from '../../utils/compraRegistro';
import { registrarCompraEnServidor } from '../../utils/registrarCompraServidor';
import { sincronizarPCompraFormas } from '../../utils/aplicarCppCompra';

const TIPOS_COMPROBANTE_COMPRA = [
  { value: 'Nota de Venta', label: 'Nota de Venta' },
  { value: 'Factura Electrónica', label: 'Factura Electrónica' },
  { value: 'Boleta Electrónica', label: 'Boleta Electrónica' },
  { value: 'Guía de Remitente', label: 'Guía de Remitente' },
];

const MAX_PRODUCTOS_COMPRA = 70;
const COMPRAS_DRAFT_KEY = 'compras_registro_borrador';
const COMPRAS_DRAFT_LEGACY_KEY = 'luxfarma_borrador_compra';
const XML_OVERLAY_MIN_MS = 450;

function estadoFilaXml(p) {
  if (!p?.origenXml) return null;
  if (!p.id_producto) return 'pendiente';
  if (p.matchXml === 'nuevo') return 'nuevo';
  if (p.matchXml === 'manual') return 'manual';
  return 'auto';
}

function etiquetaEstadoXml(estado) {
  if (estado === 'pendiente') return 'Sin coincidencia';
  if (estado === 'nuevo') return 'Producto nuevo';
  if (estado === 'manual') return 'Vinculado';
  if (estado === 'auto') return 'Automático';
  return '';
}

function filaPermiteRenombrarDesdeXml(p) {
  return !!(p?.origenXml && p.matchXml !== 'nuevo' && String(p.descripcionXml || '').trim());
}

function filasRenombreCatalogoDesdeXml(filas) {
  const porProducto = new Map();
  for (const p of filas || []) {
    if (!filaPermiteRenombrarDesdeXml(p) || !p.actualizarNombreXml || !p.id_producto) continue;
    porProducto.set(p.id_producto, {
      id_producto: p.id_producto,
      nombreActual: String(p.descripcion || '').trim() || '(sin nombre)',
      descripcion: String(p.descripcionXml).trim(),
    });
  }
  return [...porProducto.values()];
}

function OpcionRenombrarNombreXml({ fila, onToggle }) {
  if (!filaPermiteRenombrarDesdeXml(fila)) return null;
  return (
    <div className="xml-renombrar">
      <p className="xml-desc-origen">Nombre en factura: {String(fila.descripcionXml).trim()}</p>
      <label className="xml-renombrar-check">
        <input
          type="checkbox"
          checked={!!fila.actualizarNombreXml}
          onChange={(e) => onToggle(fila.ui_id, e.target.checked)}
        />
        Actualizar nombre del producto con el de la factura
      </label>
    </div>
  );
}

function normalizarRuc(valor) {
  return String(valor || '').replace(/\D/g, '');
}

function rucsEquivalentes(a, b) {
  const x = normalizarRuc(a);
  const y = normalizarRuc(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return String(Number(x)) === String(Number(y));
}

function encontrarProveedorPorRuc(lista, rucXml) {
  const objetivo = normalizarRuc(rucXml);
  if (!objetivo) return null;
  return (lista || []).find((p) => rucsEquivalentes(p.ruc, objetivo)) || null;
}

const COMPROBANTE_INICIAL = () => ({
  tipo: 'Factura Electrónica', serie: '', numero: '',
  fechaCompra: hoyLocal(),
  fechaVencimiento: '', formaPago: 'Contado', diasCredito: '', venceCredito: ''
});

let filaManualSeq = 0;
function crearFilaManualVacia() {
  filaManualSeq += 1;
  return {
    ui_id: Date.now() * 1000 + filaManualSeq,
    id_producto: null,
    descripcion: '',
    laboratorio: '',
    uMedida: 'UNIDAD',
    idMedidaSeleccionada: '',
    cantidad: 1,
    cantidadDisplay: 1,
    factor: 1,
    pCosto: 0,
    pVenta: 0,
    igvPct: 18,
    bonificacion: false,
    fVencimiento: '',
    nroLote: '',
    subtotal: 0,
    origenXml: false,
    matchXml: null,
    codigoBarras: '',
    codigoProveedor: null,
    descripcionXml: '',
  };
}

/**
 * Traslada la condición de pago leída del XML al comprobante. Si el XML no la
 * declara o no se pudo interpretar, se respeta lo que ya tenía el formulario.
 */
function aplicarCondicionPagoXml(comprobante, condicion) {
  if (!condicion?.forma) return comprobante;
  if (condicion.forma === 'Contado') {
    return { ...comprobante, formaPago: 'Contado', diasCredito: '', venceCredito: '' };
  }
  const dias = Number(condicion.diasCredito) || 0;
  const actualizado = {
    ...comprobante,
    formaPago: 'Crédito',
    diasCredito: dias > 0 ? String(dias) : '',
    venceCredito: '',
  };
  if (dias > 0 && actualizado.fechaCompra) {
    const fecha = new Date(`${actualizado.fechaCompra}T12:00:00`);
    fecha.setDate(fecha.getDate() + dias);
    actualizado.venceCredito = fecha.toISOString().split('T')[0];
  } else if (condicion.fechaVencimiento) {
    actualizado.venceCredito = condicion.fechaVencimiento;
  }
  return actualizado;
}

function resumenCondicionPago(condicion) {
  if (!condicion?.forma) return null;
  if (condicion.forma === 'Contado') return 'Forma de pago del XML: Contado.';
  const dias = Number(condicion.diasCredito) || 0;
  return dias > 0
    ? `Forma de pago del XML: Crédito a ${dias} días.`
    : 'Forma de pago del XML: Crédito (sin plazo declarado, completa los días).';
}

/** Lee borrador solo si pertenece al usuario actual (aislado entre logins). */
function leerBorradorCompras(idUsuario) {
  if (idUsuario == null) return null;
  return leerDraftDeUsuario(COMPRAS_DRAFT_KEY, idUsuario, null);
}

// Celda de tabla con edición inline por doble clic — usada en Cantidad/P.Costo/P.Venta
// de la tabla "Productos de la Compra". Input no controlado (defaultValue) para no
// necesitar estado propio por celda; confirmar/cancelar los maneja el padre.
function CeldaEditableInline({ valor, formato, editando, onIniciarEdicion, onConfirmar, onCancelar }) {
  if (editando) {
    return (
      <input
        type="number"
        step="any"
        min="0"
        autoFocus
        data-enter-skip="true"
        defaultValue={valor}
        onFocus={e => e.target.select()}
        onBlur={e => {
          if (e.currentTarget.dataset.enterConfirmado === '1') return;
          onConfirmar(e.target.value);
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.dataset.enterConfirmado = '1';
            onConfirmar(e.currentTarget.value, 'enter');
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onCancelar();
          }
        }}
        className="input-edicion-inline"
      />
    );
  }
  return (
    <span className="celda-editable-dobleclic" onDoubleClick={onIniciarEdicion} title="Doble clic para editar">
      {formato(valor)}
    </span>
  );
}

export default function AdminCompras() {
  const { user } = useAuth();
  const location = useLocation();
  const borradorInicial = leerBorradorCompras(user?.id_usuario);

  const [dbProveedores, setDbProveedores] = useState([]);
  const [cargandoDatos, setCargandoDatos] = useState(true);
  const [registrando, setRegistrando] = useState(false);

  const [alertaSistema, setAlertaSistema] = useState(null);
  const mostrarAlerta = (mensaje, tipo = 'info', accionConfirmar = null, textoConfirmar = 'Aceptar', accionCancelar = null, textoCancelar = null, extra = null) => {
    setAlertaSistema({ mensaje, tipo, accionConfirmar, textoConfirmar, accionCancelar, textoCancelar, ...extra });
  };
  const alertOkBtnRef = useRef(null);
  // Guards síncronos de re-entrancia (mismo patrón que procesandoVentaRef en POS.jsx) —
  // el estado de React (registrando/anulandoCompra) no alcanza a re-renderizar el botón
  // como disabled antes de que un doble clic/doble tap dispare la función 2 veces.
  const registrandoCompraRef = useRef(false);
  const anulandoCompraRef = useRef(false);
  const confirmarDescuadreXmlRef = useRef(false);
  const confirmarRenombreXmlRef = useRef(false);
  useEffect(() => {
    if (alertaSistema && alertOkBtnRef.current) alertOkBtnRef.current.focus();
  }, [alertaSistema]);

  // Modal "Solo modificar precio"
  const [showModalPrecio, setShowModalPrecio] = useState(false);
  const [busquedaPrecio, setBusquedaPrecio] = useState('');
  const [resultadosPrecio, setResultadosPrecio] = useState([]);
  const [prodPrecio, setProdPrecio] = useState(null);
  const [nuevoCosto, setNuevoCosto] = useState('');
  const [nuevoPrecioVenta, setNuevoPrecioVenta] = useState('');
  const [guardandoPrecio, setGuardandoPrecio] = useState(false);

  // Solo se abre con clic en "+ Agregar producto" (o atajo desde Alertas con openModal).
  const [showModalProducto, setShowModalProducto] = useState(false);
  const [edicionModalProducto, setEdicionModalProducto] = useState(null);
  // Fila que hay que devolver al carrito si se cancela/cierra el modal sin guardar —
  // solo se llena cuando se edita una fila YA CONFIRMADA (no cuando se edita un
  // duplicado recién creado, que si se cancela debe seguir sin agregarse).
  const [filaParaRestaurarSiCancela, setFilaParaRestaurarSiCancela] = useState(null);
  const tipoDocRef = useRef(null);
  const serieInputRef = useRef(null);
  const pagoTogglesRef = useRef(null);
  const registrarCompraBtnRef = useRef(null);
  const [showModalProductoForm, setShowModalProductoForm] = useState(false);
  const [modoProductoForm, setModoProductoForm] = useState('nuevo');

  const [showModalProveedor, setShowModalProveedor] = useState(false);
  const [showModalGestionProv, setShowModalGestionProv] = useState(false);
  const [busquedaGestionProv, setBusquedaGestionProv] = useState('');
  const [proveedorEditandoId, setProveedorEditandoId] = useState(null);
  const [formProv, setFormProv] = useState({ ruc: '', razon_social: '', direccion: '', telefono: '', email: '' });
  const [guardandoProv, setGuardandoProv] = useState(false);
  const [togglingProvId, setTogglingProvId] = useState(null);
  const xmlInputRef = useRef(null);
  const xmlPendienteRef = useRef(null);
  const [showModalProveedorXml, setShowModalProveedorXml] = useState(false);
  const [xmlProveedorInfo, setXmlProveedorInfo] = useState({ ruc: '', razonSocial: '' });
  const [proveedorXmlElegidoId, setProveedorXmlElegidoId] = useState('');
  const [importandoXml, setImportandoXml] = useState(false);
  const [catalogoXmlProductos, setCatalogoXmlProductos] = useState([]);
  const catalogoXmlRef = useRef([]);
  catalogoXmlRef.current = catalogoXmlProductos;
  const [uiIdXmlCrearProducto, setUiIdXmlCrearProducto] = useState(null);
  const [productoFormPrefill, setProductoFormPrefill] = useState(null);

  const [proveedorSeleccionadoId, setProveedorSeleccionadoId] = useState(() => borradorInicial?.proveedorSeleccionadoId || '');
  const [comprobante, setComprobante] = useState(() => ({
    ...COMPROBANTE_INICIAL(),
    ...(borradorInicial?.comprobante || {}),
  }));
  const [productosCarrito, setProductosCarrito] = useState(() => borradorInicial?.productosCarrito || []);
  // Datos a conservar de la fila que se está reemplazando de producto — cantidad, lote,
  // vencimiento, bonificación e IGV son de la instancia de compra, no del producto en sí,
  // así que sobreviven al cambio; precio/factor/U.Medida se recalculan del producto NUEVO.
  const [filaAReemplazar, setFilaAReemplazar] = useState(null);
  const [percepcion, setPercepcion] = useState(() => borradorInicial?.percepcion ?? 0);
  const [actualizaPrecios, setActualizaPrecios] = useState(() => borradorInicial?.actualizaPrecios ?? true);
  const [compararPrecioVenta, setCompararPrecioVenta] = useState(() => borradorInicial?.compararPrecioVenta ?? true);
  // totalManual vive acá (con el resto del borrador) para poder restaurarlo al montar —
  // la UI de edición por doble clic sigue más abajo.
  const [editandoTotal, setEditandoTotal] = useState(false);
  const [totalManual, setTotalManual] = useState(() => (
    borradorInicial?.totalManual === undefined ? null : borradorInicial.totalManual
  ));
  const edicionTotalCanceladaRef = useRef(false);

  // ── Tabs: "Registrar Compra" (contenido actual, sin cambios) / "Historial de Compras" ──
  const [vistaActual, setVistaActual] = useState('registrar'); // 'registrar' | 'historial'
  const [historialComprasLista, setHistorialComprasLista] = useState([]);
  const [cargandoHistorialCompras, setCargandoHistorialCompras] = useState(false);
  const [compraDetalleVer, setCompraDetalleVer] = useState(null);
  const [detalleComprasLineas, setDetalleComprasLineas] = useState([]);
  const [cargandoDetalleCompra, setCargandoDetalleCompra] = useState(false);

  // ── Anular compra ──
  const motivosAnulacionCompra = [
    'Error en el registro',
    'Producto equivocado',
    'Precio/cantidad incorrecta',
    'Compra duplicada',
    'Otro',
  ];
  const [compraAAnular, setCompraAAnular] = useState(null);
  const [motivoAnulacionCompra, setMotivoAnulacionCompra] = useState(motivosAnulacionCompra[0]);
  const [anulandoCompra, setAnulandoCompra] = useState(false);
  const [msgAnulacionCompra, setMsgAnulacionCompra] = useState(null);
  const [shortfallsAnulacion, setShortfallsAnulacion] = useState([]);
  const [cargandoShortfalls, setCargandoShortfalls] = useState(false);

  // ── Recuperar Anulados ──
  const [showModalRecuperar, setShowModalRecuperar] = useState(false);
  const [filtroFechaDesdeRecuperar, setFiltroFechaDesdeRecuperar] = useState('');
  const [filtroFechaHastaRecuperar, setFiltroFechaHastaRecuperar] = useState('');
  const [filtroProveedorRecuperar, setFiltroProveedorRecuperar] = useState('');
  const [comprasAnuladasLista, setComprasAnuladasLista] = useState([]);
  const [cargandoComprasAnuladas, setCargandoComprasAnuladas] = useState(false);
  const [recuperandoDetalleId, setRecuperandoDetalleId] = useState(null);
  // Compra anulada de la que se recuperaron productos hacia el carrito actual — se
  // guarda como compra_origen_id al registrar, para trazabilidad. Si se recupera de
  // más de una compra anulada en el mismo carrito, queda la última (caso raro).
  const [compraOrigenId, setCompraOrigenId] = useState(() => borradorInicial?.compraOrigenId || null);

  // ── Cargar desde Pedido Proveedor (Fase 2 de "Gestionar Pedido Proveedor") ──
  // Mismo patrón que "Recuperar Anulados": trae el detalle de un pedido en estado
  // ENVIADO hacia productosCarrito. Se guarda como id_pedido_origen al registrar la
  // compra, y ese pedido pasa a estado RECIBIDO — cierra el ciclo pedido→compra.
  const [showModalCargarPedido, setShowModalCargarPedido] = useState(false);
  const [pedidosDisponibles, setPedidosDisponibles] = useState([]);
  const [cargandoPedidosDisponibles, setCargandoPedidosDisponibles] = useState(false);
  const [cargandoPedidoId, setCargandoPedidoId] = useState(null);
  const [pedidoOrigenId, setPedidoOrigenId] = useState(() => borradorInicial?.pedidoOrigenId || null);
  // Ids de pedidos ya cargados en el carrito actual — evita que el mismo pedido se
  // cargue 2 veces (duplicando sus productos) si el modal se vuelve a abrir antes de
  // registrar o cancelar la compra en curso.
  const [pedidosCargadosIds, setPedidosCargadosIds] = useState(() => borradorInicial?.pedidosCargadosIds || []);
  const [xmlTotalesOficiales, setXmlTotalesOficiales] = useState(() => borradorInicial?.xmlTotalesOficiales || null);

  // Toggle "Forma de Pago": pagoEnfocado es el resaltado visual mientras el contenedor
  // tiene el foco (independiente de comprobante.formaPago, que es la selección confirmada).
  const [pagoEnfocado, setPagoEnfocado] = useState('Contado');
  const diasCreditoInputRef = useRef(null);
  const agregarProductoBtnRef = useRef(null);

  useEffect(() => {
    const cargarDatosMaestros = async () => {
      setCargandoDatos(true);
      try {
        const { data: provData } = await supabase.from('proveedores').select('*').order('razon_social', { ascending: true });
        setDbProveedores(provData || []);
        // Productos se buscan en tiempo real desde la BD (no hay límite de filas)
      } catch {
        mostrarAlerta("No se pudieron cargar los catálogos de la base de datos.", "error");
      } finally {
        setCargandoDatos(false);
      }
    };
    cargarDatosMaestros();
    return suscribirProveedoresChanged(cargarDatosMaestros);
  }, []);

  // Auto-guarda el borrador en sessionStorage (silencioso, como POS) — sobrevive
  // navegación a otras pantallas. Se limpia solo al registrar o cancelar la compra.
  // Incluye idUsuario para no cruzar borradores entre logins en la misma pestaña.
  useEffect(() => {
    if (!user?.id_usuario) return;
    escribirDraftDeUsuario(COMPRAS_DRAFT_KEY, user.id_usuario, {
      proveedorSeleccionadoId,
      comprobante,
      productosCarrito,
      percepcion,
      actualizaPrecios,
      compararPrecioVenta,
      totalManual,
      compraOrigenId,
      pedidoOrigenId,
      pedidosCargadosIds,
      xmlTotalesOficiales,
    });
  }, [
    user?.id_usuario, proveedorSeleccionadoId, comprobante, productosCarrito, percepcion,
    actualizaPrecios, compararPrecioVenta, totalManual, compraOrigenId, pedidoOrigenId,
    pedidosCargadosIds, xmlTotalesOficiales,
  ]);

  const limpiarBorradorCompra = () => {
    limpiarSessionDraft(COMPRAS_DRAFT_KEY);
    try { localStorage.removeItem(COMPRAS_DRAFT_LEGACY_KEY); } catch { /* ignore */ }
  };

  // Al llegar desde AdminAlertas.jsx ("+ Orden de compra" / acción "Comprar"), abre
  // directo el panel de configuración del producto exacto por id_producto. Antes se
  // mandaba el NOMBRE del producto y se buscaba filtrando "dbProductos" — un estado
  // que en realidad nunca se llena (la búsqueda real de este archivo vive en
  // buscarEnBD/resultadosBusqueda desde que se pasó a búsqueda en vivo), así que este
  // atajo nunca funcionaba, ni con nombres reales ni con "Desconocido". Buscar
  // directo por id evita depender tanto del nombre mostrado en la pantalla de origen
  // (que podía estar roto) como de ese estado muerto.
  useEffect(() => {
    const idProductoPredefinido = location.state?.idProductoPredefinido;
    if (!idProductoPredefinido || !location.state?.openModal) return;
    (async () => {
      const { data: prod } = await supabase
        .from('productos')
        .select('*, laboratorios(nombre), producto_precios(precio_venta, costo, precio_caja, ganancia)')
        .eq('id_producto', idProductoPredefinido)
        .maybeSingle();
      if (!prod) {
        mostrarAlerta('No se encontró el producto en la base de datos.', 'warning');
        return;
      }
      const productos = await listarCatalogoProductosXml();
      setCatalogoXmlProductos(productos || []);
      const fp = filaProductoPrecios(prod.producto_precios);
      const fila = {
        ...crearFilaManualVacia(),
        id_producto: prod.id_producto,
        descripcion: prod.descripcion,
        laboratorio: prod.laboratorios?.nombre || '---',
        pCosto: Number(fp?.costo) || 0,
        pVenta: Number(fp?.precio_venta) || 0,
        codigoBarras: prod.codigo_barras || '',
      };
      fila.subtotal = redondear2(Number(fila.cantidad) * Number(fila.pCosto));
      setProductosCarrito((prev) => [...prev, fila]);
      setCeldaEditando({ ui_id: fila.ui_id, campo: 'cantidad' });
    })();
  }, [location.state]);

  const handleCancelarCompra = () => {
    if (productosCarrito.length === 0 && !proveedorSeleccionadoId) return;
    mostrarAlerta("¿Estás seguro de cancelar esta compra?", "warning", () => {
      setProductosCarrito([]);
      setComprobante(COMPROBANTE_INICIAL());
      setProveedorSeleccionadoId('');
      setPercepcion(0);
      setCompraOrigenId(null);
      setPedidoOrigenId(null);
      setPedidosCargadosIds([]);
      setTotalManual(null);
      setXmlTotalesOficiales(null);
      limpiarBorradorCompra();
    }, "Sí, cancelar", () => { }, "Volver");
  };

  const resetearFormularioCompraLocal = () => {
    xmlPendienteRef.current = null;
    if (xmlInputRef.current) xmlInputRef.current.value = '';
    setProductosCarrito([]);
    setComprobante(COMPROBANTE_INICIAL());
    setProveedorSeleccionadoId('');
    setPercepcion(0);
    setCompraOrigenId(null);
    setPedidoOrigenId(null);
    setPedidosCargadosIds([]);
    setTotalManual(null);
    setEditandoTotal(false);
    setCeldaEditando(null);
    setCatalogoXmlProductos([]);
    setImportandoXml(false);
    setShowModalProveedorXml(false);
    setProveedorXmlElegidoId('');
    setXmlProveedorInfo({ ruc: '', razonSocial: '' });
    setUiIdXmlCrearProducto(null);
    setProductoFormPrefill(null);
    setFormProv({ ruc: '', razon_social: '', direccion: '', telefono: '', email: '' });
    setPagoEnfocado('Contado');
    setActualizaPrecios(true);
    setCompararPrecioVenta(true);
    setXmlTotalesOficiales(null);
    limpiarBorradorCompra();
  };

  const abrirModalAgregarProductoLimpio = () => {
    setFilaParaRestaurarSiCancela(null);
    setFilaAReemplazar(null);
    setEdicionModalProducto(null);
    setShowModalProducto(true);
  };

  const cerrarModalAgregarProducto = () => {
    if (filaParaRestaurarSiCancela) setProductosCarrito(prev => [...prev, filaParaRestaurarSiCancela]);
    setFilaParaRestaurarSiCancela(null);
    setFilaAReemplazar(null);
    setEdicionModalProducto(null);
    setShowModalProducto(false);
  };

  const handleAgregarLineaDesdeModal = (nuevoItem) => {
    setProductosCarrito((prev) => [...prev, nuevoItem]);
    setFilaParaRestaurarSiCancela(null);
    setFilaAReemplazar(null);
    setEdicionModalProducto(null);
    if (proveedorSeleccionadoId && nuevoItem.codigoProveedor) {
      persistirVinculoXml(nuevoItem.id_producto, nuevoItem.codigoProveedor);
    }
  };

  const handleProductoCatalogoDesdeModal = (productoGuardado) => {
    const labNuevo = nombreLaboratorioDeProducto(productoGuardado);
    setProductosCarrito((prev) => prev.map((p) => (p.id_producto === productoGuardado.id_producto
      ? {
        ...p,
        descripcion: productoGuardado.descripcion || p.descripcion,
        laboratorio: labNuevo || p.laboratorio,
        codigoBarras: productoGuardado.codigo_barras ?? p.codigoBarras,
      }
      : p)));
    setCatalogoXmlProductos((prev) => prev.map((p) => (
      String(p.id_producto) === String(productoGuardado.id_producto)
        ? { ...productoGuardado, stockTotal: p.stockTotal }
        : p
    )));
  };

  const handleReiniciarImportacionXml = () => {
    mostrarAlerta(
      '¿Seguro que quieres descartar esta importación? Se perderá todo lo cargado (proveedor, comprobante e ítems). No se borra nada de la base de datos.',
      'warning',
      () => resetearFormularioCompraLocal(),
      'Sí, descartar',
      () => { },
      'Volver',
    );
  };

  useEffect(() => {
    const onF2 = (e) => {
      if (e.key !== 'F2') return;
      if (vistaActual !== 'registrar') return;
      if (
        showModalProducto
        || showModalProductoForm
        || showModalProveedor
        || showModalGestionProv
        || showModalPrecio
        || showModalRecuperar
        || showModalCargarPedido
        || showModalProveedorXml
        || alertaSistema
        || compraAAnular
      ) return;
      e.preventDefault();
      abrirModalAgregarProductoLimpio();
    };
    document.addEventListener('keydown', onF2);
    return () => document.removeEventListener('keydown', onF2);
  }, [
    vistaActual,
    showModalProducto,
    showModalProductoForm,
    showModalProveedor,
    showModalGestionProv,
    showModalPrecio,
    showModalRecuperar,
    showModalCargarPedido,
    showModalProveedorXml,
    alertaSistema,
    compraAAnular,
  ]);

  const handleGuardadoProductoForm = (productoGuardado) => {
    if (uiIdXmlCrearProducto) {
      const uiId = uiIdXmlCrearProducto;
      setUiIdXmlCrearProducto(null);
      setProductoFormPrefill(null);
      vincularProductoFilaXml(uiId, productoGuardado.id_producto, productoGuardado, 'nuevo');
    }
  };

  const persistirVinculoXml = async (idProducto, codigo) => {
    const { ok, error } = await guardarVinculoCodigoProveedor(proveedorSeleccionadoId, idProducto, codigo);
    if (!ok) {
      mostrarAlerta(error?.message || 'No se pudo guardar el código de proveedor.', 'warning');
    }
  };

  const aplicarFacturaXmlAlCarrito = async (factura, idProveedor, { silenciarAlerta = false } = {}) => {
    setComprobante((prev) => aplicarCondicionPagoXml({
      ...prev,
      tipo: 'Factura Electrónica',
      serie: factura.serie || prev.serie,
      numero: factura.numero != null ? String(factura.numero) : prev.numero,
      fechaCompra: factura.fechaEmision || prev.fechaCompra,
    }, factura.condicionPago));
    setProveedorSeleccionadoId(idProveedor);

    const productos = await listarCatalogoProductosXml();
    setCatalogoXmlProductos(productos);

    const { data: codigosRows } = await supabase
      .from('producto_codigos_proveedor')
      .select('id_producto, codigo_proveedor')
      .eq('id_proveedor', idProveedor);
    const codigosMap = new Map();
    (codigosRows || []).forEach((r) => {
      if (r.codigo_proveedor) codigosMap.set(String(r.codigo_proveedor), r.id_producto);
    });

    const nuevasFilas = (factura.items || []).map((item, i) => {
      const { producto, tipo } = emparejarItemXml(item, { codigosMap, productos });
      const cant = Number(item.cantidad) || 0;
      const esBonif = !!item.bonificacion;
      const costo = esBonif ? 0 : (Number(item.precioUnitario) || 0);
      return {
        ui_id: Date.now() + i,
        id_producto: producto?.id_producto || null,
        descripcion: producto?.descripcion || item.descripcion || 'Sin coincidencia',
        descripcionXml: item.descripcion || '',
        laboratorio: producto?.laboratorios?.nombre || '---',
        uMedida: item.unidadMedida || 'UNIDAD',
        idMedidaSeleccionada: '',
        cantidad: cant,
        cantidadDisplay: cant,
        factor: 1,
        pCosto: costo,
        pVenta: producto ? Number(filaProductoPrecios(producto.producto_precios)?.precio_venta) || 0 : 0,
        igvPct: 18,
        bonificacion: esBonif,
        fVencimiento: item.fechaVencimiento || '',
        nroLote: item.lote || '',
        subtotal: esBonif ? 0 : redondear2(cant * costo),
        igvXml: esBonif ? 0 : (item.igv != null ? Number(item.igv) : null),
        codigoProveedor: item.codigoProveedor || null,
        codigoBarras: producto?.codigo_barras || '',
        matchXml: tipo || null,
        origenXml: true,
        actualizarNombreXml: false,
        sugerenciaXmlDescartada: false,
      };
    });

    if (productosCarrito.length + nuevasFilas.length > MAX_PRODUCTOS_COMPRA) {
      throw new Error(`El XML trae ${nuevasFilas.length} ítem(s) y superarías el máximo de ${MAX_PRODUCTOS_COMPRA} por compra.`);
    }

    setProductosCarrito((prev) => [...prev, ...nuevasFilas]);
    setXmlTotalesOficiales(factura.totales || null);
    const auto = nuevasFilas.filter((f) => f.id_producto).length;
    const notaPago = resumenCondicionPago(factura.condicionPago);
    if (!silenciarAlerta) {
      mostrarAlerta(
        `${auto} de ${nuevasFilas.length} ítems vinculados automáticamente. Revisa cantidades, costos y vencimientos antes de guardar.${notaPago ? ` ${notaPago}` : ''}`,
        auto === nuevasFilas.length ? 'success' : 'warning',
      );
    }
    return { auto, total: nuevasFilas.length, notaPago };
  };

  const handleArchivoXml = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const t0 = Date.now();
    setImportandoXml(true);
    let pendienteProveedorNuevo = false;
    let resumenImport = null;
    let errorImport = null;
    try {
      const factura = parsearFacturaXML(await file.arrayBuffer());
      const rucXml = factura.proveedor?.ruc || '';
      const { data: provFresh } = await supabase.from('proveedores').select('*').order('razon_social', { ascending: true });
      if (provFresh) setDbProveedores(provFresh);
      const lista = provFresh || dbProveedores;
      const prov = encontrarProveedorPorRuc(lista, rucXml);
      if (!prov) {
        xmlPendienteRef.current = factura;
        setXmlProveedorInfo({
          ruc: rucXml || '—',
          razonSocial: factura.proveedor?.razonSocial || '—',
        });
        setProveedorXmlElegidoId('');
        setFormProv({
          ruc: normalizarRuc(rucXml) || rucXml || '',
          razon_social: factura.proveedor?.razonSocial || '',
          direccion: '',
          telefono: '',
          email: '',
        });
        setComprobante((prev) => ({
          ...prev,
          tipo: 'Factura Electrónica',
          serie: factura.serie || prev.serie,
          numero: factura.numero != null ? String(factura.numero) : prev.numero,
          fechaCompra: factura.fechaEmision || prev.fechaCompra,
        }));
        pendienteProveedorNuevo = true;
      } else {
        resumenImport = await aplicarFacturaXmlAlCarrito(factura, prov.id_proveedor, { silenciarAlerta: true });
      }
    } catch (err) {
      errorImport = err?.message || 'No se pudo importar el XML.';
    } finally {
      const resto = XML_OVERLAY_MIN_MS - (Date.now() - t0);
      if (resto > 0) await new Promise((r) => setTimeout(r, resto));
      setImportandoXml(false);
      if (pendienteProveedorNuevo) setShowModalProveedorXml(true);
      else if (errorImport) mostrarAlerta(errorImport, 'error');
      else if (resumenImport) {
        mostrarAlerta(
          `${resumenImport.auto} de ${resumenImport.total} ítems vinculados automáticamente. Revisa cantidades, costos y vencimientos antes de guardar.${resumenImport.notaPago ? ` ${resumenImport.notaPago}` : ''}`,
          resumenImport.auto === resumenImport.total ? 'success' : 'warning',
        );
      }
    }
  };

  const vincularProductoFilaXml = async (uiId, idProducto, prodOverride = null, tipoMatch = 'manual') => {
    const prod = prodOverride || catalogoXmlProductos.find((p) => String(p.id_producto) === String(idProducto));
    if (!prod) return;
    setCatalogoXmlProductos((prev) => {
      if (prev.some((p) => String(p.id_producto) === String(prod.id_producto))) return prev;
      return [prod, ...prev];
    });
    const fila = productosCarrito.find((p) => p.ui_id === uiId);
    let origenXml = false;
    setProductosCarrito((prev) => prev.map((p) => {
      if (p.ui_id !== uiId) return p;
      origenXml = !!p.origenXml;
      const precios = filaProductoPrecios(prod.producto_precios);
      return {
        ...p,
        id_producto: prod.id_producto,
        descripcion: prod.descripcion,
        laboratorio: prod.laboratorios?.nombre || p.laboratorio || '---',
        pVenta: Number(precios?.precio_venta) || p.pVenta,
        pCosto: p.origenXml ? p.pCosto : (Number(precios?.costo) || p.pCosto),
        codigoBarras: prod.codigo_barras || '',
        matchXml: tipoMatch,
        actualizarNombreXml: tipoMatch === 'nuevo' ? false : !!p.actualizarNombreXml,
      };
    }));
    if (!origenXml) {
      setTimeout(() => setCeldaEditando({ ui_id: uiId, campo: 'cantidad' }), 0);
    }
    if (proveedorSeleccionadoId && fila?.codigoProveedor) {
      await persistirVinculoXml(prod.id_producto, fila.codigoProveedor);
    }
  };

  const abrirAltaProductoDesdeXml = (fila) => {
    setUiIdXmlCrearProducto(fila.ui_id);
    setModoProductoForm('nuevo');
    setProductoFormPrefill({
      descripcion: fila.descripcionXml || fila.descripcion || '',
      costo: Number(fila.pCosto) || 0,
    });
    setShowModalProductoForm(true);
  };

  const proveedoresParaCompraNueva = useMemo(
    () => (dbProveedores || []).filter(esProveedorActivo),
    [dbProveedores],
  );
  const proveedoresFiltradosGestion = useMemo(() => {
    const q = busquedaGestionProv.trim().toLowerCase();
    if (!q) return dbProveedores || [];
    return (dbProveedores || []).filter((p) => {
      const texto = `${p.razon_social || ''} ${p.ruc || ''} ${p.telefono || ''}`.toLowerCase();
      return texto.includes(q);
    });
  }, [dbProveedores, busquedaGestionProv]);

  const abrirAltaProveedor = () => {
    setProveedorEditandoId(null);
    setFormProv({ ruc: '', razon_social: '', direccion: '', telefono: '', email: '' });
    setShowModalProveedor(true);
  };

  const abrirEdicionProveedor = (prov) => {
    setProveedorEditandoId(prov.id_proveedor);
    setFormProv({
      ruc: prov.ruc || '',
      razon_social: prov.razon_social || '',
      direccion: prov.direccion || '',
      telefono: prov.telefono || '',
      email: prov.email || '',
    });
    setShowModalGestionProv(false);
    setShowModalProveedor(true);
  };

  const toggleActivoProveedor = async (prov) => {
    const nuevo = esProveedorActivo(prov) ? 0 : 1;
    setTogglingProvId(prov.id_proveedor);
    try {
      const { data, error } = await supabase
        .from('proveedores')
        .update({ activo: nuevo })
        .eq('id_proveedor', prov.id_proveedor)
        .select()
        .single();
      if (error) throw error;
      setDbProveedores((prev) => prev.map((p) => (p.id_proveedor === prov.id_proveedor ? { ...p, ...data, activo: nuevo } : p)));
      if (nuevo === 0 && Number(proveedorSeleccionadoId) === Number(prov.id_proveedor)) {
        setProveedorSeleccionadoId('');
      }
      notificarProveedoresChanged();
    } catch (error) {
      mostrarAlerta('Error al cambiar el estado del proveedor: ' + error.message, 'error');
    } finally {
      setTogglingProvId(null);
    }
  };

  const handleGuardarProveedor = async (e) => {
    e.preventDefault();
    if (!formProv.ruc || !formProv.razon_social) return mostrarAlerta("RUC y Razón Social son obligatorios.", "warning");
    const rucLimpio = normalizarRuc(formProv.ruc) || String(formProv.ruc).trim();
    setGuardandoProv(true);
    try {
      const { data: listaProv, error: errLista } = await supabase
        .from('proveedores')
        .select('id_proveedor, razon_social, ruc');
      if (errLista) throw errLista;
      const dup = encontrarProveedorPorRuc(listaProv, rucLimpio);
      if (dup && Number(dup.id_proveedor) !== Number(proveedorEditandoId)) {
        const facturaPendiente = xmlPendienteRef.current;
        xmlPendienteRef.current = null;
        if (facturaPendiente && !proveedorEditandoId) {
          setProveedorSeleccionadoId(dup.id_proveedor);
          setShowModalProveedor(false);
          setShowModalProveedorXml(false);
          await aplicarFacturaXmlAlCarrito(facturaPendiente, dup.id_proveedor);
          return;
        }
        return mostrarAlerta(
          `Ya existe un proveedor con el RUC ${rucLimpio} (${dup.razon_social || 'sin razón social'}). No se puede duplicar.`,
          'warning'
        );
      }

      const payload = {
        ruc: rucLimpio,
        razon_social: formProv.razon_social.toUpperCase(),
        direccion: formProv.direccion,
        telefono: formProv.telefono,
        email: formProv.email,
      };

      if (proveedorEditandoId) {
        const { data, error } = await supabase
          .from('proveedores')
          .update(payload)
          .eq('id_proveedor', proveedorEditandoId)
          .select()
          .single();
        if (error) throw error;
        setDbProveedores((prev) => prev.map((p) => (p.id_proveedor === data.id_proveedor ? data : p)));
        setShowModalProveedor(false);
        setProveedorEditandoId(null);
        setFormProv({ ruc: '', razon_social: '', direccion: '', telefono: '', email: '' });
        notificarProveedoresChanged();
        mostrarAlerta('Proveedor actualizado.', 'success');
        return;
      }

      const { data, error } = await supabase.from('proveedores').insert([{
        ...payload,
        activo: 1,
      }]).select().single();
      if (error) throw error;
      setDbProveedores(prev => [...prev, data]);
      setProveedorSeleccionadoId(data.id_proveedor);
      setShowModalProveedor(false);
      setShowModalProveedorXml(false);
      setFormProv({ ruc: '', razon_social: '', direccion: '', telefono: '', email: '' });
      notificarProveedoresChanged();
      const facturaPendiente = xmlPendienteRef.current;
      xmlPendienteRef.current = null;
      if (facturaPendiente) {
        await aplicarFacturaXmlAlCarrito(facturaPendiente, data.id_proveedor);
      } else {
        mostrarAlerta("Proveedor registrado en la base de datos.", "success");
      }
    } catch (error) {
      mostrarAlerta("Error: " + error.message, "error");
    } finally { setGuardandoProv(false); }
  };

  const cerrarModalProveedorXml = () => {
    xmlPendienteRef.current = null;
    setShowModalProveedorXml(false);
    setProveedorXmlElegidoId('');
    setFormProv({ ruc: '', razon_social: '', direccion: '', telefono: '', email: '' });
  };

  const usarProveedorExistenteXml = async () => {
    if (!proveedorXmlElegidoId) {
      return mostrarAlerta('Elige un proveedor de la lista, o crea uno nuevo.', 'warning');
    }
    const factura = xmlPendienteRef.current;
    xmlPendienteRef.current = null;
    setShowModalProveedorXml(false);
    if (!factura) return;
    await aplicarFacturaXmlAlCarrito(factura, proveedorXmlElegidoId);
  };

  const abrirAltaProveedorDesdeXml = () => {
    setProveedorEditandoId(null);
    setShowModalProveedorXml(false);
    setShowModalProveedor(true);
  };

  const descartarSugerenciaXml = (uiId) => {
    setProductosCarrito((prev) => prev.map((p) => (
      p.ui_id === uiId ? { ...p, sugerenciaXmlDescartada: true } : p
    )));
  };

  const toggleActualizarNombreXml = (uiId, checked) => {
    setProductosCarrito((prev) => prev.map((p) => (
      p.ui_id === uiId ? { ...p, actualizarNombreXml: !!checked } : p
    )));
  };

  const toggleBonificacionFila = (uiId, checked) => {
    setProductosCarrito((prev) => prev.map((p) => {
      if (p.ui_id !== uiId) return p;
      const bonificacion = !!checked;
      return {
        ...p,
        bonificacion,
        subtotal: bonificacion ? 0 : redondear2(Number(p.cantidad) * Number(p.pCosto)),
      };
    }));
  };

  const totalesProductos = redondear2(productosCarrito.reduce((acc, p) => acc + Number(p.subtotal), 0));
  const esImportacionXml = productosCarrito.some((p) => p.origenXml);
  const xmlTotal = productosCarrito.filter((p) => p.origenXml).length;
  const xmlVinculados = productosCarrito.filter((p) => p.origenXml && p.id_producto).length;
  const xmlPendientes = xmlTotal - xmlVinculados;

  const filasPendientesXml = useMemo(
    () => productosCarrito
      .filter((p) => p.origenXml && !p.id_producto && !p.sugerenciaXmlDescartada)
      .map((p) => ({ ui_id: p.ui_id, descripcionXml: p.descripcionXml || '' })),
    [productosCarrito],
  );
  const claveSugerenciasXml = filasPendientesXml
    .map((p) => `${p.ui_id}:${p.descripcionXml}`)
    .join('|');

  // El scoring contra el catálogo completo (miles de productos) se hace en lotes
  // durante los ratos libres del navegador: si se calcula de golpe en el render,
  // el overlay "Analizando XML…" se congela hasta que termina.
  const [sugerenciasPorFilaXml, setSugerenciasPorFilaXml] = useState({});
  const indiceSimilitudRef = useRef({ fuente: null, indice: null });
  useEffect(() => {
    if (!filasPendientesXml.length || !catalogoXmlProductos.length) {
      setSugerenciasPorFilaXml((prev) => (Object.keys(prev).length ? {} : prev));
      return undefined;
    }

    let cancelado = false;
    let handle = null;
    const usaIdle = typeof window.requestIdleCallback === 'function';
    const agendar = (fn) => {
      handle = usaIdle
        ? window.requestIdleCallback(fn, { timeout: 200 })
        : window.setTimeout(fn, 0);
    };
    const cancelar = () => {
      if (handle == null) return;
      if (usaIdle) window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };

    const constructorIndice = indiceSimilitudRef.current.fuente === catalogoXmlProductos
      ? null
      : crearConstructorIndiceSimilitud(catalogoXmlProductos);
    const acumulado = {};
    let fila = 0;

    const paso = () => {
      if (cancelado) return;
      if (constructorIndice && !constructorIndice.terminado) {
        constructorIndice.procesarLote(600);
        if (constructorIndice.terminado) {
          indiceSimilitudRef.current = { fuente: catalogoXmlProductos, indice: constructorIndice.indice };
        }
        agendar(paso);
        return;
      }
      const indice = indiceSimilitudRef.current.indice;
      const hasta = Math.min(fila + 3, filasPendientesXml.length);
      for (; fila < hasta; fila += 1) {
        const f = filasPendientesXml[fila];
        acumulado[f.ui_id] = sugerirProductosPorSimilitud(f.descripcionXml, indice);
      }
      if (fila < filasPendientesXml.length) {
        setSugerenciasPorFilaXml({ ...acumulado });
        agendar(paso);
        return;
      }
      setSugerenciasPorFilaXml(acumulado);
    };

    agendar(paso);
    return () => {
      cancelado = true;
      cancelar();
    };
    // claveSugerenciasXml cubre altas/bajas de filas pendientes y el texto XML.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveSugerenciasXml, catalogoXmlProductos]);

  const igvDesdeLineas = redondear2(productosCarrito.reduce((acc, p) => {
    if (p.bonificacion) return acc;
    if (p.igvXml != null && p.igvXml !== '') return acc + Number(p.igvXml);
    return acc + redondear2(Number(p.subtotal || 0) * 0.18);
  }, 0));
  const totalDesdeLineasConIgv = redondear2(totalesProductos + igvDesdeLineas);

  const xmlTotalesOk = esImportacionXml && xmlTotalesOficiales && xmlTotalesOficiales.total != null;
  const totalOficialXml = xmlTotalesOk ? redondear2(Number(xmlTotalesOficiales.total)) : null;
  const totalCompra = xmlTotalesOk
    ? redondear2(totalOficialXml + Number(percepcion || 0))
    : redondear2(totalesProductos + Number(percepcion || 0));

  const descuadreXml = xmlTotalesOk
    ? redondear2(totalDesdeLineasConIgv - totalOficialXml)
    : 0;
  const hayDescuadreXml = xmlTotalesOk && Math.abs(descuadreXml) > 0.05;

  // ── Edición manual de TOTAL COMPRA (doble clic) — para cuando el proveedor cobra un
  // monto distinto al calculado (ej. redondeos, descuentos de último minuto).
  // totalManual / editandoTotal se declaran arriba con el resto del borrador.
  const cancelarEdicionTotal = () => {
    edicionTotalCanceladaRef.current = true;
    setEditandoTotal(false);
  };

  const confirmarEdicionTotal = (valorStr) => {
    if (edicionTotalCanceladaRef.current) { edicionTotalCanceladaRef.current = false; return; }
    setEditandoTotal(false);
    if (valorStr === '') { setTotalManual(null); return; }
    const valor = Number(valorStr);
    if (isNaN(valor) || valor < 0) { setTotalManual(null); return; }
    setTotalManual(valor);
  };

  const totalCompraFinal = totalManual !== null ? redondear2(totalManual) : totalCompra;
  const subtotal = xmlTotalesOk
    ? redondear2(Number(xmlTotalesOficiales.gravado ?? totalesProductos))
    : redondear2(totalCompraFinal / 1.18);
  const igv = xmlTotalesOk
    ? redondear2(Number(xmlTotalesOficiales.igv ?? (totalCompraFinal - subtotal)))
    : redondear2(totalCompraFinal - subtotal);

  // ── Edición inline por doble clic (Cantidad / P.Costo / P.Venta) en la tabla de
  // Productos de la Compra — corrige diferencias chicas sin abrir el modal completo.
  const [celdaEditando, setCeldaEditando] = useState(null); // { ui_id, campo } | null
  const [filaBusquedaAuto, setFilaBusquedaAuto] = useState(null);
  // Distingue "cancelado con Escape" de "confirmado con blur/Enter": al quitar el input
  // del DOM (Escape → setCeldaEditando(null)) el navegador puede disparar un blur nativo
  // sobre el input que se está desmontando — este flag evita que ese blur re-confirme
  // el valor que el usuario justo canceló.
  const edicionCanceladaRef = useRef(false);

  const asegurarCatalogoProductos = async () => {
    if (catalogoXmlRef.current.length > 0) return catalogoXmlRef.current;
    const productos = await listarCatalogoProductosXml();
    setCatalogoXmlProductos(productos || []);
    return productos || [];
  };

  const agregarFilaVaciaAlCarrito = async () => {
    await asegurarCatalogoProductos();
    let focoId = null;
    let lleno = false;
    setProductosCarrito((prev) => {
      const vacia = prev.find((p) => !p.id_producto && !p.origenXml);
      if (vacia) {
        focoId = vacia.ui_id;
        return prev;
      }
      if (prev.length >= MAX_PRODUCTOS_COMPRA) {
        lleno = true;
        return prev;
      }
      const fila = crearFilaManualVacia();
      focoId = fila.ui_id;
      return [...prev, fila];
    });
    if (lleno) {
      mostrarAlerta(`Alcanzaste el máximo de ${MAX_PRODUCTOS_COMPRA} productos por compra. Registra esta compra y crea una nueva para continuar agregando.`, 'warning');
      return;
    }
    if (focoId) setFilaBusquedaAuto(focoId);
  };

  useEffect(() => {
    if (filaBusquedaAuto == null) return undefined;
    const t = setTimeout(() => setFilaBusquedaAuto(null), 500);
    return () => clearTimeout(t);
  }, [filaBusquedaAuto]);

  const cancelarEdicionInline = () => {
    edicionCanceladaRef.current = true;
    setCeldaEditando(null);
  };

  const confirmarEdicionInline = (item, campo, valorStr, via) => {
    if (edicionCanceladaRef.current) { edicionCanceladaRef.current = false; return; }
    const valor = parsePrecio(valorStr);
    if (valorStr === '' || Number.isNaN(Number(String(valorStr).replace(',', '.')))) return;
    if (valor < 0) return;
    if (campo !== 'pCosto' && valor <= 0) return;
    if (campo === 'pCosto' && valor === 0 && !item.bonificacion) {
      mostrarAlerta(
        'El costo es S/ 0.00. ¿Es bonificación?',
        'warning',
        () => {
          setProductosCarrito((prev) => prev.map((p) => (
            p.ui_id !== item.ui_id
              ? p
              : { ...p, pCosto: 0, bonificacion: true, subtotal: 0 }
          )));
          setCeldaEditando(null);
        },
        'Sí, es bonificación',
        null,
        'Cancelar',
      );
      return;
    }
    setProductosCarrito(prev => prev.map(p => {
      if (p.ui_id !== item.ui_id) return p;
      const actualizado = { ...p, [campo]: valor };
      if (campo === 'cantidad') actualizado.cantidadDisplay = valor;
      if (campo === 'cantidad' || campo === 'pCosto') {
        actualizado.subtotal = actualizado.bonificacion
          ? 0
          : redondear2(actualizado.cantidad * actualizado.pCosto);
      }
      return actualizado;
    }));
    if (via === 'enter') {
      if (campo === 'cantidad') setCeldaEditando({ ui_id: item.ui_id, campo: 'pCosto' });
      else if (campo === 'pCosto') setCeldaEditando({ ui_id: item.ui_id, campo: 'pVenta' });
      else if (campo === 'pVenta' && !item.origenXml) {
        setCeldaEditando(null);
        setTimeout(() => { agregarFilaVaciaAlCarrito(); }, 0);
      } else {
        setCeldaEditando(null);
      }
    } else {
      setCeldaEditando(null);
    }
  };

  const handleComprobanteChange = (e) => {
    const { name, value } = e.target;
    setComprobante(prev => {
      const updated = { ...prev, [name]: value };
      // ✅ Auto-calcular fecha de vencimiento de crédito cuando cambian los días o la fecha de compra
      if (name === 'diasCredito' || name === 'fechaCompra') {
        const dias = name === 'diasCredito' ? Number(value) : Number(prev.diasCredito);
        const base = name === 'fechaCompra' ? value : prev.fechaCompra;
        if (dias > 0 && base) {
          const fecha = new Date(base + 'T12:00:00'); // T12 evita problemas de zona horaria
          fecha.setDate(fecha.getDate() + dias);
          updated.venceCredito = fecha.toISOString().split('T')[0];
        } else if (dias <= 0) {
          updated.venceCredito = '';
        }
      }
      return updated;
    });
  };
  const setFormaPago = (forma) => setComprobante(prev => ({ ...prev, formaPago: forma, diasCredito: '', venceCredito: '' }));

  // ←/→ alternan cuál opción está resaltada (sin seleccionar); Enter confirma y salta
  // el foco al destino correspondiente — el sistema global de MainLayout.jsx ignora este
  // control (no es INPUT/SELECT), así que el salto se maneja acá con refs directas.
  const handlePagoToggleKeyDown = (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      setPagoEnfocado(prev => (prev === 'Contado' ? 'Crédito' : 'Contado'));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      setFormaPago(pagoEnfocado);
      // "Días Crédito" pasa de disabled a habilitado recién cuando React vuelve a
      // renderizar con el nuevo formaPago — se difiere el foco al siguiente tick
      // para no intentar enfocar un input que todavía está disabled en el DOM.
      setTimeout(() => {
        if (pagoEnfocado === 'Contado') {
          registrarCompraBtnRef.current?.click();
        } else {
          diasCreditoInputRef.current?.focus();
        }
      }, 0);
    }
  };
  const eliminarProductoDelCarrito = (ui_id) => setProductosCarrito(prev => prev.filter(p => p.ui_id !== ui_id));

  const editarProductoDelCarrito = async (item, { esNuevaFila = false } = {}) => {
    // Si es una fila ya confirmada (no un duplicado recién creado), la recordamos para
    // devolverla al carrito tal cual si el usuario cancela sin guardar.
    setFilaParaRestaurarSiCancela(esNuevaFila ? null : item);

    const { data: formasData } = await supabase
      .from('producto_formas_venta')
      .select('*, unidades_medida(nombre)')
      .eq('id_producto', item.id_producto)
      .eq('activo', true)
      .order('orden');

    setEdicionModalProducto({
      producto: {
        id_producto: item.id_producto,
        descripcion: item.descripcion,
        laboratorios: { nombre: item.laboratorio },
        producto_precios: [{ costo: item.pCosto, precio_venta: item.pVenta }],
      },
      formas: formasData || [],
      confItem: {
        idMedidaSeleccionada: item.idMedidaSeleccionada || '',
        factor: item.factor || 1,
        cantidad: item.cantidadDisplay,
        pCosto: item.pCosto ?? '',
        pVenta: item.pVenta,
        igvPct: item.igvPct ?? 18,
        bonificacion: !!item.bonificacion,
        fVencimiento: item.fVencimiento,
        nroLote: item.nroLote,
      },
    });
    setShowModalProducto(true);
    // Eliminar el item viejo del carrito — al guardar de nuevo se re-agrega actualizado
    setProductosCarrito(prev => prev.filter(p => p.ui_id !== item.ui_id));
  };

  // Clona la fila (mismo producto, mismos datos) justo debajo de la original, con un
  // ui_id nuevo, sin abrir el modal — el dueño ajusta lote/cantidad en la tabla o con el lápiz.
  const duplicarProductoDelCarrito = (item) => {
    if (productosCarrito.length >= MAX_PRODUCTOS_COMPRA) {
      mostrarAlerta(`Alcanzaste el máximo de ${MAX_PRODUCTOS_COMPRA} productos por compra. Registra esta compra y crea una nueva para continuar agregando.`, 'warning');
      return;
    }
    const duplicado = { ...item, ui_id: Date.now() * 1000 + (++filaManualSeq) };
    setProductosCarrito(prev => {
      const idx = prev.findIndex(p => p.ui_id === item.ui_id);
      const nuevo = [...prev];
      nuevo.splice(idx + 1, 0, duplicado);
      return nuevo;
    });
  };

  // Reemplaza el producto de una fila ya ingresada sin perder cantidad/lote/vencimiento.
  // Deja la fila vacía con buscador en la misma tabla (sin modal intermedio).
  const cambiarProductoDeFila = async (item) => {
    await asegurarCatalogoProductos();
    setProductosCarrito(prev => prev.map(p => (p.ui_id === item.ui_id
      ? { ...p, id_producto: null, descripcion: '', laboratorio: p.laboratorio || '', codigoBarras: '' }
      : p)));
    setFilaBusquedaAuto(item.ui_id);
  };

  // ── Modificar precio de venta sin compra ──
  const handleBuscarPrecio = async (valor) => {
    setBusquedaPrecio(valor);
    if (valor.length > 1) {
      const resultados = await buscarProductosCompra(valor);
      setResultadosPrecio(resultados);
    } else { setResultadosPrecio([]); }
  };

  const seleccionarProdPrecio = (prod) => {
    setProdPrecio(prod);
    const fp = filaProductoPrecios(prod.producto_precios);
    setNuevoCosto(fp?.costo ?? '');
    setNuevoPrecioVenta(fp?.precio_venta ?? '');
  };

  const ejecutarGuardadoPrecio = async () => {
    setGuardandoPrecio(true);
    try {
      // Solo unidad base en producto_precios. CAJA/BLISTER vive en producto_formas_venta
      // (TablaFormasVenta debajo) — ya no se escribe precio_caja legacy desde este modal.
      const updateData = {
        precio_venta: parsePrecio(nuevoPrecioVenta),
        ...(nuevoCosto !== '' ? { costo: parsePrecio(nuevoCosto) } : {}),
      };
      const { error } = await supabase.from('producto_precios')
        .update(updateData)
        .eq('id_producto', prodPrecio.id_producto);
      if (error) throw error;
      const costoFormas = nuevoCosto !== ''
        ? parsePrecio(nuevoCosto)
        : Number(filaProductoPrecios(prodPrecio.producto_precios)?.costo) || 0;
      await sincronizarPCompraFormas(supabase, prodPrecio.id_producto, costoFormas);
      mostrarAlerta(`Precios actualizados para "${prodPrecio.descripcion}".`, 'success');
      setShowModalPrecio(false);
      setProdPrecio(null);
      setBusquedaPrecio('');
      setResultadosPrecio([]);
    } catch (err) {
      mostrarAlerta('Error al guardar: ' + err.message, 'error');
    } finally { setGuardandoPrecio(false); }
  };

  const handleGuardarPrecio = () => {
    if (!prodPrecio) return mostrarAlerta('Selecciona un producto.', 'warning');
    if (!nuevoPrecioVenta || Number(nuevoPrecioVenta) <= 0) return mostrarAlerta('El precio de venta debe ser mayor a 0.', 'warning');
    mostrarAlerta(
      `¿Deseas guardar los nuevos precios para "${prodPrecio.descripcion}"?`,
      'warning',
      () => ejecutarGuardadoPrecio(),
      'Sí, guardar',
      null,
      'Cancelar'
    );
  };

  const registrarCompraDb = async () => {
    if (!proveedorSeleccionadoId) return mostrarAlerta("Selecciona un proveedor para continuar.", "warning");
    if (!comprobante.serie || !comprobante.numero) return mostrarAlerta("Ingresa la serie y número del comprobante.", "warning");
    if (productosCarrito.length === 0) return mostrarAlerta("El carrito está vacío. Agrega medicamentos.", "warning");
    if (productosCarrito.some((p) => !p.id_producto)) {
      return mostrarAlerta('Hay ítems importados del XML sin producto vinculado. Elige un producto en las filas "Sin coincidencia".', 'warning');
    }
    if (comprobante.formaPago === 'Crédito' && !comprobante.venceCredito) {
      return mostrarAlerta("Ingresa la fecha de vencimiento para una compra a crédito.", "warning");
    }
    if (hayDescuadreXml && !confirmarDescuadreXmlRef.current) {
      return mostrarAlerta(
        `El total calculado no coincide con el total del comprobante (diferencia: S/ ${Math.abs(descuadreXml).toFixed(2)}). El total a guardar según el XML es S/ ${totalCompraFinal.toFixed(2)}. ¿Registrar de todas formas?`,
        'warning',
        () => {
          confirmarDescuadreXmlRef.current = true;
          registrarCompraDb();
        },
        'Sí, registrar',
        () => { },
        'Volver',
      );
    }

    const renombresXml = filasRenombreCatalogoDesdeXml(productosCarrito);
    if (renombresXml.length > 0 && !confirmarRenombreXmlRef.current) {
      const n = renombresXml.length;
      const lineas = renombresXml
        .map((r, i) => `${i + 1}. ${r.nombreActual} → ${r.descripcion}`)
        .join('\n');
      return mostrarAlerta(
        `Vas a actualizar el nombre de ${n} producto${n === 1 ? '' : 's'}:\n\n${lineas}`,
        'warning',
        () => {
          confirmarRenombreXmlRef.current = true;
          registrarCompraDb();
        },
        'Sí, actualizar y registrar compra',
        () => { confirmarRenombreXmlRef.current = false; },
        'Cancelar',
        { wide: true },
      );
    }

    confirmarDescuadreXmlRef.current = false;
    confirmarRenombreXmlRef.current = false;

    if (registrandoCompraRef.current) return;
    registrandoCompraRef.current = true;
    setRegistrando(true);
    // ✅ Resolver el id_sucursal real (admins pueden tener el campo directo null pero el join en sucursales sí tiene el id)
    const sucursalId = user.id_sucursal || user.sucursales?.id_sucursal || null;
    if (!sucursalId) {
      registrandoCompraRef.current = false;
      setRegistrando(false);
      return mostrarAlerta("Tu usuario no tiene una sucursal asignada. Contacta al administrador.", "warning");
    }
    try {
      const loteDefault = (p) => p.nroLote || `FAC-${comprobante.serie}-${comprobante.numero}`;
      const renombresXml = filasRenombreCatalogoDesdeXml(productosCarrito);
      const renameMap = new Map(renombresXml.map((r) => [r.id_producto, r.descripcion]));

      const row = await registrarCompraEnServidor(armarPayloadRegistrarCompra({
        id_sucursal: sucursalId,
        id_proveedor: proveedorSeleccionadoId,
        id_usuario: user.id_usuario,
        comprobante,
        total_compra: totalCompraFinal,
        percepcion: Number(percepcion) || 0,
        compra_origen_id: compraOrigenId || null,
        id_pedido_origen: pedidoOrigenId || null,
        total_editado_manualmente: totalManual !== null,
        total_calculado_original: totalManual !== null ? totalCompra : null,
        actualiza_precios: actualizaPrecios,
        items: productosCarrito.map((p) => ({
          id_producto: p.id_producto,
          nro_lote: loteDefault(p),
          fecha_vencimiento: p.fVencimiento || null,
          cantidad: p.cantidad,
          costo_unitario: p.pCosto,
          subtotal: p.subtotal,
          p_venta: p.pVenta,
          p_venta_caja: p.pVentaCaja,
          codigo_proveedor: p.codigoProveedor || null,
          descripcion_catalogo: renameMap.get(p.id_producto) || null,
          bonificacion: !!p.bonificacion,
        })),
      }));

      if (renombresXml.length > 0) marcarCatalogoOfflineStale();

      resetearFormularioCompraLocal();
      if (row.ya_existia) {
        mostrarAlerta(
          `Esta factura ya está registrada (compra #${row.id_compra}). No se duplicó ni se volvió a mover stock.`,
          'warning',
        );
      } else {
        mostrarAlerta(
          '¡Compra registrada con éxito! El inventario ha sido actualizado.',
          'success',
          () => abrirModalAgregarProductoLimpio(),
        );
      }
    } catch (error) {
      mostrarAlerta("Error al registrar la compra: " + error.message, "error");
    } finally {
      registrandoCompraRef.current = false;
      setRegistrando(false);
    }
  };

  const provSeleccionadoData = dbProveedores.find(p => p.id_proveedor === Number(proveedorSeleccionadoId));

  // ═══════════════ HISTORIAL DE COMPRAS / ANULAR COMPRA ═══════════════

  const cargarHistorialCompras = async () => {
    setCargandoHistorialCompras(true);
    try {
      const { data, error } = await supabase
        .from('compras')
        .select('*, proveedores(razon_social)')
        .order('fecha_compra', { ascending: false })
        .limit(200);
      if (error) throw error;
      setHistorialComprasLista(data || []);
    } catch (error) {
      console.error('Error cargando historial de compras:', error);
    } finally {
      setCargandoHistorialCompras(false);
    }
  };

  useEffect(() => {
    if (vistaActual === 'historial') cargarHistorialCompras();
  }, [vistaActual]);

  // Detalle de UNA compra (activa o anulada) — mismas columnas que ya usa el modal de
  // Recuperar Anulados, sin abrir/cerrar la pantalla actual.
  const verDetalleCompra = async (compra) => {
    setCompraDetalleVer(compra);
    setCargandoDetalleCompra(true);
    try {
      const { data, error } = await supabase
        .from('compra_detalle')
        .select('id_producto, nro_lote, fecha_vencimiento, cantidad, costo_unitario, subtotal, productos(descripcion, laboratorios(nombre))')
        .eq('id_compra', compra.id_compra);
      if (error) throw error;
      setDetalleComprasLineas(data || []);
    } catch (error) {
      console.error('Error cargando detalle de compra:', error);
      setDetalleComprasLineas([]);
    } finally {
      setCargandoDetalleCompra(false);
    }
  };

  // Atajo desde el modal de detalle: reutiliza recuperarCompraAnulada tal cual, y de
  // paso cierra este modal y cambia al tab "Registrar Compra" para que el usuario vea
  // de inmediato las filas recién insertadas en el carrito.
  const recuperarDesdeDetalle = async (compra) => {
    await recuperarCompraAnulada(compra);
    setCompraDetalleVer(null);
    setVistaActual('registrar');
  };

  // Por cada línea de la compra, busca el lote EXACTO que esa compra creó/incrementó
  // (mismo nro_lote, no "el más próximo a vencer" como hace la reversión de ventas) y
  // calcula si hay suficiente stock para revertir la cantidad completa.
  const calcularShortfallsAnulacion = async (compra) => {
    const { data: detalles } = await supabase
      .from('compra_detalle')
      .select('id_producto, nro_lote, cantidad, productos(descripcion)')
      .eq('id_compra', compra.id_compra);

    const shortfalls = [];
    for (const item of (detalles || [])) {
      const { data: lotes } = await supabase
        .from('inventario_lotes')
        .select('cantidad_actual')
        .eq('id_producto', item.id_producto)
        .eq('id_sucursal', compra.id_sucursal)
        .eq('nro_lote', item.nro_lote)
        .limit(1);
      const disponible = Number(lotes?.[0]?.cantidad_actual ?? 0);
      if (disponible < Number(item.cantidad)) {
        shortfalls.push({
          descripcion: item.productos?.descripcion || '---',
          requerido: Number(item.cantidad),
          disponible,
          faltante: Number(item.cantidad) - disponible,
        });
      }
    }
    return shortfalls;
  };

  useEffect(() => {
    if (!compraAAnular) { setShortfallsAnulacion([]); return; }
    setCargandoShortfalls(true);
    calcularShortfallsAnulacion(compraAAnular)
      .then(setShortfallsAnulacion)
      .finally(() => setCargandoShortfalls(false));
  }, [compraAAnular]);

  // Revierte el Kardex por cada línea de la compra: resta del lote EXACTO (por nro_lote)
  // hasta un mínimo de 0 (nunca negativo), registra un movimiento tipo AJUSTE por línea,
  // y marca la compra como anulada.
  const handleAnularCompra = async () => {
    if (!compraAAnular) return;
    if (compraAAnular.estado_anulacion === 'ANULADO') {
      setMsgAnulacionCompra({ ok: false, texto: 'Esta compra ya está anulada.' });
      return;
    }
    if (anulandoCompraRef.current) return;
    anulandoCompraRef.current = true;
    setAnulandoCompra(true);
    setMsgAnulacionCompra(null);

    try {
      const { data: detalles } = await supabase
        .from('compra_detalle')
        .select('id_producto, nro_lote, cantidad')
        .eq('id_compra', compraAAnular.id_compra);

      const kardexMovimientos = [];
      for (const item of (detalles || [])) {
        const { data: lotes } = await supabase
          .from('inventario_lotes')
          .select('id_lote, cantidad_actual')
          .eq('id_producto', item.id_producto)
          .eq('id_sucursal', compraAAnular.id_sucursal)
          .eq('nro_lote', item.nro_lote)
          .limit(1);

        if (lotes && lotes.length > 0) {
          const lote = lotes[0];
          const nuevaCantidad = Math.max(0, Number(lote.cantidad_actual) - Number(item.cantidad));
          const { data: loteUpd, error: errLote } = await supabase
            .from('inventario_lotes')
            .update({ cantidad_actual: nuevaCantidad })
            .eq('id_lote', lote.id_lote)
            .select('id_lote');
          assertEscritura(loteUpd, errLote, `No se revirtió el stock del lote #${lote.id_lote}.`);

          kardexMovimientos.push({
            id_sucursal: compraAAnular.id_sucursal,
            id_producto: item.id_producto,
            tipo: 'AJUSTE',
            cantidad: Number(item.cantidad),
            saldo: nuevaCantidad,
            id_lote: `ANULACION-COMPRA-${compraAAnular.id_compra}`,
            id_usuario: user.id_usuario,
            observacion: `Anulación de compra ${compraAAnular.nro_documento}: ${motivoAnulacionCompra}`,
          });
        }
      }
      if (kardexMovimientos.length > 0) {
        const { data: kardexIns, error: errKardex } = await supabase
          .from('kardex_movimientos')
          .insert(kardexMovimientos)
          .select();
        assertEscritura(kardexIns, errKardex, 'No se registraron los movimientos de kardex de la anulación.');
        if (kardexIns.length !== kardexMovimientos.length) {
          throw new Error(`Kardex incompleto al anular: se esperaban ${kardexMovimientos.length} y se guardaron ${kardexIns.length}.`);
        }
      }

      const { data: compraUpd, error: errCompra } = await supabase.from('compras').update({
        estado_anulacion: 'ANULADO',
        motivo_anulacion: motivoAnulacionCompra,
        anulado_at: new Date().toISOString(),
      })
        .eq('id_compra', compraAAnular.id_compra)
        .or('estado_anulacion.is.null,estado_anulacion.neq.ANULADO')
        .select('id_compra');
      assertEscritura(compraUpd, errCompra, 'No se pudo anular la compra (quizá ya estaba anulada).');

      setHistorialComprasLista(prev => prev.map(c =>
        c.id_compra === compraAAnular.id_compra ? { ...c, estado_anulacion: 'ANULADO' } : c
      ));

      // Cierra de inmediato — el resultado se comunica con el toast del sistema, sin
      // dejar al usuario esperando dentro del modal a que algo más pase.
      const nroDocumentoAnulado = compraAAnular.nro_documento;
      setCompraAAnular(null);
      setMsgAnulacionCompra(null);
      setMotivoAnulacionCompra(motivosAnulacionCompra[0]);
      setShortfallsAnulacion([]);
      mostrarAlerta(`Compra ${nroDocumentoAnulado} anulada correctamente.`, 'success');
    } catch (error) {
      setMsgAnulacionCompra({ ok: false, texto: 'Error: ' + error.message });
    } finally {
      anulandoCompraRef.current = false;
      setAnulandoCompra(false);
    }
  };

  // ═══════════════ RECUPERAR ANULADOS ═══════════════

  const cargarComprasAnuladas = async () => {
    setCargandoComprasAnuladas(true);
    try {
      let query = supabase
        .from('compras')
        .select('*, proveedores(razon_social)')
        .eq('estado_anulacion', 'ANULADO')
        .order('fecha_compra', { ascending: false })
        .limit(200);
      if (filtroFechaDesdeRecuperar) query = query.gte('fecha_compra', filtroFechaDesdeRecuperar);
      if (filtroFechaHastaRecuperar) query = query.lte('fecha_compra', filtroFechaHastaRecuperar);
      if (filtroProveedorRecuperar) query = query.eq('id_proveedor', Number(filtroProveedorRecuperar));
      const { data, error } = await query;
      if (error) throw error;

      // Compras que YA sirvieron de origen para alguna otra — para el badge "✓ Recuperada"
      const { data: origenes } = await supabase
        .from('compras')
        .select('compra_origen_id')
        .not('compra_origen_id', 'is', null);
      const idsRecuperados = new Set((origenes || []).map(o => o.compra_origen_id));

      setComprasAnuladasLista((data || []).map(c => ({ ...c, yaRecuperada: idsRecuperados.has(c.id_compra) })));
    } catch (error) {
      console.error('Error cargando compras anuladas:', error);
    } finally {
      setCargandoComprasAnuladas(false);
    }
  };

  useEffect(() => {
    if (showModalRecuperar) cargarComprasAnuladas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showModalRecuperar, filtroFechaDesdeRecuperar, filtroFechaHastaRecuperar, filtroProveedorRecuperar]);

  // Trae el detalle completo de una compra anulada y lo inserta directo en
  // productosCarrito (sin abrir modal de edición por fila) — el usuario corrige después
  // con ✏️ Editar si hace falta (U.Medida/factor/bonificación/IGV no se pueden
  // reconstruir porque compra_detalle no los guarda; P.Venta usa el precio actual del
  // catálogo porque compra_detalle tampoco guarda precio de venta histórico).
  const recuperarCompraAnulada = async (compra) => {
    setRecuperandoDetalleId(compra.id_compra);
    try {
      const { data: detalles, error } = await supabase
        .from('compra_detalle')
        .select('id_producto, nro_lote, fecha_vencimiento, cantidad, costo_unitario, productos(descripcion, laboratorios(nombre), producto_precios(precio_venta))')
        .eq('id_compra', compra.id_compra);
      if (error) throw error;

      if (!detalles || detalles.length === 0) {
        mostrarAlerta('Esta compra anulada no tiene productos en su detalle.', 'warning');
        return;
      }

      if (productosCarrito.length + detalles.length > MAX_PRODUCTOS_COMPRA) {
        mostrarAlerta(`No se puede recuperar: agregaría ${detalles.length} producto(s) y superarías el máximo de ${MAX_PRODUCTOS_COMPRA} por compra (ya tienes ${productosCarrito.length}).`, 'warning');
        return;
      }

      const nuevasFilas = detalles.map((item, i) => {
        const cant = Number(item.cantidad) || 0;
        const costo = Number(item.costo_unitario) || 0;
        return {
          ui_id: Date.now() + i,
          id_producto: item.id_producto,
          descripcion: item.productos?.descripcion || '---',
          laboratorio: item.productos?.laboratorios?.nombre || '---',
          uMedida: 'UNIDAD',
          idMedidaSeleccionada: '',
          cantidad: cant,
          cantidadDisplay: cant,
          factor: 1,
          pCosto: costo,
          pVenta: Number(filaProductoPrecios(item.productos?.producto_precios)?.precio_venta) || 0,
          igvPct: 18,
          bonificacion: false,
          fVencimiento: item.fecha_vencimiento || '',
          nroLote: item.nro_lote || '',
          subtotal: redondear2(cant * costo),
        };
      });

      setProductosCarrito(prev => [...prev, ...nuevasFilas]);
      setCompraOrigenId(compra.id_compra);
      setShowModalRecuperar(false);
      mostrarAlerta(`${nuevasFilas.length} producto(s) recuperados de la compra ${compra.nro_documento}. Revisa cantidad, precio, lote y U.Medida antes de guardar.`, 'success');
    } catch (error) {
      mostrarAlerta('Error al recuperar la compra: ' + error.message, 'error');
    } finally {
      setRecuperandoDetalleId(null);
    }
  };

  // ═══════════════ CARGAR DESDE PEDIDO PROVEEDOR ═══════════════

  const cargarPedidosDisponibles = async () => {
    setCargandoPedidosDisponibles(true);
    try {
      const { data, error } = await supabase
        .from('pedidos_proveedor')
        .select('id_pedido, fecha_pedido, fecha_envio, pedido_proveedor_detalle(cantidad_pedida, costo_estimado)')
        .eq('id_proveedor', proveedorSeleccionadoId)
        .eq('estado', 'ENVIADO')
        .order('fecha_envio', { ascending: false });
      if (error) throw error;
      setPedidosDisponibles(data || []);
    } catch (error) {
      console.error('Error cargando pedidos disponibles:', error);
    } finally {
      setCargandoPedidosDisponibles(false);
    }
  };

  useEffect(() => {
    if (showModalCargarPedido && proveedorSeleccionadoId) cargarPedidosDisponibles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showModalCargarPedido, proveedorSeleccionadoId]);

  // Trae el detalle de un pedido ENVIADO y lo inserta en productosCarrito — mismo
  // criterio que recuperarCompraAnulada: cantidad_pedida/costo_estimado son solo el
  // punto de partida, el usuario ajusta cantidad real y precio real antes de guardar
  // (U.Medida/factor/bonificación/IGV no vienen del pedido, se completan como siempre;
  // P.Venta usa el precio actual del catálogo, igual que en Recuperar Anulados).
  const cargarPedidoEnCarrito = async (pedido) => {
    if (pedidosCargadosIds.includes(pedido.id_pedido)) {
      mostrarAlerta('Este pedido ya fue cargado en el carrito actual.', 'warning');
      return;
    }
    setCargandoPedidoId(pedido.id_pedido);
    try {
      const { data: detalles, error } = await supabase
        .from('pedido_proveedor_detalle')
        .select('id_producto, cantidad_pedida, costo_estimado, productos(descripcion, laboratorios(nombre), producto_precios(precio_venta))')
        .eq('id_pedido', pedido.id_pedido);
      if (error) throw error;

      if (!detalles || detalles.length === 0) {
        mostrarAlerta('Este pedido no tiene productos en su detalle.', 'warning');
        return;
      }

      if (productosCarrito.length + detalles.length > MAX_PRODUCTOS_COMPRA) {
        mostrarAlerta(`No se puede cargar: agregaría ${detalles.length} producto(s) y superarías el máximo de ${MAX_PRODUCTOS_COMPRA} por compra (ya tienes ${productosCarrito.length}).`, 'warning');
        return;
      }

      const nuevasFilas = detalles.map((item, i) => {
        const cant = Number(item.cantidad_pedida) || 0;
        const costo = Number(item.costo_estimado) || 0;
        return {
          ui_id: Date.now() + i,
          id_producto: item.id_producto,
          descripcion: item.productos?.descripcion || '---',
          laboratorio: item.productos?.laboratorios?.nombre || '---',
          uMedida: 'UNIDAD',
          idMedidaSeleccionada: '',
          cantidad: cant,
          cantidadDisplay: cant,
          factor: 1,
          pCosto: costo,
          pVenta: Number(filaProductoPrecios(item.productos?.producto_precios)?.precio_venta) || 0,
          igvPct: 18,
          bonificacion: false,
          fVencimiento: '',
          nroLote: '',
          subtotal: redondear2(cant * costo),
        };
      });

      setProductosCarrito(prev => [...prev, ...nuevasFilas]);
      setPedidoOrigenId(pedido.id_pedido);
      setPedidosCargadosIds(prev => [...prev, pedido.id_pedido]);
      setShowModalCargarPedido(false);
      mostrarAlerta(`${nuevasFilas.length} producto(s) cargados del pedido #${pedido.id_pedido}. Revisa cantidad, precio, lote y U.Medida antes de guardar.`, 'success');
    } catch (error) {
      mostrarAlerta('Error al cargar el pedido: ' + error.message, 'error');
    } finally {
      setCargandoPedidoId(null);
    }
  };

  if (cargandoDatos) return (
    <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--lf-text-muted)' }}>
      Conectando con la base de datos...
    </div>
  );

  return (
    <div className={`admin-compras-container${vistaActual === 'registrar' ? ' modo-registrar' : ''}`}>

      <AlertaSistemaModal alerta={alertaSistema} onClose={() => setAlertaSistema(null)} />
      {importandoXml && (
        <LogoCargandoOverlay mensaje="Analizando XML..." />
      )}

      <div className="compras-vista-toggle">
        <button
          type="button"
          className={vistaActual === 'registrar' ? 'active' : ''}
          onClick={() => setVistaActual('registrar')}
        ><UiIcon name="NotebookPen" size={15} /> Registrar Compra
        </button>
        <button
          type="button"
          className={vistaActual === 'historial' ? 'active' : ''}
          onClick={() => setVistaActual('historial')}
        ><UiIcon name="ClipboardList" size={15} /> Historial de Compras
        </button>
      </div>

      {vistaActual === 'registrar' && (
        <>
      {/* ============ MODAL: SOLO MODIFICAR PRECIO ============ */}
      {showModalPrecio && (
        <div className="modal-overlay-strict" style={{ zIndex: 100031 }}>
          <div className="popup-producto-card" style={{ maxWidth: '900px', width: '90vw' }}>
            <div className="popup-header">
              <div className="popup-title-group">
                <h3><UiIcon name="Wallet" size={15} /> Modificar precio de venta</h3>
                <p>Sin crear compra — solo actualiza el precio en catálogo</p>
              </div>
              <button className="btn-close-popup" onClick={() => { setShowModalPrecio(false); setProdPrecio(null); setBusquedaPrecio(''); setResultadosPrecio([]); }}><UiIcon name="X" size={16} /></button>
            </div>
            <div className="popup-body">
              <div className="popup-search-row">
                <div className="search-input-wrapper">
                  <span className="search-icon"><UiIcon name="Search" size={16} /></span>
                  <input type="text" placeholder="Busca por nombre, código de barras o laboratorio..." value={busquedaPrecio} onChange={e => handleBuscarPrecio(e.target.value)} autoFocus />
                  {busquedaPrecio && <button className="btn-clear-search" onClick={() => { setBusquedaPrecio(''); setResultadosPrecio([]); }}><UiIcon name="X" size={16} /></button>}
                </div>
              </div>
              <div className="popup-results-table">
                <div className="res-header" style={{ gridTemplateColumns: '110px 2fr 130px 90px 90px 90px 60px' }}>
                  <span>CÓDIGO</span><span>PRODUCTO</span><span>LABORATORIO</span>
                  <span>P. COSTO</span><span>P. VENTA</span><span>STOCK</span><span>SEL.</span>
                </div>
                <div className="res-scroll">
                  {resultadosPrecio.map(prod => (
                    <div key={prod.id_producto} className={`res-row ${prodPrecio?.id_producto === prod.id_producto ? 'selected' : ''}`} onClick={() => seleccionarProdPrecio(prod)} style={{ gridTemplateColumns: '110px 2fr 130px 90px 90px 90px 60px' }}>
                      <span>{prod.codigo_barras || '---'}</span>
                      <span className="text-bold text-dark">{prod.descripcion}</span>
                      <span className="text-muted">{prod.laboratorios?.nombre || '---'}</span>
                      <span className="text-muted">{formatSolesUnitario(filaProductoPrecios(prod.producto_precios)?.costo || 0)}</span>
                      <span className="text-muted">{formatSolesUnitario(filaProductoPrecios(prod.producto_precios)?.precio_venta || 0)}</span>
                      <span style={{ fontWeight: 700, color: prod.stockTotal > 0 ? '#16a34a' : '#dc2626' }}>{prod.stockTotal ?? 0}</span>
                      <div className="check-box-ui">{prodPrecio?.id_producto === prod.id_producto && <UiIcon name="Check" size={14} />}</div>
                    </div>
                  ))}
                  {busquedaPrecio && resultadosPrecio.length === 0 && <div className="empty-results">No se encontraron productos.</div>}
                  {!busquedaPrecio && <div className="empty-results">Escribe para buscar un producto.</div>}
                </div>
              </div>

              {prodPrecio && (
                  <div className="popup-config-area">
                    <h4 className="config-label"><UiIcon name="Pencil" size={15} /> Editando — {prodPrecio.descripcion}</h4>
                    <div className="config-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                      <div className="conf-item">
                        <label>P. COSTO (por unidad) <span style={{ color: 'var(--lf-text-muted)', fontWeight: 400, fontSize: '0.7rem' }}>(opcional)</span></label>
                        <input type="number" step="any" min="0" placeholder="No modificar" value={nuevoCosto} onChange={e => setNuevoCosto(e.target.value)} />
                      </div>
                      <div className="conf-item">
                        <label>P. VENTA (por unidad) *</label>
                        <input type="number" step="any" min="0" placeholder="0.00" value={nuevoPrecioVenta} onChange={e => setNuevoPrecioVenta(e.target.value)} />
                      </div>
                      <div className="conf-item">
                        <label>MARGEN (%)</label>
                        <div className="margin-badge">
                          {formatearPorcentajeGanancia(nuevoPrecioVenta, nuevoCosto)}
                        </div>
                      </div>
                    </div>

                    <TablaFormasVenta idProducto={prodPrecio?.id_producto} mostrarAlerta={mostrarAlerta} />
                  </div>
              )}
            </div>
            <div className="popup-footer">
              <button className="btn-popup-cancel" data-enter-skip="true" tabIndex={-1} onClick={() => { setShowModalPrecio(false); setProdPrecio(null); setBusquedaPrecio(''); setResultadosPrecio([]); }}><UiIcon name="X" size={15} /> Cancelar</button>
              <button className="btn-popup-add" onClick={handleGuardarPrecio} disabled={guardandoPrecio} style={{ background: 'linear-gradient(135deg,#16a34a,#15803d)' }}>
                {guardandoPrecio ? 'Guardando...' : <><UiIcon name="Save" size={15} /> Guardar precios</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ MODAL: RECUPERAR ANULADOS ============ */}
      {showModalRecuperar && (
        <div className="modal-overlay-strict" style={{ zIndex: 100031 }}>
          <div className="popup-producto-card popup-producto-card-ancho">
            <div className="popup-header">
              <div className="popup-title-group">
                <h3><UiIcon name="RefreshCw" size={15} /> Recuperar Anulados</h3>
                <p>Reingresa el detalle de una compra anulada por error de registro</p>
              </div>
              <button className="btn-close-popup" onClick={() => setShowModalRecuperar(false)}><UiIcon name="X" size={16} /></button>
            </div>
            <div className="popup-body">
              <div className="recuperar-filtros-row">
                <div>
                  <label className="section-title">Desde</label>
                  <SmartDateInput value={filtroFechaDesdeRecuperar} onChange={setFiltroFechaDesdeRecuperar} className="sdi-grande" />
                </div>
                <div>
                  <label className="section-title">Hasta</label>
                  <SmartDateInput value={filtroFechaHastaRecuperar} onChange={setFiltroFechaHastaRecuperar} className="sdi-grande" />
                </div>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <label className="section-title">Proveedor</label>
                  <SearchableSelect
                    className="recuperar-select-proveedor"
                    options={dbProveedores}
                    value={filtroProveedorRecuperar}
                    onChange={setFiltroProveedorRecuperar}
                    getOptionValue={(p) => p.id_proveedor}
                    getOptionLabel={(p) => p.razon_social}
                    getOptionSearchText={(p) => `${p.razon_social} ${p.ruc || ''}`}
                    placeholder="Buscar proveedor..."
                    emptyOptionLabel="-- Todos --"
                  />
                </div>
              </div>

              {cargandoComprasAnuladas ? (
                <p className="text-muted" style={{ padding: '1.5rem', textAlign: 'center' }}>Buscando compras anuladas...</p>
              ) : comprasAnuladasLista.length === 0 ? (
                <p className="text-muted" style={{ padding: '1.5rem', textAlign: 'center' }}>No se encontraron compras anuladas con esos filtros.</p>
              ) : (
                <div className="table-container-compras" style={{ marginTop: '1.25rem' }}>
                  <table className="table-compras recuperar-table">
                    <thead>
                      <tr>
                        <th>FECHA</th>
                        <th>PROVEEDOR</th>
                        <th>N° DOCUMENTO</th>
                        <th className="text-right">TOTAL</th>
                        <th>MOTIVO DE ANULACIÓN</th>
                        <th className="text-center">ACCIÓN</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comprasAnuladasLista.map(c => (
                        <tr key={c.id_compra}>
                          <td className="text-muted">{new Date(c.fecha_compra).toLocaleDateString('es-PE')}</td>
                          <td>{c.proveedores?.razon_social || '---'}</td>
                          <td className="font-bold">
                            {c.nro_documento}
                            {c.yaRecuperada && <><br /><span className="badge-recuperada"><UiIcon name="Check" size={15} /> Recuperada</span></>}
                          </td>
                          <td className="text-right font-bold text-dark">S/ {Number(c.total_compra).toFixed(2)}</td>
                          <td className="text-muted">{c.motivo_anulacion || '---'}</td>
                          <td className="text-center">
                            <button
                              className="btn-row-action btn-row-swap"
                              onClick={() => recuperarCompraAnulada(c)}
                              disabled={recuperandoDetalleId === c.id_compra}
                            >
                              {recuperandoDetalleId === c.id_compra ? 'Recuperando...' : 'Recuperar'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ============ MODAL: CARGAR DESDE PEDIDO PROVEEDOR ============ */}
      {showModalCargarPedido && (
        <div className="modal-overlay-strict" style={{ zIndex: 100031 }}>
          <div className="popup-producto-card popup-producto-card-ancho">
            <div className="popup-header">
              <div className="popup-title-group">
                <h3><UiIcon name="ClipboardList" size={15} /> Cargar desde Pedido</h3>
                <p>Pedidos enviados a {provSeleccionadoData?.razon_social || 'este proveedor'}, pendientes de recibir</p>
              </div>
              <button className="btn-close-popup" onClick={() => setShowModalCargarPedido(false)}><UiIcon name="X" size={16} /></button>
            </div>
            <div className="popup-body">
              {cargandoPedidosDisponibles ? (
                <p className="text-muted" style={{ padding: '1.5rem', textAlign: 'center' }}>Buscando pedidos enviados...</p>
              ) : pedidosDisponibles.length === 0 ? (
                <p className="text-muted" style={{ padding: '1.5rem', textAlign: 'center' }}>Este proveedor no tiene pedidos en estado ENVIADO.</p>
              ) : (
                <div className="table-container-compras" style={{ marginTop: '0.5rem' }}>
                  <table className="table-compras recuperar-table">
                    <thead>
                      <tr>
                        <th>N° PEDIDO</th>
                        <th>FECHA ENVÍO</th>
                        <th className="text-center">ITEMS</th>
                        <th className="text-right">TOTAL ESTIMADO</th>
                        <th className="text-center">ACCIÓN</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pedidosDisponibles.map(p => {
                        const totalEst = (p.pedido_proveedor_detalle || []).reduce((s, d) => s + (Number(d.cantidad_pedida) || 0) * (Number(d.costo_estimado) || 0), 0);
                        return (
                          <tr key={p.id_pedido}>
                            <td className="font-bold">#{p.id_pedido}</td>
                            <td className="text-muted">{p.fecha_envio ? new Date(p.fecha_envio).toLocaleDateString('es-PE') : '---'}</td>
                            <td className="text-center">{(p.pedido_proveedor_detalle || []).length}</td>
                            <td className="text-right font-bold text-dark">S/ {totalEst.toFixed(2)}</td>
                            <td className="text-center">
                              <button
                                className="btn-row-action btn-row-swap"
                                onClick={() => cargarPedidoEnCarrito(p)}
                                disabled={cargandoPedidoId === p.id_pedido || pedidosCargadosIds.includes(p.id_pedido)}
                              >
                                {pedidosCargadosIds.includes(p.id_pedido)
                                  ? <><UiIcon name="Check" size={15} /> Cargado</>
                                  : (cargandoPedidoId === p.id_pedido ? 'Cargando...' : <><UiIcon name="ClipboardList" size={15} /> Cargar</>)}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showModalProveedorXml && (
        <div className="modal-overlay-strict">
          <div className="modal-proveedor-card xml-prov-nuevo-card">
            <div className="modal-prov-header">
              <h3>Proveedor nuevo</h3>
              <button type="button" onClick={cerrarModalProveedorXml}><UiIcon name="X" size={16} /></button>
            </div>
            <div className="modal-prov-body">
              <p className="xml-prov-nuevo-aviso">
                El RUC del XML no coincide con ningún proveedor registrado (se ignoran espacios y formato).
                Si es el mismo de siempre con otro RUC o nombre, elígelo abajo. Si es uno nuevo, créalo.
              </p>
              <div className="xml-prov-datos">
                <div>
                  <label>RUC del XML</label>
                  <p>{xmlProveedorInfo.ruc}</p>
                </div>
                <div>
                  <label>Razón social del XML</label>
                  <p>{xmlProveedorInfo.razonSocial}</p>
                </div>
              </div>
              <div className="input-group">
                <label>Usar un proveedor ya existente</label>
                <SearchableSelect
                  options={proveedoresParaCompraNueva}
                  value={proveedorXmlElegidoId}
                  onChange={setProveedorXmlElegidoId}
                  getOptionValue={(p) => p.id_proveedor}
                  getOptionLabel={(p) => p.razon_social}
                  getOptionSearchText={(p) => `${p.razon_social} ${p.ruc || ''}`}
                  placeholder="Buscar proveedor..."
                  emptyOptionLabel="-- Elegir proveedor registrado --"
                />
              </div>
              <div className="modal-prov-footer xml-prov-nuevo-footer">
                <button type="button" className="btn-bottom-outline" onClick={cerrarModalProveedorXml}>Cancelar</button>
                <button
                  type="button"
                  className="btn-bottom-outline"
                  disabled={!proveedorXmlElegidoId}
                  onClick={usarProveedorExistenteXml}
                >
                  Usar este proveedor
                </button>
                <button type="button" className="btn-bottom-primary" onClick={abrirAltaProveedorDesdeXml}>
                  + Crear proveedor nuevo
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showModalProveedor && (
        <div className="modal-overlay-strict">
          <div className="modal-proveedor-card">
            <div className="modal-prov-header">
              <h3>{proveedorEditandoId ? 'Editar proveedor' : 'Registrar Nuevo Proveedor'}</h3>
              <button onClick={() => { setShowModalProveedor(false); setProveedorEditandoId(null); }}><UiIcon name="X" size={16} /></button>
            </div>
            <form onSubmit={handleGuardarProveedor} className="modal-prov-body">
              <div className="input-group"><label>RUC *</label><input type="text" maxLength="11" required value={formProv.ruc} onChange={e => setFormProv(p => ({ ...p, ruc: e.target.value }))} /></div>
              <div className="input-group"><label>Razón Social *</label><input type="text" required value={formProv.razon_social} onChange={e => setFormProv(p => ({ ...p, razon_social: e.target.value }))} /></div>
              <div className="input-group"><label>Dirección</label><input type="text" value={formProv.direccion} onChange={e => setFormProv(p => ({ ...p, direccion: e.target.value }))} /></div>
              <div className="input-group" style={{ flexDirection: 'row', gap: '1rem' }}>
                <div style={{ flex: 1 }}><label>Teléfono</label><input type="text" style={{ width: '100%' }} value={formProv.telefono} onChange={e => setFormProv(p => ({ ...p, telefono: e.target.value }))} /></div>
                <div style={{ flex: 1 }}><label>Email</label><input type="email" style={{ width: '100%' }} value={formProv.email} onChange={e => setFormProv(p => ({ ...p, email: e.target.value }))} /></div>
              </div>
              <div className="modal-prov-footer">
                <button type="button" className="btn-bottom-outline" data-enter-skip="true" tabIndex={-1} onClick={() => { setShowModalProveedor(false); setProveedorEditandoId(null); }}>Cancelar</button>
                <button type="submit" className="btn-bottom-primary">{guardandoProv ? 'Guardando...' : (proveedorEditandoId ? 'Guardar cambios' : 'Guardar Proveedor')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showModalGestionProv && (
        <div className="modal-overlay-strict" data-keyboard-trap role="dialog" aria-modal="true">
          <div className="modal-proveedor-card modal-gestion-prov-card">
            <div className="gestion-prov-hero">
              <div className="gestion-prov-hero-text">
                <span className="gestion-prov-kicker">Directorio</span>
                <h3>Gestionar proveedores</h3>
                <p>Desactivar oculta el proveedor en compras nuevas. El historial no se borra.</p>
              </div>
              <button type="button" className="gestion-prov-cerrar" onClick={() => { setShowModalGestionProv(false); setBusquedaGestionProv(''); }} aria-label="Cerrar">
                <UiIcon name="X" size={16} />
              </button>
            </div>
            <div className="gestion-prov-toolbar">
              <label className="gestion-prov-buscar-wrap">
                <UiIcon name="Search" size={16} />
                <input
                  type="search"
                  placeholder="Buscar razón social, RUC o teléfono..."
                  value={busquedaGestionProv}
                  onChange={(e) => setBusquedaGestionProv(e.target.value)}
                  autoFocus
                />
              </label>
              <div className="gestion-prov-stats">
                <span><strong>{dbProveedores.length}</strong> total</span>
                <span className="is-on"><strong>{dbProveedores.filter(esProveedorActivo).length}</strong> activos</span>
                <span className="is-off"><strong>{dbProveedores.filter((p) => !esProveedorActivo(p)).length}</strong> inactivos</span>
              </div>
            </div>
            <div className="gestion-prov-lista">
              {proveedoresFiltradosGestion.length === 0 ? (
                <div className="gestion-prov-vacio">
                  {dbProveedores.length === 0 ? 'No hay proveedores.' : 'Ningún proveedor coincide con la búsqueda.'}
                </div>
              ) : proveedoresFiltradosGestion.map((p) => {
                const activo = esProveedorActivo(p);
                const inicial = String(p.razon_social || '?').trim().charAt(0).toUpperCase();
                const tel = p.telefono && String(p.telefono).toUpperCase() !== 'NULL' ? p.telefono : '—';
                return (
                  <article key={p.id_proveedor} className={`gestion-prov-fila${activo ? '' : ' is-off'}`}>
                    <div className={`gestion-prov-avatar${activo ? '' : ' is-off'}`}>{inicial}</div>
                    <div className="gestion-prov-info">
                      <strong>{p.razon_social}</strong>
                      <div className="gestion-prov-meta">
                        <span>RUC {p.ruc || '—'}</span>
                        <span>{tel}</span>
                      </div>
                    </div>
                    <span className={`gestion-prov-badge${activo ? ' is-on' : ' is-off'}`}>{activo ? 'Activo' : 'Inactivo'}</span>
                    <div className="gestion-prov-acciones">
                      <button type="button" className="gestion-prov-btn" onClick={() => abrirEdicionProveedor(p)}>
                        <UiIcon name="Pencil" size={14} /> Editar
                      </button>
                      <button
                        type="button"
                        className={`gestion-prov-btn${activo ? ' is-warn' : ' is-ok'}`}
                        disabled={togglingProvId === p.id_proveedor}
                        onClick={() => toggleActivoProveedor(p)}
                      >
                        {togglingProvId === p.id_proveedor ? '...' : (activo ? 'Desactivar' : 'Activar')}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {showModalProducto && (
      <ModalAgregarProductoCompra
        visible
        onClose={cerrarModalAgregarProducto}
        onAgregarLinea={handleAgregarLineaDesdeModal}
        onProductoCatalogoActualizado={handleProductoCatalogoDesdeModal}
        productosEnCarrito={productosCarrito.length}
        totalCompra={totalCompra}
        ultimosItems={productosCarrito.slice(-3)}
        maxProductos={MAX_PRODUCTOS_COMPRA}
        compararPrecioVenta={compararPrecioVenta}
        mostrarAlerta={mostrarAlerta}
        filaOrigen={filaParaRestaurarSiCancela}
        filaAReemplazar={filaAReemplazar}
        edicion={edicionModalProducto}
        initialBusqueda={location.state?.busquedaPredefinida || ''}
      />
      )}

      <ProductoFormModal
        visible={showModalProductoForm}
        modo={modoProductoForm}
        productoInicial={productoFormPrefill || null}
        onClose={() => {
          setShowModalProductoForm(false);
          setUiIdXmlCrearProducto(null);
          setProductoFormPrefill(null);
        }}
        onGuardado={handleGuardadoProductoForm}
        mostrarAlerta={mostrarAlerta}
      />

      <div className="compra-section">
        <h4 className="section-title">PROVEEDOR</h4>
        <div className="proveedor-top-row">
          <div className="prov-search-box selected" style={{ padding: 0, border: 'none', flex: 1, minWidth: 0 }}>
            <SearchableSelect
              className="select-prov-main"
              options={proveedoresParaCompraNueva}
              value={proveedorSeleccionadoId}
              onChange={setProveedorSeleccionadoId}
              getOptionValue={(p) => p.id_proveedor}
              getOptionLabel={(p) => p.razon_social}
              getOptionSearchText={(p) => `${p.razon_social} ${p.ruc || ''}`}
              placeholder="Buscar proveedor..."
              emptyOptionLabel="-- Seleccionar Proveedor --"
              onElegido={() => tipoDocRef.current?.focus()}
              onEnterWhenClosed={() => tipoDocRef.current?.focus()}
            />
          </div>
          <button className="btn-outline-prov" onClick={abrirAltaProveedor}>+ Nuevo proveedor</button>
          <button className="btn-outline-prov" type="button" onClick={() => setShowModalGestionProv(true)}>Gestionar</button>
        </div>
        {provSeleccionadoData && (
          <div className="proveedor-details-row">
            <div className="detail-item"><label>RUC</label><p>{provSeleccionadoData.ruc}</p></div>
            <div className="detail-item"><label>DIRECCIÓN</label><p>{provSeleccionadoData.direccion || '---'}</p></div>
            <div className="detail-item"><label>TELÉFONO</label><p>{provSeleccionadoData.telefono || '---'}</p></div>
            <div className="detail-item"><label>ESTADO</label><p className={esProveedorActivo(provSeleccionadoData) ? 'text-green font-bold' : 'text-muted font-bold'}>{esProveedorActivo(provSeleccionadoData) ? 'Activo' : 'Inactivo'}</p></div>
          </div>
        )}
      </div>

      <div className="compra-section">
        <h4 className="section-title">DATOS DEL COMPROBANTE</h4>
        <div className="comprobante-grid">
          <div className="input-group"><label>TIPO DOC.</label>
            <TecladoListbox
              ref={tipoDocRef}
              aria-label="Tipo de documento"
              options={TIPOS_COMPROBANTE_COMPRA}
              value={comprobante.tipo}
              onChange={(val) => handleComprobanteChange({ target: { name: 'tipo', value: val } })}
              onConfirmado={() => serieInputRef.current?.focus()}
            />
          </div>
          <div className="input-group"><label>SERIE</label><input ref={serieInputRef} type="text" name="serie" value={comprobante.serie} onChange={handleComprobanteChange} placeholder="Ej: FF58" /></div>
          <div className="input-group"><label>NÚMERO</label><input type="text" name="numero" value={comprobante.numero} onChange={handleComprobanteChange} placeholder="Ej: 0682243" /></div>
          <div className="input-group"><label>F. COMPRA</label>
            <SmartDateInput
              value={comprobante.fechaCompra}
              onChange={(val) => handleComprobanteChange({ target: { name: 'fechaCompra', value: val } })}
              onEnterAnio={() => pagoTogglesRef.current?.focus()}
            />
          </div>
          <div className="input-group">
            <label>ACTUALIZA PRECIOS</label>
            <select data-enter-skip="true" value={actualizaPrecios ? 'si' : 'no'} onChange={e => setActualizaPrecios(e.target.value === 'si')}>
              <option value="si">Sí</option>
              <option value="no">No</option>
            </select>
          </div>
          <div className="input-group forma-pago-group">
            <label>FORMA DE PAGO</label>
            <div
              ref={pagoTogglesRef}
              className="pago-toggles"
              tabIndex={0}
              data-enter-target="true"
              onFocus={() => setPagoEnfocado(comprobante.formaPago)}
              onKeyDown={handlePagoToggleKeyDown}
            >
              <button
                type="button" tabIndex={-1} data-enter-skip="true"
                className={`${comprobante.formaPago === 'Contado' ? 'active' : ''} ${pagoEnfocado === 'Contado' ? 'focused' : ''}`}
                onClick={() => { setFormaPago('Contado'); setPagoEnfocado('Contado'); }}
              >
                Contado
              </button>
              <button
                type="button" tabIndex={-1} data-enter-skip="true"
                className={`${comprobante.formaPago === 'Crédito' ? 'active' : ''} ${pagoEnfocado === 'Crédito' ? 'focused' : ''}`}
                onClick={() => { setFormaPago('Crédito'); setPagoEnfocado('Crédito'); }}
              >
                Crédito
              </button>
            </div>
          </div>
          <div className="input-group">
            <label>DÍAS CRÉDITO</label>
            <input
              ref={diasCreditoInputRef}
              type="number"
              name="diasCredito"
              value={comprobante.diasCredito}
              onChange={handleComprobanteChange}
              disabled={comprobante.formaPago === 'Contado'}
              placeholder="Ej: 30, 60, 90"
              min="1"
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                e.stopPropagation();
                registrarCompraBtnRef.current?.click();
              }}
            />
          </div>
          {/* Fecha de vencimiento calculada automáticamente */}
          {comprobante.formaPago !== 'Contado' && (
            <div className="input-group">
              <label>VENCE CRÉDITO — <span style={{color:'#16a34a',fontWeight:400,fontSize:'0.65rem'}}>calculado automático</span></label>
              <SmartDateInput
                value={comprobante.venceCredito}
                onChange={(val) => handleComprobanteChange({ target: { name: 'venceCredito', value: val } })}
                readOnly={!!comprobante.diasCredito}
                saltarEnter
              />
              {comprobante.venceCredito && comprobante.diasCredito && (
                <small style={{color:'#16a34a',fontSize:'0.7rem', display:'inline-flex', alignItems:'center', gap:4}}>
                  <UiIcon name="CheckCircle2" size={12} /> Vence el {new Date(comprobante.venceCredito + 'T12:00:00').toLocaleDateString('es-PE', {day:'2-digit',month:'long',year:'numeric'})} ({comprobante.diasCredito} días)
                </small>
              )}
            </div>
          )}
        </div>
      </div>

      <div className={`compra-section productos-section${esImportacionXml ? ' productos-section-xml' : ''}`}>
        <div className="productos-header">
          <h4 className="section-title">PRODUCTOS DE LA COMPRA</h4>
          <div className="compras-acciones">
            <button data-enter-skip="true" tabIndex={-1} className="btn-add-product btn-compra-sec btn-compra-precio" onClick={() => setShowModalPrecio(true)}><UiIcon name="Wallet" size={15} /> Modificar precio</button>
            <button ref={agregarProductoBtnRef} className="btn-add-product btn-compra-primary" title="F2" onClick={abrirModalAgregarProductoLimpio}>+ Agregar producto</button>
            <button
              data-enter-skip="true"
              tabIndex={-1}
              className="btn-add-product btn-compra-sec btn-compra-recuperar"
              onClick={() => setShowModalRecuperar(true)}
            ><UiIcon name="RefreshCw" size={15} /> Recuperar Anulados
            </button>
            <button
              data-enter-skip="true"
              tabIndex={-1}
              className="btn-add-product btn-compra-sec btn-compra-pedido"
              disabled={!proveedorSeleccionadoId}
              title={!proveedorSeleccionadoId ? 'Selecciona primero un proveedor' : ''}
              onClick={() => setShowModalCargarPedido(true)}
            ><UiIcon name="ClipboardList" size={15} /> Cargar desde Pedido
            </button>
            <input
              ref={xmlInputRef}
              type="file"
              accept=".xml,text/xml,application/xml"
              style={{ display: 'none' }}
              onChange={handleArchivoXml}
            />
            <button
              data-enter-skip="true"
              tabIndex={-1}
              className="btn-add-product btn-compra-sec btn-compra-xml"
              disabled={importandoXml}
              onClick={() => xmlInputRef.current?.click()}
            >
              {importandoXml ? 'Importando XML...' : <><UiIcon name="Upload" size={15} /> Importar XML</>}
            </button>
            <button
              type="button"
              data-enter-skip="true"
              tabIndex={-1}
              className="btn-add-product btn-compra-sec btn-compra-reset"
              disabled={!esImportacionXml && !showModalProveedorXml}
              title={!esImportacionXml && !showModalProveedorXml
                ? 'No hay una importación XML en pantalla'
                : 'Descarta proveedor, comprobante e ítems cargados del XML (no toca la base de datos)'}
              onClick={handleReiniciarImportacionXml}
            >
              <UiIcon name="RefreshCw" size={15} /> Reiniciar importación
            </button>
          </div>
        </div>
        <label className="compras-comparar-precio">
          <input type="checkbox" checked={compararPrecioVenta} onChange={e => setCompararPrecioVenta(e.target.checked)} />
          Comparar Precio Venta (alertar si el nuevo precio es menor al actual)
        </label>
        {esImportacionXml && (
          <div className="xml-import-resumen">
            <span>
              {xmlVinculados} de {xmlTotal} ítems vinculados
              {xmlPendientes > 0 ? ` · ${xmlPendientes} sin coincidencia` : ''}.
              {xmlTotalesOk ? ` Total del comprobante: S/ ${totalOficialXml.toFixed(2)}.` : ''}
            </span>
          </div>
        )}
        {hayDescuadreXml && (
          <div className="xml-import-descuadre" role="status">
            El total calculado no coincide con el total del comprobante (diferencia: S/ {Math.abs(descuadreXml).toFixed(2)}). Verifica los ítems antes de guardar.
          </div>
        )}
        <div className={`table-container-compras${esImportacionXml ? ' es-xml-import' : ''}`}>
          <table className={`table-compras${esImportacionXml ? ' table-compras-xml' : ''}`}>
            <thead>
              <tr>
                <th className="col-indice">#</th>
                {esImportacionXml && <th>Código</th>}
                <th>Producto</th>
                {!esImportacionXml && <th>Laboratorio</th>}
                {!esImportacionXml && <th>Medida</th>}
                <th className="col-cant">Cantidad</th>
                <th className="col-money">P. costo</th>
                <th className="col-money">P. venta</th>
                {!esImportacionXml && <th className="col-money">Importe</th>}
                <th>F. vencim.</th>
                {esImportacionXml && <th>Estado</th>}
                <th className="col-accion">Acción</th>
              </tr>
            </thead>
            <tbody>
              {productosCarrito.length === 0 ? (
                <tr><td colSpan={esImportacionXml ? 9 : 10} className="empty-table">
                  <div className="compras-empty">
                    <div className="compras-empty-icon"><UiIcon name="Package" size={28} /></div>
                    <p className="compras-empty-title">Haz clic en "+ Agregar producto" para comenzar a llenar tu factura.</p>
                    <p className="compras-empty-sub">Los ítems de esta factura aparecerán en esta tabla.</p>
                  </div>
                </td></tr>
              ) : (
                productosCarrito.map((p, i) => {
                  const estXml = estadoFilaXml(p);
                  const codigoBarrasVinculo = p.codigoBarras
                    || catalogoXmlProductos.find((c) => String(c.id_producto) === String(p.id_producto))?.codigo_barras
                    || '';
                  return (
                  <tr key={p.ui_id} className={estXml ? `xml-row xml-row-${estXml}` : undefined}>
                    <td className="col-indice text-muted">{i + 1}</td>
                    {esImportacionXml && (
                      <td className="xml-col-codigo">{p.codigoProveedor || '—'}</td>
                    )}
                    <td className="xml-col-desc">
                      {!p.id_producto ? (
                        p.origenXml ? (
                        <div className="xml-match-cell">
                          {(sugerenciasPorFilaXml[p.ui_id] || []).length > 0 && (
                            <div className="xml-sugerencias">
                              <div className="xml-sugerencias-head">
                                <span className="xml-sugerencias-titulo">
                                  <UiIcon name="Lightbulb" size={13} />
                                  {(sugerenciasPorFilaXml[p.ui_id] || []).length > 1 ? 'Quizá sea uno de estos' : 'Quizá sea este'}
                                </span>
                                <button
                                  type="button"
                                  className="btn-xml-sug-no"
                                  onClick={() => descartarSugerenciaXml(p.ui_id)}
                                >
                                  No, buscar otro
                                </button>
                              </div>
                              <div className="xml-sugerencias-lista">
                                {(sugerenciasPorFilaXml[p.ui_id] || []).map((sug) => (
                                  <button
                                    key={sug.id_producto}
                                    type="button"
                                    className="xml-sug-chip"
                                    title={`Vincular con "${sug.descripcion}"`}
                                    onClick={() => {
                                      const prod = catalogoXmlProductos.find((c) => String(c.id_producto) === String(sug.id_producto));
                                      vincularProductoFilaXml(p.ui_id, sug.id_producto, prod || null);
                                    }}
                                  >
                                    <span className="xml-sug-chip-nombre">{sug.descripcion}</span>
                                    <span className="xml-sug-chip-accion">
                                      <UiIcon name="Check" size={12} /> Sí, es este
                                    </span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="xml-match-actions">
                            <SearchableSelect
                              className="xml-match-select"
                              options={catalogoXmlProductos}
                              value=""
                              onChange={(val, prod) => vincularProductoFilaXml(p.ui_id, val, prod || null)}
                              getOptionValue={(prod) => prod.id_producto}
                              getOptionLabel={(prod) => prod.descripcion}
                              getOptionSearchText={(prod) => `${prod.descripcion} ${prod.laboratorios?.nombre || ''} ${prod.codigo_barras || ''}`}
                              autoSelectExactBarcode
                              resolveExactBarcode={buscarProductoPorCodigoBarras}
                              placeholder="Nombre o código de barras..."
                              emptyOptionLabel="-- Elegir producto --"
                            />
                            <button
                              type="button"
                              className="btn-xml-crear-prod"
                              onClick={() => abrirAltaProductoDesdeXml(p)}
                            >
                              <UiIcon name="Plus" size={14} /> Crear producto nuevo
                            </button>
                          </div>
                          <OpcionRenombrarNombreXml fila={p} onToggle={toggleActualizarNombreXml} />
                          <label className="xml-bonif-check" style={{ marginLeft: 0, marginTop: 6 }}>
                            <input
                              type="checkbox"
                              checked={!!p.bonificacion}
                              onChange={(e) => toggleBonificacionFila(p.ui_id, e.target.checked)}
                            />
                            Bonificación
                          </label>
                        </div>
                        ) : (
                        <div className="xml-match-cell">
                          <SearchableSelect
                            className="xml-match-select"
                            options={catalogoXmlProductos}
                            value=""
                            autoOpen={filaBusquedaAuto === p.ui_id}
                            onChange={(val, prod) => {
                              if (!val || !prod) return;
                              vincularProductoFilaXml(p.ui_id, val, prod);
                            }}
                            getOptionValue={(prod) => prod.id_producto}
                            getOptionLabel={(prod) => prod.descripcion}
                            getOptionSearchText={(prod) => `${prod.descripcion} ${prod.laboratorios?.nombre || ''} ${prod.codigo_barras || ''}`}
                            autoSelectExactBarcode
                            resolveExactBarcode={buscarProductoPorCodigoBarras}
                            placeholder="Nombre o código de barras..."
                          />
                        </div>
                        )
                      ) : (
                        <>
                          <strong>{p.descripcion}</strong>
                          {p.origenXml && (
                            <label className="xml-bonif-check">
                              <input
                                type="checkbox"
                                checked={!!p.bonificacion}
                                onChange={(e) => toggleBonificacionFila(p.ui_id, e.target.checked)}
                              />
                              Bonificación
                            </label>
                          )}
                          {!p.origenXml && p.bonificacion && (
                            <span style={{ marginLeft: 6, fontSize: '0.7rem', fontWeight: 700, color: 'var(--lf-primary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <UiIcon name="Gift" size={12} /> Bonificación
                            </span>
                          )}
                          <br />
                          <small className="text-muted">
                            Lote: {p.nroLote || 'Genérico'}
                            {p.origenXml && (
                              <> · Cód. barras: {codigoBarrasVinculo || 'Sin código de barras'}</>
                            )}
                            {p.uMedida !== 'UNIDAD' && p.factor > 1 && ` · ${p.cantidadDisplay} ${p.uMedida.toLowerCase()}${p.cantidadDisplay > 1 ? 's' : ''} × ${p.factor} und`}
                          </small>
                          {estXml !== 'nuevo' && (
                            <OpcionRenombrarNombreXml fila={p} onToggle={toggleActualizarNombreXml} />
                          )}
                        </>
                      )}
                    </td>
                    {!esImportacionXml && <td className="text-muted">{p.laboratorio || '---'}</td>}
                    {!esImportacionXml && <td>{p.uMedida}</td>}
                    <td className="col-cant">
                      <CeldaEditableInline
                        valor={p.cantidad}
                        formato={v => `${v} und`}
                        editando={celdaEditando?.ui_id === p.ui_id && celdaEditando?.campo === 'cantidad'}
                        onIniciarEdicion={() => setCeldaEditando({ ui_id: p.ui_id, campo: 'cantidad' })}
                        onConfirmar={(valorStr, via) => confirmarEdicionInline(p, 'cantidad', valorStr, via)}
                        onCancelar={cancelarEdicionInline}
                      />
                    </td>
                    <td className="col-money">
                      <CeldaEditableInline
                        valor={p.pCosto}
                        formato={v => formatSolesUnitario(v)}
                        editando={celdaEditando?.ui_id === p.ui_id && celdaEditando?.campo === 'pCosto'}
                        onIniciarEdicion={() => setCeldaEditando({ ui_id: p.ui_id, campo: 'pCosto' })}
                        onConfirmar={(valorStr, via) => confirmarEdicionInline(p, 'pCosto', valorStr, via)}
                        onCancelar={cancelarEdicionInline}
                      />
                    </td>
                    <td className="col-money">
                      <CeldaEditableInline
                        valor={p.pVenta}
                        formato={v => formatSolesUnitario(v)}
                        editando={celdaEditando?.ui_id === p.ui_id && celdaEditando?.campo === 'pVenta'}
                        onIniciarEdicion={() => setCeldaEditando({ ui_id: p.ui_id, campo: 'pVenta' })}
                        onConfirmar={(valorStr, via) => confirmarEdicionInline(p, 'pVenta', valorStr, via)}
                        onCancelar={cancelarEdicionInline}
                      />
                    </td>
                    {!esImportacionXml && <td className="col-money col-importe">S/ {p.subtotal.toFixed(2)}</td>}
                    <td className="text-muted xml-col-fecha">{p.fVencimiento || '---'}</td>
                    {esImportacionXml && (
                      <td>
                        <span className={`xml-estado xml-estado-${estXml}`}>
                          {etiquetaEstadoXml(estXml)}
                        </span>
                      </td>
                    )}
                    <td className="col-accion">
                      <div className="row-actions">
                        <button
                          className="btn-row-action btn-row-icon btn-row-edit"
                          title="Editar producto"
                          aria-label="Editar producto"
                          onClick={() => editarProductoDelCarrito(p)}
                          disabled={!p.id_producto}
                        >
                          <UiIcon name="Pencil" size={15} />
                        </button>
                        <button
                          className="btn-row-action btn-row-icon btn-row-swap"
                          title="Cambiar el producto de esta fila"
                          aria-label="Cambiar el producto de esta fila"
                          onClick={() => cambiarProductoDeFila(p)}
                          disabled={!p.id_producto}
                        >
                          <UiIcon name="RefreshCw" size={15} />
                        </button>
                        <button
                          className="btn-row-action btn-row-icon btn-row-duplicate"
                          title="Duplicar producto"
                          aria-label="Duplicar producto"
                          onClick={() => duplicarProductoDelCarrito(p)}
                          disabled={!p.id_producto}
                        >
                          <UiIcon name="ClipboardList" size={15} />
                        </button>
                        <button
                          className="btn-row-action btn-row-icon btn-row-delete"
                          title="Eliminar producto"
                          aria-label="Eliminar producto"
                          onClick={() => eliminarProductoDelCarrito(p.ui_id)}
                        >
                          <UiIcon name="Trash2" size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="compras-footer">
        <div className="cf-marca">
          <span className="cf-logo" aria-hidden="true">
            <LogoLuxFarma variant="icon" size={38} color="red" />
          </span>
          <div className="cf-items">
            <span className="cf-items-num">{productosCarrito.length}</span>
            <span className="cf-items-txt">{productosCarrito.length === 1 ? 'producto' : 'productos'}</span>
          </div>
        </div>

        <div className="cf-desglose">
          <div className="cf-dato">
            <label>Subtotal</label>
            <span>S/ {subtotal.toFixed(2)}</span>
          </div>
          <div className="cf-dato">
            <label>IGV (18%)</label>
            <span>S/ {igv.toFixed(2)}</span>
          </div>
          <div className="cf-dato cf-dato-percepcion">
            <label>Percepción</label>
            <div className="input-box-prefix small">
              <span>S/</span>
              <input type="number" value={percepcion || ''} onChange={(e) => setPercepcion(e.target.value === '' ? 0 : Number(e.target.value))} />
            </div>
          </div>
        </div>

        <div className="cf-total">
          <label>Total compra</label>
          <h2
            className={totalManual !== null ? 'total-editado-manual' : undefined}
            title={totalManual !== null ? `Editado manualmente — el sistema había calculado S/ ${totalCompra.toFixed(2)}` : undefined}
          >
            <CeldaEditableInline
              valor={totalCompraFinal}
              formato={v => `S/ ${Number(v).toFixed(2)}`}
              editando={editandoTotal}
              onIniciarEdicion={() => setEditandoTotal(true)}
              onConfirmar={confirmarEdicionTotal}
              onCancelar={cancelarEdicionTotal}
            />
          </h2>
        </div>

        <div className="cf-acciones">
          <button className="btn-bottom-outline" data-enter-skip="true" tabIndex={-1} onClick={handleCancelarCompra}><UiIcon name="X" size={15} /> Cancelar compra</button>
          <button ref={registrarCompraBtnRef} className="btn-bottom-primary" data-enter-primary="true" onClick={registrarCompraDb} disabled={registrando}>
            {registrando ? 'Registrando en BD...' : <><UiIcon name="Check" size={15} /> Registrar compra</>}
          </button>
        </div>
      </div>
        </>
      )}

      {vistaActual === 'historial' && (
        <div className="historial-compras-card">
          <h4 className="section-title">Historial de Compras</h4>
          {cargandoHistorialCompras ? (
            <div className="empty-table" style={{ padding: '2rem' }}>Cargando...</div>
          ) : historialComprasLista.length === 0 ? (
            <div className="empty-table" style={{ padding: '2rem' }}>No hay compras registradas.</div>
          ) : (
            <div className="table-container-compras">
              <table className="table-compras">
                <thead>
                  <tr>
                    <th>FECHA</th>
                    <th>PROVEEDOR</th>
                    <th>N° DOCUMENTO</th>
                    <th className="text-right">TOTAL</th>
                    <th>FORMA PAGO</th>
                    <th className="text-center">ESTADO</th>
                    <th className="text-center">ACCIÓN</th>
                  </tr>
                </thead>
                <tbody>
                  {historialComprasLista.map(c => {
                    const anulada = c.estado_anulacion === 'ANULADO';
                    return (
                      <tr key={c.id_compra} style={anulada ? { opacity: 0.55 } : undefined}>
                        <td className="text-muted">{new Date(c.fecha_compra).toLocaleDateString('es-PE')}</td>
                        <td>{c.proveedores?.razon_social || '---'}</td>
                        <td className="font-bold">{c.nro_documento}</td>
                        <td className="text-right font-bold text-dark">
                          S/ {Number(c.total_compra).toFixed(2)}
                          {c.total_editado_manualmente && (
                            <span className="icono-total-editado" title={`Editado manualmente — el sistema había calculado S/ ${Number(c.total_calculado_original || 0).toFixed(2)}`}><UiIcon name="Pencil" size={16} /></span>
                          )}
                        </td>
                        <td className="text-muted">{c.forma_pago}</td>
                        <td className="text-center">
                          <span className={`estado-pill ${anulada ? 'anulado' : (c.estado_pago === 'PAGADO' ? 'pagado' : 'pendiente')}`}>
                            {anulada ? 'ANULADA' : c.estado_pago}
                          </span>
                        </td>
                        <td className="text-center">
                          <div className="row-actions">
                            <button
                              className="btn-row-action btn-row-edit"
                              onClick={() => verDetalleCompra(c)}
                            >
                              <UiIcon name="Eye" size={15} /> Ver detalle
                            </button>
                            {!anulada && (
                              <button
                                className="btn-row-action btn-row-delete"
                                onClick={() => { setCompraAAnular(c); setMotivoAnulacionCompra(motivosAnulacionCompra[0]); setMsgAnulacionCompra(null); }}
                              ><UiIcon name="Ban" size={15} /> Anular
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ============ MODAL: VER DETALLE DE COMPRA ============ */}
      {compraDetalleVer && (
        <div className="modal-overlay-strict" style={{ zIndex: 100031 }}>
          <div className="popup-producto-card popup-producto-card-ancho">
            <div className="popup-header">
              <div className="popup-title-group">
                <h3><UiIcon name="Eye" size={15} /> Detalle de compra</h3>
                <p>
                  {compraDetalleVer.nro_documento} · {compraDetalleVer.proveedores?.razon_social || '---'} · S/ {Number(compraDetalleVer.total_compra).toFixed(2)}
                  {compraDetalleVer.total_editado_manualmente && (
                    <span className="icono-total-editado" title={`Editado manualmente — el sistema había calculado S/ ${Number(compraDetalleVer.total_calculado_original || 0).toFixed(2)}`}><UiIcon name="Pencil" size={16} /></span>
                  )}
                </p>
              </div>
              <button className="btn-close-popup" onClick={() => setCompraDetalleVer(null)}><UiIcon name="X" size={16} /></button>
            </div>
            <div className="popup-body">
              {compraDetalleVer.estado_anulacion === 'ANULADO' && (
                <div className="alerta-anulacion-box" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                  <UiIcon name="AlertTriangle" size={15} /> Esta compra está anulada. Motivo: {compraDetalleVer.motivo_anulacion || '---'}
                </div>
              )}

              {cargandoDetalleCompra ? (
                <p className="text-muted" style={{ padding: '1.5rem', textAlign: 'center' }}>Cargando detalle...</p>
              ) : detalleComprasLineas.length === 0 ? (
                <p className="text-muted" style={{ padding: '1.5rem', textAlign: 'center' }}>Esta compra no tiene productos en su detalle.</p>
              ) : (
                <div className="table-container-compras">
                  <table className="table-compras">
                    <thead>
                      <tr>
                        <th>PRODUCTO</th>
                        <th>LABORATORIO</th>
                        <th className="text-center">CANTIDAD</th>
                        <th className="text-center">U.MEDIDA</th>
                        <th className="text-center">P.COSTO</th>
                        <th className="text-right">IMPORTE</th>
                        <th>LOTE</th>
                        <th>F.VENCIMIENTO</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detalleComprasLineas.map((item, i) => (
                        <tr key={i}>
                          <td className="font-bold">{item.productos?.descripcion || '---'}</td>
                          <td className="text-muted">{item.productos?.laboratorios?.nombre || '---'}</td>
                          <td className="text-center">{item.cantidad}</td>
                          <td className="text-center text-muted">UNIDAD</td>
                          <td className="text-center">S/ {Number(item.costo_unitario).toFixed(4)}</td>
                          <td className="text-right font-bold text-dark">S/ {Number(item.subtotal).toFixed(2)}</td>
                          <td className="text-muted">{item.nro_lote || '---'}</td>
                          <td className="text-muted">{item.fecha_vencimiento || '---'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {compraDetalleVer.estado_anulacion === 'ANULADO' && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
                  <button
                    className="btn-add-product btn-compra-sec btn-compra-recuperar"
                    onClick={() => recuperarDesdeDetalle(compraDetalleVer)}
                  ><UiIcon name="RefreshCw" size={15} /> Recuperar esta compra
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ============ MODAL: ANULAR COMPRA ============ */}
      {compraAAnular && (
        <div className="modal-overlay-strict" style={{ zIndex: 100032 }} onClick={() => !anulandoCompra && setCompraAAnular(null)}>
          <div className="popup-producto-card" style={{ maxWidth: '460px' }} onClick={e => e.stopPropagation()}>
            <div className="popup-header">
              <div className="popup-title-group">
                <h3><UiIcon name="AlertTriangle" size={15} /> Anular compra</h3>
                <p>{compraAAnular.nro_documento} · S/ {Number(compraAAnular.total_compra).toFixed(2)}</p>
              </div>
              <button className="btn-close-popup" disabled={anulandoCompra} onClick={() => setCompraAAnular(null)}><UiIcon name="X" size={16} /></button>
            </div>
            <div className="popup-body" style={{ padding: '1.25rem 1.5rem' }}>
              <div className="alerta-anulacion-box" style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <UiIcon name="AlertTriangle" size={15} /> Acción irreversible. Se revertirá el stock que esta compra agregó al inventario.
              </div>

              {cargandoShortfalls ? (
                <p className="text-muted" style={{ fontSize: '0.82rem', margin: '0.75rem 0' }}>Verificando stock disponible...</p>
              ) : shortfallsAnulacion.length > 0 && (
                <div className="alerta-shortfall-box">
                  <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><UiIcon name="AlertTriangle" size={15} /> Stock insuficiente para revertir completo:</strong>
                  <ul>
                    {shortfallsAnulacion.map((s, i) => (
                      <li key={i}>{s.descripcion}: requiere {s.requerido}, solo hay {s.disponible} (faltan {s.faltante})</li>
                    ))}
                  </ul>
                  <p>Se restará hasta donde alcance el stock (mínimo 0) en los productos con faltante.</p>
                </div>
              )}

              <div style={{ margin: '1rem 0' }}>
                <label className="section-title" style={{ display: 'block', marginBottom: '0.4rem' }}>Motivo de anulación</label>
                <select
                  value={motivoAnulacionCompra}
                  onChange={e => setMotivoAnulacionCompra(e.target.value)}
                  disabled={anulandoCompra}
                  style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '8px', border: '1.5px solid var(--lf-border)' }}
                >
                  {motivosAnulacionCompra.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>

              {msgAnulacionCompra && (
                <div className={`msg-anulacion-box ${msgAnulacionCompra.ok ? 'ok' : 'error'}`}>
                  {msgAnulacionCompra.texto}
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
                <button className="btn-popup-cancel" data-enter-skip="true" tabIndex={-1} disabled={anulandoCompra} onClick={() => setCompraAAnular(null)}>
                  Cancelar
                </button>
                <button className="btn-bottom-primary" style={{ background: '#dc2626' }} disabled={anulandoCompra || cargandoShortfalls} onClick={handleAnularCompra}>
                  {anulandoCompra ? (
                    <><span className="row-action-spinner" style={{ borderColor: 'rgba(255,255,255,0.35)', borderTopColor: '#fff' }}></span> Anulando...</>
                  ) : shortfallsAnulacion.length > 0 ? 'Sí, anular de todas formas' : 'Confirmar anulación'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
