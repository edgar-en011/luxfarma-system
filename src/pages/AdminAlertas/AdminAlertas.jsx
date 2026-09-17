import { useState, useEffect, useMemo, useRef } from 'react';
import AlertaSistemaModal from '../../components/AlertaSistemaModal';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../context/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { calcularProductosStockBajo, cargarIdsProductosConMovimiento, resolverIdSucursalProducto, cargarLotesParaSede } from '../../utils/stockBajo';
import { notificarRespuestaTicketVendedor, notificarTicketEnCursoVendedor, EVT_ADMIN_TOAST_CERRAR } from '../../utils/notificacionesService';
import { claseEstadoTicket } from '../../utils/soporteTicketVista';

const cerrarToastTicketAdmin = (idTicket) => {
  if (idTicket == null) return;
  window.dispatchEvent(new CustomEvent(EVT_ADMIN_TOAST_CERRAR, { detail: { id_ticket: idTicket } }));
};
import SmartDateInput from '../../components/SmartDateInput';
import { filaProductoPrecios } from '../../utils/productoPrecios';
import { hashPassword } from '../../utils/passwordHash';
import { diasHastaFecha, formatearFechaPE } from '../../utils/fechas';
import { estaPorVencer } from '../../utils/umbralesVencimiento';
import { marcarLotesVencidos } from '../../utils/lotesVencidos';
import { assertEscritura } from '../../utils/supaWrite';
import './AdminAlertas.css';
import UiIcon from '../../components/UiIcon';
import {
  etiquetaComprobanteVisible,
  parsearBusquedaComprobante,
  resolverIdsVentaPorComprobante,
} from '../../utils/comprobanteVisible';

// Motivos posibles al registrar (VentasPerdidas.jsx) — usados como pills de filtro.
function nombreSedePorId(idSucursal, sucursales) {
  if (idSucursal == null || idSucursal === '') return '';
  return sucursales.find((s) => Number(s.id_sucursal) === Number(idSucursal))?.nombre_comercial || '';
}

function sedeStockItem(item, lotesSede, sucursalesActivas, sucursalesTodas) {
  const idSucursal = item.id_sucursal != null && item.id_sucursal !== ''
    ? Number(item.id_sucursal)
    : resolverIdSucursalProducto(item.id_producto, lotesSede, sucursalesActivas);
  if (idSucursal == null || !Number.isFinite(idSucursal)) {
    return { idSucursal: null, sede: '' };
  }
  const sede = nombreSedePorId(idSucursal, sucursalesTodas || sucursalesActivas || []);
  return { idSucursal, sede };
}

function claseGravedadAlerta(alerta) {
  if (alerta.titulo === 'Sin stock') return 'sin-stock';
  if (alerta.titulo === 'Stock bajo') return 'stock-bajo';
  if (alerta.titulo === 'Por vencer') return 'por-vencer';
  return String(alerta.tipo || 'alerta').toLowerCase();
}

function FilaAlertaSistema({ alerta, onAccion }) {
  const kind = claseGravedadAlerta(alerta);
  const esStock = alerta.accionId === 'COMPRAR';
  const esPorVencer = alerta.titulo === 'Por vencer';
  const qtyValor = esPorVencer ? alerta.diasRestantes : alerta.stockTotal;
  const qtyUnidad = esPorVencer ? 'días' : 'und';

  const meta = [];
  if (esStock) {
    if (alerta.umbral != null) meta.push(`mín. ${alerta.umbral}`);
    if (alerta.sede) meta.push(alerta.sede);
  } else {
    if (alerta.nroLote) meta.push(`Lote ${alerta.nroLote}`);
    if (alerta.stockTotal != null && !esPorVencer) meta.push(`${alerta.stockTotal} und`);
    if (esPorVencer && alerta.stockTotal != null) meta.push(`${alerta.stockTotal} und`);
    if (alerta.sede) meta.push(alerta.sede);
    if (alerta.titulo === 'Vencido' && alerta.diasVencido > 0) meta.unshift(`hace ${alerta.diasVencido}d`);
  }

  return (
    <div className={`alerta-card card-${kind}`} title={alerta.linea}>
      <div className="alerta-card-qty">
        <strong>{qtyValor ?? '—'}</strong>
        <span>{qtyUnidad}</span>
      </div>
      <div className="alerta-card-body">
        <span className={`badge-tipo badge-${kind}`}>{alerta.titulo}</span>
        <p className="alerta-card-nombre">{alerta.nombreProd || alerta.linea}</p>
        {meta.length > 0 && <p className="alerta-card-meta">{meta.join(' · ')}</p>}
      </div>
      <button type="button" className="btn-al-primary" onClick={() => onAccion(alerta)}>
        {alerta.accionPrimaria}
      </button>
    </div>
  );
}

const MOTIVOS_VENTA_PERDIDA = [
  'Falta de stock',
  'Sin catálogo',
  'Precio elevado',
  'No tenemos la presentación',
  'Otro',
];

