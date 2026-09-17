import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../supabaseClient";
import { useOnlineStatus } from "../../hooks/useOnlineStatus";
import { guardarVentaOffline, contarPendientes, obtenerVentasPendientes, ensureOfflineReady } from "../../utils/offlineQueue";
import { sincronizarCola } from "../../utils/syncEngine";
import { buscarProductosOffline, descargarCatalogo, catalogoTieneDatos, catalogoMarcadoStale, suscribirProductosChanged } from "../../utils/catalogoCache";
import { ordenarResultadosBusqueda, terminoBusquedaSeguro, SELECT_POS_BUSQUEDA, nombreLaboratorioProducto, DEBOUNCE_BUSQUEDA_MS, MIN_CHARS_BUSQUEDA_VIVA } from "../../utils/buscarProductosCatalogo";
import { obtenerFormasVentaOffline, obtenerUnidadesOffline } from "../../utils/offlineStore";

/** Umbral de stock bajo (unidades base del snapshot local) para aviso offline entre cajeros. */
const STOCK_BAJO_OFFLINE = 3;
import { esComprobanteSunat, procesarEmisionSunat, reintentarComprobantesSunat } from "../../services/comprobantesSunat";
import { facturacionElectronica, EMPRESA } from "../../config/empresa";
import { obtenerStockDisponible } from "../../utils/notasInventarioAjustes";
import { armarPayloadSincronizacion } from "../../utils/ventaUuid";
import { registrarVentaEnServidor } from "../../utils/registrarVentaServidor";
import { mensajeStockOfflineInsuficiente, validarStockOfflineCarrito } from "../../utils/stockOffline";
import {
  agregarLineaCarrito,
  cambiarCantidadLinea,
  cambiarModoVentaLinea,
  claveLineaCarrito,
  debePreguntarFormaVenta,
  etiquetaProductoTicket,
  formaVentaMenorFactor,
  productosDistintosEnCarrito,
  quitarLineaCarrito,
  unidadesBaseProducto,
} from "../../utils/carritoPos";
import { filaProductoPrecios } from "../../utils/productoPrecios";
import { costoCatalogoUnidadBase, estamparCostoSnapshotCarrito } from "../../utils/costoVentaSnapshot";
import { redondear2 } from "../../utils/dinero";
import { formatPrecioUnitario, formatSolesUnitario } from "../../utils/precioExacto";
import { buildPrintPayloadFromRecibo, printTicketVenta } from "../../utils/ticketPrint";
import { cargarVentasDelTurno } from "../../utils/ventasDelTurno";
import { etiquetaComprobanteVisible } from "../../utils/comprobanteVisible";
import ProcesandoVenta from "../../components/ProcesandoVenta";
import AlertaSistemaModal from "../../components/AlertaSistemaModal";
import SelectorFormaVentaModal from "./SelectorFormaVentaModal";
import "./POS.css";
import UiIcon from '../../components/UiIcon';
import LogoLuxFarma from '../../components/LogoLuxFarma';

import { consultarDocumento } from '../../utils/consultaDocIdentidad';
import { typewriteFields } from '../../utils/typewriteText';
import { playNotifSound } from '../../utils/notifSound';
import { resolverSexoAutofill } from '../../utils/sexoPorNombre';
const TIPOS_COMPROBANTE = facturacionElectronica
  ? ["Boleta", "Factura", "Nota de Venta"]
  : ["Nota de Venta"];
const TIPO_COMPROBANTE_DEFAULT = facturacionElectronica ? "Boleta" : "Nota de Venta";
const OPCIONES_SEXO = [
  { value: 'M', label: 'Masculino' },
  { value: 'F', label: 'Femenino' },
];
const METODOS_PAGO = ["Efectivo", "Yape", "Tarjeta", "Mixto"];
const METODOS_MIXTO = ["Efectivo", "Yape", "Tarjeta"];
/** Número Yape mostrado al cobrar (confirmación de pago). */
const YAPE_NUMERO = "929 994 214";

/** Solo dígitos, mínimo 6 — heurística de código de barras / escáner. */
function esCodigoBarras(term) {
  return /^\d{6,}$/.test(String(term || "").trim());
}

/** Match exacto de código de barras (case-insensitive). */
function matchExactoBarcode(lista, term) {
  const t = String(term || "").trim().toLowerCase();
  return (lista || []).filter(
    (p) => String(p.codigo_barras || "").toLowerCase() === t
  );
}

// ===================================================================
// 🖨️ IMPRIMIR RECIBO — fuera del componente para evitar conflicto JSX
// ===================================================================
function _imprimirRecibo(venta, carritoSnap, totalSnap, metodoPagoSnap, mixtoSnap, userSnap, clienteNombreSnap) {
  const fecha = new Date();
  const fechaStr = fecha.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const horaStr = fecha.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
  const comprobante = venta.serie + '-' + String(venta.correlativo).padStart(8, '0');
  const nombreSede = (userSnap && userSnap.sucursales && userSnap.sucursales.nombre_comercial) || EMPRESA.nombreComercial;
  const vendedor = (userSnap ? userSnap.nombres || '' : '') + ' ' + ((userSnap && userSnap.apellidos) ? userSnap.apellidos.split(' ')[0] : '');
  const clienteStr = (clienteNombreSnap && String(clienteNombreSnap).trim()) || 'CLIENTE GENERAL';

  let metodoStr = metodoPagoSnap;
  if (metodoPagoSnap === 'Mixto' && mixtoSnap) {
    metodoStr = mixtoSnap.metodo1 + ' S/' + Number(mixtoSnap.monto1).toFixed(2) + ' + ' + mixtoSnap.metodo2 + ' S/' + Number(mixtoSnap.monto2).toFixed(2);
  }

  var filas = carritoSnap.map(function (item) {
    return '<tr>' +
      '<td style="padding:3px 4px;font-size:12px">' + etiquetaProductoTicket(item) + '</td>' +
      '<td style="padding:3px 4px;font-size:12px;text-align:center">' + item.cantidad + '</td>' +
      '<td style="padding:3px 4px;font-size:12px;text-align:right">S/' + formatPrecioUnitario(item.precio) + '</td>' +
      '<td style="padding:3px 4px;font-size:12px;text-align:right"><b>S/' + Number(item.subtotal).toFixed(2) + '</b></td>' +
      '</tr>';
  }).join('');

  var igv = Math.round((totalSnap / 1.18 * 0.18) * 100) / 100;
  var base = Math.round((totalSnap - igv) * 100) / 100;

  var css = [
    '@page { size: 80mm auto; margin: 0; }',
    '* { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
    'html, body { width:80mm; }',
    'body { font-family: "Courier New", Courier, monospace; margin:0 auto; padding:2mm; font-size:15px; color:#000; font-weight:700; -webkit-font-smoothing: none; text-rendering: optimizeSpeed; line-height:1.4; }',
    '.center { text-align:center; }',
    '.bold { font-weight:800; }',
    '.line { border-top:1.5px dashed #000; margin:5px 0; }',
    'table { width:100%; border-collapse:collapse; }',
    'th { font-size:13px; font-weight:800; text-align:left; border-bottom:1.5px solid #000; padding:3px 4px; }',
    'td { font-weight:600; }',
    '.total-row td { border-top:1.5px solid #000; padding-top:5px; font-weight:800; font-size:16px; }',
    '@media print { html, body { width:80mm; margin:0; } button { display:none !important; } * { font-weight:600 !important; } .bold, .total-row td, th { font-weight:800 !important; } }'
  ].join(' ');

  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + comprobante + '</title>' +
    '<style>' + css + '</style></head><body>' +
    '<div class="center bold" style="font-size:17px;letter-spacing:1px">' + EMPRESA.ticketMarca + '</div>' +
    '<div class="center" style="font-size:12px">' + nombreSede + '</div>' +
    '<div class="center" style="font-size:11px;color:#555">' + EMPRESA.ticketRubro + '</div>' +
    '<div class="line"></div>' +
    '<div class="center bold" style="font-size:14px">' + (venta.tipo_comprobante === 'NOTA DE VENTA' ? 'NOTA DE VENTA' : (venta.tipo_comprobante || 'BOLETA') + ' DE VENTA') + '</div>' +
    '<div class="center bold" style="font-size:15px;letter-spacing:2px">' + comprobante + '</div>' +
    (venta.es_offline ? '<div class="center" style="font-size:11px;color:#f59e0b">⚠ Registrado offline</div>' : '') +
    '<div class="line"></div>' +
    '<div style="font-size:11px">Fecha: <b>' + fechaStr + '</b> &nbsp; Hora: <b>' + horaStr + '</b></div>' +
    '<div style="font-size:11px">Vendedor: <b>' + vendedor.trim() + '</b></div>' +
    '<div style="font-size:11px">Cliente: <b>' + clienteStr + '</b></div>' +
    '<div class="line"></div>' +
    '<table><thead><tr>' +
    '<th style="width:45%">PRODUCTO</th><th style="width:15%;text-align:center">CANT</th>' +
    '<th style="width:20%;text-align:right">P.UNIT</th><th style="width:20%;text-align:right">SUBT.</th>' +
    '</tr></thead><tbody>' + filas + '</tbody>' +
    '<tbody>' +
    '<tr class="total-row"><td colspan="3" style="text-align:right;font-size:13px">SUBTOTAL:</td><td style="text-align:right;font-size:13px">S/' + Number(totalSnap).toFixed(2) + '</td></tr>' +
    '<tr><td colspan="3" style="text-align:right;font-size:13px">BASE IMPONIBLE:</td><td style="text-align:right;font-size:13px">S/' + base.toFixed(2) + '</td></tr>' +
    '<tr><td colspan="3" style="text-align:right;font-size:13px">IGV (18%):</td><td style="text-align:right;font-size:13px">S/' + igv.toFixed(2) + '</td></tr>' +
    '<tr><td colspan="3" style="text-align:right;font-weight:bold;font-size:16px">TOTAL:</td><td style="text-align:right;font-weight:bold;font-size:16px">S/' + Number(totalSnap).toFixed(2) + '</td></tr>' +
    '</tbody></table>' +
    '<div class="line"></div>' +
    '<div style="font-size:11px">Pago: <b>' + metodoStr + '</b></div>' +
    '<div class="line"></div>' +
    '<div class="center" style="font-size:11px;margin-top:6px">\u00a1Gracias por su compra!</div>' +
    '<div class="center" style="font-size:10px;color:#555">Conserve su comprobante</div><br/>' +
    '<div class="center"><button onclick="window.print()" style="padding:6px 20px;font-size:12px;cursor:pointer;background:var(--lf-primary-dark);color:white;border:none;border-radius:4px">Imprimir</button></div>' +
    '<scr' + 'ipt>window.onload=function(){setTimeout(function(){window.print();},400);}' + '<' + '/scr' + 'ipt>' +
    '</body></html>';

  var win = window.open('', '_blank', 'width=320,height=600,scrollbars=yes');
  if (win) { win.document.write(html); win.document.close(); }
}

const getSavedState = (key, defaultValue) => {
  const saved = sessionStorage.getItem(key);
  if (saved) {
    try { return JSON.parse(saved); } catch { return saved; }
  }
  return defaultValue;
};

// ===================================================================
// 📡 BADGE DE CONEXIÓN — componente visual para el estado de red
// ===================================================================
function ConnectionBadge({ isOnline, pendientes, sincronizando }) {
  return (
    <div
      className={`pos-conn-badge ${isOnline ? "is-online" : "is-offline"}`}
      aria-live="polite"
    >
      <span
        className={`pos-conn-dot ${isOnline ? "is-online" : "is-offline"}`}
        aria-hidden="true"
      />
      {sincronizando
        ? <><UiIcon name="Loader" size={14} /> Sincronizando...</>
        : isOnline
          ? pendientes > 0
            ? <><UiIcon name="Check" size={14} /> Online · {pendientes} pendiente{pendientes > 1 ? 's' : ''}</>
            : <><UiIcon name="Check" size={14} /> Online</>
          : pendientes > 0
            ? <><UiIcon name="AlertTriangle" size={14} /> Offline · {pendientes} en cola</>
            : <><UiIcon name="WifiOff" size={14} /> Sin conexión</>}
    </div>
  );
}