export default function AdminAlertas() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Abrir la pestaña correcta si se navegó desde notificaciones / toast
  const [activeTab, setActiveTab] = useState(location.state?.tab || 'SISTEMA');
  const pendingTicketIdRef = useRef(location.state?.ticketId ?? null);
  const deepLinkTicketAplicado = useRef(false);
  /** Evita re-abrir el mismo deep-link (toast) tras cerrar el modal a mano / en curso. */
  const deepLinkKeyRef = useRef(null);
  const [ticketResaltado, setTicketResaltado] = useState(null);
  const [cargando, setCargando] = useState(true);

  // Secciones colapsables + "Ver más" en pestaña Sistema
  const [secSistemaAbierta, setSecSistemaAbierta] = useState({
    criticas: true, porVencer: true, stockBajo: true,
  });
  const [limiteSistema, setLimiteSistema] = useState({
    criticas: 20, porVencer: 20, stockBajo: 20,
  });

  // ================= ESTADOS DE DATOS DE BD =================
  const [rawLotes, setRawLotes] = useState([]);
  const [rawVentasPerdidas, setRawVentasPerdidas] = useState([]);
  const [preciosPorNombreVp, setPreciosPorNombreVp] = useState({});
  const [rawTickets, setRawTickets] = useState([]);
  const [diccionarios, setDiccionarios] = useState({ productos: [], sucursales: [], usuarios: [] });
  const [idsConMovimiento, setIdsConMovimiento] = useState(() => new Set());
  const [lotesSedeRespaldo, setLotesSedeRespaldo] = useState([]);
  const [sedeFiltroReab, setSedeFiltroReab] = useState('TODAS');

  // Filtros pestaña Ventas Perdidas (solo presentación — no cambian cómo se cargan los datos)
  const [filtroVpDesde, setFiltroVpDesde] = useState('');
  const [filtroVpHasta, setFiltroVpHasta] = useState('');
  const [busquedaVp, setBusquedaVp] = useState('');
  const [sedeFiltroVp, setSedeFiltroVp] = useState('TODAS');
  const [motivoFiltroVp, setMotivoFiltroVp] = useState('TODOS');

  // ================= ESTADOS DE MODALES Y ALERTAS =================
  const [showModalTicket, setShowModalTicket] = useState(false);
  const [ticketActivo, setTicketActivo] = useState(null);
  const [respuestaAdmin, setRespuestaAdmin] = useState('');
  const [guardandoTicket, setGuardandoTicket] = useState(false);
  const [resetandoClave, setResetandoClave] = useState(false);

  // Estados para procesamiento de devoluciones
  const [ventaDev, setVentaDev] = useState(null);        // venta encontrada
  const [detallesDev, setDetallesDev] = useState([]);    // items de la venta
  const [cantidadesDev, setCantidadesDev] = useState({}); // {id_producto: cantidad a devolver}
  const [buscandoVenta, setBuscandoVenta] = useState(false);
  const [procesandoDev, setProcesandoDev] = useState(false);
  const [tipoDev, setTipoDev] = useState('NOTA_CREDITO'); // ANULACION | NOTA_CREDITO

  const [loteDetalle, setLoteDetalle] = useState(null);
  const [ticketsNuevos, setTicketsNuevos] = useState(0); // badge nuevos tickets en tiempo real
  const canalTicketsRef = useRef(null);

  const [alertaSistema, setAlertaSistema] = useState(null);
  const alertOkBtnRef = useRef(null);
  useEffect(() => {
    if (alertaSistema && alertOkBtnRef.current) alertOkBtnRef.current.focus();
  }, [alertaSistema]);
  const mostrarAlerta = (mensaje, tipo = 'info', accionConfirmar = null, textoConfirmar = 'Aceptar', accionCancelar = null, textoCancelar = null) => {
    setAlertaSistema({ mensaje, tipo, accionConfirmar, textoConfirmar, accionCancelar, textoCancelar });
  };

  // ================= 1. CARGA DE DATOS =================
  const cargarDatos = async () => {
    setCargando(true);
    try {
      // Transición automática VIGENTE → VENCIDO si la fecha ya pasó (antes de
      // armar alertas). FEFO solo vende VIGENTE; Alertas sigue listando VENCIDO.
      await marcarLotesVencidos();

      const [resSuc, resUsu, resLotes, resVP, idsMov] = await Promise.all([
        supabase.from('sucursales').select('id_sucursal, nombre_comercial, activo'),
        supabase.from('usuarios').select('id_usuario, nombres, apellidos'),
        supabase.from('inventario_lotes').select('*').in('estado', ['VIGENTE', 'VENCIDO']).gt('cantidad_actual', 0),
        supabase.from('ventas_perdidas').select('*').order('created_at', { ascending: false }).limit(500),
        cargarIdsProductosConMovimiento(),
      ]);
      setIdsConMovimiento(idsMov);

      setRawLotes(resLotes.data || []);
      setRawVentasPerdidas(resVP.data || []);

      // Precios de catálogo por nombre exacto — solo para estimar valor perdido en KPIs.
      // ventas_perdidas no guarda id_producto; si el nombre no coincide, el estimado es 0.
      const nombresVp = [...new Set((resVP.data || []).map(v => v.nombre_producto).filter(Boolean))];
      if (nombresVp.length > 0) {
        const { data: prodsPrecio } = await supabase
          .from('productos')
          .select('descripcion, producto_precios(precio_venta)')
          .in('descripcion', nombresVp);
        const mapa = {};
        (prodsPrecio || []).forEach((p) => {
          const precio = Number(filaProductoPrecios(p.producto_precios)?.precio_venta) || 0;
          if (p.descripcion) mapa[p.descripcion] = precio;
        });
        setPreciosPorNombreVp(mapa);
      } else {
        setPreciosPorNombreVp({});
      }

      // Productos SOLO de los que aparecen en los lotes de arriba — no el catálogo
      // completo. PostgREST tiene un tope DURO de 1000 filas por request en el
      // servidor (un .limit() más alto pedido desde el cliente no lo levanta), y este
      // catálogo ya supera las 4000 filas: cualquier producto con id fuera de las
      // primeras 1000 quedaba fuera del diccionario y aparecía como "Desconocido" en
      // Reabastecimiento/Alertas, aunque el producto exista perfectamente en la BD.
      // Filtrar por los ids que realmente hacen falta (unas pocas decenas, no miles)
      // evita el tope de raíz en vez de intentar subirlo.
      const idsProductosNecesarios = [...new Set([
        ...(resLotes.data || []).map((l) => l.id_producto),
        ...idsMov,
      ])];
      const { data: resProd } = idsProductosNecesarios.length > 0
        ? await supabase.from('productos').select('id_producto, descripcion, codigo_barras, stock_minimo').in('id_producto', idsProductosNecesarios)
        : { data: [] };

      const idsConVigente = new Set(
        (resLotes.data || []).filter((l) => l.estado === 'VIGENTE').map((l) => Number(l.id_producto))
      );
      const idsSinVigente = [...idsMov].filter((id) => !idsConVigente.has(Number(id)));
      setLotesSedeRespaldo(await cargarLotesParaSede(idsSinVigente));

      setDiccionarios({
        productos: resProd || [],
        sucursales: (resSuc.data || []).filter(s => String(s.activo) === '1' || s.activo === true),
        sucursalesTodas: resSuc.data || [],
        usuarios: resUsu.data || []
      });

      try {
        const { data: ticketsData, error: errTickets } = await supabase.from('tickets_soporte').select('*').order('created_at', { ascending: false });
        if (!errTickets) setRawTickets(ticketsData || []);
      } catch { console.warn("Tabla tickets_soporte no encontrada."); }

    } catch (error) {
      console.error("Error cargando alertas:", error);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargarDatos();

    // ⚡ Realtime: nuevos tickets del vendedor aparecen al instante
    canalTicketsRef.current = supabase
      .channel('admin-tickets-realtime')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'tickets_soporte'
      }, (payload) => {
        // Agregar el nuevo ticket al inicio de la lista sin recargar
        setRawTickets(prev => [payload.new, ...prev]);
        setTicketsNuevos(prev => prev + 1);
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'tickets_soporte'
      }, (payload) => {
        // Actualizar el ticket que fue respondido
        setRawTickets(prev =>
          prev.map(t => t.id_ticket === payload.new.id_ticket ? { ...t, ...payload.new } : t)
        );
      })
      .subscribe();

    return () => {
      if (canalTicketsRef.current) supabase.removeChannel(canalTicketsRef.current);
    };
  }, []);

  // ================= 2. PROCESAMIENTO DE ALERTAS DE SISTEMA =================
  // Críticas / Por vencer por lote; Stock bajo agrupado por producto (calcularProductosStockBajo).
  const alertasSistemaGrupos = useMemo(() => {
    const criticas = [];
    const porVencer = [];

    rawLotes.forEach(lote => {
      const prodObj = diccionarios.productos.find(p => Number(p.id_producto) === Number(lote.id_producto));
      const sucObj = diccionarios.sucursales.find(s => Number(s.id_sucursal) === Number(lote.id_sucursal));
      const nombreProd = prodObj ? prodObj.descripcion : 'Producto Desconocido';
      const sede = sucObj ? sucObj.nombre_comercial : 'Sede no especificada';
      const cantActual = Number(lote.cantidad_actual || 0);

      if (!lote.fecha_vencimiento) return;
      const diasRestantes = diasHastaFecha(lote.fecha_vencimiento);
      if (diasRestantes == null) return;

      if (diasRestantes < 0 || lote.estado === 'VENCIDO') {
        const diasVencido = diasRestantes < 0 ? Math.abs(diasRestantes) : 0;
        criticas.push({
          id: `vencido-${lote.id_lote}`, tipo: 'CRITICO', accionId: 'RETIRAR',
          titulo: 'Vencido',
          nombreProd,
          sede,
          stockTotal: cantActual,
          nroLote: lote.nro_lote,
          diasVencido,
          linea: diasVencido > 0
            ? `${nombreProd} · Lote ${lote.nro_lote} · Venció hace ${diasVencido}d · ${cantActual} und · ${sede}`
            : `${nombreProd} · Lote ${lote.nro_lote} · Marcado vencido · ${cantActual} und · ${sede}`,
          accionPrimaria: 'Gestionar retiro',
          productoRef: prodObj,
          loteRef: {
            id_lote: lote.id_lote,
            nro_lote: lote.nro_lote,
            cantidad_actual: cantActual,
            id_sucursal: lote.id_sucursal,
            fecha_vencimiento: lote.fecha_vencimiento,
            estado: lote.estado,
          },
        });
      } else if (estaPorVencer(diasRestantes)) {
        porVencer.push({
          id: `porvencer-${lote.id_lote}`, tipo: 'ALERTA', accionId: 'VER_LOTE',
          titulo: 'Por vencer',
          nombreProd,
          sede,
          stockTotal: cantActual,
          nroLote: lote.nro_lote,
          linea: `${nombreProd} · Lote ${lote.nro_lote} · Vence en ${diasRestantes}d · ${cantActual} und · ${sede}`,
          accionPrimaria: 'Ver lote',
          diasRestantes,
          loteRef: { ...lote, nombreProd, sede, diasRestantes },
        });
      }
    });

    porVencer.sort((a, b) => (a.diasRestantes ?? 99) - (b.diasRestantes ?? 99));

    const lotesSede = [...rawLotes, ...lotesSedeRespaldo];
    const stockBajo = calcularProductosStockBajo(diccionarios.productos, rawLotes, idsConMovimiento)
      .map(item => {
        const { idSucursal, sede } = sedeStockItem(
          item, lotesSede, diccionarios.sucursales, diccionarios.sucursalesTodas,
        );
        const nombreProd = item.producto?.descripcion || 'Producto desconocido';
        const linea = sede
          ? `${item.stockTotal} und — ${nombreProd} · (mín. ${item.umbral}) · ${sede}`
          : `${item.stockTotal} und — ${nombreProd} · (mín. ${item.umbral})`;
        return {
          id: `stock-${item.id_producto}-${idSucursal ?? 'x'}`,
          tipo: 'ALERTA',
          accionId: 'COMPRAR',
          titulo: item.stockTotal === 0 ? 'Sin stock' : 'Stock bajo',
          nombreProd,
          sede,
          umbral: item.umbral,
          linea,
          accionPrimaria: 'Crear orden',
          productoRef: item.producto,
          stockTotal: item.stockTotal,
        };
      })
      .sort((a, b) => a.stockTotal - b.stockTotal);

    return { criticas, porVencer, stockBajo };
  }, [rawLotes, lotesSedeRespaldo, diccionarios, idsConMovimiento]);

  // ================= 3. PROCESAMIENTO VENTAS PERDIDAS =================
  const ventasPerdidasProcesadas = useMemo(() => {
    return rawVentasPerdidas.map(vp => {
      const sucObj = diccionarios.sucursales.find(s => Number(s.id_sucursal) === Number(vp.id_sucursal));
      const usuObj = diccionarios.usuarios.find(u => Number(u.id_usuario) === Number(vp.id_usuario));

      const nombreProd = vp.nombre_producto || 'No especificado';
      const nombreSede = sucObj ? sucObj.nombre_comercial : 'Sede desconocida';
      const nombreCajero = usuObj ? `${usuObj.nombres} ${usuObj.apellidos || ''}` : 'Usuario desconocido';
      const cant = Number(vp.cantidad_solicitada) || 1;
      const precioUnit = Number(preciosPorNombreVp[nombreProd]) || 0;
      const valorEstimado = cant * precioUnit;

      return {
        ...vp,
        nombreProd,
        nombreSede,
        nombreCajero,
        fechaVisual: vp.created_at,
        cantidadNum: cant,
        precioUnit,
        valorEstimado,
        motivoNorm: vp.motivo || 'Falta de stock',
      };
    });
  }, [rawVentasPerdidas, diccionarios, preciosPorNombreVp]);

  const sedesConDatosVp = useMemo(() => {
    const ids = new Set(ventasPerdidasProcesadas.map(v => Number(v.id_sucursal)).filter(Boolean));
    return diccionarios.sucursales.filter(s => ids.has(Number(s.id_sucursal)));
  }, [ventasPerdidasProcesadas, diccionarios.sucursales]);

  const ventasPerdidasFiltradas = useMemo(() => {
    const q = busquedaVp.trim().toLowerCase();
    return ventasPerdidasProcesadas.filter((vp) => {
      if (q && !(vp.nombreProd || '').toLowerCase().includes(q)) return false;
      if (sedeFiltroVp !== 'TODAS' && vp.nombreSede !== sedeFiltroVp) return false;
      if (motivoFiltroVp !== 'TODOS' && vp.motivoNorm !== motivoFiltroVp) return false;
      if (filtroVpDesde || filtroVpHasta) {
        if (!vp.fechaVisual) return false;
        const f = new Date(vp.fechaVisual);
        if (filtroVpDesde && f < new Date(filtroVpDesde + 'T00:00:00')) return false;
        if (filtroVpHasta && f > new Date(filtroVpHasta + 'T23:59:59')) return false;
      }
      return true;
    });
  }, [ventasPerdidasProcesadas, busquedaVp, sedeFiltroVp, motivoFiltroVp, filtroVpDesde, filtroVpHasta]);

  const kpiVp = useMemo(() => {
    const totalRegistros = ventasPerdidasFiltradas.length;
    const totalUnidades = ventasPerdidasFiltradas.reduce((s, v) => s + v.cantidadNum, 0);
    const valorEstimado = ventasPerdidasFiltradas.reduce((s, v) => s + v.valorEstimado, 0);
    const porProducto = {};
    ventasPerdidasFiltradas.forEach((v) => {
      const key = v.nombreProd;
      if (!porProducto[key]) porProducto[key] = { nombre: key, unidades: 0, veces: 0 };
      porProducto[key].unidades += v.cantidadNum;
      porProducto[key].veces += 1;
    });
    const top = Object.values(porProducto).sort((a, b) => b.unidades - a.unidades || b.veces - a.veces)[0] || null;
    return { totalRegistros, totalUnidades, valorEstimado, top };
  }, [ventasPerdidasFiltradas]);

  const hayFiltrosVpActivos = !!(
    busquedaVp.trim() || filtroVpDesde || filtroVpHasta
    || sedeFiltroVp !== 'TODAS' || motivoFiltroVp !== 'TODOS'
  );

  // ================= 4. PROCESAMIENTO TICKETS SOPORTE =================
  const ticketsProcesados = useMemo(() => {
    return rawTickets.map(t => {
      const usuObj = diccionarios.usuarios.find(u => Number(u.id_usuario) === Number(t.id_usuario));
      return { ...t, nombreRemitente: usuObj ? `${usuObj.nombres} ${usuObj.apellidos || ''}` : 'Usuario desconocido' };
    });
  }, [rawTickets, diccionarios]);

  // ================= 4. PROCESAMIENTO REABASTECIMIENTO =================
  // calcularProductosStockBajo: VIGENTE, stock_minimo o 3, solo productos con movimiento.
  const reabastecimientoData = useMemo(() => {
    const lotesSede = [...rawLotes, ...lotesSedeRespaldo];
    return calcularProductosStockBajo(diccionarios.productos, rawLotes, idsConMovimiento)
      .map(item => {
        const { sede } = sedeStockItem(
          item, lotesSede, diccionarios.sucursales, diccionarios.sucursalesTodas,
        );
        return {
          ...item,
          nombreProd: item.producto?.descripcion || 'Desconocido',
          codigoProd: item.producto?.codigo_barras || '',
          sede,
          criticidad: item.stockTotal === 0 ? 'SIN_STOCK'
            : item.stockTotal <= 5  ? 'CRITICO'
            : item.stockTotal <= 10 ? 'BAJO'
            : 'ADVERTENCIA',
          color: item.stockTotal === 0 ? '#dc2626'
            : item.stockTotal <= 5  ? '#ea580c'
            : item.stockTotal <= 10 ? '#d97706'
            : '#ca8a04',
        };
      })
      .sort((a, b) => {
        const p = { SIN_STOCK: 0, CRITICO: 1, BAJO: 2, ADVERTENCIA: 3 };
        return p[a.criticidad] - p[b.criticidad];
      });
  }, [rawLotes, lotesSedeRespaldo, diccionarios, idsConMovimiento]);

  const reabFiltrado = useMemo(() => {
    if (sedeFiltroReab === 'TODAS') return reabastecimientoData;
    return reabastecimientoData.filter(r => r.sede === sedeFiltroReab);
  }, [reabastecimientoData, sedeFiltroReab]);

  const kpiReab     = reabastecimientoData.filter(r => r.criticidad === 'SIN_STOCK' || r.criticidad === 'CRITICO').length;
  const kpiCriticas = alertasSistemaGrupos.criticas.length;
  const kpiAlertas  = alertasSistemaGrupos.porVencer.length + alertasSistemaGrupos.stockBajo.length;
  const kpiTickets  = rawTickets.filter(t => (t.estado || '').toUpperCase() === 'PENDIENTE').length;

  // ================= LÓGICA DE NAVEGACIÓN Y ACCIONES =================
  const ejecutarAccionPrimaria = (alerta) => {
    if (alerta.accionId === 'RETIRAR') {
      const lote = alerta.loteRef;
      navigate('/admin-toma-inventario', {
        state: {
          vista: 'nota-salida',
          retiroVencido: {
            id_producto: alerta.productoRef?.id_producto,
            descripcion: alerta.productoRef?.descripcion,
            id_lote: lote?.id_lote,
            nro_lote: lote?.nro_lote,
            cantidad: Number(lote?.cantidad_actual || 0),
            id_sucursal: lote?.id_sucursal,
          },
        },
      });
    }
    else if (alerta.accionId === 'COMPRAR') {
      // Stock crítico = mercadería aún no pedida al proveedor, mismo caso que
      // Reabastecimiento → va a Pedidos (armar un pedido futuro), no a Compras
      // (que registra mercadería ya recibida). Mismo shape que ya espera el efecto
      // de precarga de AdminPedidos.jsx (productoPredefinido: {id_producto, descripcion}).
      navigate('/admin-pedidos', { state: { productoPredefinido: { id_producto: alerta.productoRef?.id_producto, descripcion: alerta.productoRef?.descripcion } } });
    }
    else if (alerta.accionId === 'VER_LOTE') {
      setLoteDetalle(alerta.loteRef);
    }
  };

  const abrirTicket = (ticket) => {
    setTicketActivo(ticket);
    setRespuestaAdmin(ticket.respuesta_admin || '');
    // Reset devolución state
    setVentaDev(null); setDetallesDev([]); setCantidadesDev({}); setTipoDev('NOTA_CREDITO');
    setShowModalTicket(true);
  };

  /** Cierra el modal y limpia el deep-link del toast/campana para que un UPDATE realtime no lo reabra. */
  const cerrarModalTicket = () => {
    pendingTicketIdRef.current = null;
    deepLinkTicketAplicado.current = true;
    deepLinkKeyRef.current = null;
    setShowModalTicket(false);
    setTicketActivo(null);
    if (location.state?.ticketId != null || location.state?.deepLinkNonce != null) {
      navigate(location.pathname + (location.search || ''), {
        replace: true,
        state: { tab: location.state?.tab || activeTab || 'SOPORTE' },
      });
    }
  };

  const marcarTicketEnCurso = async (ticket) => {
    if (!ticket?.id_ticket) return;
    const est = (ticket.estado || '').toUpperCase();
    if (est === 'RESUELTO' || est === 'EN PROCESO') return;
    try {
      // Cortar deep-link ANTES del update: el realtime UPDATE refresca la lista y
      // si location.state aún tiene ticketId, el effect volvía a abrir el modal.
      pendingTicketIdRef.current = null;
      deepLinkTicketAplicado.current = true;

      const { error } = await supabase
        .from('tickets_soporte')
        .update({ estado: 'EN PROCESO' })
        .eq('id_ticket', ticket.id_ticket);
      if (error) throw error;

      setRawTickets(prev =>
        prev.map(t => t.id_ticket === ticket.id_ticket ? { ...t, estado: 'EN PROCESO' } : t)
      );
      cerrarModalTicket();
      cerrarToastTicketAdmin(ticket.id_ticket);

      await notificarTicketEnCursoVendedor({
        id_usuario: ticket.id_usuario,
        id_ticket: ticket.id_ticket,
        asunto: ticket.asunto,
      });
    } catch (err) {
      mostrarAlerta('Error al marcar en curso: ' + err.message, 'error');
    }
  };

  // Deep-link: toast / campana / notif → tab SOPORTE + abrir ticket
  useEffect(() => {
    const st = location.state || {};
    const params = new URLSearchParams(location.search);
    const tab = st.tab || params.get('tab');
    const ticketId = st.ticketId ?? params.get('ticketId');
    if (tab) setActiveTab(tab);
    if (ticketId != null && ticketId !== '') {
      const key = `${ticketId}:${st.deepLinkNonce ?? ''}`;
      // Solo re-armar el deep-link si es una navegación nueva (toast/campana),
      // no si el state residual es el mismo ticket ya abierto/cerrado.
      if (deepLinkKeyRef.current !== key) {
        deepLinkKeyRef.current = key;
        pendingTicketIdRef.current = ticketId;
        deepLinkTicketAplicado.current = false;
      }
    }
  }, [location.state, location.search]);

  useEffect(() => {
    const id = pendingTicketIdRef.current;
    if (id == null || deepLinkTicketAplicado.current || ticketsProcesados.length === 0) return;
    const t = ticketsProcesados.find(x => Number(x.id_ticket) === Number(id));
    if (!t) return;
    deepLinkTicketAplicado.current = true;
    setActiveTab('SOPORTE');
    setTicketResaltado(Number(t.id_ticket));
    abrirTicket(t);
  }, [ticketsProcesados]);

  // Busca la venta por el número visible (SUNAT o NV01). Tickets viejos con B001-x
  // siguen resolviendo la misma venta vía ventas.serie+correlativo.
  const buscarVentaDevolucion = async (comprobante) => {
    setBuscandoVenta(true);
    try {
      const parsed = parsearBusquedaComprobante(comprobante);
      if (!parsed || parsed.modo !== 'serie-numero') {
        throw new Error('Formato inválido. Usa: NV01-10');
      }
      const ids = await resolverIdsVentaPorComprobante(supabase, comprobante);
      if (ids.length === 0) throw new Error(`No se encontró el comprobante ${comprobante}.`);

      const { data: venta, error: errV } = await supabase
        .from('ventas')
        .select('*, comprobantes_sunat(serie, numero)')
        .in('id_venta', ids)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (errV || !venta) throw new Error(`No se encontró el comprobante ${comprobante}.`);

      const { data: detalles, error: errD } = await supabase
        .from('venta_detalle').select('*, productos(descripcion)')
        .eq('id_venta', venta.id_venta);
      if (errD) throw errD;

      // Enriquecer con nombre del producto
      const detallesEnriquecidos = (detalles || []).map(d => ({
        ...d,
        nombreProducto: d.productos?.descripcion || ('Producto ' + d.id_producto)
      }));

      setVentaDev(venta);
      setDetallesDev(detallesEnriquecidos);
      // Inicializar cantidades al máximo (devolución total por defecto)
      const cantInicial = {};
      detallesEnriquecidos.forEach(d => { cantInicial[d.id] = d.cantidad; });
      setCantidadesDev(cantInicial);

      // Auto-detectar tipo: si es hoy -> anulación, si es otro día -> nota de crédito
      const hoyStr = new Date().toISOString().slice(0, 10);
      const ventaStr = (venta.created_at || '').slice(0, 10);
      setTipoDev(hoyStr === ventaStr ? 'ANULACION' : 'NOTA_CREDITO');
    } catch (err) {
      mostrarAlerta('Error buscando venta: ' + err.message, 'error');
    } finally { setBuscandoVenta(false); }
  };

  // Procesa la devolución: revierte stock + crea nota de crédito + cierra ticket
  const handleProcesarDevolucion = async () => {
    if (!ventaDev || !ticketActivo) return;
    const itemsADevolver = detallesDev.filter(d => (cantidadesDev[d.id] || 0) > 0);
    if (itemsADevolver.length === 0) return mostrarAlerta('Selecciona al menos un ítem a devolver.', 'warning');

    setProcesandoDev(true);
    try {
      const montoDevuelto = itemsADevolver.reduce((acc, d) => {
        const cant = cantidadesDev[d.id] || 0;
        return acc + (d.precio_unitario * cant);
      }, 0);

      // 1️⃣ Crear nota de crédito (usando nombres reales de la tabla)
      const { data: nota, error: errNota } = await supabase
        .from('notas_credito').insert({
          id_venta_referenciada: ventaDev.id_venta,
          id_sucursal: ventaDev.id_sucursal,
          tipo: tipoDev,
          motivo: JSON.parse(ticketActivo.descripcion).motivo || 'Devolución procesada por admin',
          total: montoDevuelto,
          estado_sunat: 'PENDIENTE',
          procesado_por: user.id_usuario,
          id_ticket: ticketActivo.id_ticket,
        }).select().single();
      if (errNota) throw errNota;

      // 2️⃣ Insertar detalle de nota
      const detalleNota = itemsADevolver.map(d => ({
        id_nc: nota.id_nc,
        id_producto: d.id_producto,
        nombre_producto: d.nombreProducto,
        cantidad_devuelta: cantidadesDev[d.id],
        precio_unitario: d.precio_unitario,
        subtotal_devuelto: d.precio_unitario * cantidadesDev[d.id],
      }));
      const { data: detNotaIns, error: errDetNota } = await supabase.from('nota_credito_detalle').insert(detalleNota).select();
      assertEscritura(detNotaIns, errDetNota, 'No se guardó el detalle de la nota de crédito.');
      if (detNotaIns.length !== detalleNota.length) {
        throw new Error(`Detalle de NC incompleto: se esperaban ${detalleNota.length} líneas.`);
      }

      // 3️⃣ Revertir stock (FEFO en reverso: agregar al primer lote vigente del producto)
      for (const d of itemsADevolver) {
        const cantRet = cantidadesDev[d.id];
        const { data: lotes, error: errLotes } = await supabase
          .from('inventario_lotes').select('id_lote, cantidad_actual')
          .eq('id_producto', d.id_producto)
          .eq('id_sucursal', ventaDev.id_sucursal)
          .in('estado', ['VIGENTE', 'AGOTADO'])
          .order('fecha_vencimiento', { ascending: true })
          .limit(1);
        if (errLotes) throw errLotes;
        if (lotes && lotes.length > 0) {
          const lote = lotes[0];
          const { data: loteUpd, error: errLote } = await supabase.from('inventario_lotes').update({
            cantidad_actual: lote.cantidad_actual + cantRet,
            estado: 'VIGENTE'
          }).eq('id_lote', lote.id_lote).select('id_lote');
          assertEscritura(loteUpd, errLote, `No se pudo reponer stock del producto "${d.nombreProducto}".`);
        }
        // Kardex de entrada por devolución
        const { data: kardexIns, error: errKardex } = await supabase.from('kardex_movimientos').insert({
          id_sucursal: ventaDev.id_sucursal,
          id_producto: d.id_producto,
          tipo: 'ENTRADA',
          cantidad: cantRet,
          id_lote: (lotes && lotes[0]) ? lotes[0].id_lote : null,
          id_usuario: user.id_usuario,
        }).select();
        assertEscritura(kardexIns, errKardex, `No se registró el kardex de devolución de "${d.nombreProducto}".`);
      }

      // 4️⃣ Actualizar estado de la venta
      const esTotal = itemsADevolver.length === detallesDev.length &&
        itemsADevolver.every(d => cantidadesDev[d.id] === d.cantidad);
      const { data: ventaUpd, error: errVenta } = await supabase.from('ventas').update({
        estado: esTotal ? 'ANULADA' : 'CON_NOTA_CREDITO'
      }).eq('id_venta', ventaDev.id_venta).select('id_venta');
      assertEscritura(ventaUpd, errVenta, 'No se actualizó el estado de la venta tras la devolución.');

      // 5️⃣ Cerrar el ticket
      const respDev = `Devolución procesada. ${tipoDev === 'ANULACION' ? 'Venta anulada' : 'Nota de crédito emitida'}. Monto devuelto: S/ ${montoDevuelto.toFixed(2)}.`;
      const { data: ticketUpd, error: errTicket } = await supabase.from('tickets_soporte').update({
        respuesta_admin: respDev,
        estado: 'RESUELTO'
      }).eq('id_ticket', ticketActivo.id_ticket).select('id_ticket');
      assertEscritura(ticketUpd, errTicket, 'No se pudo cerrar el ticket de soporte tras la devolución.');

      await notificarRespuestaTicketVendedor({
        id_usuario: ticketActivo.id_usuario,
        id_ticket: ticketActivo.id_ticket,
        asunto: ticketActivo.asunto,
        respuesta: respDev,
      });
      cerrarToastTicketAdmin(ticketActivo.id_ticket);

      mostrarAlerta(`Devolución procesada exitosamente. ${tipoDev === 'ANULACION' ? 'Venta anulada' : 'Nota de crédito N° ' + nota.id_nc + ' creada'}. Stock repuesto.`, 'success');
      cerrarModalTicket();
      cargarDatos();
    } catch (err) {
      mostrarAlerta('Error al procesar devolución: ' + err.message, 'error');
    } finally { setProcesandoDev(false); }
  };

  const handleResponderTicket = async (e) => {
    e.preventDefault();
    if (!respuestaAdmin.trim()) return mostrarAlerta("Escribe una respuesta para el usuario.", "warning");
    
    setGuardandoTicket(true);
    try {
      await supabase.from('tickets_soporte').update({ respuesta_admin: respuestaAdmin, estado: 'RESUELTO' }).eq('id_ticket', ticketActivo.id_ticket);
      await notificarRespuestaTicketVendedor({
        id_usuario: ticketActivo.id_usuario,
        id_ticket: ticketActivo.id_ticket,
        asunto: ticketActivo.asunto,
        respuesta: respuestaAdmin,
      });
      cerrarToastTicketAdmin(ticketActivo.id_ticket);
      mostrarAlerta("El ticket ha sido respondido y marcado como resuelto exitosamente.", "success");
      cerrarModalTicket();
      cargarDatos(); 
    } catch (error) { 
      mostrarAlerta("Error al guardar: " + error.message, "error"); 
    } finally { 
      setGuardandoTicket(false); 
    }
  };

  // 🔑 Restablece la clave del usuario a su DNI
  const handleResetearContrasena = async () => {
    if (!ticketActivo) return;
    setResetandoClave(true);
    try {
      // 1️⃣ Obtener el DNI del usuario que hizo el ticket
      const { data: usuData, error: usuErr } = await supabase
        .from('usuarios')
        .select('dni, nombres')
        .eq('id_usuario', ticketActivo.id_usuario)
        .single();
      if (usuErr || !usuData?.dni) throw new Error('No se pudo obtener el DNI del usuario.');

      // 2️⃣ Actualizar password_hash al DNI (hasheado) — antes escribía la columna
      // inexistente/incorrecta "clave" y el reset nunca afectaba el login.
      const nuevoHash = await hashPassword(usuData.dni);
      const { error: updErr } = await supabase
        .from('usuarios')
        .update({ password_hash: nuevoHash })
        .eq('id_usuario', ticketActivo.id_usuario);
      if (updErr) throw updErr;

      // 3️⃣ Cerrar el ticket con nota automática
      const respReset = `Contraseña restablecida correctamente. Tu nueva clave temporal es tu número de DNI (${usuData.dni}). Por seguridad, cámbiala en tu próximo ingreso.`;
      await supabase.from('tickets_soporte').update({
        respuesta_admin: respReset,
        estado: 'RESUELTO'
      }).eq('id_ticket', ticketActivo.id_ticket);

      await notificarRespuestaTicketVendedor({
        id_usuario: ticketActivo.id_usuario,
        id_ticket: ticketActivo.id_ticket,
        asunto: ticketActivo.asunto,
        respuesta: respReset,
      });
      cerrarToastTicketAdmin(ticketActivo.id_ticket);

      mostrarAlerta(`Listo. La contraseña de ${usuData.nombres} fue restablecida a su DNI (${usuData.dni}). Avísale que ya puede ingresar.`, 'success');
      cerrarModalTicket();
      cargarDatos();
    } catch (err) {
      mostrarAlerta('Error: ' + err.message, 'error');
    } finally {
      setResetandoClave(false);
    }
  };

  if (cargando) return <div className="admin-loading">Analizando diagnóstico del sistema...</div>;

  return (
    <div className="alertas-container">
      
      <AlertaSistemaModal alerta={alertaSistema} onClose={() => setAlertaSistema(null)} />

      {/* TABS NAVEGACIÓN */}
      <div className="alertas-tabs">
        <button className={`tab-btn ${activeTab === 'SISTEMA' ? 'active' : ''}`} onClick={() => setActiveTab('SISTEMA')}>Sistema</button>
        <button className={`tab-btn ${activeTab === 'REABASTECIMIENTO' ? 'active' : ''}`} onClick={() => setActiveTab('REABASTECIMIENTO')}>
          Reabastecimiento
          {kpiReab > 0 && <span className="tab-btn-badge tab-btn-badge-reab">{kpiReab}</span>}
        </button>
        <button className={`tab-btn ${activeTab === 'VENTAS_PERDIDAS' ? 'active' : ''}`} onClick={() => setActiveTab('VENTAS_PERDIDAS')}>Ventas Perdidas</button>
        <button
          className={`tab-btn ${activeTab === 'SOPORTE' ? 'active' : ''}`}
          onClick={() => { setActiveTab('SOPORTE'); setTicketsNuevos(0); }}
        >
          Tickets de Cajeros
          {kpiTickets > 0 && <span className="tab-btn-badge tab-btn-badge-soporte">{kpiTickets}</span>}
        </button>
      </div>

      {/* ================= PESTAÑA 1: SISTEMA ================= */}
      {activeTab === 'SISTEMA' && (
        <div className="tab-content fade-in">
          <div className="alertas-kpi-grid">
            <div className="akpi-card border-critico">
              <div className="akpi-icon"><UiIcon name="AlertTriangle" size={26} /></div>
              <div className="akpi-copy">
                <span className="akpi-label">Críticas</span>
                <h2 className="text-critico">{kpiCriticas}</h2>
                <span className="akpi-sub">vencidos / stock mínimo crítico</span>
              </div>
            </div>
            <div className="akpi-card border-alerta">
              <div className="akpi-icon"><UiIcon name="Timer" size={26} /></div>
              <div className="akpi-copy">
                <span className="akpi-label">Advertencias</span>
                <h2 className="text-alerta">{kpiAlertas}</h2>
                <span className="akpi-sub">próximos a vencer / stock bajo</span>
              </div>
            </div>
            <div className="akpi-card border-tickets">
              <div className="akpi-icon"><UiIcon name="MessageSquare" size={26} /></div>
              <div className="akpi-copy">
                <span className="akpi-label">Soporte</span>
                <h2 className="text-tickets">{kpiTickets}</h2>
                <span className="akpi-sub">tickets pendientes de respuesta</span>
              </div>
            </div>
          </div>

          {/* POPUP DE VER LOTE */}
          {loteDetalle && (
            <div className="modal-overlay-strict" role="dialog" aria-modal="true" data-keyboard-trap>
              <div className="modal-lote-card">
                <div className="ml-header">
                  <h3><UiIcon name="Package" size={15} /> Detalle de Lote</h3>
                  <button onClick={() => setLoteDetalle(null)}><UiIcon name="X" size={16} /></button>
                </div>
                <div className="ml-body">
                  <p><strong>Producto:</strong> {loteDetalle.nombreProd}</p>
                  <p><strong>Sede:</strong> {loteDetalle.sede}</p>
                  <p><strong>Nro Lote:</strong> <span className="badge-lote">{loteDetalle.nro_lote}</span></p>
                  <p><strong>Stock Físico:</strong> {loteDetalle.cantidad_actual} unidades</p>
                  <p><strong>Fecha Vencimiento:</strong> {formatearFechaPE(loteDetalle.fecha_vencimiento)}</p>
                  <p className="text-orange"><strong>Estado:</strong> Vence en {loteDetalle.diasRestantes} días</p>
                </div>
                <div className="ml-footer">
                  <button className="btn-tk-primary" onClick={() => setLoteDetalle(null)}>Entendido</button>
                </div>
              </div>
            </div>
          )}

          {(kpiCriticas + kpiAlertas) === 0 ? (
            <div className="empty-alertas"><UiIcon name="CheckCircle2" size={15} /> Sistema operando en condiciones óptimas.</div>
          ) : (
            <div className="alertas-secciones">
              {[
                { key: 'criticas', kicker: 'Urgente', titulo: 'Críticas', items: alertasSistemaGrupos.criticas },
                { key: 'porVencer', kicker: 'Vencimiento', titulo: 'Por vencer', items: alertasSistemaGrupos.porVencer },
                { key: 'stockBajo', kicker: 'Inventario', titulo: 'Stock bajo', items: alertasSistemaGrupos.stockBajo },
              ].map(sec => {
                const abierta = secSistemaAbierta[sec.key];
                const limite = limiteSistema[sec.key];
                const visibles = sec.items.slice(0, limite);
                return (
                  <div key={sec.key} className={`alerta-seccion alerta-seccion--${sec.key}`}>
                    <button
                      type="button"
                      className="alerta-seccion-head"
                      onClick={() => setSecSistemaAbierta(prev => ({ ...prev, [sec.key]: !prev[sec.key] }))}
                    >
                      <span className="alerta-seccion-title">
                        <span className="alerta-seccion-chevron">{abierta ? <UiIcon name="ChevronDown" size={14} /> : <UiIcon name="ChevronRight" size={14} />}</span>
                        <span className="alerta-seccion-copy">
                          <span className="alerta-seccion-kicker">{sec.kicker}</span>
                          <span className="alerta-seccion-name">{sec.titulo}</span>
                        </span>
                      </span>
                      <span className="alerta-seccion-count">{sec.items.length}</span>
                    </button>
                    {abierta && (
                      <div className="alertas-lista">
                        {sec.items.length === 0 ? (
                          <div className="alerta-seccion-empty">Sin alertas en esta sección</div>
                        ) : (
                          <>
                            {visibles.map(alerta => (
                              <FilaAlertaSistema
                                key={alerta.id}
                                alerta={alerta}
                                onAccion={ejecutarAccionPrimaria}
                              />
                            ))}
                            {sec.items.length > limite && (
                              <button
                                type="button"
                                className="alerta-ver-mas"
                                onClick={() => setLimiteSistema(prev => ({
                                  ...prev,
                                  [sec.key]: prev[sec.key] + 20,
                                }))}
                              >
                                Mostrar {Math.min(20, sec.items.length - limite)} más
                                <span className="alerta-ver-mas-rest">({sec.items.length - limite} restantes)</span>
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ================= PESTAÑA 2: REABASTECIMIENTO ================= */}
      {activeTab === 'REABASTECIMIENTO' && (
        <div className="tab-content fade-in">
          <div className="vp-header-box" style={{display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:'1rem'}}>
            <div>
              <h3><UiIcon name="Package" size={15} /> Reabastecimiento por Sede</h3>
              <p>Productos con stock por debajo del umbral mínimo (20 unds). Ordenados por criticidad.</p>
            </div>
            <div style={{display:'flex', alignItems:'center', gap:'0.5rem'}}>
              <label style={{fontSize:'0.82rem', fontWeight:600, color:'var(--lf-text-muted)'}}>Filtrar sede:</label>
              <select
                value={sedeFiltroReab}
                onChange={e => setSedeFiltroReab(e.target.value)}
                style={{padding:'0.4rem 0.7rem', borderRadius:'6px', border:'1px solid var(--lf-border)', fontSize:'0.85rem', background:'var(--lf-bg)', cursor:'pointer'}}
              >
                <option value="TODAS">Todas las sedes</option>
                {diccionarios.sucursales.map(s => (
                  <option key={s.id_sucursal} value={s.nombre_comercial}>{s.nombre_comercial}</option>
                ))}
              </select>
            </div>
          </div>

          {/* KPI STRIP */}
          <div style={{display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'0.8rem', marginBottom:'1.2rem'}}>
            {[['SIN_STOCK','Sin stock','#dc2626'],['CRITICO','Crítico (1-5)','#ea580c'],['BAJO','Bajo (6-10)','#d97706'],['ADVERTENCIA','Advertencia (11-20)','#ca8a04']].map(([key, label, color]) => (
              <div key={key} style={{background:'white', border:`2px solid ${color}`, borderRadius:'10px', padding:'0.8rem', textAlign:'center'}}>
                <div style={{fontWeight:800, fontSize:'1.6rem', color}}>
                  {reabFiltrado.filter(r => r.criticidad === key).length}
                </div>
                <div style={{fontSize:'0.75rem', color:'var(--lf-text-muted)', fontWeight:600}}>{label}</div>
              </div>
            ))}
          </div>

          {/* TABLA */}
          <div className="vp-table-wrapper">
            <table className="vp-table">
              <thead><tr>
                <th>PRODUCTO</th>
                <th>SEDE</th>
                <th className="text-center">STOCK ACTUAL</th>
                <th className="text-center">UMBRAL</th>
                <th className="text-center">ESTADO</th>
                <th className="text-center">ACCIÓN</th>
              </tr></thead>
              <tbody>
                {reabFiltrado.length === 0 ? (
                  <tr><td colSpan="6" className="empty-alertas"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><UiIcon name="CheckCircle2" size={15} /> Todos los productos tienen stock suficiente en {sedeFiltroReab === 'TODAS' ? 'todas las sedes' : sedeFiltroReab}.</span></td></tr>
                ) : (
                  reabFiltrado.map((item, i) => (
                    <tr key={i}>
                      <td>
                        <strong style={{color:'var(--lf-text)', display:'block'}}>{item.nombreProd}</strong>
                        {item.codigoProd && <small style={{color:'var(--lf-text-muted)'}}>Cód: {item.codigoProd}</small>}
                      </td>
                      <td style={{color:'#52525B', fontWeight:600}}>{item.sede || '—'}</td>
                      <td className="text-center">
                        <strong style={{fontSize:'1.1rem', color: item.color}}>
                          {item.stockTotal}
                        </strong>
                      </td>
                      <td className="text-center" style={{color:'var(--lf-text-muted)'}}>{item.umbral} unds</td>
                      <td className="text-center">
                        <span style={{
                          background: item.color + '20',
                          color: item.color,
                          padding:'3px 10px', borderRadius:'999px',
                          fontSize:'0.75rem', fontWeight:700,
                          display:'inline-flex', alignItems:'center', gap:4
                        }}>
                          {item.criticidad === 'SIN_STOCK' ? <><UiIcon name="Ban" size={12} /> Sin stock</>
                            : item.criticidad === 'CRITICO' ? <><UiIcon name="AlertCircle" size={12} /> Crítico</>
                            : item.criticidad === 'BAJO' ? <><UiIcon name="AlertTriangle" size={12} /> Bajo</>
                            : <><UiIcon name="AlertTriangle" size={12} /> Advertencia</>}
                        </span>
                      </td>
                      <td className="text-center">
                        <button
                          className="btn-al-primary"
                          onClick={() => navigate('/admin-pedidos', { state: { productoPredefinido: { id_producto: item.id_producto, descripcion: item.nombreProd } } })}
                          style={{fontSize:'0.8rem', padding:'0.35rem 0.8rem'}}
                        >
                          + Orden de compra
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ================= PESTAÑA 3 (antes 2): VENTAS PERDIDAS ================= */}
      {activeTab === 'VENTAS_PERDIDAS' && (
        <div className="tab-content fade-in">
          <div className="vp-header-box">
            <h3>Registro de Ventas Perdidas</h3>
            <p>Monitorea los productos que tus clientes buscan y no tienes en stock para optimizar las próximas compras.</p>
          </div>

          <div className="vp-panel">
            <div className="alertas-kpi-grid vp-kpi-grid">
              <div className="akpi-card border-critico">
                <div className="akpi-icon"><UiIcon name="TrendingDown" size={26} /></div>
                <div className="akpi-copy">
                  <span className="akpi-label">Total pérdidas</span>
                  <h2 className="text-critico">{kpiVp.totalRegistros}</h2>
                  <span className="akpi-sub">
                    {kpiVp.totalUnidades} und. en el período filtrado
                  </span>
                </div>
              </div>
              <div className="akpi-card border-alerta">
                <div className="akpi-icon"><UiIcon name="Package" size={26} /></div>
                <div className="akpi-copy">
                  <span className="akpi-label">Más solicitado</span>
                  <h2 className="text-alerta vp-kpi-producto" title={kpiVp.top?.nombre || ''}>
                    {kpiVp.top ? kpiVp.top.nombre : '—'}
                  </h2>
                  <span className="akpi-sub">
                    {kpiVp.top
                      ? `${kpiVp.top.unidades} und. · ${kpiVp.top.veces} registro${kpiVp.top.veces === 1 ? '' : 's'}`
                      : 'Sin datos en el filtro actual'}
                  </span>
                </div>
              </div>
              <div className="akpi-card border-tickets">
                <div className="akpi-icon"><UiIcon name="Banknote" size={26} /></div>
                <div className="akpi-copy">
                  <span className="akpi-label">Valor estimado</span>
                  <h2 className="text-tickets">
                    S/ {kpiVp.valorEstimado.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </h2>
                  <span className="akpi-sub">cantidad × precio de catálogo (si coincide el nombre)</span>
                </div>
              </div>
            </div>

            <div className="vp-filters-bar">
              <div className="vp-search-box">
                <span className="icon" aria-hidden="true"><UiIcon name="Search" size={16} /></span>
                <input
                  type="text"
                  placeholder="Buscar por nombre de producto..."
                  value={busquedaVp}
                  onChange={(e) => setBusquedaVp(e.target.value)}
                />
              </div>
              <div className="vp-date-filter">
                <label>Desde</label>
                <SmartDateInput value={filtroVpDesde} onChange={setFiltroVpDesde} />
              </div>
              <div className="vp-date-filter">
                <label>Hasta</label>
                <SmartDateInput value={filtroVpHasta} onChange={setFiltroVpHasta} />
              </div>
              {sedesConDatosVp.length > 1 && (
                <select
                  className="vp-select-sede"
                  value={sedeFiltroVp}
                  onChange={(e) => setSedeFiltroVp(e.target.value)}
                >
                  <option value="TODAS">Todas las sedes</option>
                  {sedesConDatosVp.map((s) => (
                    <option key={s.id_sucursal} value={s.nombre_comercial}>{s.nombre_comercial}</option>
                  ))}
                </select>
              )}
              <div className="vp-motivo-pills">
                <button
                  type="button"
                  className={`vp-pill ${motivoFiltroVp === 'TODOS' ? 'active' : ''}`}
                  onClick={() => setMotivoFiltroVp('TODOS')}
                >
                  Todos los motivos
                </button>
                {MOTIVOS_VENTA_PERDIDA.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`vp-pill ${motivoFiltroVp === m ? 'active' : ''}`}
                    onClick={() => setMotivoFiltroVp(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
              {hayFiltrosVpActivos && (
                <button
                  type="button"
                  className="vp-clear-filters"
                  onClick={() => {
                    setBusquedaVp('');
                    setFiltroVpDesde('');
                    setFiltroVpHasta('');
                    setSedeFiltroVp('TODAS');
                    setMotivoFiltroVp('TODOS');
                  }}
                >
                  Limpiar filtros
                </button>
              )}
            </div>

            <div className="vp-table-wrap-inner">
              {ventasPerdidasFiltradas.length === 0 ? (
                <div className="vp-empty-state">
                  <div className="vp-empty-icon" aria-hidden="true"><UiIcon name="Inbox" size={32} /></div>
                  <h4>
                    {ventasPerdidasProcesadas.length === 0
                      ? 'Aún no hay ventas perdidas registradas'
                      : 'Ningún resultado con estos filtros'}
                  </h4>
                  <p>
                    {ventasPerdidasProcesadas.length === 0
                      ? 'Cuando un cajero registre una venta perdida desde el POS o Ventas Perdidas, aparecerá aquí.'
                      : 'Prueba ampliar el rango de fechas, quitar el motivo o limpiar la búsqueda.'}
                  </p>
                  {hayFiltrosVpActivos && ventasPerdidasProcesadas.length > 0 && (
                    <button
                      type="button"
                      className="btn-al-primary"
                      onClick={() => {
                        setBusquedaVp('');
                        setFiltroVpDesde('');
                        setFiltroVpHasta('');
                        setSedeFiltroVp('TODAS');
                        setMotivoFiltroVp('TODOS');
                      }}
                    >
                      Ver todos los registros
                    </button>
                  )}
                </div>
              ) : (
                <table className="vp-table">
                  <thead>
                    <tr>
                      <th>FECHA</th>
                      <th>PRODUCTO SOLICITADO</th>
                      <th>MOTIVO DE PÉRDIDA</th>
                      <th>SEDE</th>
                      <th>CAJERO</th>
                      <th className="text-right">EST. S/</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ventasPerdidasFiltradas.map((vp) => (
                      <tr key={vp.id_vp || `${vp.fechaVisual}-${vp.nombreProd}-${vp.id_usuario}`}>
                        <td className="font-bold">
                          {vp.fechaVisual ? new Date(vp.fechaVisual).toLocaleDateString('es-PE') : '---'}
                        </td>
                        <td>
                          <strong className="text-dark">{vp.nombreProd}</strong><br />
                          <small className="text-muted">Cant. perdida: {vp.cantidadNum}</small>
                        </td>
                        <td><span className="badge-motivo">{vp.motivoNorm}</span></td>
                        <td className="text-muted font-bold">{vp.nombreSede}</td>
                        <td className="text-muted">{vp.nombreCajero}</td>
                        <td className="text-right font-bold">
                          {vp.valorEstimado > 0
                            ? `S/ ${vp.valorEstimado.toFixed(2)}`
                            : <span className="text-muted">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================= PESTAÑA 3: SOPORTE ================= */}
      {activeTab === 'SOPORTE' && (
        <div className="tab-content fade-in">
          
          {showModalTicket && ticketActivo && (
            <div className="modal-overlay-strict" role="dialog" aria-modal="true" data-keyboard-trap>
              <div className="ticket-modal-clean">
                <div className="tmc-header">
                  <h3>Atender Ticket #{ticketActivo.id_ticket}</h3>
                  <button onClick={cerrarModalTicket}><UiIcon name="X" size={16} /></button>
                </div>
                <div className="tmc-body">
                <div className="tmc-info">
                  <p><strong>Remitente:</strong> {ticketActivo.nombreRemitente}</p>
                  <p><strong>Asunto:</strong> {ticketActivo.asunto}</p>
                  <p>
                    <strong>Estado:</strong>{' '}
                    <span className={`badge-estado ${claseEstadoTicket(ticketActivo.estado)}`}>
                      {ticketActivo.estado || 'PENDIENTE'}
                    </span>
                  </p>
                  {ticketActivo.tipo !== 'Devolución' && (
                    <div className="tmc-mensaje">
                      <label>Detalle:</label>
                      <p>{ticketActivo.descripcion}</p>
                    </div>
                  )}
                  {(ticketActivo.estado || '').toUpperCase() === 'PENDIENTE' && (
                    <button
                      type="button"
                      className="btn-tk-en-curso"
                      onClick={() => marcarTicketEnCurso(ticketActivo)}
                    ><UiIcon name="Loader" size={15} /> Marcar en curso
                    </button>
                  )}
                </div>

                {/* ↩️ PANEL DEVOLUCIÓN */}
                {ticketActivo.asunto === 'Devolución' ? (() => {
                  let datosTicket = {};
                  try { datosTicket = JSON.parse(ticketActivo.descripcion); } catch { /* empty */ }
                  return (
                    <div style={{marginTop:'1rem'}}>
                      <div style={{background:'#fef2f2', border:'2px solid #fca5a5', borderRadius:'10px', padding:'1rem', marginBottom:'1rem'}}>
                        <p style={{fontWeight:700, color:'#991b1b', marginBottom:'0.3rem', display:'flex', alignItems:'center', gap:6}}><UiIcon name="Undo2" size={15} /> Solicitud de Devolución</p>
                        <p style={{fontSize:'0.85rem', color:'#7f1d1d'}}><strong>Comprobante:</strong> {datosTicket.comprobante || '—'}</p>
                        <p style={{fontSize:'0.85rem', color:'#7f1d1d'}}><strong>Motivo:</strong> {datosTicket.motivo || '—'}</p>
                      </div>

                      {/* Buscar venta si no está cargada */}
                      {!ventaDev ? (
                        <button
                          onClick={() => buscarVentaDevolucion(datosTicket.comprobante || '')}
                          disabled={buscandoVenta || ticketActivo.estado === 'RESUELTO'}
                          style={{width:'100%', padding:'0.7rem', background:'var(--lf-primary-dark)', color:'white', border:'none', borderRadius:'8px', fontWeight:700, cursor:'pointer'}}
                        >
                          {buscandoVenta ? 'Buscando...' : ticketActivo.estado === 'RESUELTO' ? 'Ya fue procesado' : <><UiIcon name="Search" size={15} /> Cargar venta y procesar</>}
                        </button>
                      ) : (
                        <>
                          {/* Info de la venta */}
                          <div style={{background:'#f0fdf4', border:'1px solid #86efac', borderRadius:'8px', padding:'0.7rem', marginBottom:'0.8rem', fontSize:'0.83rem'}}>
                            <strong>Venta encontrada:</strong> {etiquetaComprobanteVisible(ventaDev)} &nbsp;|&nbsp;
                            Total: S/ {Number(ventaDev.total).toFixed(2)} &nbsp;|&nbsp;
                            Fecha: {new Date(ventaDev.created_at).toLocaleDateString('es-PE')}
                          </div>

                          {/* Tipo de documento */}
                          <div style={{display:'flex', gap:'0.5rem', marginBottom:'0.8rem'}}>
                            {['ANULACION','NOTA_CREDITO'].map(t => (
                              <button key={t} type="button" onClick={() => setTipoDev(t)} style={{
                                flex:1, padding:'0.4rem', borderRadius:'6px', fontWeight:600, fontSize:'0.8rem',
                                border: tipoDev === t ? '2px solid var(--lf-primary-dark)' : '2px solid var(--lf-border)',
                                background: tipoDev === t ? 'var(--lf-primary-dark)' : 'var(--lf-bg)',
                                color: tipoDev === t ? 'white' : 'var(--lf-text-muted)', cursor:'pointer'
                              }}>
                                {t === 'ANULACION' ? <><UiIcon name="Ban" size={14} /> Anulación total</> : <><UiIcon name="FileText" size={14} /> Nota de crédito</>}
                              </button>
                            ))}
                          </div>

                          {/* Tabla de ítems con selector de cantidad */}
                          <table style={{width:'100%', borderCollapse:'collapse', marginBottom:'1rem', fontSize:'0.83rem'}}>
                            <thead><tr style={{background:'var(--lf-info-bg)'}}>
                              <th style={{padding:'6px 8px', textAlign:'left'}}>Producto</th>
                              <th style={{padding:'6px 8px', textAlign:'center'}}>Cant. vendida</th>
                              <th style={{padding:'6px 8px', textAlign:'center'}}>Cant. a devolver</th>
                            </tr></thead>
                            <tbody>
                              {detallesDev.map(d => (
                                <tr key={d.id} style={{borderBottom:'1px solid var(--lf-info-bg)'}}>
                                  <td style={{padding:'6px 8px'}}>{d.nombreProducto}</td>
                                  <td style={{padding:'6px 8px', textAlign:'center'}}>{d.cantidad}</td>
                                  <td style={{padding:'6px 8px', textAlign:'center'}}>
                                    <input type="number" min="0" max={d.cantidad}
                                      value={cantidadesDev[d.id] ?? d.cantidad}
                                      onChange={e => setCantidadesDev(prev => ({...prev, [d.id]: Math.min(Number(e.target.value), d.cantidad)}))}
                                      style={{width:'60px', textAlign:'center', border:'1px solid #E4E4E7', borderRadius:'4px', padding:'2px'}}
                                    />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>

                          <div style={{display:'flex', gap:'0.5rem'}}>
                            <button type="button" data-enter-skip="true" tabIndex={-1} onClick={() => setVentaDev(null)} style={{flex:1, padding:'0.6rem', background:'var(--lf-info-bg)', border:'1px solid var(--lf-border)', borderRadius:'8px', cursor:'pointer', fontWeight:600, color:'var(--lf-text-muted)'}}>
                              ← Cambiar comprobante
                            </button>
                            <button type="button" data-enter-primary="true" onClick={handleProcesarDevolucion} disabled={procesandoDev} style={{flex:2, padding:'0.6rem', background:'#dc2626', color:'white', border:'none', borderRadius:'8px', fontWeight:700, cursor:'pointer'}}>
                              {procesandoDev ? 'Procesando...' : <><UiIcon name="Undo2" size={15} /> Confirmar devolución</>}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })() : ticketActivo.asunto === 'Recuperación de contraseña' ? (
                  <div style={{
                    background: '#fffbeb', border: '2px solid #f59e0b', borderRadius: '10px',
                    padding: '1.2rem', marginTop: '1rem'
                  }}>
                    <p style={{ fontWeight: 700, color: '#92400e', marginBottom: '0.5rem' }}><UiIcon name="Key" size={15} /> Solicitud de Recuperación de Contraseña
                    </p>
                    <p style={{ fontSize: '0.85rem', color: '#78350f', marginBottom: '1rem' }}>
                      Al hacer clic, la clave del usuario será restablecida a su <strong>número de DNI</strong> como contraseña temporal.
                      Avísale al usuario (verbalmente o por WhatsApp) que ya puede ingresar con su DNI.
                    </p>
                    <button
                      onClick={handleResetearContrasena}
                      disabled={resetandoClave || ticketActivo.estado === 'RESUELTO'}
                      style={{
                        background: ticketActivo.estado === 'RESUELTO' ? '#d1d5db' : '#f59e0b',
                        color: ticketActivo.estado === 'RESUELTO' ? '#6b7280' : '#fff',
                        border: 'none', borderRadius: '8px', padding: '0.7rem 1.5rem',
                        fontWeight: 700, fontSize: '0.95rem', cursor: ticketActivo.estado === 'RESUELTO' ? 'default' : 'pointer',
                        width: '100%'
                      }}
                    >
                      {ticketActivo.estado === 'RESUELTO'
                        ? 'Ya fue procesado'
                        : resetandoClave ? 'Procesando...' : <><UiIcon name="Key" size={15} /> Restablecer contraseña al DNI</>}
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleResponderTicket} className="tmc-form">
                    <label>Tu respuesta (La verá el cajero en su sistema):</label>
                    <textarea rows="4" required placeholder="Escribe la solución..." value={respuestaAdmin} onChange={e => setRespuestaAdmin(e.target.value)}></textarea>
                    <div className="tmc-footer">
                      <button type="button" className="btn-tk-cancel" data-enter-skip="true" tabIndex={-1} onClick={cerrarModalTicket}>Cancelar</button>
                      <button type="submit" className="btn-tk-primary" disabled={guardandoTicket}>{guardandoTicket ? '...' : 'Enviar y Marcar Resuelto'}</button>
                    </div>
                  </form>
                )}
              </div>
              </div>
            </div>
          )}

          <div className="vp-header-box" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3>Bandeja de Tickets del Personal</h3>
              <p>Atiende las solicitudes y problemas que envían tus cajeros.</p>
            </div>
            <button
              onClick={cargarDatos}
              style={{ background: 'var(--lf-info-bg)', border: '1px solid var(--lf-border)', borderRadius: '8px', padding: '0.4rem 0.9rem', fontSize: '0.82rem', fontWeight: 600, color: '#52525B', cursor: 'pointer' }}
            ><UiIcon name="RefreshCw" size={15} /> Actualizar
            </button>
          </div>

          {ticketsNuevos > 0 && activeTab === 'SOPORTE' && (
            <div style={{
              background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: '8px',
              padding: '0.7rem 1rem', marginBottom: '1rem',
              fontSize: '0.85rem', color: '#92400e', fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: '0.5rem'
            }}>
              <UiIcon name="Bell" size={15} /> {ticketsNuevos} nuevo(s) ticket(s) acaban de llegar en tiempo real
              <button onClick={() => setTicketsNuevos(0)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#92400e', fontWeight: 700 }}><UiIcon name="X" size={16} /></button>
            </div>
          )}
          <div className="vp-table-wrapper">
            <table className="vp-table">
              <thead><tr><th>FECHA</th><th>REMITENTE</th><th>ASUNTO</th><th className="text-center">URGENCIA</th><th className="text-center">ESTADO</th><th className="text-center">ACCIÓN</th></tr></thead>
              <tbody>
                {ticketsProcesados.length === 0 ? (
                  <tr><td colSpan="6" className="empty-alertas">No hay tickets registrados en la bandeja.</td></tr>
                ) : (
                  ticketsProcesados.map(t => (
                    <tr
                      key={t.id_ticket}
                      className={Number(t.id_ticket) === Number(ticketResaltado) ? 'ticket-row-resaltado' : undefined}
                    >
                      <td className="font-bold text-muted">{new Date(t.created_at || t.fecha_creacion).toLocaleDateString('es-PE')}</td>
                      <td><strong className="text-dark">{t.nombreRemitente}</strong></td>
                      <td>{t.asunto}</td>
                      <td className="text-center"><span className={`badge-urgencia u-${(t.prioridad || t.nivel_urgencia || 'BAJA').toLowerCase()}`}>{t.prioridad || t.nivel_urgencia || 'BAJA'}</span></td>
                      <td className="text-center"><span className={`badge-estado ${claseEstadoTicket(t.estado)}`}>{t.estado || 'PENDIENTE'}</span></td>
                      <td className="text-center" style={{ whiteSpace: 'nowrap' }}>
                        {(t.estado || '').toUpperCase() === 'PENDIENTE' && (
                          <button
                            type="button"
                            className="btn-en-curso-tk"
                            onClick={() => marcarTicketEnCurso(t)}
                            title="Marcar como En proceso"
                          >
                            En curso
                          </button>
                        )}
                        {' '}
                        <button className="btn-responder-tk" onClick={() => abrirTicket(t)}>
                          {t.estado === 'RESUELTO' ? 'Ver / Editar' : 'Responder'}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
}