export default function POS() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // ─── Estado de conexión ─────────────────────────────────────
  const isOnline = useOnlineStatus();

  // ─── Turno abierto — se verifica UNA vez al entrar a la pantalla (antes solo se
  // consultaba recién al presionar Cobrar, muy tarde para avisar con tiempo). null =
  // todavía no se sabe (no bloquea mientras carga), false = confirmado que no hay
  // turno abierto. No se re-consulta en cada clic: si el turno se cierra desde otra
  // pantalla mientras el vendedor sigue en POS, Dashboard.jsx ya lo desloguea/redirige
  // a él directamente, así que este componente no necesita vigilarlo en vivo. ─────
  const [turnoAbierto, setTurnoAbierto] = useState(null);
  const [idTurnoPos, setIdTurnoPos] = useState(null);
  const [resumenTurno, setResumenTurno] = useState({ total: 0, ops: 0 });
  const idTurnoPosRef = useRef(null);
  idTurnoPosRef.current = idTurnoPos;
  useEffect(() => {
    if (!isOnline || !user?.id_usuario) return;
    supabase
      .from('caja_turnos')
      .select('id_turno, id_sucursal')
      .eq('id_usuario_vendedor', user.id_usuario)
      .eq('estado', 'ABIERTO')
      .maybeSingle()
      .then(({ data }) => {
        setTurnoAbierto(!!data);
        setIdTurnoPos(data?.id_turno ?? null);
      });
  }, [isOnline, user?.id_usuario]);

  useEffect(() => {
    if (idTurnoPos) return;
    try {
      const t = JSON.parse(localStorage.getItem('luxfarma_turnoActivo') || 'null');
      if (t?.id_turno) setIdTurnoPos(t.id_turno);
    } catch { /* solo lectura para la franja */ }
  }, [idTurnoPos]);

  useEffect(() => {
    if (!idTurnoPos || !isOnline) return undefined;
    let cancelado = false;
    cargarVentasDelTurno(supabase, idTurnoPos)
      .then((r) => {
        if (cancelado) return;
        setResumenTurno({ total: r.totalVendido, ops: r.operaciones });
      })
      .catch(() => {});
    return () => { cancelado = true; };
  }, [idTurnoPos, isOnline]);

  const avisarSinTurno = () => {
    mostrarAlerta(
      'No tienes un turno abierto. Necesitas abrir turno antes de registrar ventas.',
      'warning',
      () => navigate('/dashboard'),
      'Abrir turno'
    );
  };
  const [ventasPendientes, setVentasPendientes] = useState(0);
  const [sincronizando, setSincronizando] = useState(false);
  const [notifSync, setNotifSync] = useState(null); // notificación de resultado sync
  const [descargaProgreso, setDescargaProgreso] = useState(null);
  // { fase: 'productos'|'stock'|'guardando'|'listo', descargados: 0, total: 0 }

  const [tipoComprobante, setTipoComprobante] = useState(() => {
    const saved = getSavedState("pos_tipo", TIPO_COMPROBANTE_DEFAULT);
    if (!facturacionElectronica && (saved === "Boleta" || saved === "Factura")) return "Nota de Venta";
    return saved;
  });
  // Booleanos derivados, calculados una sola vez por render — evitan repetir
  // `tipoComprobante === "Boleta"` en ~14 lugares distintos y que alguno quede
  // desactualizado al agregar un tipo nuevo. Nota de Venta comparte formulario/
  // validación/búsqueda con Boleta (ver comentarios en cada uso); Factura es la
  // única rama realmente distinta.
  const esBoleta = tipoComprobante === "Boleta";
  const esFactura = tipoComprobante === "Factura";
  const esNotaVenta = tipoComprobante === "Nota de Venta";
  // Toggle "Tipo de comprobante": tipoEnfocado es el resaltado visual mientras el
  // contenedor tiene foco, independiente de tipoComprobante (la selección confirmada).
  const [tipoEnfocado, setTipoEnfocado] = useState(() => {
    const saved = getSavedState("pos_tipo", TIPO_COMPROBANTE_DEFAULT);
    if (!facturacionElectronica && (saved === "Boleta" || saved === "Factura")) return "Nota de Venta";
    return saved;
  });
  /** Dirección slide al cambiar Boleta ↔ Factura ↔ Nota (no bloquea teclado). */
  const [tipoTabDir, setTipoTabDir] = useState("forward");
  const docInputRef = useRef(null);
  const clienteNombresRef = useRef(null);
  const sexoRef = useRef(null);
  const direccionRef = useRef(null);
  const buscadorProductoRef = useRef(null);
  const [metodoPago, setMetodoPago] = useState(() => getSavedState("pos_metodo", "Efectivo"));
  const [montoRecibido, setMontoRecibido] = useState(() => getSavedState("pos_monto", 0));
  const [carrito, setCarrito] = useState(() => getSavedState("pos_carrito", []));
  const [selectorForma, setSelectorForma] = useState(null);
  const [_unidadesMedida, setUnidadesMedida] = useState([]);

  const [searchTerm, setSearchTerm] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  /** Resultados embebidos — búsqueda en vivo desde 3 letras, Enter selecciona. */
  const [showResultadosPanel, setShowResultadosPanel] = useState(false);
  const [filaResaltada, setFilaResaltada] = useState(-1);
  const rowRefs = useRef([]);
  const searchWrapperRef = useRef(null);
  /** Evita carreras si el usuario escribe mientras un Enter espera el flush. */
  const busquedaSeqRef = useRef(0);
  const busquedaDebounceRef = useRef(null);
  const idResaltadoPosRef = useRef(null);
  const searchTermRef = useRef("");

  /** null | 'cliente' | 'pago' — pasos de cobro (cliente/pago ocultos hasta Cobrar). */
  const [pasoCobro, setPasoCobro] = useState(null);
  /** Dirección de transición visual entre paso cliente ↔ pago. */
  const [cobroAnimDir, setCobroAnimDir] = useState("forward");
  const [pagoEnfocado, setPagoEnfocado] = useState(0);
  const cobroTrasMixtoRef = useRef(false);
  const pagoGridRef = useRef(null);
  const montoRecibidoRef = useRef(null);
  const confirmarPagoBtnRef = useRef(null);
  const mixtoMonto1Ref = useRef(null);

  const [showPagoMixto, setShowPagoMixto] = useState(false);
  const [mixtoData, setMixtoData] = useState({ metodo1: "Efectivo", monto1: 0, metodo2: "Yape", monto2: 0 });

  const [docInput, setDocInput] = useState(() => getSavedState("pos_doc", ""));
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState("");
  const [docOk, setDocOk] = useState(() => !!getSavedState("pos_nombres", "") || !!getSavedState("pos_razon", ""));
  /** Contador de flash: >0 dispara CSS; se resetea solo (no bloquea teclado). */
  const [docAutofillFlash, setDocAutofillFlash] = useState(0);
  const [clienteNombres, setClienteNombres] = useState(() => getSavedState("pos_nombres", ""));
  const [clienteApellidos, setClienteApellidos] = useState(() => getSavedState("pos_apellidos", ""));
  const [clienteSexo, setClienteSexo] = useState(() => getSavedState("pos_sexo", ""));
  /** true = chip de sexo vino de sugerencia por nombre (no de clic del cajero / API). */
  const [sexoEsSugerido, setSexoEsSugerido] = useState(false);
  const [clienteRazonSocial, setClienteRazonSocial] = useState(() => getSavedState("pos_razon", ""));
  const [clienteDireccion, setClienteDireccion] = useState(() => getSavedState("pos_dir", ""));
  const [modoManual, setModoManual] = useState(false);
  /** Boleta/Nota sin DNI: Nubefact ya envía tipo_doc=0 + 00000000 (SIN_DOC). */
  const [ventaSinDoc, setVentaSinDoc] = useState(false);
  const docTimer = useRef(null);
  const docFlashTimer = useRef(null);
  /** Cancela typewriter en curso si llega otra consulta / unmount. */
  const typewriteAbortRef = useRef(null);

  const dispararAutofillFlash = useCallback(() => {
    if (docFlashTimer.current) clearTimeout(docFlashTimer.current);
    setDocAutofillFlash((n) => n + 1);
    playNotifSound();
    docFlashTimer.current = setTimeout(() => setDocAutofillFlash(0), 720);
  }, []);

  const cancelarTypewrite = useCallback(() => {
    if (typewriteAbortRef.current) {
      typewriteAbortRef.current.abort();
      typewriteAbortRef.current = null;
    }
  }, []);

  const aplicarAutofillTypewrite = useCallback(async (jobs) => {
    cancelarTypewrite();
    const ac = new AbortController();
    typewriteAbortRef.current = ac;
    // Vaciar campos animados al instante para que el tipeo se note
    for (const j of jobs) j.set('');
    await typewriteFields(jobs, { durationMs: 420, signal: ac.signal });
    if (typewriteAbortRef.current === ac) typewriteAbortRef.current = null;
  }, [cancelarTypewrite]);

  useEffect(() => () => {
    if (docFlashTimer.current) clearTimeout(docFlashTimer.current);
    cancelarTypewrite();
  }, [cancelarTypewrite]);

  const [ventaPerdidaItem, setVentaPerdidaItem] = useState(null);
  const [motivoPerdida, setMotivoPerdida] = useState("Falta de stock");
  const [detallePerdida, setDetallePerdida] = useState("");
  const [registrandoPerdida, setRegistrandoPerdida] = useState(false);
  const [alertaSistema, setAlertaSistema] = useState(null);

  const [showPagoModal, setShowPagoModal] = useState(false);

  const [procesandoVenta, setProcesandoVenta] = useState(false);
  // Guard real contra doble clic/doble envío en Cobrar — un useRef, no el state de
  // arriba, porque .current se comparte instantáneamente entre CUALQUIER invocación de
  // handleCobrar sin importar de qué render venga el closure (el state sí puede quedar
  // "viejo" si un segundo clic dispara el handler antes de que React re-renderice el
  // botón como disabled — el ref no depende del ciclo de render en absoluto).
  const procesandoVentaRef = useRef(false);
  /** Alerta de éxito diferida hasta cerrar ProcesandoVenta (evita tapar el checklist). */
  const alertaPostVentaRef = useRef(null);
  const [pasosVenta, setPasosVenta] = useState({
    registroVenta: false,
    inventario: false,
    sunat: false,
    recibo: false,
  });

  const mostrarAlerta = (mensaje, tipo = "info", accion = null, textoBoton = "Aceptar", extra = null) => {
    setAlertaSistema({ mensaje, tipo, accion, textoBoton, ...(extra || {}) });
  };

  const motivosOpciones = [
    "Falta de stock", "Precio elevado", "Producto no encontrado",
    "No tenemos la presentación", "Cliente desistió de la compra", "Otro",
  ];

  // ─── Actualizar contador de pendientes ──────────────────────
  const actualizarContadorPendientes = useCallback(async () => {
    const count = await contarPendientes();
    setVentasPendientes(count);
  }, []);

  // ─── Sincronizar automáticamente al recuperar internet ──────
  useEffect(() => {
    if (!isOnline) return;

    const ejecutarSync = async () => {
      const pendientes = await contarPendientes();
      if (pendientes === 0) {
        try { await sincronizarCola(); } catch { /* reintento SUNAT interno */ }
        return;
      }

      setSincronizando(true);
      try {
        const resultado = await sincronizarCola((progreso) => {
          console.log('[POS Sync]', progreso);
        });

        await actualizarContadorPendientes();

        if (resultado.sincronizadas > 0) {
          setNotifSync({
            tipo: 'success',
            mensaje: `${resultado.sincronizadas} venta${resultado.sincronizadas > 1 ? 's' : ''} sincronizada${resultado.sincronizadas > 1 ? 's' : ''} correctamente.`,
          });
          setTimeout(() => setNotifSync(null), 5000);
        }
        if (resultado.errores > 0) {
          setNotifSync({
            tipo: 'warning',
            mensaje: `${resultado.errores} venta${resultado.errores > 1 ? 's' : ''} no pudo sincronizarse. Intenta de nuevo.`,
          });
          setTimeout(() => setNotifSync(null), 8000);
        }
        if (resultado.conFaltante > 0) {
          setNotifSync({
            tipo: 'warning',
            mensaje: `${resultado.conFaltante} venta${resultado.conFaltante > 1 ? 's' : ''} se sincronizó sin stock suficiente — revisa el Kardex (movimientos marcados "REQUIERE REVISIÓN").`,
          });
          setTimeout(() => setNotifSync(null), 10000);
        }
      } catch (err) {
        console.error('[POS] Error al sincronizar:', err);
      } finally {
        setSincronizando(false);
      }
    };

    // Pequeño delay para asegurarse de que la conexión es estable
    const timer = setTimeout(ejecutarSync, 1500);
    // Mientras el POS esté online, reintentar comprobantes SUNAT cada minuto
    // (sin tope; el propio job ya espera 1.5 s entre uno y otro).
    const interval = facturacionElectronica
      ? setInterval(() => {
        reintentarComprobantesSunat().catch(() => {});
      }, 60_000)
      : null;
    return () => {
      clearTimeout(timer);
      if (interval) clearInterval(interval);
    };
  }, [isOnline, actualizarContadorPendientes]);

  // ─── Cargar contador de pendientes al montar ────────────────
  useEffect(() => {
    actualizarContadorPendientes();
  }, [actualizarContadorPendientes]);

  // Todas las claves se escriben con JSON.stringify — antes solo "pos_carrito" lo
  // hacía, el resto se guardaba crudo (sessionStorage.setItem coacciona a string, ej.
  // "72345678" queda guardado como texto 72345678 sin comillas), pero getSavedState()
  // relee con JSON.parse. "72345678" es JSON válido (un número), así que un DNI/RUC
  // (siempre puros dígitos) volvía como Number en vez de string al recargar la
  // página — de ahí el docInput.trim is not a function. Simétrico stringify/parse en
  // ambos lados evita este tipo de corrupción para cualquier campo, no solo docInput.
  useEffect(() => {
    sessionStorage.setItem("pos_carrito", JSON.stringify(carrito));
    sessionStorage.setItem("pos_tipo", JSON.stringify(tipoComprobante));
    sessionStorage.setItem("pos_metodo", JSON.stringify(metodoPago));
    sessionStorage.setItem("pos_monto", JSON.stringify(montoRecibido));
    sessionStorage.setItem("pos_doc", JSON.stringify(docInput));
    sessionStorage.setItem("pos_nombres", JSON.stringify(clienteNombres));
    sessionStorage.setItem("pos_apellidos", JSON.stringify(clienteApellidos));
    sessionStorage.setItem("pos_sexo", JSON.stringify(clienteSexo));
    sessionStorage.setItem("pos_razon", JSON.stringify(clienteRazonSocial));
    sessionStorage.setItem("pos_dir", JSON.stringify(clienteDireccion));
  }, [carrito, tipoComprobante, metodoPago, montoRecibido, docInput, clienteNombres, clienteApellidos, clienteSexo, clienteRazonSocial, clienteDireccion]);

  const limpiarPOS = () => {
    setCarrito([]); setMontoRecibido(0); setMetodoPago("Efectivo");
    setDocInput(""); setClienteNombres(""); setClienteApellidos("");
    setClienteSexo(""); setClienteRazonSocial(""); setClienteDireccion("");
    setSexoEsSugerido(false);
    setDocOk(false); setDocError(""); setModoManual(false); setVentaSinDoc(false);
    // Solo las claves propias de POS — sessionStorage.clear() borraba TODO el
    // sessionStorage del origen (afectaba, por ejemplo, el filtro guardado de
    // Conteo Físico en otra pantalla).
    ["pos_carrito", "pos_tipo", "pos_metodo", "pos_monto", "pos_doc", "pos_nombres", "pos_apellidos", "pos_sexo", "pos_razon", "pos_dir"]
      .forEach(key => sessionStorage.removeItem(key));
  };

  const handleTipoComprobante = (tipo, dirOverride) => {
    if (tipo !== tipoComprobante) {
      const fromIdx = TIPOS_COMPROBANTE.indexOf(tipoComprobante);
      const toIdx = TIPOS_COMPROBANTE.indexOf(tipo);
      const dir = dirOverride === "forward" || dirOverride === "back"
        ? dirOverride
        : (toIdx > fromIdx ? "forward" : "back");
      setTipoTabDir(dir);
    }
    setTipoComprobante(tipo); setDocInput(""); setDocError(""); setDocOk(false);
    setClienteNombres(""); setClienteApellidos(""); setClienteSexo("");
    setSexoEsSugerido(false);
    setClienteRazonSocial(""); setClienteDireccion(""); setModoManual(false); setVentaSinDoc(false);
  };

  const activarVentaSinDoc = () => {
    if (esFactura) return;
    clearTimeout(docTimer.current);
    setVentaSinDoc(true);
    setModoManual(true);
    setDocInput("");
    setDocOk(false);
    setDocLoading(false);
    setDocError("");
    setClienteNombres("");
    setClienteApellidos("");
    setClienteSexo("");
    setSexoEsSugerido(false);
    setTimeout(() => clienteNombresRef.current?.focus(), 40);
  };

  // ←/→ alternan cuál opción está resaltada (sin seleccionar); Enter confirma y salta
  // el foco al campo DNI/RUC — el sistema global de MainLayout.jsx ignora este control
  // (no es INPUT/SELECT), así que el salto se maneja acá con una ref directa.
  const handleTipoToggleKeyDown = (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      const idx = TIPOS_COMPROBANTE.indexOf(tipoEnfocado);
      const delta = e.key === 'ArrowRight' ? 1 : -1;
      const next = TIPOS_COMPROBANTE[(idx + delta + TIPOS_COMPROBANTE.length) % TIPOS_COMPROBANTE.length];
      setTipoEnfocado(next);
      // Dirección = tecla (no índice), para que el wrap Nota→Boleta con → siga yendo “adelante”.
      handleTipoComprobante(next, e.key === 'ArrowRight' ? 'forward' : 'back');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (tipoComprobante !== tipoEnfocado) handleTipoComprobante(tipoEnfocado);
      setTimeout(() => {
        docInputRef.current?.focus();
      }, 0);
    }
  };

  // Enter en DNI/RUC: si ya se autocompletó (RENIEC/SUNAT o clientes), no tiene sentido
  // pasar por Nombres/Apellidos/Sexo (ya están llenos) — se salta directo al buscador de
  // productos. Si no se autocompletó (modo manual, o la consulta todavía no resuelve por
  // el debounce de 600ms), se deja pasar el Enter sin intervenir: el sistema global de
  // MainLayout.jsx mueve el foco al siguiente campo del DOM (Nombres/Razón Social).
  const handleDocKeyDown = (e) => {
    if (e.key !== 'Enter') return;
    if (pasoCobro === 'cliente') {
      e.preventDefault();
      e.stopPropagation();
      if (docLoading) return;
      continuarDesdeCliente();
      return;
    }
    if (docOk && !modoManual) {
      e.preventDefault();
      e.stopPropagation();
      buscadorProductoRef.current?.focus();
    }
  };

  const handleDocInput = useCallback((valor) => {
    // Si el usuario empieza a escribir un documento, sale del modo "sin DNI".
    if (ventaSinDoc) setVentaSinDoc(false);

    if (modoManual) {
      setDocInput(valor); setDocError("");
      return;
    }
    // Si está offline, no intentar consultar la API
    if (!isOnline) {
      const soloNumeros = valor.replace(/\D/g, "");
      setDocInput(soloNumeros);
      return;
    }
    const soloNumeros = valor.replace(/\D/g, "");
    setDocInput(soloNumeros); setDocError(""); setDocOk(false);
    clearTimeout(docTimer.current);
    cancelarTypewrite();
    // Nota de Venta usa el mismo formulario/búsqueda que Boleta (ver punto 6 del pedido).
    const esDni = tipoComprobante === "Boleta" || tipoComprobante === "Nota de Venta";
    const longitudEsperada = esDni ? 8 : 11;
    if (soloNumeros.length !== longitudEsperada) return;
    setDocLoading(true);
    docTimer.current = setTimeout(async () => {
      try {
        // Buscar primero en la tabla local `clientes` — si ya compró antes, se
        // autocompleta desde ahí sin gastar la consulta externa a RENIEC/SUNAT.
        const { data: clienteLocal } = await supabase
          .from('clientes')
          .select('nombres, apellidos, nombre_razon_social, direccion, sexo')
          .eq('nro_doc', soloNumeros)
          .maybeSingle();

        if (clienteLocal) {
          if (esDni) {
            const resSexo = resolverSexoAutofill(clienteLocal.nombres || "", clienteLocal.sexo);
            setClienteSexo(resSexo.sexo);
            setSexoEsSugerido(resSexo.sugerido);
            setDocOk(true);
            dispararAutofillFlash();
            setDocLoading(false);
            await aplicarAutofillTypewrite([
              { set: setClienteNombres, text: clienteLocal.nombres || "" },
              { set: setClienteApellidos, text: clienteLocal.apellidos || "" },
            ]);
          } else {
            setDocOk(true);
            dispararAutofillFlash();
            setDocLoading(false);
            await aplicarAutofillTypewrite([
              { set: setClienteRazonSocial, text: clienteLocal.nombre_razon_social || "" },
              { set: setClienteDireccion, text: clienteLocal.direccion || "" },
            ]);
          }
          return;
        }

        const data = await consultarDocumento(esDni ? 'dni' : 'ruc', soloNumeros);
        if (esDni) {
          const nombresApi = data.nombres || "";
          const resSexo = resolverSexoAutofill(nombresApi, data.sexo);
          setClienteSexo(resSexo.sexo);
          setSexoEsSugerido(resSexo.sugerido);
          setDocOk(true);
          dispararAutofillFlash();
          setDocLoading(false);
          await aplicarAutofillTypewrite([
            { set: setClienteNombres, text: nombresApi },
            {
              set: setClienteApellidos,
              text: `${data.apellido_paterno || ""} ${data.apellido_materno || ""}`.trim(),
            },
          ]);
        } else {
          setDocOk(true);
          dispararAutofillFlash();
          setDocLoading(false);
          await aplicarAutofillTypewrite([
            { set: setClienteRazonSocial, text: data.nombre_o_razon_social || "" },
            { set: setClienteDireccion, text: data.direccion || "" },
          ]);
        }
      } catch {
        // Auto → modo manual: no obliga a buscar el botón "Ingresar manual".
        cancelarTypewrite();
        setModoManual(true);
        setDocOk(false);
        setDocAutofillFlash(0);
        setSexoEsSugerido(false);
        if (esDni) {
          setClienteNombres("");
          setClienteApellidos("");
          setClienteSexo("");
          setDocError("No se encontró este DNI, ingresa los datos manualmente");
        } else {
          setClienteRazonSocial("");
          setClienteDireccion("");
          setDocError("No se encontró este RUC, ingresa los datos manualmente");
        }
        setTimeout(() => {
          if (esDni) clienteNombresRef.current?.focus();
        }, 40);
      } finally { setDocLoading(false); }
    }, 600);
  }, [tipoComprobante, modoManual, isOnline, ventaSinDoc, dispararAutofillFlash, cancelarTypewrite, aplicarAutofillTypewrite]);

  const subtotalBruto = redondear2(carrito.reduce((sum, item) => sum + (Number(item.subtotal) || 0), 0));
  const total = subtotalBruto;
  const subtotalSinIgv = redondear2(total / 1.18);
  const igv = redondear2(total - subtotalSinIgv);
  const unidadesEnCarrito = carrito.reduce((s, i) => s + (Number(i.cantidad) || 0) * (Number(i.factor) || 1), 0);
  const productosDistintos = productosDistintosEnCarrito(carrito);
  const cartStatsSig = `${carrito.length}:${productosDistintos}:${unidadesEnCarrito}`;

  /** Destellos visuales al cambiar contador/total — no bloquean teclado. */
  const [cartStatsFlash, setCartStatsFlash] = useState(0);
  const [totalFlash, setTotalFlash] = useState(0);
  const prevCartStatsRef = useRef(null);
  const prevTotalRef = useRef(null);
  useEffect(() => {
    if (prevCartStatsRef.current === null) {
      prevCartStatsRef.current = cartStatsSig;
      return;
    }
    if (prevCartStatsRef.current === cartStatsSig) return;
    prevCartStatsRef.current = cartStatsSig;
    setCartStatsFlash((n) => n + 1);
  }, [cartStatsSig]);
  useEffect(() => {
    if (prevTotalRef.current === null) {
      prevTotalRef.current = total;
      return;
    }
    if (prevTotalRef.current === total) return;
    prevTotalRef.current = total;
    setTotalFlash((n) => n + 1);
  }, [total]);

  const vuelto = redondear2(
    metodoPago === "Mixto"
      ? Number(mixtoData.monto1) + Number(mixtoData.monto2) - total
      : (Number(montoRecibido) || 0) - total
  );

  // monto_recibido a persistir en ventas: Efectivo puro = montoRecibido; Mixto = solo la
  // parte asignada a Efectivo (si la hay); cualquier otro método (Yape/Tarjeta/etc.) = 0.
  const montoRecibidoParaGuardar = metodoPago === "Mixto"
    ? (mixtoData.metodo1 === "Efectivo" ? Number(mixtoData.monto1) || 0
      : mixtoData.metodo2 === "Efectivo" ? Number(mixtoData.monto2) || 0
      : 0)
    : (metodoPago === "Efectivo" ? Number(montoRecibido) || 0 : 0);

  useEffect(() => {
    function handleClickOutside(event) {
      if (searchWrapperRef.current && !searchWrapperRef.current.contains(event.target)) {
        setShowResultadosPanel(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);

    const fetchUnidades = async () => {
      try {
        if (!isOnline) {
          const locales = await obtenerUnidadesOffline();
          if (locales?.length) setUnidadesMedida(locales);
          return;
        }
        const { data, error } = await supabase.from("unidades_medida").select("*").eq("activo", 1).order("id_medida");
        if (error) throw error;
        if (data) setUnidadesMedida(data);
      } catch (err) { console.error("Error cargando unidades:", err.message); }
    };

    const inicializarCatalogo = async () => {
      try {
        await ensureOfflineReady();
        if (!isOnline) return;
        const tieneDatos = await catalogoTieneDatos();
        const stale = catalogoMarcadoStale();
        const id_sucursal = user?.id_sucursal || null;
        // Primera descarga o catálogo marcado obsoleto tras CRUD de productos
        if (!tieneDatos || stale) {
          console.log(stale ? '[POS] Re-descargando catálogo offline (obsoleto)...' : '[POS] Descargando catálogo offline...');
          await descargarCatalogo(id_sucursal, (progreso) => {
            setDescargaProgreso(progreso);
            if (progreso.fase === 'listo') {
              setTimeout(() => setDescargaProgreso(null), 3000);
            }
          });
        }
      } catch (err) {
        console.error('[POS] Error inicializando catálogo:', err);
        setDescargaProgreso(null);
      }
    };

    fetchUnidades();
    inicializarCatalogo();

    const unsubProductos = suscribirProductosChanged(() => {
      if (!isOnline) return;
      const id_sucursal = user?.id_sucursal || null;
      descargarCatalogo(id_sucursal, (progreso) => {
        setDescargaProgreso(progreso);
        if (progreso.fase === 'listo') {
          setTimeout(() => setDescargaProgreso(null), 2000);
        }
      }).catch((err) => console.error('[POS] Error refrescando catálogo:', err));
    });

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      unsubProductos();
    };
  }, [isOnline]);
  // Trae las formas de venta configuradas para un producto (Unidad, Caja, Blister, Xmayor1...)
  const cargarFormasVentaProducto = async (idProducto) => {
    if (!isOnline) {
      return obtenerFormasVentaOffline(idProducto);
    }
    const { data } = await supabase
      .from('producto_formas_venta')
      .select('*, unidades_medida(id_medida, nombre)')
      .eq('id_producto', idProducto)
      .eq('activo', true)
      .order('orden');
    return data && data.length > 0
      ? data
      : [{ id_medida: 1, factor: 1, precio_venta: 0, unidades_medida: { nombre: 'UNIDAD' } }]; // fallback
  };

  // Conserva el resaltado por id_producto si el ítem sigue en la lista (p. ej. re-búsqueda).
  useEffect(() => {
    if (resultados.length === 0) {
      setFilaResaltada(-1);
      return;
    }
    const id = idResaltadoPosRef.current;
    const idx = id != null ? resultados.findIndex((p) => p.id_producto === id) : -1;
    setFilaResaltada(idx >= 0 ? idx : 0);
  }, [resultados]);

  // Scroll automático para mantener visible la fila resaltada por teclado
  useEffect(() => {
    if (filaResaltada >= 0) {
      rowRefs.current[filaResaltada]?.scrollIntoView({ block: 'nearest' });
      const id = resultados[filaResaltada]?.id_producto;
      if (id != null) idResaltadoPosRef.current = id;
    }
  }, [filaResaltada, resultados]);

  useEffect(() => () => {
    if (busquedaDebounceRef.current) clearTimeout(busquedaDebounceRef.current);
  }, []);

  /** Ejecuta la búsqueda bajo demanda (Enter o debounce) y devuelve la lista. */
  const ejecutarBusqueda = async (termino) => {
    const t = String(termino || "").trim();
    if (t.length < 2) {
      setResultados([]);
      return [];
    }
    const seq = ++busquedaSeqRef.current;
    setBuscando(true);
    try {
      if (!isOnline) {
        const resultadosOffline = ordenarResultadosBusqueda(
          await buscarProductosOffline(termino),
          termino,
        );
        if (seq !== busquedaSeqRef.current) return resultadosOffline;
        setResultados(resultadosOffline);
        return resultadosOffline;
      }

      const terminoSeguro = terminoBusquedaSeguro(termino);
      const [resPorNombre, resPorCodigo] = await Promise.all([
        supabase
          .from("productos")
          .select(SELECT_POS_BUSQUEDA)
          .ilike("descripcion", `%${terminoSeguro}%`)
          .eq("activo", 1)
          .order("descripcion", { ascending: true })
          .limit(50),
        /^\d+$/.test(terminoSeguro)
          ? supabase
            .from("productos")
            .select(SELECT_POS_BUSQUEDA)
            .eq("codigo_barras", terminoSeguro)
            .eq("activo", 1)
            .limit(10)
          : Promise.resolve({ data: [] }),
      ]);
      if (resPorNombre.error) throw resPorNombre.error;
      if (resPorCodigo.error) throw resPorCodigo.error;

      const porCodigo = resPorCodigo.data || [];
      const idsCodigo = new Set(porCodigo.map((p) => p.id_producto));
      const combinados = [
        ...porCodigo,
        ...(resPorNombre.data || []).filter((p) => !idsCodigo.has(p.id_producto)),
      ];
      const data = ordenarResultadosBusqueda(combinados, termino).slice(0, 30);

      const ids = (data || []).map((p) => p.id_producto);
      const sucursalId = user.id_sucursal || user.sucursales?.id_sucursal || null;
      let lotesQuery = supabase
        .from("inventario_lotes")
        .select("id_producto, nro_lote, fecha_vencimiento, cantidad_actual, estado")
        .in("id_producto", ids)
        .eq("estado", "VIGENTE")
        .gt("cantidad_actual", 0);
      if (sucursalId) {
        lotesQuery = lotesQuery.or(`id_sucursal.eq.${sucursalId},id_sucursal.is.null`);
      }
      const { data: lotesData } = ids.length > 0 ? await lotesQuery : { data: [] };

      const lotesMap = {};
      (lotesData || []).forEach((l) => {
        if (!lotesMap[l.id_producto]) lotesMap[l.id_producto] = [];
        lotesMap[l.id_producto].push(l);
      });
      const processedData = (data || []).map((prod) => {
        const activeLots = (lotesMap[prod.id_producto] || [])
          .sort((a, b) => new Date(a.fecha_vencimiento) - new Date(b.fecha_vencimiento));
        const currentLot = activeLots[0] || null;
        const totalStock = activeLots.reduce((sum, lot) => sum + Number(lot.cantidad_actual), 0);
        let fechaVenceStr = "";
        if (currentLot?.fecha_vencimiento) {
          const [year, month] = currentLot.fecha_vencimiento.split("-");
          fechaVenceStr = `${month}/${year}`;
        }
        return { ...prod, inventario_lotes: activeLots, currentLot, fechaVenceStr, totalStock };
      });
      if (seq !== busquedaSeqRef.current) return processedData;
      setResultados(processedData);
      return processedData;
    } catch (error) {
      console.error("Error buscando:", error);
      if (seq === busquedaSeqRef.current) setResultados([]);
      return [];
    } finally {
      if (seq === busquedaSeqRef.current) setBuscando(false);
    }
  };

  const cancelarDebounceBusqueda = () => {
    if (busquedaDebounceRef.current) {
      clearTimeout(busquedaDebounceRef.current);
      busquedaDebounceRef.current = null;
    }
  };

  const abrirPanelResultados = (lista) => {
    setShowResultadosPanel(true);
    const id = idResaltadoPosRef.current;
    const idx = id != null ? (lista || []).findIndex((p) => p.id_producto === id) : -1;
    setFilaResaltada(idx >= 0 ? idx : (lista && lista.length > 0 ? 0 : -1));
  };

  const lanzarBusquedaEnVivo = (termino) => {
    const t = String(termino || "").trim();
    if (t.length < MIN_CHARS_BUSQUEDA_VIVA) {
      setShowResultadosPanel(false);
      setResultados([]);
      setFilaResaltada(-1);
      idResaltadoPosRef.current = null;
      return;
    }
    void (async () => {
      const lista = await ejecutarBusqueda(t);
      if (String(searchTermRef.current || "").trim() !== t) return;
      abrirPanelResultados(lista);
    })();
  };

  /** Actualiza el texto y dispara búsqueda en vivo desde 3 letras (con debounce). */
  const buscarProducto = (termino) => {
    searchTermRef.current = termino;
    setSearchTerm(termino);
    cancelarDebounceBusqueda();
    const t = String(termino || "").trim();
    if (t.length < MIN_CHARS_BUSQUEDA_VIVA) {
      busquedaSeqRef.current += 1;
      setShowResultadosPanel(false);
      setResultados([]);
      setFilaResaltada(-1);
      idResaltadoPosRef.current = null;
      return;
    }
    busquedaDebounceRef.current = setTimeout(() => {
      busquedaDebounceRef.current = null;
      lanzarBusquedaEnVivo(termino);
    }, DEBOUNCE_BUSQUEDA_MS);
  };

  const handleKeyDownBuscador = async (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setShowResultadosPanel(false);
      setResultados([]);
      return;
    }

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!showResultadosPanel || resultados.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "ArrowDown") {
        setFilaResaltada((prev) => Math.min(prev + 1, resultados.length - 1));
      } else {
        setFilaResaltada((prev) => Math.max(prev - 1, 0));
      }
      return;
    }

    if (e.key !== "Enter") return;

    e.preventDefault();
    e.stopPropagation();
    cancelarDebounceBusqueda();

    // Panel ya abierto: Enter confirma la fila resaltada
    if (showResultadosPanel) {
      if (filaResaltada >= 0 && filaResaltada < resultados.length) {
        await agregarAlCarrito(resultados[filaResaltada]);
      }
      return;
    }

    const term = searchTerm.trim();

    // Buscador vacío + carrito con productos → ir directo a cobrar
    if (term.length === 0) {
      if (carrito.length > 0) iniciarCobro();
      return;
    }

    if (term.length < 2) return;

    const lista = await ejecutarBusqueda(term);

    if (esCodigoBarras(term)) {
      const exactos = matchExactoBarcode(lista, term);
      if (exactos.length === 1) {
        await agregarAlCarrito(exactos[0]);
        return;
      }
      // Sin match exacto único: sección embebida con parciales
      abrirPanelResultados(lista);
      return;
    }

    // Texto manual → sección embebida de resultados
    abrirPanelResultados(lista);
  };

  const MAX_PRODUCTOS_CARRITO = 20;

  const cerrarBusquedaPos = () => {
    setShowResultadosPanel(false);
    setSearchTerm("");
    searchTermRef.current = "";
    setResultados([]);
    idResaltadoPosRef.current = null;
  };

  const enfocarBuscadorPos = () => {
    requestAnimationFrame(() => buscadorProductoRef.current?.focus());
  };

  const avisarStockBajoOffline = (producto) => {
    if (isOnline) return;
    const stockSnap = Number(producto.totalStock ?? 0);
    if (stockSnap > 0 && stockSnap <= STOCK_BAJO_OFFLINE) {
      mostrarAlerta(
        `Este producto tiene poco stock (${stockSnap} unidad${stockSnap === 1 ? '' : 'es'}) y no hay internet. Verifica con el otro cajero antes de vender.`,
        'warning',
      );
    }
  };

  const pushLineaCarrito = (producto, formasVenta, forma) => {
    const formaElegida = forma || formaVentaMenorFactor(formasVenta);
    if (!formaElegida) return;
    const precioCatalogo = Number(filaProductoPrecios(producto.producto_precios)?.precio_venta) || 0;
    const precio = Number(formaElegida.precio_venta) || precioCatalogo;
    const factor = Number(formaElegida.factor) || 1;
    avisarStockBajoOffline(producto);
    setCarrito((prev) => {
      const { carrito: next, error } = agregarLineaCarrito(prev, {
        id_producto: producto.id_producto,
        producto: producto.descripcion,
        formasVenta,
        id_medida: formaElegida.id_medida,
        factor,
        precio: Number(precio) || 0,
        modo_venta: formaElegida.unidades_medida?.nombre || 'UNIDAD',
        cantidad: 1,
        stock_total: producto.totalStock,
        stock_disponible: Math.floor(producto.totalStock / factor),
        lote: producto.currentLot?.nro_lote || "Sin Lote",
        laboratorio: nombreLaboratorioProducto(producto),
        subtotal: redondear2(precio),
        costo_unitario: costoCatalogoUnidadBase(producto),
      }, { maxProductosDistintos: MAX_PRODUCTOS_CARRITO });
      if (error) {
        mostrarAlerta(error, "warning");
        return prev;
      }
      return next;
    });
    cerrarBusquedaPos();
    enfocarBuscadorPos();
  };

  const agregarAlCarrito = async (producto) => {
    if (turnoAbierto === false) {
      avisarSinTurno();
      cerrarBusquedaPos();
      return;
    }

    if (producto.totalStock <= 0) {
      mostrarAlerta(
        `"${producto.descripcion}" no tiene stock disponible. ¿Deseas registrar una venta perdida?`,
        "warning",
        () => abrirModalVentaPerdida({ id_producto: producto.id_producto, producto: producto.descripcion, cantidad: 1 })
      );
      cerrarBusquedaPos();
      return;
    }

    const formasVenta = await cargarFormasVentaProducto(producto.id_producto);
    if (debePreguntarFormaVenta(carrito, producto.id_producto, formasVenta)) {
      cerrarBusquedaPos();
      setSelectorForma({ producto, formas: formasVenta });
      return;
    }

    pushLineaCarrito(producto, formasVenta, formaVentaMenorFactor(formasVenta));
  };

  const cambiarCantidad = (clave, nuevaCantidad) => {
    setCarrito((prev) => {
      const { carrito: next, error } = cambiarCantidadLinea(prev, clave, nuevaCantidad, { redondear2 });
      if (error) mostrarAlerta(error, "warning");
      return next;
    });
  };

  const [qtyEditMap, setQtyEditMap] = useState({});
  const handleQtyFocus = (clave, cantidad) => setQtyEditMap(prev => ({ ...prev, [clave]: String(cantidad) }));
  const handleQtyChange = (clave, valor) => setQtyEditMap(prev => ({ ...prev, [clave]: valor }));
  const handleQtyCommit = (clave) => {
    const raw = qtyEditMap[clave];
    const qty = parseInt(raw, 10);
    if (!isNaN(qty) && qty >= 1) cambiarCantidad(clave, qty);
    setQtyEditMap(prev => { const n = { ...prev }; delete n[clave]; return n; });
  };

  const cambiarModoVenta = (claveActual, idMedidaElegida) => {
    setCarrito((prev) => {
      const item = prev.find((i) => claveLineaCarrito(i) === claveActual);
      const forma = item?.formasVenta?.find((f) => Number(f.id_medida) === Number(idMedidaElegida));
      const { carrito: next, error } = cambiarModoVentaLinea(prev, claveActual, forma, { redondear2 });
      if (error) mostrarAlerta(error, 'warning');
      return next;
    });
  };

  // Suma de los 2 métodos del mixto (redondeada a 2 decimales).
  const sumaMixtoActual = redondear2(Number(mixtoData.monto1 || 0) + Number(mixtoData.monto2 || 0));
  const totalMixtoExacto = redondear2(total);
  const diffMixto = redondear2(sumaMixtoActual - totalMixtoExacto);
  const mixtoCuadraExacto = Math.abs(diffMixto) < 0.005;

  const mensajeErrorMixto = () => {
    if (sumaMixtoActual <= 0) return "Ingresa los montos del pago mixto.";
    if (mixtoData.metodo1 === mixtoData.metodo2) {
      return "Elige dos métodos de pago distintos.";
    }
    if (mixtoCuadraExacto) return null;
    if (diffMixto < 0) {
      return `Faltan S/ ${Math.abs(diffMixto).toFixed(2)} por cubrir. La suma (S/ ${sumaMixtoActual.toFixed(2)}) no alcanza el total (S/ ${totalMixtoExacto.toFixed(2)}).`;
    }
    return `La suma de los pagos (S/ ${sumaMixtoActual.toFixed(2)}) no coincide con el total a cobrar (S/ ${totalMixtoExacto.toFixed(2)}). Ajusta los montos (sobran S/ ${diffMixto.toFixed(2)}).`;
  };

  const confirmarPagoMixto = () => {
    const err = mensajeErrorMixto();
    if (err) { mostrarAlerta(err, "error"); return; }
    cobroTrasMixtoRef.current = true;
    setMetodoPago("Mixto");
    setShowPagoMixto(false);
    setPasoCobro(null);
  };

  // Tras configurar Mixto, metodoPago ya es Mixto → dispara handleCobrar (sin tocar su lógica).
  useEffect(() => {
    if (!cobroTrasMixtoRef.current || metodoPago !== "Mixto" || showPagoMixto) return;
    cobroTrasMixtoRef.current = false;
    handleCobrar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metodoPago, showPagoMixto]);

  const iniciarCobro = () => {
    if (carrito.length === 0) return mostrarAlerta("El carrito está vacío.", "error");
    setCobroAnimDir("forward");
    setPasoCobro("cliente");
    setTimeout(() => docInputRef.current?.focus(), 50);
  };

  const validarDatosCliente = () => {
    // Factura siempre exige RUC. Boleta/Nota: DNI obligatorio salvo "Continuar sin DNI".
    if (esFactura) {
      if (!docInput || docInput.trim() === "") {
        mostrarAlerta("Ingresa el RUC del cliente.", "error");
        return false;
      }
      if (!clienteRazonSocial || clienteRazonSocial.trim() === "") {
        mostrarAlerta("Ingresa la razón social del cliente.", "error");
        return false;
      }
      return true;
    }

    if (!ventaSinDoc && (!docInput || docInput.trim() === "")) {
      mostrarAlerta("Ingresa el DNI del cliente, o elige Continuar sin DNI.", "error");
      return false;
    }
    if (!clienteNombres || clienteNombres.trim() === "") {
      mostrarAlerta("Ingresa el nombre del cliente.", "error");
      return false;
    }
    // Con DNI: apellidos siguen siendo obligatorios. Sin DNI: basta el nombre.
    if (!ventaSinDoc && (!clienteApellidos || clienteApellidos.trim() === "")) {
      mostrarAlerta("Ingresa los apellidos del cliente.", "error");
      return false;
    }
    return true;
  };

  const continuarDesdeCliente = () => {
    if (!validarDatosCliente()) return;
    const idx = METODOS_PAGO.indexOf(metodoPago);
    setPagoEnfocado(idx >= 0 && metodoPago !== "Mixto" ? idx : 0);
    setCobroAnimDir("forward");
    setPasoCobro("pago");
    setTimeout(() => pagoGridRef.current?.focus(), 50);
  };

  const volverAClienteDesdePago = () => {
    setCobroAnimDir("back");
    setPasoCobro("cliente");
    setTimeout(() => docInputRef.current?.focus(), 50);
  };

  // Chips de Sexo (mismo patrón que Boleta/Factura y métodos de pago): ←/→/↑/↓
  // ciclan Masculino↔Femenino; Enter (con foco en el grupo) continúa al pago.
  const handleSexoChipsKeyDown = (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      const delta = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1;
      const idx = OPCIONES_SEXO.findIndex((o) => o.value === clienteSexo);
      const base = idx < 0 ? (delta > 0 ? -1 : 0) : idx;
      const next = OPCIONES_SEXO[(base + delta + OPCIONES_SEXO.length) % OPCIONES_SEXO.length];
      setClienteSexo(next.value);
      setSexoEsSugerido(false);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (pasoCobro === 'cliente') continuarDesdeCliente();
      else buscadorProductoRef.current?.focus();
    }
  };

  const handleKeyDownPagoGrid = (e) => {
    const cols = 2;
      if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      volverAClienteDesdePago();
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      e.stopPropagation();
      setPagoEnfocado((i) => (i % cols === cols - 1 ? i : Math.min(i + 1, METODOS_PAGO.length - 1)));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      e.stopPropagation();
      setPagoEnfocado((i) => (i % cols === 0 ? i : i - 1));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      setPagoEnfocado((i) => Math.min(i + cols, METODOS_PAGO.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      setPagoEnfocado((i) => Math.max(i - cols, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      confirmarMetodoPagoPaso(METODOS_PAGO[pagoEnfocado]);
    }
  };

  const confirmarMetodoPagoPaso = (metodo) => {
    setMetodoPago(metodo);
    if (metodo === "Mixto") {
      // Cerrar el paso "método de pago" para que su grid (con foco + Enter → Efectivo)
      // NO siga montado detrás del modal Mixto. Ese era el bug del Enter filtrado.
      setPasoCobro(null);
      setShowPagoMixto(true);
      return;
    }
    // Yape/Tarjeta: monto = total (validación de handleCobrar). Efectivo: vacío para que el cajero escriba.
    if (metodo !== "Efectivo") {
      setMontoRecibido(total);
    } else {
      setMontoRecibido("");
    }
    setPasoCobro(null);
    setShowPagoModal(true);
  };

  const cerrarPagoMixto = () => {
    setShowPagoMixto(false);
    setPasoCobro("pago");
    setTimeout(() => pagoGridRef.current?.focus(), 50);
  };

  // Al abrir Mixto: foco DENTRO del modal (si queda en el grid de atrás, Enter dispara Efectivo).
  useEffect(() => {
    if (!showPagoMixto) return undefined;
    const t = setTimeout(() => {
      mixtoMonto1Ref.current?.focus();
      mixtoMonto1Ref.current?.select?.();
    }, 40);
    return () => clearTimeout(t);
  }, [showPagoMixto]);

  // Efectivo: al abrir el modal de confirmación, foco inmediato en "Monto recibido".
  // Yape/Tarjeta: foco en "Confirmar pago" para que Enter cobre de inmediato.
  useEffect(() => {
    if (!showPagoModal) return;
    const t = setTimeout(() => {
      if (metodoPago === "Efectivo") {
        montoRecibidoRef.current?.focus();
        montoRecibidoRef.current?.select?.();
      } else {
        confirmarPagoBtnRef.current?.focus();
      }
    }, 40);
    return () => clearTimeout(t);
  }, [showPagoModal, metodoPago]);

  // ── Atrapar teclado por modal (no depender solo de MainLayout) ──
  // En bubble del overlay: stopPropagation corta el Enter antes de que llegue al
  // listener global de MainLayout. Enter en inputs cicla dentro del overlay; si no
  // hay siguiente campo, dispara el botón primario (data-enter-primary / último botón).
  const atraparTecladoOverlay = (e) => {
    if (!["Enter", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Escape"].includes(e.key)) return;
    e.stopPropagation();
    if (e.key !== "Enter") return;
    if (e.target?.tagName === "BUTTON" || e.target?.tagName === "TEXTAREA") return;
    // INPUT/SELECT: avanzar al siguiente. Los grupos con data-enter-target (Sexo,
    // tipo de comprobante, grilla de pago) manejan Enter en su propio onKeyDown.
    if (e.target?.tagName !== "INPUT" && e.target?.tagName !== "SELECT") return;
    e.preventDefault();
    const root = e.currentTarget;
    const focusables = Array.from(
      root.querySelectorAll(
        'input:not([disabled]):not([type="hidden"]), select:not([disabled]), button:not([disabled]):not([data-enter-skip="true"]), [data-enter-target="true"]'
      )
    ).filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    const idx = focusables.indexOf(e.target);
    const siguientes = idx >= 0 ? focusables.slice(idx + 1) : [];
    const nextField = siguientes.find(
      (el) => el.tagName === "INPUT" || el.tagName === "SELECT"
    );
    if (nextField) {
      nextField.focus();
      if (typeof nextField.select === "function") nextField.select();
      return;
    }
    const primary =
      root.querySelector('[data-enter-primary="true"]:not([disabled])')
      || siguientes.find((el) => el.tagName === "BUTTON")
      || root.querySelector('button:not([disabled]):not([data-enter-skip="true"])');
    if (primary) primary.click();
  };

  /** Imprime el ticket en cuanto la venta se confirma (sin modal de vista previa). */
  const imprimirTicketTrasCobro = useCallback((dataRecibo) => {
    const payload = buildPrintPayloadFromRecibo(dataRecibo);
    if (!payload) return;
    void printTicketVenta(payload).catch((err) => {
      console.error('[POS] Impresión automática falló:', err);
    });
  }, []);

  // Red de seguridad: si hay modal POS abierto y el foco está FUERA de cualquier
  // data-keyboard-trap, bloquear Enter/flechas en capture (antes que MainLayout).
  const hayModalPosAbierto = !!(
    showPagoMixto || showPagoModal || pasoCobro || alertaSistema || ventaPerdidaItem
  );
  useEffect(() => {
    if (!hayModalPosAbierto) return undefined;
    const onKeyDownCapture = (e) => {
      if (!["Enter", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest("[data-keyboard-trap]")) return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("keydown", onKeyDownCapture, true);
    return () => document.removeEventListener("keydown", onKeyDownCapture, true);
  }, [hayModalPosAbierto]);

  const abrirModalVentaPerdida = (item) => {
    setVentaPerdidaItem(item); setMotivoPerdida("Falta de stock"); setDetallePerdida("");
  };

  const procesarVentaPerdida = async (e) => {
    e.preventDefault();
    if (!ventaPerdidaItem) return;
    setRegistrandoPerdida(true);
    try {
      if (isOnline) {
        await supabase.from("ventas_perdidas").insert({
          id_sucursal: user.id_sucursal,
          id_usuario: user.id_usuario,
          nombre_producto: ventaPerdidaItem.producto,
          cantidad_solicitada: ventaPerdidaItem.cantidad,
          motivo: motivoPerdida,
          detalle: detallePerdida,
        });
      }
      // Si está offline, la venta perdida se ignora por ahora (no crítico)
      setCarrito((c) => quitarLineaCarrito(c, claveLineaCarrito(ventaPerdidaItem)));
      setVentaPerdidaItem(null);
      mostrarAlerta("Venta perdida registrada.", "success");
    } catch {
      mostrarAlerta("Hubo un error al registrar la venta perdida.", "error");
    } finally { setRegistrandoPerdida(false); }
  };

  // ===================================================================
  // 💳 HANDLE COBRAR — con soporte offline
  // ===================================================================
  const handleCobrar = async () => {
    if (carrito.length === 0) return mostrarAlerta("El carrito está vacío.", "error");

    // Validación de datos del cliente (misma regla que validarDatosCliente / Continuar)
    if (!validarDatosCliente()) return;

    if (metodoPago !== "Mixto" && montoRecibido < total)
      return mostrarAlerta("El monto recibido es menor al total a cobrar.", "error");

    if (metodoPago === "Mixto") {
      // Defensa en profundidad: misma regla de igualdad exacta que confirmarPagoMixto
      // (antes solo bloqueaba si faltaba dinero; si sobraba —ej. 50 vs 11.50— dejaba pasar).
      const errMixto = (() => {
        const suma = redondear2(Number(mixtoData.monto1 || 0) + Number(mixtoData.monto2 || 0));
        const tot = redondear2(total);
        const diff = redondear2(suma - tot);
        if (suma <= 0) return "Configura los montos del pago mixto.";
        if (mixtoData.metodo1 === mixtoData.metodo2) return "Elige dos métodos de pago distintos.";
        if (Math.abs(diff) < 0.005) return null;
        if (diff < 0) {
          return `Faltan S/ ${Math.abs(diff).toFixed(2)} por cubrir. La suma (S/ ${suma.toFixed(2)}) no alcanza el total (S/ ${tot.toFixed(2)}).`;
        }
        return `La suma de los pagos (S/ ${suma.toFixed(2)}) no coincide con el total a cobrar (S/ ${tot.toFixed(2)}). Ajusta los montos.`;
      })();
      if (errMixto) return mostrarAlerta(errMixto, "error");
    }

    if (metodoPago !== "Mixto" && !showPagoModal) {
      setShowPagoModal(true);
      return;
    }

    {
      const vistos = new Set();
      for (const item of carrito) {
        const id = Number(item.id_producto);
        if (vistos.has(id)) continue;
        vistos.add(id);
        const necesario = unidadesBaseProducto(carrito, id);
        const stockTotal = Number(item.stock_total || 0);
        if (necesario > stockTotal) {
          mostrarAlerta(`No hay suficiente stock de "${item.producto}" (se piden ${necesario} uds. base).`, "error");
          return;
        }
      }
    }

    // A partir de acá ya pasamos todas las validaciones (todas síncronas, sin ningún
    // await previo) y estamos por comprometernos de verdad — este es el punto exacto
    // donde un doble clic/doble tap podía colarse antes de que React re-renderice el
    // botón como disabled. El guard se lee y se marca en la misma línea, antes de
    // cualquier await de acá en adelante (online u offline).
    if (procesandoVentaRef.current) return;
    procesandoVentaRef.current = true;

    // ─────────────────────────────────────────────────────────
    // 📴 MODO OFFLINE — guardar en IndexedDB y mostrar recibo
    // ─────────────────────────────────────────────────────────
    if (!isOnline) {
      try {
        // Turno: misma fuente que online (Dashboard/POS escriben luxfarma_turnoActivo).
        // Sin id_turno NO se encola — evita ventas huérfanas de turno.
        let turnoGuardado = null;
        try {
          const raw = localStorage.getItem('luxfarma_turnoActivo');
          turnoGuardado = raw ? JSON.parse(raw) : null;
        } catch { turnoGuardado = null; }
        if (!turnoGuardado?.id_turno) {
          procesandoVentaRef.current = false;
          mostrarAlerta(
            'Abre tu turno antes de vender.',
            'warning',
            () => navigate('/dashboard'),
            'Abrir turno'
          );
          return;
        }
        const turnoLocal = {
          id_turno: turnoGuardado.id_turno,
          id_sucursal: turnoGuardado.id_sucursal || user.id_sucursal || null,
        };
        const idSucursalOffline = turnoLocal.id_sucursal || user.id_sucursal || null;

        // Stock virtual en UNIDADES BASE: stock_total cacheado menos lo ya reservado
        // (cantidad × factor) en ventas offline pendientes de ESTE dispositivo.
        // No usar stock_disponible (unidades de venta) contra necesario (unidades base).
        const pendientesCola = await obtenerVentasPendientes();
        const offlineStock = validarStockOfflineCarrito(carrito, pendientesCola);
        if (!offlineStock.ok) {
          procesandoVentaRef.current = false;
          mostrarAlerta(mensajeStockOfflineInsuficiente(offlineStock.item, offlineStock.chequeo), "error");
          return;
        }

        setShowPagoModal(false);
        setShowPagoMixto(false);
        setPasoCobro(null);
        setProcesandoVenta(true);
        setPasosVenta({ registroVenta: false, inventario: false, sunat: false, recibo: false });
        alertaPostVentaRef.current = null;

        const serie = esFactura ? "F001" : esNotaVenta ? "NV01" : "B001";
        // Correlativo temporal offline (se reemplazará en la sync)
        const correlativoLocal = Date.now();
        // UUID estable: si el sync se corta a medias, el reintento no duplica la venta.
        const uuidVenta = crypto.randomUUID();

        const esDniVentaOffline = esBoleta || esNotaVenta;
        const nombreRazonSocialOffline = esDniVentaOffline
          ? `${clienteNombres || ''} ${clienteApellidos || ''}`.trim()
          : (clienteRazonSocial || '').trim();
        const tipoDocOffline = (ventaSinDoc && !docInput)
          ? 'SIN_DOC'
          : (esFactura ? 'RUC' : 'DNI');

        const carritoOffline = await estamparCostoSnapshotCarrito(carrito, { isOnline: false });

        await guardarVentaOffline({
          turno: turnoLocal,
          tipoComprobante,
          serie,
          uuid_venta: uuidVenta,
          correlativo_local: correlativoLocal,
          total,
          vuelto: vuelto > 0 && metodoPago !== "Mixto" ? vuelto : 0,
          monto_recibido: montoRecibidoParaGuardar,
          carrito: carritoOffline,
          metodoPago,
          mixtoData,
          id_sucursal: idSucursalOffline,
          id_usuario: user.id_usuario,
          cliente: {
            docInput: docInput || '',
            ventaSinDoc: !!ventaSinDoc,
            nombres: clienteNombres || '',
            apellidos: clienteApellidos || '',
            sexo: clienteSexo || '',
            razonSocial: clienteRazonSocial || '',
            direccion: clienteDireccion || '',
            nombreRazonSocial: nombreRazonSocialOffline,
            tipoDoc: tipoDocOffline,
          },
        });

        await actualizarContadorPendientes();
        setPasosVenta(prev => ({ ...prev, registroVenta: true, inventario: true, sunat: true }));

        // Mostrar recibo offline (sin número de comprobante real)
        const ventaFicticiaOffline = {
          id_venta: null,
          serie,
          correlativo: correlativoLocal,
          tipo_comprobante: tipoComprobante.toUpperCase(),
          es_offline: true,
        };

        const dataReciboOffline = {
          venta: ventaFicticiaOffline,
          carrito: [...carrito],
          total,
          descuento: 0,
          metodoPago,
          mixtoData,
          user,
          montoRecibido,
          vuelto,
          clienteNombre: nombreRazonSocialOffline || 'CLIENTE GENERAL',
          clienteDoc: (ventaSinDoc || !docInput) ? '' : docInput,
          clienteDireccion: clienteDireccion || '',
          puntosAcum: 0,
        };
        imprimirTicketTrasCobro(dataReciboOffline);
        setPasosVenta(prev => ({ ...prev, recibo: true }));
        limpiarPOS();
        setResumenTurno((prev) => ({
          total: redondear2((Number(prev.total) || 0) + Number(total)),
          ops: (Number(prev.ops) || 0) + 1,
        }));
        // Alerta después de que ProcesandoVenta cierre (onCompleto) — no tapar el checklist.
        alertaPostVentaRef.current = {
          mensaje: 'Venta guardada offline. Se sincronizará automáticamente cuando haya conexión.',
          tipo: 'info',
        };
      } catch (err) {
        console.error('[POS Offline] Error al guardar:', err);
        alertaPostVentaRef.current = null;
        mostrarAlerta('Error al guardar la venta offline: ' + err.message, 'error');
        // Antes esto no reseteaba nada: pasosVenta se quedaba a medias, por lo que
        // ProcesandoVenta (que solo llama a onCompleto cuando TODOS los pasos quedan en
        // true) nunca disparaba su reset — procesandoVenta se quedaba en true para
        // siempre y el botón de Cobrar habría quedado bloqueado sin poder reintentar.
        setProcesandoVenta(false);
        procesandoVentaRef.current = false;
      }
      return;
    }

    // ─────────────────────────────────────────────────────────
    // ✅ MODO ONLINE — flujo normal con Supabase
    // ─────────────────────────────────────────────────────────
    try {
      setShowPagoModal(false);
      setShowPagoMixto(false);
      setPasoCobro(null);
      setProcesandoVenta(true);
      setPasosVenta({ registroVenta: false, inventario: false, sunat: false, recibo: false });
      alertaPostVentaRef.current = null;

      const { data: turno } = await supabase
        .from("caja_turnos").select("id_turno, id_sucursal")
        .eq("id_usuario_vendedor", user.id_usuario).eq("estado", "ABIERTO").maybeSingle();

      if (!turno) {
        throw new Error("No tienes un turno abierto.");
      }

      localStorage.setItem('luxfarma_turnoActivo', JSON.stringify(turno));

      const idSucursalVenta = turno?.id_sucursal || user.id_sucursal || user.sucursales?.id_sucursal;
      const idTurnoVenta = turno?.id_turno || null;

      if (!idSucursalVenta) {
        throw new Error("No se pudo determinar la sucursal para registrar la venta.");
      }

      // Revalidación de stock real justo antes de cobrar — suma unidades base de
      // todas las líneas del mismo producto (caja + unidad). El stock del carrito
      // es el snapshot de cuando se buscó y puede quedar desactualizado.
      const idsStock = [...new Set(carrito.map((i) => Number(i.id_producto)))];
      for (const idProducto of idsStock) {
        const muestra = carrito.find((i) => Number(i.id_producto) === idProducto);
        const disponibleReal = await obtenerStockDisponible(idProducto, idSucursalVenta);
        const necesario = unidadesBaseProducto(carrito, idProducto);
        if (necesario > disponibleReal) {
          throw new Error(`Stock insuficiente de "${muestra?.producto}" (disponible: ${disponibleReal}, requerido: ${necesario}).`);
        }
      }

      const serie = esFactura ? "F001" : esNotaVenta ? "NV01" : "B001";
      const esDniVenta = esBoleta || esNotaVenta;
      const nombreRazonSocial = esDniVenta
        ? `${clienteNombres || ''} ${clienteApellidos || ''}`.trim()
        : (clienteRazonSocial || '');

      const carritoOnline = await estamparCostoSnapshotCarrito(carrito, { isOnline: true });

      // Misma RPC que el sync offline: correlativo con lock + stock atómico.
      const rowVenta = await registrarVentaEnServidor(armarPayloadSincronizacion({
        tipoComprobante,
        serie,
        total,
        vuelto: vuelto > 0 && metodoPago !== "Mixto" ? vuelto : 0,
        monto_recibido: montoRecibidoParaGuardar,
        carrito: carritoOnline,
        metodoPago,
        mixtoData,
        id_sucursal: idSucursalVenta,
        id_usuario: user.id_usuario,
        cliente: {
          docInput: docInput || '',
          ventaSinDoc: !!ventaSinDoc,
          nombres: clienteNombres || '',
          apellidos: clienteApellidos || '',
          sexo: clienteSexo || '',
          razonSocial: clienteRazonSocial || '',
          direccion: clienteDireccion || '',
          nombreRazonSocial,
          tipoDoc: ventaSinDoc && !docInput ? 'SIN_DOC' : (esFactura ? 'RUC' : 'DNI'),
        },
      }, { idTurno: idTurnoVenta, exigirUuid: false }));

      const venta = {
        id_venta: rowVenta.id_venta,
        serie: rowVenta.serie,
        correlativo: rowVenta.correlativo,
        tipo_comprobante: tipoComprobante.toUpperCase(),
        id_cliente: rowVenta.id_cliente || null,
      };
      setPasosVenta(prev => ({ ...prev, registroVenta: true, inventario: true }));
      await new Promise(r => setTimeout(r, 200));

      // ── NUBEFACT: Boleta/Factura. La venta ya está guardada; un fallo SUNAT no la revierte.
      // El ticket usa B003/F003 si Nubefact ya respondió; si no (offline / error), B001/F001.
      let avisoSunat = null;
      let enlacePdfSunat = null;
      let emisionSunat = null;
      if (facturacionElectronica && esComprobanteSunat(tipoComprobante)) {
        try {
          const clienteSunat = {
            dni: (tipoComprobante === 'Boleta' && !ventaSinDoc) ? docInput : null,
            ruc: tipoComprobante === 'Factura' ? docInput : null,
            nombres: clienteNombres,
            apellidos: clienteApellidos,
            razon_social: clienteRazonSocial,
            direccion: clienteDireccion,
            nro_doc: (ventaSinDoc || !docInput) ? '' : docInput,
          };
          const resSunat = await procesarEmisionSunat({
            id_venta: venta.id_venta,
            id_sucursal: idSucursalVenta,
            tipoComprobante,
            carrito,
            cliente: clienteSunat,
            total,
            metodoPago,
            mixtoData,
          });
          emisionSunat = resSunat;
          if (resSunat.ok) {
            enlacePdfSunat = resSunat.enlace_pdf || null;
            try {
              await supabase.from('comprobantes_electronicos').insert({
                id_venta: venta.id_venta,
                serie: resSunat.serie || venta.serie,
                correlativo: resSunat.numero || venta.correlativo,
                tipo_comprobante: tipoComprobante.toUpperCase(),
                estado_sunat: 'ENVIADO',
                pdf_url: enlacePdfSunat,
                xml_url: resSunat.registro?.enlace_xml || null,
                hash_cdr: resSunat.codigo_hash || resSunat.registro?.key_nubefact || null,
                descripcion_sunat: null,
                ultimo_error: null,
                enviado_at: new Date().toISOString(),
                intentos: 1,
                total_gravada: Number((total / 1.18).toFixed(2)),
                total_igv: Number((total - total / 1.18).toFixed(2)),
                total,
                cliente_nombre: nombreRazonSocial || 'CLIENTE GENERAL',
                cliente_numero_doc: (ventaSinDoc || !docInput) ? '00000000' : docInput,
              });
            } catch (errElec) {
              console.warn('[POS] comprobantes_electronicos:', errElec);
            }
          } else {
            avisoSunat = resSunat.aviso || 'Comprobante pendiente de enviar a SUNAT';
          }
        } catch (errNubefact) {
          console.error('[Nubefact] Error:', errNubefact);
          avisoSunat = 'Comprobante pendiente de enviar a SUNAT';
        }
      }
      setPasosVenta(prev => ({ ...prev, sunat: true }));

      const carritoSnap = [...carrito];
      const dataRecibo = {
        venta,
        carrito: carritoSnap,
        total,
        descuento: 0,
        metodoPago,
        mixtoData,
        user,
        montoRecibido,
        vuelto,
        clienteNombre: nombreRazonSocial || 'CLIENTE GENERAL',
        clienteDoc: (ventaSinDoc || !docInput) ? '' : docInput,
        clienteDireccion: clienteDireccion || '',
        puntosAcum: 0,
        sunat: (facturacionElectronica && esComprobanteSunat(tipoComprobante) && emisionSunat?.ok)
          ? {
              serie: emisionSunat.serie,
              numero: emisionSunat.numero,
              cadenaQr: emisionSunat.cadena_qr,
              codigoHash: emisionSunat.codigo_hash,
              enlace: emisionSunat.enlace || emisionSunat.enlace_pdf,
              barcode: emisionSunat.codigo_barras,
            }
          : null,
      };
      imprimirTicketTrasCobro(dataRecibo);
      setPasosVenta(prev => ({ ...prev, recibo: true }));
      limpiarPOS();
      if (idTurnoPosRef.current && navigator.onLine) {
        cargarVentasDelTurno(supabase, idTurnoPosRef.current)
          .then((r) => setResumenTurno({ total: r.totalVendido, ops: r.operaciones }))
          .catch(() => {});
      }
      const nroVisible = etiquetaComprobanteVisible(venta, {
        sunatSerie: emisionSunat?.serie,
        sunatNumero: emisionSunat?.numero,
      });
      alertaPostVentaRef.current = {
        mensaje: avisoSunat
          ? `¡Venta registrada! ${nroVisible}\n${avisoSunat}`
          : `¡Venta registrada! ${nroVisible}`,
        tipo: avisoSunat ? 'warning' : 'success',
        enlace: enlacePdfSunat,
        enlaceLabel: enlacePdfSunat ? 'Ver PDF SUNAT' : null,
      };
    } catch (error) {
      console.error("Error procesando la venta:", error);
      // Antes esto no reseteaba procesandoVenta: el modal "Procesando venta" (que vive
      // ARRIBA de esta alerta, z-index 99999 contra 9999) se quedaba girando para
      // siempre tapando el aviso, aunque el error ya se hubiera capturado bien acá —
      // por eso se sentía "colgado" en vez de fallar rápido.
      alertaPostVentaRef.current = null;
      setProcesandoVenta(false);
      procesandoVentaRef.current = false;
      if (error.message === "No tienes un turno abierto.") {
        setTurnoAbierto(false);
        avisarSinTurno();
      } else {
        mostrarAlerta("Error al cobrar: " + error.message, "error");
      }
    }
  };

  const DocStatusIcon = () => {
    if (docLoading) return <span className="doc-spinner" />;
    if (docOk) {
      return (
        <span key={docAutofillFlash || "ok"} className={`doc-check ${docAutofillFlash ? "is-pop" : ""}`}>
          <UiIcon name="CheckCircle2" size={17} />
        </span>
      );
    }
    if (docError) return <span className="doc-x">✗</span>;
    return null;
  };

  const campoAutofillCls = (lleno) => {
    const base = docOk && !modoManual && lleno;
    if (!base) return "";
    return `is-autofilled${docAutofillFlash ? " is-just-filled" : ""}`;
  };

  const docLenEsperado = esFactura ? 11 : 8;
  const docLenActual = String(docInput || "").replace(/\D/g, "").length;
  const docLenCompleto = docLenActual >= docLenEsperado;
  const nombreCajero = `${user?.nombres || ''} ${user?.apellidos || ''}`.trim() || 'Cajero';
  const nombreSucursal = user?.sucursales?.nombre_comercial || '—';
  const serieVista = esFactura ? 'F001' : esNotaVenta ? 'NV01' : 'B001';

  return (
    <div className="pos-container">

      {/* ── CSS para animación del badge ── */}
      <style>{`
        @keyframes pulse-dot {
          0%   { box-shadow: 0 0 0 0 rgba(var(--pulse-color, 16,185,129), 0.4); }
          70%  { box-shadow: 0 0 0 6px rgba(var(--pulse-color, 16,185,129), 0); }
          100% { box-shadow: 0 0 0 0 rgba(var(--pulse-color, 16,185,129), 0); }
        }
        .sync-toast {
          position: fixed;
          bottom: 24px;
          right: 24px;
          z-index: 99999;
          background: var(--lf-text);
          color: white;
          padding: 12px 20px;
          border-radius: 12px;
          font-size: 0.85rem;
          font-weight: 600;
          box-shadow: 0 8px 30px rgba(0,0,0,0.35);
          animation: slideInRight 0.3s ease;
          max-width: 320px;
        }
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(40px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        .offline-banner {
          background: linear-gradient(135deg, #7c2d12, #b45309);
          color: white;
          text-align: center;
          padding: 10px 16px;
          font-size: 0.8rem;
          font-weight: 700;
          letter-spacing: 0.2px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          flex-wrap: wrap;
          line-height: 1.35;
        }
        .recibo-offline-badge {
          background: #fef3c7;
          color: #92400e;
          border: 1.5px solid #f59e0b;
          border-radius: 8px;
          padding: 8px 12px;
          font-size: 0.8rem;
          font-weight: 600;
          margin-bottom: 10px;
          text-align: center;
        }
      `}</style>

      {/* ── Toast de sincronización ── */}
      {notifSync && (
        <div className="sync-toast">
          {notifSync.mensaje}
        </div>
      )}

      {/* ── Toast de descarga de catálogo ── */}
      {descargaProgreso && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 99999,
          background: descargaProgreso.fase === 'listo' ? '#14532d' : 'var(--lf-text)',
          color: 'white', borderRadius: '14px', padding: '14px 18px',
          boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
          minWidth: '280px', maxWidth: '320px',
          animation: 'slideInRight 0.3s ease',
          border: `1.5px solid ${descargaProgreso.fase === 'listo' ? '#16a34a' : '#3F3F46'}`,
        }}>
          {descargaProgreso.fase === 'listo' ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: '1.1rem' }}><UiIcon name="CheckCircle2" size={16} /></span>
                <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>Catálogo listo offline</span>
              </div>
              <p style={{ fontSize: '0.78rem', color: '#86efac', margin: 0 }}>
                {descargaProgreso.descargados.toLocaleString()} productos disponibles sin internet
              </p>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: '1rem' }}><UiIcon name="Package" size={16} /></span>
                <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>
                  {descargaProgreso.fase === 'productos' && 'Descargando catálogo...'}
                  {descargaProgreso.fase === 'formas' && 'Descargando formas de venta...'}
                  {descargaProgreso.fase === 'stock' && 'Descargando stock...'}
                  {descargaProgreso.fase === 'guardando' && 'Guardando en tu dispositivo...'}
                </span>
              </div>
              <div style={{ background: 'var(--lf-border)', borderRadius: 999, height: 6, marginBottom: 6, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 999,
                  background: 'linear-gradient(90deg, var(--lf-primary), var(--lf-accent))',
                  width: `${Math.min((descargaProgreso.descargados / Math.max(descargaProgreso.total, 1)) * 100, 100)}%`,
                  transition: 'width 0.4s ease',
                }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--lf-text-muted)' }}>
                <span>
                  {descargaProgreso.fase === 'productos' && `${descargaProgreso.descargados.toLocaleString()} / ${descargaProgreso.total.toLocaleString()} productos`}
                  {descargaProgreso.fase === 'formas' && `${descargaProgreso.descargados.toLocaleString()} / ${descargaProgreso.total.toLocaleString()}`}
                  {descargaProgreso.fase === 'stock' && `Lote ${descargaProgreso.descargados} / ${descargaProgreso.total}`}
                  {descargaProgreso.fase === 'guardando' && 'Guardando...'}
                </span>
                <span style={{ color: 'var(--lf-primary-soft)', fontWeight: 600 }}>
                  {Math.round((descargaProgreso.descargados / Math.max(descargaProgreso.total, 1)) * 100)}%
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Banner de modo offline (coordinación entre cajeros) ── */}
      {!isOnline && (
        <div className="offline-banner" role="status">
          <span><UiIcon name="AlertTriangle" size={16} /></span>
          <span>
            SIN CONEXIÓN A INTERNET — Coordina con el otro cajero antes de vender productos con poco stock.
            Las ventas se sincronizarán cuando vuelva la conexión.
          </span>
          {ventasPendientes > 0 && (
            <span style={{ background: 'rgba(255,255,255,0.2)', borderRadius: 20, padding: '2px 10px', marginLeft: 8, flexShrink: 0 }}>
              {ventasPendientes} en cola
            </span>
          )}
        </div>
      )}

      {/* === MODAL VENTA PERDIDA === */}
      {ventaPerdidaItem && (
        <div className="modal-overlay-strict" data-keyboard-trap onKeyDown={atraparTecladoOverlay}>
          <div className="apertura-modal-modern" role="dialog" aria-modal="true" aria-label="Venta perdida">
            <div className="apertura-header-modern">
              <div className="circle-decoration circle-1"></div>
              <div className="circle-decoration circle-2"></div>
              <p className="header-label">ACCIÓN</p>
              <h2 className="header-monto" style={{ fontSize: "2rem" }}>Venta Perdida</h2>
            </div>
            <form className="apertura-body-modern" onSubmit={procesarVentaPerdida}>
              <div className="badge-ready">
                <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 16, height: 16, marginRight: 5 }}>
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Listo para registrar
              </div>
              <div className="vp-info-block">
                <label className="vp-label">PRODUCTO</label>
                <p className="vp-value">{etiquetaProductoTicket(ventaPerdidaItem)}</p>
              </div>
              <div className="vp-info-block">
                <label className="vp-label">CANTIDAD</label>
                <p className="vp-value">{ventaPerdidaItem.cantidad}{ventaPerdidaItem.modo_venta ? ` ${ventaPerdidaItem.modo_venta}` : ''}</p>
              </div>
              <div className="vp-info-block">
                <label className="vp-label">MOTIVO</label>
                <select className="vp-select" value={motivoPerdida} onChange={(e) => setMotivoPerdida(e.target.value)}>
                  {motivosOpciones.map((mot) => (<option key={mot} value={mot}>{mot}</option>))}
                </select>
                <textarea className="vp-textarea" placeholder="Detalle opcional..." rows="3"
                  value={detallePerdida} onChange={(e) => setDetallePerdida(e.target.value)}></textarea>
              </div>
              <div className="vp-divider"></div>
              <div className="action-buttons-modern" style={{ marginTop: "1.5rem", marginBottom: 0 }}>
                <button type="submit" className="btn-primary-modern" disabled={registrandoPerdida}>
                  <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: "20px", height: "20px", color: "#fff", marginRight: "8px" }}>
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  {registrandoPerdida ? "Registrando..." : "Registrar Venta Perdida"}
                </button>
                <button type="button" className="btn-secondary-modern" data-enter-skip="true" tabIndex={-1} onClick={() => setVentaPerdidaItem(null)} disabled={registrandoPerdida}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* === ALERTA PERSONALIZADA (Enter → Aceptar; tras checklist: z-index 100050 < ProcesandoVenta 100060) === */}
      {selectorForma && (
        <SelectorFormaVentaModal
          producto={selectorForma.producto}
          formas={selectorForma.formas}
          idsMedidaEnCarrito={carrito
            .filter((i) => Number(i.id_producto) === Number(selectorForma.producto.id_producto))
            .map((i) => i.id_medida)}
          onElegir={(forma) => {
            const { producto, formas } = selectorForma;
            setSelectorForma(null);
            pushLineaCarrito(producto, formas, forma);
          }}
          onCancelar={() => {
            setSelectorForma(null);
            enfocarBuscadorPos();
          }}
        />
      )}

      <AlertaSistemaModal
        alerta={alertaSistema}
        onClose={() => {
          setAlertaSistema(null);
          setTimeout(() => buscadorProductoRef.current?.focus(), 40);
        }}
        overlayClassName="pos-alerta-overlay"
        zIndex={100050}
      />

      {/* MODAL PAGO MIXTO */}
      {showPagoMixto && (
        <div
          className="modal-overlay-mixto"
          data-keyboard-trap
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              cerrarPagoMixto();
              return;
            }
            atraparTecladoOverlay(e);
          }}
        >
          <div className="modal-mixto-box" role="dialog" aria-modal="true" aria-label="Configurar pago mixto">
            <h3>Configurar Pago Mixto</h3>
            <p>Total a cubrir: <strong>S/ {totalMixtoExacto.toFixed(2)}</strong></p>
            <div className="mixto-block">
              <label>Método 1</label>
              <div className="toggle-group pos-mixto-metodos">
                {METODOS_MIXTO.map((m) => (
                  <button
                    key={`m1-${m}`}
                    type="button"
                    tabIndex={-1}
                    data-enter-skip="true"
                    className={`toggle-btn ${mixtoData.metodo1 === m ? "active" : ""}`}
                    onClick={() => setMixtoData({ ...mixtoData, metodo1: m })}
                  >{m}</button>
                ))}
              </div>
              <input
                ref={mixtoMonto1Ref}
                type="number"
                min="0"
                step="0.01"
                value={mixtoData.monto1}
                onChange={(e) => setMixtoData({ ...mixtoData, monto1: e.target.value })}
                placeholder="Monto 1"
              />
            </div>
            <div className="mixto-block">
              <label>Método 2</label>
              <div className="toggle-group pos-mixto-metodos">
                {METODOS_MIXTO.map((m) => (
                  <button
                    key={`m2-${m}`}
                    type="button"
                    tabIndex={-1}
                    data-enter-skip="true"
                    className={`toggle-btn ${mixtoData.metodo2 === m ? "active" : ""}`}
                    onClick={() => setMixtoData({ ...mixtoData, metodo2: m })}
                  >{m}</button>
                ))}
              </div>
              <input type="number" min="0" step="0.01" value={mixtoData.monto2} onChange={(e) => setMixtoData({ ...mixtoData, monto2: e.target.value })} placeholder="Monto 2" />
            </div>
            <div
              className={`mixto-balance ${
                sumaMixtoActual <= 0
                  ? "mixto-balance-idle"
                  : mixtoCuadraExacto
                    ? "mixto-balance-ok"
                    : diffMixto < 0
                      ? "mixto-balance-falta"
                      : "mixto-balance-sobra"
              }`}
              role="status"
            >
              <span>Suma: <strong>S/ {sumaMixtoActual.toFixed(2)}</strong></span>
              <span>
                {sumaMixtoActual <= 0
                  ? "Ingresa los montos"
                  : mixtoCuadraExacto
                    ? "✓ Cuadra exacto"
                    : diffMixto < 0
                      ? `Faltan S/ ${Math.abs(diffMixto).toFixed(2)}`
                      : `Sobran S/ ${diffMixto.toFixed(2)}`}
              </span>
            </div>
            <div className="mixto-actions">
              <button className="btn-cancelar" data-enter-skip="true" tabIndex={-1} onClick={cerrarPagoMixto}>Cancelar</button>
              <button
                type="button"
                className="btn-confirmar"
                onClick={confirmarPagoMixto}
                disabled={!mixtoCuadraExacto || mixtoData.metodo1 === mixtoData.metodo2}
                data-enter-skip={!mixtoCuadraExacto || mixtoData.metodo1 === mixtoData.metodo2 ? "true" : undefined}
                title={!mixtoCuadraExacto ? "La suma debe coincidir exactamente con el total" : undefined}
              >
                Confirmar S/ {sumaMixtoActual.toFixed(2)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ ÁREA DE TRABAJO: buscador | carrito ═══ */}
      {/* inert: con cualquier modal de cobro/alerta abierto, el fondo no recibe foco ni teclado */}
      <div className="pos-workspace" inert={hayModalPosAbierto ? true : undefined}>
        <div
          className={`pos-search-col${showResultadosPanel ? " has-resultados" : ""}`}
          ref={searchWrapperRef}
          {...(showResultadosPanel ? { "data-keyboard-trap": true } : {})}
        >
          <div className="pos-search-wrapper">
            <div className="pos-search-bar">
              <span className="pos-search-brand-logo" aria-hidden="true">
                <LogoLuxFarma variant="icon" size={32} color="red" />
              </span>
              <span className="pos-search-divider" aria-hidden="true" />
              <UiIcon name="Search" size={22} className="search-icon" aria-hidden="true" />
              <input ref={buscadorProductoRef} type="text"
                placeholder={isOnline ? "Escanear código o escribe 3 letras..." : "Offline — escribe 3 letras o el código"}
                value={searchTerm}
                onChange={(e) => buscarProducto(e.target.value)}
                onKeyDown={handleKeyDownBuscador}
                autoFocus
              />
              <div className="pos-search-badge-wrap">
                <ConnectionBadge
                  isOnline={isOnline}
                  pendientes={ventasPendientes}
                  sincronizando={sincronizando}
                />
              </div>
            </div>
            <div className="pos-ctx-strip" aria-label="Contexto de la venta">
              <span className="pos-ctx-item">
                <span className="pos-ctx-label">Cajero</span>
                <strong>{nombreCajero}</strong>
              </span>
              <span className="pos-ctx-sep" aria-hidden="true" />
              <span className="pos-ctx-item">
                <span className="pos-ctx-label">Sucursal</span>
                <strong>{nombreSucursal}</strong>
              </span>
              <span className="pos-ctx-sep" aria-hidden="true" />
              <span className="pos-ctx-item">
                <span className="pos-ctx-label">Serie</span>
                <strong>{serieVista}</strong>
                <em>n.º al cobrar</em>
              </span>
              <span className="pos-ctx-sep" aria-hidden="true" />
              <span className="pos-ctx-item pos-ctx-turno">
                <span className="pos-ctx-label">Turno</span>
                <strong>S/ {Number(resumenTurno.total || 0).toFixed(2)}</strong>
                <em>{resumenTurno.ops} {resumenTurno.ops === 1 ? 'venta' : 'ventas'}</em>
              </span>
            </div>
          </div>
          <p className="pos-search-help">
            Escribe 3 letras para ver resultados · Enter selecciona · Con carrito lleno, Enter vacío cobra
          </p>

          {/* Zona idle: solo cuando no hay panel de resultados (decorativa, sin foco) */}
          {!showResultadosPanel && (
            <div className="pos-search-idle" aria-hidden="true">
              <div className="pos-search-idle-card">
                <div className="pos-search-idle-icon">
                  <UiIcon name="Barcode" size={56} />
                </div>
                <p className="pos-search-idle-kicker">Mostrador listo</p>
                <p className="pos-search-idle-title">Listo para vender</p>
                <p className="pos-search-idle-text">
                  Escanea un código de barras o escribe 3 letras del nombre para ver resultados
                </p>
                <ul className="pos-idle-keys">
                  <li><kbd>3 letras</kbd><span>Ver resultados</span></li>
                  <li><kbd>Enter</kbd><span>Seleccionar producto</span></li>
                  <li><kbd>↑ ↓</kbd><span>Navegar lista</span></li>
                  <li><kbd>Enter vacío</kbd><span>Cobrar carrito</span></li>
                  <li><kbd>Esc</kbd><span>Cerrar resultados</span></li>
                </ul>
              </div>
            </div>
          )}

          {/* Resultados embebidos: ocupan el resto de la columna hacia abajo; scroll solo en la lista */}
          {showResultadosPanel && (
            <section className="pos-resultados-panel" role="listbox" aria-label="Resultados de búsqueda">
              <div className="pos-resultados-panel-head">
                <div>
                  <p className="pos-resultados-kicker">Búsqueda</p>
                  <h3>Productos encontrados</h3>
                  <p className="pos-resultados-hint">
                    {buscando
                      ? "Buscando..."
                      : `${resultados.length} resultado${resultados.length !== 1 ? "s" : ""} · ↑↓ navegar · Enter agregar · Esc cerrar`}
                  </p>
                </div>
                <button
                  type="button"
                  className="pos-resultados-cerrar"
                  data-enter-skip="true"
                  tabIndex={-1}
                  onClick={() => { setShowResultadosPanel(false); setResultados([]); buscadorProductoRef.current?.focus(); }}
                >
                  Cerrar
                </button>
              </div>
              <div className="pos-resultados-lista">
                {buscando ? (
                  <div className="pos-resultados-vacio">Buscando productos...</div>
                ) : resultados.length === 0 ? (
                  <div className="pos-resultados-vacio">No se encontraron productos para “{searchTerm}”.</div>
                ) : (
                  resultados.map((item, i) => {
                    const precio = Number(filaProductoPrecios(item.producto_precios)?.precio_venta || 0);
                    return (
                      <div
                        key={item.id_producto}
                        ref={el => rowRefs.current[i] = el}
                        role="option"
                        aria-selected={i === filaResaltada}
                        className={`pos-resultado-card ${i === filaResaltada ? "resaltada" : ""}`}
                        style={{
                          '--stagger': Math.min(i, 8),
                          '--row-op': item.totalStock <= 0 ? 0.65 : 1,
                        }}
                        onClick={() => { setFilaResaltada(i); agregarAlCarrito(item); }}
                      >
                        <div className="pos-resultado-main">
                          <span className="pos-resultado-nombre">{item.descripcion}</span>
                          <span className="pos-resultado-lab">
                            {nombreLaboratorioProducto(item) || 'Sin laboratorio'}
                          </span>
                          <span className="pos-resultado-meta">
                            {item.codigo_barras ? `${item.codigo_barras} · ` : ""}
                            {item.currentLot ? `Lote ${item.currentLot.nro_lote} · Vence ${item.fechaVenceStr}` : "Sin lote activo"}
                          </span>
                        </div>
                        <div className="pos-resultado-side">
                          <span className="pos-resultado-precio">{formatSolesUnitario(precio)}</span>
                          <span className={`pos-resultado-stock ${item.totalStock > 20 ? "ok" : item.totalStock > 0 ? "low" : "out"}`}>
                            {item.totalStock <= 0 ? "Sin stock" : `${item.totalStock} und`}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          )}
        </div>

        {/* CARRITO — siempre visible */}
        <div className="pos-cart-col">
          <div className="cart-panel">
            <div className="cart-header">
              <div className="cart-header-left">
                <div className="cart-header-icon"><UiIcon name="ShoppingCart" size={16} /></div>
                <div>
                  <h3 className="cart-title">Carrito</h3>
                  <p
                    key={`cart-stats-${cartStatsFlash}`}
                    className={`cart-subtitle${cartStatsFlash > 0 ? " is-flash" : ""}`}
                  >
                    {carrito.length === 0
                      ? "Sin productos"
                      : `${carrito.length} línea${carrito.length > 1 ? "s" : ""} · ${productosDistintos} producto${productosDistintos > 1 ? "s" : ""} · ${unidadesEnCarrito} uds.`}
                  </p>
                </div>
              </div>
              {carrito.length > 0 && (
                <button className="cart-clear-btn" type="button" data-enter-skip="true" tabIndex={-1} onClick={() => setCarrito([])}>
                  Limpiar
                </button>
              )}
            </div>
            {carrito.length === 0 ? (
              <div className="cart-empty">
                <div className="cart-empty-stage">
                  <div className="cart-empty-icon"><UiIcon name="ShoppingCart" size={52} /></div>
                  <p className="cart-empty-title">El carrito está vacío</p>
                  <p className="cart-empty-sub">Escanea o busca un producto para comenzar.</p>
                  <div className="cart-empty-ghosts" aria-hidden="true">
                    <span /><span /><span />
                  </div>
                </div>
              </div>
            ) : (
              <div className="cart-items-list">
                {carrito.map((item, idx) => {
                  const clave = claveLineaCarrito(item);
                  const stockModo = Math.floor(
                    Math.max(0, Number(item.stock_total || 0) - unidadesBaseProducto(carrito, item.id_producto, clave))
                    / (Number(item.factor) || 1),
                  );
                  return (
                  <article key={clave} className="cart-item-card">
                    <div className="cart-item-top">
                      <div className="cart-item-title-row">
                        <span className="crow-prod-index">{idx + 1}</span>
                        <div className="crow-prod-info">
                          <span className="crow-prod-name">{item.producto}</span>
                          <div className="cart-item-meta">
                            {item.laboratorio ? (
                              <span className="crow-lab-badge" title={item.laboratorio}>{item.laboratorio}</span>
                            ) : null}
                            <span className={`crow-stock-label ${item.cantidad >= stockModo ? "stock-warn" : ""}`}>
                              Stock <b>{stockModo}</b>
                            </span>
                            <span className="crow-lote-badge" title={item.lote || ""}>{item.lote || "Sin lote"}</span>
                          </div>
                        </div>
                      </div>
                      <div className="crow-actions">
                        <button
                          type="button"
                          className="crow-btn-del"
                          title="Quitar del carrito"
                          aria-label="Quitar del carrito"
                          data-enter-skip="true"
                          tabIndex={-1}
                          onClick={() => setCarrito((c) => quitarLineaCarrito(c, clave))}
                        >
                          ✕
                        </button>
                        <button
                          type="button"
                          className="crow-btn-loss"
                          title="Registrar venta perdida"
                          aria-label="Registrar venta perdida"
                          data-enter-skip="true"
                          tabIndex={-1}
                          onClick={() => abrirModalVentaPerdida(item)}
                        ><UiIcon name="TrendingDown" size={16} /></button>
                      </div>
                    </div>

                    <div className="cart-item-controls">
                      <div className="crow-tipo">
                        {item.formasVenta && item.formasVenta.length > 1 ? (
                          <select
                            className="crow-tipo-select"
                            value={item.id_medida}
                            onChange={(e) => cambiarModoVenta(clave, Number(e.target.value))}
                            aria-label="Forma de venta"
                          >
                            {item.formasVenta.map((f) => (
                              <option key={f.id_medida} value={f.id_medida}>{f.unidades_medida?.nombre}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="modo-und-label">{item.modo_venta}</span>
                        )}
                      </div>

                      <div className="qty-control" aria-label="Cantidad">
                        <button
                          type="button"
                          className="qty-btn"
                          data-enter-skip="true"
                          tabIndex={-1}
                          disabled={item.cantidad <= 1}
                          onClick={() => cambiarCantidad(clave, item.cantidad - 1)}
                          aria-label="Disminuir cantidad"
                        >
                          −
                        </button>
                        <input
                          type="text"
                          inputMode="numeric"
                          className="qty-input"
                          value={qtyEditMap[clave] !== undefined ? qtyEditMap[clave] : item.cantidad}
                          onFocus={() => handleQtyFocus(clave, item.cantidad)}
                          onChange={(e) => handleQtyChange(clave, e.target.value)}
                          onBlur={() => handleQtyCommit(clave)}
                          onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
                          aria-label="Cantidad"
                        />
                        <button
                          type="button"
                          className="qty-btn"
                          data-enter-skip="true"
                          tabIndex={-1}
                          onClick={() => cambiarCantidad(clave, item.cantidad + 1)}
                          aria-label="Aumentar cantidad"
                        >
                          +
                        </button>
                      </div>

                      <div className="cart-item-money">
                        <span className="crow-price-val">{formatSolesUnitario(item.precio)} <small>c/u</small></span>
                        <span className="crow-subtotal-val">S/ {item.subtotal?.toFixed(2) || "0.00"}</span>
                      </div>
                    </div>
                  </article>
                  );
                })}
              </div>
            )}
            <div className="pos-cart-checkout">
              <div className="pos-cart-totals">
                <div className="pos-cart-totals-row"><span>Subtotal</span><span>S/ {subtotalSinIgv.toFixed(2)}</span></div>
                <div className="pos-cart-totals-row"><span>IGV (18%)</span><span>S/ {igv.toFixed(2)}</span></div>
                <div className="pos-cart-totals-grand">
                  <span>Total a cobrar</span>
                  <strong
                    key={`total-flash-${totalFlash}`}
                    className={totalFlash > 0 ? "is-flash" : undefined}
                  >
                    S/ {total.toFixed(2)}
                  </strong>
                </div>
              </div>
              <button
                type="button"
                className={`btn-cobrar${carrito.length > 0 && !procesandoVenta ? " is-ready" : ""}`}
                onClick={iniciarCobro}
                disabled={procesandoVenta || carrito.length === 0}
                style={{
                  background: !isOnline ? "linear-gradient(135deg, #92400e, #b45309)" : undefined,
                  opacity: procesandoVenta || carrito.length === 0 ? 0.6 : 1,
                  cursor: procesandoVenta || carrito.length === 0 ? "not-allowed" : "pointer",
                }}
              >
                {!procesandoVenta && <UiIcon name="Wallet" size={18} aria-hidden="true" />}
                {procesandoVenta ? "Procesando..." : (isOnline ? `Cobrar S/ ${total.toFixed(2)}` : `Cobrar offline S/ ${total.toFixed(2)}`)}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ PASO COBRO: datos del cliente ═══ */}
      {pasoCobro === "cliente" && (
        <div
          className="pos-cobro-overlay"
          data-keyboard-trap
          onKeyDown={atraparTecladoOverlay}
          onMouseDown={(e) => { if (e.target === e.currentTarget) { setPasoCobro(null); buscadorProductoRef.current?.focus(); } }}
        >
          <div className={`pos-cobro-modal pos-cobro-cliente ${cobroAnimDir === "back" ? "pos-cobro-panel-enter-back" : "pos-cobro-panel-enter"}`} role="dialog" aria-modal="true" aria-label="Datos del cliente">
            <div className="pos-cliente-brand-banner">
              <span className="pos-cliente-brand-logo">
                <LogoLuxFarma variant="icon" size={28} color="red" />
              </span>
              <div className="pos-cliente-brand-text">
                <span className="pos-cliente-brand-name">LuxFarma</span>
                <span className="pos-cliente-brand-tag">Farmacia · Punto de venta</span>
              </div>
            </div>
            <div className="pos-cobro-modal-head">
              <div>
                <div className="pos-cobro-progress" aria-hidden="true">
                  <span className="pos-cobro-progress-dot is-done" />
                  <span className="pos-cobro-progress-line is-active" />
                  <span className="pos-cobro-progress-dot is-next" />
                </div>
                <p className="pos-cobro-step">Paso 1 de 2 · Cliente</p>
                <h2>Datos del cliente</h2>
                <p className="pos-cobro-sub">Total a cobrar: <strong>S/ {total.toFixed(2)}</strong></p>
              </div>
              <button type="button" className="pos-resultados-cerrar" data-enter-skip="true" tabIndex={-1}
                onClick={() => { setPasoCobro(null); buscadorProductoRef.current?.focus(); }}><UiIcon name="X" size={16} /></button>
            </div>
            <div className="pos-cobro-modal-body">
              <div className="form-group pos-cliente-tipo">
                <label>Tipo de comprobante</label>
                <div
                  className="toggle-group pos-cliente-segment"
                  tabIndex={0}
                  data-enter-target="true"
                  onFocus={() => setTipoEnfocado(tipoComprobante)}
                  onKeyDown={handleTipoToggleKeyDown}
                >
                  {facturacionElectronica && (
                  <button type="button" tabIndex={-1} data-enter-skip="true"
                    className={`toggle-btn ${esBoleta ? "active" : ""} ${tipoEnfocado === "Boleta" ? "focused" : ""}`}
                    onClick={() => { handleTipoComprobante("Boleta"); setTipoEnfocado("Boleta"); }}>
                    <UiIcon name="Receipt" size={14} /> Boleta / DNI
                  </button>
                  )}
                  {facturacionElectronica && (
                  <button type="button" tabIndex={-1} data-enter-skip="true"
                    className={`toggle-btn ${esFactura ? "active" : ""} ${tipoEnfocado === "Factura" ? "focused" : ""}`}
                    onClick={() => { handleTipoComprobante("Factura"); setTipoEnfocado("Factura"); }}>
                    <UiIcon name="Building2" size={14} /> Factura / RUC
                  </button>
                  )}
                  <button type="button" tabIndex={-1} data-enter-skip="true"
                    className={`toggle-btn ${esNotaVenta ? "active" : ""} ${tipoEnfocado === "Nota de Venta" ? "focused" : ""}`}
                    onClick={() => { handleTipoComprobante("Nota de Venta"); setTipoEnfocado("Nota de Venta"); }}>
                    <UiIcon name="FileText" size={14} /> Nota de Venta
                  </button>
                </div>
              </div>

              <div className="pos-cliente-stack-viewport">
              <div
                key={tipoComprobante}
                className={`pos-cliente-stack ${tipoTabDir === "back" ? "pos-cliente-stack--back" : "pos-cliente-stack--forward"}`}
              >
              <div className="pos-cliente-card pos-cliente-card--id">
                <div className="pos-cliente-card-head">
                  <div>
                    <p className="pos-cliente-card-kicker">
                      <span className="pos-cliente-card-ico" aria-hidden="true">
                        <UiIcon name={esFactura ? "Landmark" : "CreditCard"} size={13} />
                      </span>
                      Identificación
                    </p>
                    <h3 className="pos-cliente-card-title">
                      {esFactura ? "RUC del cliente" : ventaSinDoc ? "Venta sin DNI" : "DNI del cliente"}
                    </h3>
                  </div>
                  <div className="pos-cliente-card-actions">
                    {docOk && isOnline && !modoManual && !ventaSinDoc && (
                      <span className="pos-cliente-verified-badge">
                        <UiIcon name="CheckCircle2" size={13} /> Verificado
                      </span>
                    )}
                    {!ventaSinDoc && (
                      <button
                        type="button"
                        className={`pos-cliente-manual-btn ${modoManual ? "is-on" : ""}`}
                        onClick={() => { setModoManual((m) => !m); setDocError(""); setDocOk(false); if (ventaSinDoc) setVentaSinDoc(false); }}
                      >
                        <UiIcon name="PenLine" size={14} />
                        {modoManual ? "MANUAL activo" : "Ingresar manual"}
                      </button>
                    )}
                  </div>
                </div>

                {!ventaSinDoc && (
                  <div className="pos-cliente-doc-row">
                    <div className={`pos-cliente-doc-wrap ${modoManual ? "is-manual" : ""} ${docOk ? "is-ok" : ""} ${docError ? "is-err" : ""} ${docLoading ? "is-loading" : ""} ${docAutofillFlash ? "is-just-ok" : ""}`}>
                      <input
                        ref={docInputRef}
                        type="text"
                        inputMode="numeric"
                        maxLength={modoManual ? 15 : (esFactura ? 11 : 8)}
                        value={docInput}
                        onChange={(e) => handleDocInput(e.target.value)}
                        onKeyDown={handleDocKeyDown}
                        placeholder={!isOnline ? "Sin conexión — manual" : modoManual ? "Nro. documento" : esFactura ? "RUC (11 dígitos)" : "DNI (8 dígitos)"}
                        className="pos-cliente-doc-input"
                        aria-describedby="pos-cliente-doc-count"
                      />
                      <span className="pos-cliente-doc-status">
                        {modoManual ? <span className="pos-cliente-doc-manual-ico"><UiIcon name="Pencil" size={14} /></span> : <DocStatusIcon />}
                      </span>
                    </div>
                    <span
                      id="pos-cliente-doc-count"
                      className={`pos-cliente-doc-count ${docLenCompleto ? "is-complete" : ""} ${docOk && !modoManual ? "is-verified" : ""}`}
                      aria-live="polite"
                    >
                      {Math.min(docLenActual, docLenEsperado)}/{docLenEsperado} dígitos
                    </span>
                  </div>
                )}

                <div className="pos-cliente-doc-hints">
                  {!isOnline && !ventaSinDoc && (
                    <div className="pos-cliente-alert pos-cliente-alert--warn" role="status">
                      <span className="pos-cliente-alert-ico" aria-hidden="true"><UiIcon name="WifiOff" size={16} /></span>
                      <div className="pos-cliente-alert-body">
                        <strong>Sin conexión</strong>
                        <p>La consulta DNI/RUC no está disponible. Usa modo manual o reintenta al recuperar internet.</p>
                      </div>
                    </div>
                  )}
                  {docLoading && isOnline && !modoManual && !ventaSinDoc && (
                    <p className="pos-cliente-hint is-muted">Consultando {esFactura ? "SUNAT" : "RENIEC"}…</p>
                  )}
                  {docError && (
                    <div className="pos-cliente-alert pos-cliente-alert--error" role="alert">
                      <span className="pos-cliente-alert-ico" aria-hidden="true"><UiIcon name="AlertTriangle" size={16} /></span>
                      <div className="pos-cliente-alert-body">
                        <strong>Documento no encontrado</strong>
                        <p>{docError}</p>
                      </div>
                    </div>
                  )}
                  {ventaSinDoc && (
                    <div className="pos-cliente-alert pos-cliente-alert--info" role="status">
                      <span className="pos-cliente-alert-ico" aria-hidden="true"><UiIcon name="Info" size={16} /></span>
                      <div className="pos-cliente-alert-body">
                        <strong>Venta sin DNI</strong>
                        <p>El nombre es obligatorio. SUNAT: documento tipo 0 (sin documento).</p>
                      </div>
                    </div>
                  )}
                  {modoManual && !ventaSinDoc && !docError && (
                    <div className="pos-cliente-alert pos-cliente-alert--manual" role="status">
                      <span className="pos-cliente-alert-ico" aria-hidden="true"><UiIcon name="Pencil" size={16} /></span>
                      <div className="pos-cliente-alert-body">
                        <strong>Modo manual</strong>
                        <p>Escribe los datos del cliente directamente.</p>
                      </div>
                    </div>
                  )}
                  {docOk && isOnline && !modoManual && !ventaSinDoc && (
                    <p className="pos-cliente-hint is-ok">
                      <UiIcon name="CheckCircle2" size={14} /> Datos verificados desde la consulta oficial
                    </p>
                  )}
                </div>

                {!esFactura && (
                  <button
                    type="button"
                    className="pos-btn-sin-dni"
                    data-enter-skip="true"
                    tabIndex={-1}
                    onClick={() => {
                      if (ventaSinDoc) {
                        setVentaSinDoc(false);
                        setTimeout(() => docInputRef.current?.focus(), 40);
                      } else {
                        activarVentaSinDoc();
                      }
                    }}
                  >
                    {ventaSinDoc ? <><UiIcon name="Undo2" size={14} /> Volver a pedir DNI</> : <><UiIcon name="User" size={14} /> Continuar sin DNI</>}
                  </button>
                )}
              </div>

              <div className="pos-cliente-card pos-cliente-card--datos pos-cliente-card-datos">
                <div className="pos-cliente-card-head">
                  <div>
                    <p className="pos-cliente-card-kicker">
                      <span className="pos-cliente-card-ico" aria-hidden="true">
                        <UiIcon name={esFactura ? "Building2" : "User"} size={13} />
                      </span>
                      Datos personales
                    </p>
                    <h3 className="pos-cliente-card-title">
                      {esFactura ? "Empresa / RUC" : "Persona / DNI"}
                    </h3>
                  </div>
                </div>

                {esFactura ? (
                  <div className="pos-cliente-fields">
                    <div className={`pos-field ${campoAutofillCls(clienteRazonSocial)}`}>
                      <div className="pos-field-label-row">
                        <label htmlFor="pos-cliente-razon">Razón social</label>
                        {docOk && !modoManual && clienteRazonSocial && (
                          <span className={`pos-field-badge ${docAutofillFlash ? "is-pop" : ""}`}><UiIcon name="CheckCircle2" size={12} /> Verificado</span>
                        )}
                      </div>
                      <input
                        id="pos-cliente-razon"
                        type="text"
                        placeholder="Razón social *"
                        value={clienteRazonSocial}
                        onChange={(e) => setClienteRazonSocial(e.target.value)}
                        className="input-full"
                      />
                    </div>
                    <div className={`pos-field pos-field-direccion ${campoAutofillCls(clienteDireccion)}`}>
                      <div className="pos-field-label-row">
                        <label htmlFor="pos-cliente-dir">Dirección (SUNAT)</label>
                        {docOk && !modoManual && clienteDireccion && (
                          <span className={`pos-field-badge ${docAutofillFlash ? "is-pop" : ""}`}><UiIcon name="CheckCircle2" size={12} /> Verificado</span>
                        )}
                      </div>
                      <textarea
                        id="pos-cliente-dir"
                        ref={direccionRef}
                        rows={2}
                        placeholder="Dirección fiscal según SUNAT"
                        value={clienteDireccion}
                        onChange={(e) => setClienteDireccion(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter' || e.shiftKey) return;
                          e.preventDefault();
                          e.stopPropagation();
                          if (pasoCobro === 'cliente') continuarDesdeCliente();
                          else buscadorProductoRef.current?.focus();
                        }}
                        className="input-full pos-cliente-dir-area"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="pos-cliente-fields">
                    <div className="pos-cliente-nombres-grid">
                      <div className={`pos-field ${campoAutofillCls(clienteNombres)}`}>
                        <div className="pos-field-label-row">
                          <label htmlFor="pos-cliente-nombres">Nombres</label>
                          {docOk && !modoManual && clienteNombres && (
                            <span className={`pos-field-badge ${docAutofillFlash ? "is-pop" : ""}`}><UiIcon name="CheckCircle2" size={12} /> Verificado</span>
                          )}
                        </div>
                        <input
                          id="pos-cliente-nombres"
                          ref={clienteNombresRef}
                          type="text"
                          placeholder="Nombres *"
                          value={clienteNombres}
                          onChange={(e) => setClienteNombres(e.target.value)}
                          className="input-full"
                        />
                      </div>
                      <div className={`pos-field ${campoAutofillCls(clienteApellidos)}`}>
                        <div className="pos-field-label-row">
                          <label htmlFor="pos-cliente-apellidos">Apellidos</label>
                          {docOk && !modoManual && clienteApellidos && (
                            <span className={`pos-field-badge ${docAutofillFlash ? "is-pop" : ""}`}><UiIcon name="CheckCircle2" size={12} /> Verificado</span>
                          )}
                        </div>
                        <input
                          id="pos-cliente-apellidos"
                          type="text"
                          placeholder={ventaSinDoc ? "Apellidos (opcional)" : "Apellidos *"}
                          value={clienteApellidos}
                          onChange={(e) => setClienteApellidos(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter") return;
                            e.preventDefault();
                            e.stopPropagation();
                            sexoRef.current?.focus();
                          }}
                          className="input-full"
                        />
                      </div>
                    </div>

                    <div className={`pos-field pos-cliente-sexo ${docOk && !modoManual && !clienteSexo ? "is-sexo-pendiente" : ""} ${clienteSexo ? "has-value" : ""} ${sexoEsSugerido ? "is-sugerido" : ""}`}>
                      <div className="pos-field-label-row">
                        <label>Sexo <span className="pos-field-optional">(opcional)</span></label>
                        {sexoEsSugerido && clienteSexo && (
                          <span className="pos-sexo-sugerido-badge" title="Detectado por el primer nombre — puedes corregirlo">
                            sugerido
                          </span>
                        )}
                      </div>
                      <div
                        className="toggle-group pos-cliente-segment pos-sexo-chips"
                        ref={sexoRef}
                        tabIndex={0}
                        data-enter-target="true"
                        role="group"
                        aria-label="Sexo (opcional)"
                        aria-activedescendant={clienteSexo ? `pos-sexo-${clienteSexo}` : undefined}
                        onKeyDown={handleSexoChipsKeyDown}
                      >
                        {OPCIONES_SEXO.map((op) => (
                          <button
                            key={op.value}
                            id={`pos-sexo-${op.value}`}
                            type="button"
                            tabIndex={-1}
                            data-enter-skip="true"
                            className={`toggle-btn ${clienteSexo === op.value ? "active" : ""}`}
                            onClick={() => {
                              setClienteSexo(op.value);
                              setSexoEsSugerido(false);
                            }}
                          >
                            {op.label}
                          </button>
                        ))}
                      </div>
                      {docOk && !modoManual && !clienteSexo && (
                        <p className="pos-cliente-hint is-muted pos-sexo-hint">
                          La consulta no trae sexo — elige con un click o ← → (no bloquea el cobro)
                        </p>
                      )}
                      {sexoEsSugerido && clienteSexo && (
                        <p className="pos-cliente-hint is-muted pos-sexo-hint">
                          Sugerido por el nombre — verifica o cambia con un clic
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
              </div>
              </div>
            </div>
            <div className="pos-cobro-modal-actions">
              <button type="button" className="btn-cancelar" data-enter-skip="true" tabIndex={-1}
                onClick={() => { setPasoCobro(null); buscadorProductoRef.current?.focus(); }}>Cancelar</button>
              <button type="button" className="btn-confirmar" onClick={continuarDesdeCliente}>
                Continuar al pago →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ PASO COBRO: método de pago 2×2 ═══ */}
      {pasoCobro === "pago" && !showPagoMixto && (
        <div className="pos-cobro-overlay" data-keyboard-trap onKeyDown={atraparTecladoOverlay}>
          <div
            className="pos-cobro-modal pos-cobro-pago pos-cobro-panel-enter"
            role="dialog"
            aria-modal="true"
            aria-label="Método de pago"
            ref={pagoGridRef}
            tabIndex={0}
            data-enter-target="true"
            onKeyDown={handleKeyDownPagoGrid}
          >
            <div className="pos-cliente-brand-banner">
              <span className="pos-cliente-brand-logo">
                <LogoLuxFarma variant="icon" size={28} color="red" />
              </span>
              <div className="pos-cliente-brand-text">
                <span className="pos-cliente-brand-name">LuxFarma</span>
                <span className="pos-cliente-brand-tag">Farmacia · Punto de venta</span>
              </div>
            </div>
            <div className="pos-cobro-modal-head">
              <div>
                <div className="pos-cobro-progress" aria-hidden="true">
                  <span className="pos-cobro-progress-dot is-done" />
                  <span className="pos-cobro-progress-line is-done" />
                  <span className="pos-cobro-progress-dot is-done" />
                </div>
                <p className="pos-cobro-step">Paso 2 de 2 · Pago</p>
                <h2>Método de pago</h2>
                <p className="pos-cobro-sub">Total: <strong>S/ {total.toFixed(2)}</strong> · flechas + Enter</p>
              </div>
              <button type="button" className="pos-resultados-cerrar" data-enter-skip="true" tabIndex={-1}
                onClick={volverAClienteDesdePago}>←</button>
            </div>
            <div className="pos-pago-grid">
              {METODOS_PAGO.map((m, i) => (
                <button
                  key={m}
                  type="button"
                  tabIndex={-1}
                  data-enter-skip="true"
                  className={`pos-pago-tile ${pagoEnfocado === i ? "focused" : ""} ${metodoPago === m ? "active" : ""}`}
                  onClick={() => { setPagoEnfocado(i); confirmarMetodoPagoPaso(m); }}
                  onMouseEnter={() => setPagoEnfocado(i)}
                >
                  <span className="pos-pago-tile-icon">
                    {m === "Efectivo" ? <UiIcon name="Banknote" size={22} /> : m === "Yape" ? "Y" : m === "Tarjeta" ? <UiIcon name="CreditCard" size={22} /> : <UiIcon name="Shuffle" size={22} />}
                  </span>
                  <span className="pos-pago-tile-label">{m}</span>
                </button>
              ))}
            </div>
            <div className="pos-cobro-modal-actions">
              <button type="button" className="btn-cancelar" data-enter-skip="true" tabIndex={-1}
                onClick={volverAClienteDesdePago}>Volver</button>
              <button type="button" className="btn-confirmar" onClick={() => confirmarMetodoPagoPaso(METODOS_PAGO[pagoEnfocado])}>
                Confirmar {METODOS_PAGO[pagoEnfocado]} →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================= MODAL PAGO UNIFICADO ======================= */}
      {showPagoModal && (() => {
        const esEfectivo = metodoPago === 'Efectivo';
        const esYape = metodoPago === 'Yape';
        const esTarjeta = metodoPago === 'Tarjeta';
        const theme = esEfectivo
          ? { grad: 'linear-gradient(135deg,#14532d 0%,#16a34a 50%,#15803d 100%)', btn: 'linear-gradient(135deg,#16a34a,#15803d)', shadow: 'rgba(22,163,74,0.4)', icon: 'Banknote', label: 'Efectivo' }
          : esYape
            ? { grad: 'linear-gradient(135deg,var(--lf-warning) 0%,var(--lf-accent) 50%,var(--lf-accent) 100%)', btn: 'linear-gradient(135deg,var(--lf-accent),var(--lf-accent))', shadow: 'rgba(242, 184, 75, 0.4)', icon: 'Smartphone', label: 'Yape' }
            : { grad: 'linear-gradient(135deg,var(--lf-primary) 0%,var(--lf-primary) 50%,var(--lf-primary-dark) 100%)', btn: 'linear-gradient(135deg,var(--lf-primary),var(--lf-primary-dark))', shadow: 'rgba(225, 29, 46, 0.4)', icon: 'CreditCard', label: 'Tarjeta' };

        return (
          <div
            data-keyboard-trap
            onKeyDown={atraparTecladoOverlay}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100030, backdropFilter: 'blur(4px)' }}
          >
            <div role="dialog" aria-modal="true" aria-label="Confirmar pago" style={{ background: 'white', borderRadius: '20px', width: '380px', overflow: 'hidden', boxShadow: '0 25px 60px rgba(0,0,0,0.4)' }}>
              <div style={{ padding: '1.2rem 1.5rem 0.8rem', borderBottom: '1px solid var(--lf-info-bg)' }}>
                <p style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--lf-text-muted)', letterSpacing: '1.5px', marginBottom: '2px' }}>TOTAL A COBRAR</p>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '1.9rem', fontWeight: 800, color: 'var(--lf-text)' }}>S/ {total.toFixed(2)}</span>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--lf-text-muted)', fontWeight: 600 }}>{tipoComprobante} · {esFactura ? 'F001' : esNotaVenta ? 'NV01' : 'B001'} · {metodoPago}</span>
                    {!isOnline && <span style={{ fontSize: '0.7rem', color: '#b45309', fontWeight: 700, background: '#fef3c7', padding: '2px 8px', borderRadius: 20, display: 'inline-flex', alignItems: 'center', gap: 4 }}><UiIcon name="WifiOff" size={12} /> Se guardará offline</span>}
                  </div>
                </div>
              </div>
              <div style={{ padding: '0.85rem 1.5rem 0' }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  padding: '0.4rem 0.85rem', borderRadius: 999, fontSize: '0.8rem', fontWeight: 700,
                  background: 'var(--lf-primary-light)', color: 'var(--lf-primary-darker)', border: '1px solid var(--lf-primary-soft)'
                }}>
                  <UiIcon name={theme.icon} size={15} /> {theme.label}
                </span>
              </div>
              <div style={{ margin: '0.9rem 1.5rem', background: theme.grad, borderRadius: '16px', padding: '1.5rem', color: 'white', position: 'relative', overflow: 'hidden' }}>
                {[{ top: '8%', left: '8%', c: '#fbbf24', s: 8, r: 30 }, { top: '15%', left: '25%', c: '#ffffff', s: 6, r: -20 }, { top: '5%', left: '70%', c: 'var(--lf-accent)', s: 7, r: 45 }, { top: '20%', right: '10%', c: 'rgba(255,255,255,0.5)', s: 9, r: -40 }, { bottom: '20%', left: '5%', c: '#fb923c', s: 7, r: 60 }, { bottom: '10%', left: '30%', c: 'rgba(255,255,255,0.4)', s: 5, r: -30 }, { bottom: '15%', right: '20%', c: '#fbbf24', s: 8, r: 20 }, { top: '50%', right: '5%', c: 'rgba(255,255,255,0.6)', s: 6, r: -50 }].map((c, i) => (
                  <div key={i} style={{ position: 'absolute', top: c.top, left: c.left, right: c.right, bottom: c.bottom, width: c.s, height: c.s * 1.6, background: c.c, borderRadius: '2px', transform: `rotate(${c.r}deg)`, opacity: 0.8 }} />
                ))}
                <div style={{ textAlign: 'center', marginBottom: '0.6rem' }}>
                  <span style={{ fontSize: '0.9rem', fontWeight: 300, letterSpacing: '3px', opacity: 0.9 }}>{theme.label}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.8rem' }}>
                  <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', border: '3px solid rgba(255,255,255,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><UiIcon name={theme.icon} size={28} /></div>
                </div>
                <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                  <p style={{ fontWeight: 700, fontSize: '1rem', margin: 0 }}>LuxFarma</p>
                  <p style={{ fontSize: '0.75rem', opacity: 0.75, margin: 0 }}>{user?.sucursales?.nombre_comercial || 'Sede Principal'}</p>
                </div>
                {esYape && (<div style={{ textAlign: 'center', marginBottom: '0.5rem' }}><p style={{ fontSize: '1.9rem', fontWeight: 800, letterSpacing: '4px', margin: 0 }}>{YAPE_NUMERO}</p></div>)}
                {esEfectivo && (
                  <div style={{ textAlign: 'center', marginBottom: '0.5rem' }}>
                    <p style={{ fontSize: '0.75rem', opacity: 0.75, margin: '0 0 4px' }}>Monto recibido</p>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>S/</span>
                      <input
                        ref={montoRecibidoRef}
                        type="number"
                        placeholder="0.00"
                        value={montoRecibido === '' || montoRecibido === null || montoRecibido === undefined ? '' : montoRecibido}
                        onChange={(e) => setMontoRecibido(e.target.value === '' ? '' : Number(e.target.value))}
                        style={{ width: 130, padding: '6px 8px', borderRadius: 8, border: '2px solid rgba(255,255,255,0.45)', background: 'rgba(255,255,255,0.15)', color: 'white', fontWeight: 800, fontSize: '1.4rem', textAlign: 'center', outline: 'none' }}
                      />
                    </div>
                    <p style={{ fontSize: '0.75rem', opacity: 0.75, margin: '8px 0 2px' }}>Vuelto</p>
                    <p style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0, color: '#bbf7d0' }}>{vuelto >= 0 ? 'S/ ' + vuelto.toFixed(2) : 'S/ 0.00'}</p>
                  </div>
                )}
                {esTarjeta && (<div style={{ textAlign: 'center', marginBottom: '0.5rem' }}><p style={{ fontSize: '0.75rem', opacity: 0.75, margin: '0 0 4px' }}>Monto con tarjeta</p><p style={{ fontSize: '1.9rem', fontWeight: 800, margin: 0 }}>S/ {total.toFixed(2)}</p></div>)}
                {esYape && (<div style={{ textAlign: 'center', marginTop: '0.5rem' }}><p style={{ fontSize: '0.7rem', opacity: 0.75, margin: '0 0 2px' }}>Monto a yapear</p><p style={{ fontSize: '1.9rem', fontWeight: 800, margin: 0 }}>S/ {total.toFixed(2)}</p></div>)}
              </div>
              <div style={{ padding: '0 1.5rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <button
                  ref={confirmarPagoBtnRef}
                  data-enter-primary="true"
                  onClick={handleCobrar}
                  disabled={procesandoVenta}
                  style={{ width: '100%', padding: '0.85rem', background: isOnline ? theme.btn : 'linear-gradient(135deg,#92400e,#b45309)', color: 'white', border: 'none', borderRadius: '12px', fontWeight: 700, fontSize: '1rem', cursor: procesandoVenta ? 'not-allowed' : 'pointer', opacity: procesandoVenta ? 0.6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', boxShadow: `0 4px 15px ${theme.shadow}` }}
                >
                  <span><UiIcon name="Check" size={16} /></span> {procesandoVenta ? 'Procesando...' : (isOnline ? 'Confirmar pago recibido →' : 'Guardar offline →')}
                </button>
                <button onClick={() => { setShowPagoModal(false); setPasoCobro('pago'); setTimeout(() => pagoGridRef.current?.focus(), 50); }} data-enter-skip="true" tabIndex={-1} style={{ background: 'none', border: 'none', color: 'var(--lf-text-muted)', fontSize: '0.9rem', cursor: 'pointer', padding: '0.3rem' }}>Cancelar</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* MODAL PROCESANDO VENTA — pasos ligados a setPasosVenta en handleCobrar */}
      <ProcesandoVenta
        visible={procesandoVenta}
        pasos={[
          { id: 'venta',  label: 'Registrando comprobante', completado: pasosVenta.registroVenta },
          { id: 'stock',  label: 'Actualizando inventario',  completado: pasosVenta.inventario },
          {
            id: 'sunat',
            // Refleja el flujo real: Nota de Venta / sin token no envían a Nubefact;
            // offline marca el paso al guardar en cola (sync posterior).
            label: !isOnline
              ? 'Cola offline (SUNAT al sincronizar)'
              : esNotaVenta
                ? 'Comprobante (sin envío SUNAT)'
                : 'Enviando a SUNAT',
            completado: pasosVenta.sunat,
          },
          { id: 'recibo', label: 'Imprimiendo ticket',       completado: pasosVenta.recibo },
        ]}
        onCompleto={() => {
          setProcesandoVenta(false);
          procesandoVentaRef.current = false;
          setPasosVenta({ registroVenta: false, inventario: false, sunat: false, recibo: false });
          const pendiente = alertaPostVentaRef.current;
          alertaPostVentaRef.current = null;
          if (pendiente) {
            mostrarAlerta(pendiente.mensaje, pendiente.tipo, null, 'Aceptar', {
              enlace: pendiente.enlace || null,
              enlaceLabel: pendiente.enlaceLabel || null,
            });
          } else {
            setTimeout(() => buscadorProductoRef.current?.focus(), 40);
          }
        }}
      />

    </div>
  );
}