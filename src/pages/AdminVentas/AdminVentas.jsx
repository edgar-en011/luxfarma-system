import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import { anularVenta, precheckAnulacion } from '../../utils/ventasAjustes';
import { etiquetaComprobanteVisible, parsearBusquedaComprobante, resolverIdsVentaPorComprobante } from '../../utils/comprobanteVisible';
import { contarTurnosUnicos, ordenarVentasPorTurno, labelTurno } from '../../utils/turnosVentas';
import { gananciaDesdeDetallesVenta } from '../../utils/productoPrecios';
import { reimprimirVentaPorId } from '../../utils/ticketPrint';
import { primerNombreTicket } from '../../utils/ticketFarmacia';
import {
  boundsISOPeru,
  fechaLocalStr,
  formatHora12AmPm,
  hoyLocal,
  NOMBRES_MES_ES,
} from '../../utils/fechas';
import {
  agregarPorAnio,
  agregarPorDia,
  agregarPorHoraYVendedor,
  agregarPorMes,
  anioMesActualLocal,
  fetchPrimeraFechaVenta,
  fetchVentasLigeras,
  kpisDesdeVentasLigeras,
  itemsAniosDesdeAgregado,
  itemsMesesDesdeAgregado,
  listaDiasIsoDelMes,
  rangoAnio,
  rangoMes,
  SELECT_VENTA_COMPLETA,
} from '../../utils/historialVentasExplorar';
import './AdminVentas.css';
import './AdminVentasExplorar.css';
import LogoCargandoOverlay from '../../components/LogoCargandoOverlay';
import FullScreenModal from '../../components/FullScreenModal';
import HistorialFiltros from './HistorialFiltros';
import ListaDiasMes from './ListaDiasMes';
import ListaAniosMeses from './ListaAniosMeses';
import PanelDiaVentas from './PanelDiaVentas';
import UiIcon from '../../components/UiIcon';
import { esRolOperativo } from '../../utils/roles';
import { nubefactIpcDisponible } from '../../services/nubefactService';

/* Paleta con mejor contraste para barras apiladas / ranking */
const AVATAR_COLORS = [
  '#012B63', '#2563eb', '#0ea5e9', '#14b8a6',
  '#22c55e', '#eab308', '#f97316', '#ef4444',
  '#a855f7', '#ec4899',
];

/** Inicial + primer apellido, con trim (evita ". CABRERA" si nombres viene con espacio inicial). */
function etiquetaCajero(nombres, apellidos) {
  const inicial = primerNombreTicket(nombres).charAt(0);
  const primerApellido = primerNombreTicket(apellidos);
  return `${inicial}. ${primerApellido}`;
}

export default function AdminVentas() {
  const [loading, setLoading] = useState(true);
  const [ventas, setVentas] = useState([]);
  // 'rango' = chips clásicos; 'mes' | 'todo' = explorador
  const [modo, setModo] = useState('rango');
  const [filtroRapido, setFiltroRapido] = useState('Hoy');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [aplicandoRango, setAplicandoRango] = useState(false);
  const [msgRangoFecha, setMsgRangoFecha] = useState(null);

  const actual = anioMesActualLocal();
  const [anioMes, setAnioMes] = useState(actual.anio);
  const [mesSel, setMesSel] = useState(actual.mes);
  const [diasMes, setDiasMes] = useState([]);
  const [ventasMesLigeras, setVentasMesLigeras] = useState([]);
  const [cargandoMes, setCargandoMes] = useState(false);
  const [diaSeleccionado, setDiaSeleccionado] = useState(null);
  const [ventasDelDia, setVentasDelDia] = useState([]);
  const [cargandoDia, setCargandoDia] = useState(false);

  // Todo el tiempo: anios → meses → dias
  const [todoNivel, setTodoNivel] = useState('anios'); // 'anios' | 'meses' | 'dias'
  const [anioTodo, setAnioTodo] = useState(null);
  const [mesTodo, setMesTodo] = useState(null);
  const [itemsAnios, setItemsAnios] = useState([]);
  const [itemsMeses, setItemsMeses] = useState([]);
  const [kpisTodo, setKpisTodo] = useState({ total: 0, operaciones: 0, ticketPromedio: 0 });
  const [cargandoTodo, setCargandoTodo] = useState(false);
  const [primeraFechaVenta, setPrimeraFechaVenta] = useState(null);
  const [aniosDisponibles, setAniosDisponibles] = useState([actual.anio]);
  const cargarExplorarIdRef = useRef(0);
  // Red de seguridad "última petición gana": si llegan a superponerse dos llamadas a
  // cargarVentas (ej. filtro rápido + Aplicar casi al mismo tiempo), solo se aplica el
  // resultado de la que se inició más recientemente, descartando respuestas obsoletas
  // sin importar el orden en que resuelvan.
  const cargarVentasIdRef = useRef(0);
  const [paginaActual, setPaginaActual] = useState(1);
  const [filasPorPagina, setFilasPorPagina] = useState(10);
  const [ventaSeleccionada, setVentaSeleccionada] = useState(null);
  const [detallesVenta, setDetallesVenta] = useState([]);
  const [pagosVenta, setPagosVenta] = useState([]);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [reimprimiendoId, setReimprimiendoId] = useState(null);

  const [sucursales, setSucursales] = useState([]);
  const [filtroSucursal, setFiltroSucursal] = useState('todas');
  const [filtroVendedor, setFiltroVendedor] = useState('todos');

  const [vendedores, setVendedores] = useState([]);
  const [mostrarVendedores, setMostrarVendedores] = useState(false);
  const [vendedorExpandido, setVendedorExpandido] = useState(null);
  const [ventasVendedor, setVentasVendedor] = useState([]);
  const [_turnosActivos, setTurnosActivos] = useState(new Set());
  const [mostrarGanancia, setMostrarGanancia] = useState(false);

  const [ventaAAnular, setVentaAAnular] = useState(null);
  const [motivoAnulacion, setMotivoAnulacion] = useState('Error en la emisión');
  const [anulando, setAnulando] = useState(false);
  const [anulacionExitosa, setAnulacionExitosa] = useState(false);
  const [msgAnulacion, setMsgAnulacion] = useState(null);

  // ── Aviso de "venta anterior al fix de factor" (ver ventasAjustes.js/precheckAnulacion)
  // — se calcula apenas se abre el modal de anulación; si aplica, el checkbox "Entiendo"
  // gatea el botón Confirmar, así es imposible saltárselo sin leerlo. ──
  const [avisoAnulacion, setAvisoAnulacion] = useState(null);
  const [cargandoAviso, setCargandoAviso] = useState(false);
  const [avisoLeido, setAvisoLeido] = useState(false);

  useEffect(() => {
    if (!ventaAAnular) {
      setAvisoAnulacion(null);
      setAvisoLeido(false);
      return;
    }
    let cancelado = false;
    setCargandoAviso(true);
    precheckAnulacion({ venta: ventaAAnular }).then(resultado => {
      if (!cancelado) { setAvisoAnulacion(resultado); setCargandoAviso(false); }
    });
    return () => { cancelado = true; };
  }, [ventaAAnular]);

  // ── Buscar por N° de boleta/factura — independiente del período: consulta directo a
  // Supabase por el número visible (SUNAT o NV01), así encuentra un comprobante
  // aunque esté fuera del rango Desde/Hasta seleccionado. null = no está buscando.
  const [busquedaComprobante, setBusquedaComprobante] = useState('');
  const [resultadosBusquedaComprobante, setResultadosBusquedaComprobante] = useState(null);
  const [buscandoComprobante, setBuscandoComprobante] = useState(false);

  const motivosAnulacion = [
    'Error en la emisión',
    'Devolución del cliente',
    'Producto equivocado',
    'Precio incorrecto',
    'Solicitud del cliente',
    'Otro',
  ];

  useEffect(() => {
    if (modo !== 'rango') return;
    if (filtroRapido === 'Personalizado') return;

    const hoy = new Date();
    let desde = new Date();
    let hasta = new Date();

    if (filtroRapido === 'Hoy') {
      desde = new Date(hoy);
      hasta = new Date(hoy);
    } else if (filtroRapido === 'Ayer') {
      desde = new Date(hoy);
      desde.setDate(hoy.getDate() - 1);
      hasta = new Date(desde);
    } else if (filtroRapido === 'Esta semana') {
      desde = new Date(hoy);
      desde.setDate(hoy.getDate() - 6);
      hasta = new Date(hoy);
    } else if (filtroRapido === 'Este mes') {
      desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
      hasta = new Date(hoy);
    } else if (filtroRapido === 'Mes pasado') {
      desde = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
      hasta = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
    }

    setFechaDesde(fechaLocalStr(desde));
    setFechaHasta(fechaLocalStr(hasta));
  }, [filtroRapido, modo]);

  // Solo auto-carga en modo rango + filtro rápido (no Personalizado).
  useEffect(() => {
    if (modo !== 'rango') return;
    if (filtroRapido === 'Personalizado') return;
    if (fechaDesde && fechaHasta) cargarVentas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fechaDesde, fechaHasta, modo]);

  const enriquecerVentas = (ventasRaw, usuariosData, sucursalesData, nombresElecMap = {}) => {
    return (ventasRaw || []).map((v) => {
      let metodoStr = 'Efectivo';
      if (v.pagos_venta?.length > 1) metodoStr = 'Mixto';
      else if (v.pagos_venta?.length === 1) {
        const m = v.pagos_venta[0].metodo;
        metodoStr = m.charAt(0).toUpperCase() + m.slice(1).toLowerCase();
      }
      const userObj = usuariosData.find((u) => u.id_usuario === v.id_usuario_vendedor);
      const nombreCompleto = userObj
        ? `${userObj.nombres || ''} ${userObj.apellidos || ''}`.trim()
        : `Vendedor #${v.id_usuario_vendedor}`;
      const cajero = userObj
        ? etiquetaCajero(userObj.nombres, userObj.apellidos)
        : 'N/A';
      const sucObj = sucursalesData.find((s) => s.id_sucursal === v.id_sucursal);
      const sucursal = sucObj ? sucObj.nombre_comercial : 'Sede Central';
      const cli = v.clientes;
      const nombreDesdeCliente = cli
        ? (`${cli.nombres || ''} ${cli.apellidos || ''}`.trim() || (cli.nombre_razon_social || '').trim())
        : '';
      const cliente = nombresElecMap[v.id_venta] || nombreDesdeCliente || 'Consumidor final';
      return {
        ...v,
        cliente,
        cajero,
        nombreCompleto,
        sucursal,
        metodoStr,
        ganancia: gananciaDesdeDetallesVenta(v.venta_detalle),
      };
    });
  };

  const cargarCatalogosBase = async () => {
    const [resUsuarios, resSucursales, resTurnos] = await Promise.all([
      supabase.from('usuarios').select('id_usuario, nombres, apellidos, id_rol, activo'),
      supabase.from('sucursales').select('id_sucursal, nombre_comercial, activo'),
      supabase.from('caja_turnos').select('id_usuario_vendedor').eq('estado', 'ABIERTO'),
    ]);
    const usuariosData = resUsuarios.data || [];
    const turnosSet = new Set((resTurnos.data || []).map((t) => t.id_usuario_vendedor));
    const sucursalesData = (resSucursales.data || []).filter((s) => String(s.activo) === '1' || s.activo === true);
    setTurnosActivos(turnosSet);
    setSucursales(sucursalesData);

    const trabajadoresMap = {};
    (usuariosData || []).forEach((u) => {
      if (esRolOperativo(u.id_rol) && (String(u.activo) === '1' || u.activo === true)) {
        const nombreCompleto = `${u.nombres || ''} ${u.apellidos || ''}`.trim();
        trabajadoresMap[u.id_usuario] = {
          id: u.id_usuario,
          nombre: nombreCompleto,
          cajero: etiquetaCajero(u.nombres, u.apellidos),
          total: 0,
          operaciones: 0,
          activo: turnosSet.has(u.id_usuario),
        };
      }
    });
    return { usuariosData, sucursalesData, turnosSet, trabajadoresMap };
  };

  const cargarVentas = async () => {
    const idLlamada = ++cargarVentasIdRef.current;
    setLoading(true);
    setVendedorExpandido(null);
    setVentasVendedor([]);
    setFiltroVendedor('todos');
    try {
      const { start, end } = boundsISOPeru(fechaDesde, fechaHasta);
      if (!start || !end) {
        console.error('Rango de fechas inválido, se omite la consulta:', { fechaDesde, fechaHasta });
        return;
      }

      const [resVentas, catalogos] = await Promise.all([
        supabase.from('ventas')
          .select(SELECT_VENTA_COMPLETA)
          .gte('created_at', start).lte('created_at', end).order('created_at', { ascending: false }),
        cargarCatalogosBase(),
      ]);
      const { usuariosData, sucursalesData, turnosSet, trabajadoresMap } = catalogos;

      if (idLlamada !== cargarVentasIdRef.current) return;

      const sucursalesActivasIds = new Set(sucursalesData.map((s) => s.id_sucursal));
      const ventasData = (resVentas.data || []).filter((v) => sucursalesActivasIds.has(v.id_sucursal));

      const idsVenta = ventasData.map((v) => v.id_venta);
      const { data: comprobantesElec } = idsVenta.length > 0
        ? await supabase.from('comprobantes_electronicos').select('id_venta, cliente_nombre').in('id_venta', idsVenta)
        : { data: [] };
      if (idLlamada !== cargarVentasIdRef.current) return;
      const nombresElecMap = {};
      (comprobantesElec || []).forEach((c) => {
        const n = (c.cliente_nombre || '').trim();
        if (n) nombresElecMap[c.id_venta] = n;
      });

      const ventasFormateadas = enriquecerVentas(ventasData, usuariosData, sucursalesData, nombresElecMap);
      ventasFormateadas.forEach((v) => {
        const idV = v.id_usuario_vendedor;
        if (!trabajadoresMap[idV]) {
          trabajadoresMap[idV] = {
            id: idV, nombre: v.nombreCompleto, cajero: v.cajero,
            total: 0, operaciones: 0, activo: turnosSet.has(idV),
          };
        }
        if (v.estado_anulacion !== 'ANULADO') {
          trabajadoresMap[idV].total += Number(v.total || 0);
          trabajadoresMap[idV].operaciones += 1;
        }
      });

      const ranking = Object.values(trabajadoresMap)
        .sort((a, b) => b.total - a.total)
        .map((t, i) => ({
          ...t,
          color: AVATAR_COLORS[i % AVATAR_COLORS.length],
          ticketPromedio: t.operaciones > 0 ? t.total / t.operaciones : 0,
        }));

      setVentas(ventasFormateadas);
      setVendedores(ranking);
      setPaginaActual(1);
    } catch (error) {
      console.error('Error cargando ventas:', error);
    } finally {
      if (idLlamada === cargarVentasIdRef.current) setLoading(false);
    }
  };

  const filtrosExplorar = useCallback(() => ({
    idSucursal: filtroSucursal === 'todas' ? null : filtroSucursal,
    idVendedor: filtroVendedor === 'todos' ? null : filtroVendedor,
  }), [filtroSucursal, filtroVendedor]);

  const publicarRankingVendedores = (trabajadoresMap, ligeras = []) => {
    (ligeras || []).forEach((v) => {
      if (v.estado_anulacion === 'ANULADO') return;
      const idV = v.id_usuario_vendedor;
      if (!trabajadoresMap[idV]) {
        trabajadoresMap[idV] = {
          id: idV, nombre: `Vendedor #${idV}`, cajero: 'N/A',
          total: 0, operaciones: 0, activo: false,
        };
      }
      trabajadoresMap[idV].total += Number(v.total || 0);
      trabajadoresMap[idV].operaciones += 1;
    });
    const ranking = Object.values(trabajadoresMap)
      .sort((a, b) => b.total - a.total)
      .map((t, i) => ({
        ...t,
        color: AVATAR_COLORS[i % AVATAR_COLORS.length],
        ticketPromedio: t.operaciones > 0 ? t.total / t.operaciones : 0,
      }));
    setVendedores(ranking);
  };

  const cargarListaMes = useCallback(async (anio, mes) => {
    const id = ++cargarExplorarIdRef.current;
    setCargandoMes(true);
    setDiaSeleccionado(null);
    setVentasDelDia([]);
    try {
      const { trabajadoresMap } = await cargarCatalogosBase();
      const { fechaDesde: d, fechaHasta: h } = rangoMes(anio, mes);
      const ligeras = await fetchVentasLigeras(supabase, {
        fechaDesde: d,
        fechaHasta: h,
        ...filtrosExplorar(),
      });
      if (id !== cargarExplorarIdRef.current) return;
      setVentasMesLigeras(ligeras);
      setDiasMes(agregarPorDia(ligeras, listaDiasIsoDelMes(anio, mes)));
      publicarRankingVendedores(trabajadoresMap, ligeras);
    } catch (err) {
      console.error('Error cargando mes:', err);
      if (id === cargarExplorarIdRef.current) {
        setVentasMesLigeras([]);
        setDiasMes(agregarPorDia([], listaDiasIsoDelMes(anio, mes)));
      }
    } finally {
      if (id === cargarExplorarIdRef.current) setCargandoMes(false);
    }
  }, [filtrosExplorar]);

  const cargarDiaCompleto = useCallback(async (fechaIso) => {
    const id = ++cargarExplorarIdRef.current;
    setCargandoDia(true);
    setDiaSeleccionado(fechaIso);
    try {
      const catalogos = await cargarCatalogosBase();
      const { start, end } = boundsISOPeru(fechaIso, fechaIso);
      let q = supabase
        .from('ventas')
        .select(SELECT_VENTA_COMPLETA)
        .gte('created_at', start)
        .lte('created_at', end)
        .order('created_at', { ascending: false });
      if (filtroSucursal !== 'todas') q = q.eq('id_sucursal', Number(filtroSucursal));
      if (filtroVendedor !== 'todos') q = q.eq('id_usuario_vendedor', Number(filtroVendedor));
      const { data, error } = await q;
      if (error) throw error;
      if (id !== cargarExplorarIdRef.current) return;

      const idsVenta = (data || []).map((v) => v.id_venta);
      const { data: elec } = idsVenta.length > 0
        ? await supabase.from('comprobantes_electronicos').select('id_venta, cliente_nombre').in('id_venta', idsVenta)
        : { data: [] };
      if (id !== cargarExplorarIdRef.current) return;
      const nombresElecMap = {};
      (elec || []).forEach((c) => {
        const n = (c.cliente_nombre || '').trim();
        if (n) nombresElecMap[c.id_venta] = n;
      });
      setVentasDelDia(enriquecerVentas(data || [], catalogos.usuariosData, catalogos.sucursalesData, nombresElecMap));
    } catch (err) {
      console.error('Error cargando día:', err);
      if (id === cargarExplorarIdRef.current) setVentasDelDia([]);
    } finally {
      if (id === cargarExplorarIdRef.current) setCargandoDia(false);
    }
  }, [filtroSucursal, filtroVendedor]);

  const cargarTodoAnios = useCallback(async () => {
    const id = ++cargarExplorarIdRef.current;
    setCargandoTodo(true);
    setTodoNivel('anios');
    setAnioTodo(null);
    setMesTodo(null);
    setDiaSeleccionado(null);
    setVentasDelDia([]);
    try {
      const { trabajadoresMap } = await cargarCatalogosBase();
      let primera = primeraFechaVenta;
      if (!primera) {
        primera = await fetchPrimeraFechaVenta(supabase);
        setPrimeraFechaVenta(primera);
      }
      if (!primera) {
        setItemsAnios([]);
        setKpisTodo({ total: 0, operaciones: 0, ticketPromedio: 0 });
        return;
      }
      const anioIni = Number(primera.slice(0, 4));
      const anioFin = Number(hoyLocal().slice(0, 4));
      setAniosDisponibles(Array.from({ length: anioFin - anioIni + 1 }, (_, i) => anioFin - i));

      const ligeras = await fetchVentasLigeras(supabase, {
        fechaDesde: primera,
        fechaHasta: hoyLocal(),
        ...filtrosExplorar(),
      });
      if (id !== cargarExplorarIdRef.current) return;
      setKpisTodo(kpisDesdeVentasLigeras(ligeras));
      setItemsAnios(itemsAniosDesdeAgregado(agregarPorAnio(ligeras)));
      publicarRankingVendedores(trabajadoresMap, ligeras);
    } catch (err) {
      console.error('Error cargando historial total:', err);
      if (id === cargarExplorarIdRef.current) {
        setItemsAnios([]);
        setKpisTodo({ total: 0, operaciones: 0, ticketPromedio: 0 });
      }
    } finally {
      if (id === cargarExplorarIdRef.current) setCargandoTodo(false);
    }
  }, [filtrosExplorar, primeraFechaVenta]);

  const cargarTodoMeses = useCallback(async (anio) => {
    const id = ++cargarExplorarIdRef.current;
    setCargandoTodo(true);
    setAnioTodo(anio);
    setMesTodo(null);
    setTodoNivel('meses');
    setDiaSeleccionado(null);
    setVentasDelDia([]);
    try {
      const { fechaDesde: d, fechaHasta: h } = rangoAnio(anio);
      const ligeras = await fetchVentasLigeras(supabase, {
        fechaDesde: d,
        fechaHasta: h,
        ...filtrosExplorar(),
      });
      if (id !== cargarExplorarIdRef.current) return;
      setItemsMeses(itemsMesesDesdeAgregado(agregarPorMes(ligeras, anio)));
    } catch (err) {
      console.error('Error cargando meses:', err);
      if (id === cargarExplorarIdRef.current) setItemsMeses([]);
    } finally {
      if (id === cargarExplorarIdRef.current) setCargandoTodo(false);
    }
  }, [filtrosExplorar]);

  useEffect(() => {
    if (modo === 'mes') cargarListaMes(anioMes, mesSel);
  }, [modo, anioMes, mesSel, filtroSucursal, filtroVendedor, cargarListaMes]);

  useEffect(() => {
    if (modo === 'todo' && todoNivel === 'anios') cargarTodoAnios();
  }, [modo, filtroSucursal, filtroVendedor]); // eslint-disable-line react-hooks/exhaustive-deps

  // La lógica de stock/kardex/Nubefact vive en src/utils/ventasAjustes.js
  // (anularVenta), compartida con la pantalla de Vendedor (MisVentas.jsx) — acá solo
  // queda el manejo de estado propio de esta pantalla (spinner, mensaje, actualizar la
  // fila local y la de resultados de búsqueda si estaba visible).
  const handleAnularVenta = async () => {
    if (!ventaAAnular) return;
    setAnulando(true);
    setAnulacionExitosa(false);
    setMsgAnulacion(null);

    const resultado = await anularVenta({ venta: ventaAAnular, motivo: motivoAnulacion });

    if (resultado.ok) {
      setVentas(prev => prev.map(v =>
        v.id_venta === ventaAAnular.id_venta
          ? { ...v, estado_anulacion: 'ANULADO', estado_sunat: 'ANULADO' }
          : v
      ));
      setResultadosBusquedaComprobante(prev => prev ? prev.map(v =>
        v.id_venta === ventaAAnular.id_venta
          ? { ...v, estado_anulacion: 'ANULADO', estado_sunat: 'ANULADO' }
          : v
      ) : prev);

      // El overlay a pantalla completa muestra el check verde ~1.1s y luego cierra TODO
      // de una — antes había un segundo cierre encadenado (banner chico + 2s extra
      // dentro del modal de confirmación, que quedaba detrás del overlay) que sumaba un
      // retraso adicional desconectado de este tiempo de exhibición configurado.
      setAnulacionExitosa(true);
      await new Promise(resolve => setTimeout(resolve, 1100));
      setAnulando(false);
      setAnulacionExitosa(false);
      setVentaAAnular(null);
      setMsgAnulacion(null);
      setMotivoAnulacion('Error en la emisión');
    } else {
      console.error('Error al anular venta:', resultado.error);
      setAnulando(false);
      setMsgAnulacion({ ok: false, texto: 'Error al anular: ' + resultado.error.message });
    }
  };

  // Búsqueda por el número visible (SUNAT B004-10, NV01-5). También resuelve el interno
  // B001-x si alguien lo escribe. Sin filtro de fecha: encuentra aunque esté fuera del período.
  const buscarComprobanteGlobal = async (texto) => {
    setBuscandoComprobante(true);
    try {
      const ids = await resolverIdsVentaPorComprobante(supabase, texto);
      if (ids.length === 0) {
        setResultadosBusquedaComprobante([]);
        return;
      }
      const [resVentas, resUsuarios, resSucursales] = await Promise.all([
        supabase.from('ventas')
          .select(SELECT_VENTA_COMPLETA)
          .in('id_venta', ids)
          .order('created_at', { ascending: false }),
        supabase.from('usuarios').select('id_usuario, nombres, apellidos'),
        supabase.from('sucursales').select('id_sucursal, nombre_comercial'),
      ]);
      const usuariosData = resUsuarios.data || [];
      const sucursalesData = resSucursales.data || [];
      const ventasBusqueda = resVentas.data || [];
      const idsBusqueda = ventasBusqueda.map(v => v.id_venta);
      const { data: elecBusqueda } = idsBusqueda.length > 0
        ? await supabase.from('comprobantes_electronicos').select('id_venta, cliente_nombre').in('id_venta', idsBusqueda)
        : { data: [] };
      const nombresElecBusq = {};
      (elecBusqueda || []).forEach(c => {
        const n = (c.cliente_nombre || '').trim();
        if (n) nombresElecBusq[c.id_venta] = n;
      });
      const resultado = ventasBusqueda.map(v => {
        let metodoStr = 'Efectivo';
        if (v.pagos_venta?.length > 1) metodoStr = 'Mixto';
        else if (v.pagos_venta?.length === 1) {
          const m = v.pagos_venta[0].metodo;
          metodoStr = m.charAt(0).toUpperCase() + m.slice(1).toLowerCase();
        }
        const userObj = usuariosData.find(u => u.id_usuario === v.id_usuario_vendedor);
        const nombreCompleto = userObj ? `${userObj.nombres||''} ${userObj.apellidos||''}`.trim() : `Vendedor #${v.id_usuario_vendedor}`;
        const cajero = userObj ? etiquetaCajero(userObj.nombres, userObj.apellidos) : 'N/A';
        const sucObj = sucursalesData.find(s => s.id_sucursal === v.id_sucursal);
        const sucursal = sucObj ? sucObj.nombre_comercial : 'Sede Central';
        const cli = v.clientes;
        const nombreDesdeCliente = cli
          ? (`${cli.nombres || ''} ${cli.apellidos || ''}`.trim() || (cli.nombre_razon_social || '').trim())
          : '';
        const cliente = nombresElecBusq[v.id_venta] || nombreDesdeCliente || 'Consumidor final';
        return { ...v, cliente, cajero, nombreCompleto, sucursal, metodoStr, ganancia: gananciaDesdeDetallesVenta(v.venta_detalle) };
      });
      setResultadosBusquedaComprobante(resultado);
    } catch (error) {
      console.error('Error buscando comprobante:', error);
      setResultadosBusquedaComprobante([]);
    } finally {
      setBuscandoComprobante(false);
    }
  };

  useEffect(() => {
    if (!busquedaComprobante.trim()) { setResultadosBusquedaComprobante(null); return undefined; }
    if (!parsearBusquedaComprobante(busquedaComprobante)) { setResultadosBusquedaComprobante([]); return undefined; }
    const t = setTimeout(() => buscarComprobanteGlobal(busquedaComprobante), 400);
    return () => clearTimeout(t);
  }, [busquedaComprobante]);

  const toggleVendedor = (vendedor) => {
    if (vendedorExpandido?.id === vendedor.id) { setVendedorExpandido(null); setVentasVendedor([]); return; }
    setVendedorExpandido(vendedor);
    const vv = ventas.filter(v => v.id_usuario_vendedor === vendedor.id);
    setVentasVendedor(vv);
  };

  const verDetalleVenta = async (venta) => {
    setVentaSeleccionada(venta);
    setCargandoDetalle(true);
    try {
      const [resDetalle, resPagos, resVentaFull, resElec] = await Promise.all([
        supabase.from('venta_detalle')
          .select('cantidad, precio_unitario, subtotal, productos(descripcion)')
          .eq('id_venta', venta.id_venta),
        supabase.from('pagos_venta')
          .select('metodo, monto')
          .eq('id_venta', venta.id_venta),
        supabase.from('ventas')
          .select('vuelto, descuento, id_cliente, clientes(nombre_razon_social, nombres, apellidos)')
          .eq('id_venta', venta.id_venta)
          .single(),
        supabase.from('comprobantes_electronicos')
          .select('cliente_nombre')
          .eq('id_venta', venta.id_venta)
          .maybeSingle(),
      ]);
      if (resDetalle.error) throw resDetalle.error;
      // vuelto/descuento son campos secundarios del modal (no bloquean el detalle de
      // productos/pagos) — se loguea el error en vez de lanzarlo, para que un problema
      // acá no rompa el resto del modal, pero tampoco quede invisible como antes.
      if (resVentaFull.error) console.error('Error obteniendo vuelto/descuento de la venta:', resVentaFull.error);
      const cli = resVentaFull.data?.clientes;
      const nombreDesdeCliente = cli
        ? (`${cli.nombres || ''} ${cli.apellidos || ''}`.trim() || (cli.nombre_razon_social || '').trim())
        : '';
      const cliente = (resElec.data?.cliente_nombre || '').trim()
        || nombreDesdeCliente
        || (venta.cliente && venta.cliente !== 'Consumidor final' ? venta.cliente : '')
        || 'Consumidor final';
      setDetallesVenta(resDetalle.data || []);
      setPagosVenta(resPagos.data || []);
      setVentaSeleccionada({
        ...venta,
        vuelto: resVentaFull.data?.vuelto || 0,
        descuento: resVentaFull.data?.descuento || 0,
        cliente,
      });
    } catch (err) { console.error(err); } finally { setCargandoDetalle(false); }
  };

  const handleReimprimir = async (venta) => {
    if (!venta?.id_venta || reimprimiendoId != null) return;
    console.info('[AdminVentas] Reimprimir click', { id_venta: venta.id_venta, serie: venta.serie, correlativo: venta.correlativo });
    setReimprimiendoId(venta.id_venta);
    try {
      const result = await reimprimirVentaPorId(supabase, venta.id_venta);
      console.info('[AdminVentas] Reimprimir resultado', result);
      if (result?.error) {
        // La térmica falló pero pudo usarse fallback HTML; no alertar como "impresora rota"
        // si via === window.print (ya abrió diálogo). Solo avisar si no hubo vía útil.
        if (result.via !== 'window.print' && result.via !== 'thermal') {
          window.alert(`No se pudo reimprimir el ticket.\n${result.error}`);
        }
      }
    } catch (err) {
      console.error('[AdminVentas] Reimprimir falló (carga de datos / payload):', err);
      window.alert(`No se pudo armar el ticket para reimprimir.\n${err?.message || err}`);
    } finally {
      setReimprimiendoId(null);
    }
  };

  const getInitials = (nombre) => { const p = nombre.trim().split(' '); return p.length>=2?`${p[0][0]}${p[1][0]}`.toUpperCase():nombre.slice(0,2).toUpperCase(); };
  const aplicarRangoManual = async () => {
    if (!fechaDesde || !fechaHasta) {
      setMsgRangoFecha('Completa las fechas "Desde" y "Hasta" antes de aplicar.');
      setTimeout(() => setMsgRangoFecha(null), 4000);
      return;
    }
    // Comparación directa de strings: fechaDesde/fechaHasta ya vienen en formato
    // 'YYYY-MM-DD' (así los emite SmartDateInput), que ordena correctamente como texto.
    if (fechaDesde > fechaHasta) {
      setMsgRangoFecha('La fecha "Desde" no puede ser posterior a "Hasta".');
      setTimeout(() => setMsgRangoFecha(null), 4000);
      return;
    }
    setAplicandoRango(true);
    try {
      setFiltroRapido('Personalizado');
      // Duración mínima visible de 700ms para el spinner "Aplicando..." — cargarVentas()
      // suele resolver en 300-400ms, muy rápido para que el usuario perciba el feedback.
      await Promise.all([cargarVentas(), new Promise(resolve => setTimeout(resolve, 700))]);
    } finally {
      setAplicandoRango(false);
    }
  };

  const ventasFiltradas = ventas.filter(v => {
    const okSuc = filtroSucursal === 'todas' || v.id_sucursal === Number(filtroSucursal);
    const okVend = filtroVendedor === 'todos' || v.id_usuario_vendedor === Number(filtroVendedor);
    return okSuc && okVend;
  });

  const kpisFiltrados = {
    total: ventasFiltradas.filter(v => v.estado_anulacion !== 'ANULADO').reduce((s,v) => s + Number(v.total||0), 0),
    operaciones: ventasFiltradas.filter(v => v.estado_anulacion !== 'ANULADO').length,
  };
  const ticketPromedio = kpisFiltrados.operaciones > 0 ? kpisFiltrados.total / kpisFiltrados.operaciones : 0;

  // Modo búsqueda de comprobante: reemplaza la fuente de datos de la tabla (bypassa
  // filtros de período/sucursal/vendedor y paginación) por los resultados globales.
  const enBusquedaComprobante = busquedaComprobante.trim() !== '';

  // Si el período (o la búsqueda) mezcla varios turnos, ordenamos y mostramos
  // encabezados de sección; con un solo turno se mantiene la lista plana.
  const fuenteTabla = enBusquedaComprobante ? (resultadosBusquedaComprobante || []) : ventasFiltradas;
  const agruparPorTurno = contarTurnosUnicos(fuenteTabla) > 1;
  const ventasParaPaginar = agruparPorTurno && !enBusquedaComprobante
    ? ordenarVentasPorTurno(ventasFiltradas)
    : (enBusquedaComprobante && agruparPorTurno
      ? ordenarVentasPorTurno(fuenteTabla)
      : fuenteTabla);

  const subtotalPorTurno = (() => {
    if (!agruparPorTurno) return new Map();
    const m = new Map();
    for (const v of ventasParaPaginar) {
      const key = v.id_turno == null ? '__sin__' : v.id_turno;
      if (!m.has(key)) m.set(key, 0);
      if (v.estado_anulacion !== 'ANULADO') m.set(key, m.get(key) + Number(v.total || 0));
    }
    return m;
  })();

  const indexOfLast  = paginaActual * filasPorPagina;
  const indexOfFirst = indexOfLast - filasPorPagina;
  const ventasPagina = enBusquedaComprobante
    ? ventasParaPaginar
    : ventasParaPaginar.slice(indexOfFirst, indexOfLast);
  const totalPaginas = Math.ceil((enBusquedaComprobante ? ventasParaPaginar : ventasFiltradas).length / filasPorPagina);
  const maxVendedor  = vendedores.length > 0 ? vendedores[0].total : 1;
  const filasTabla = ventasPagina;

  const vendedoresFiltrados = (filtroSucursal === 'todas' || modo !== 'rango')
    ? vendedores
    : vendedores.filter(v => ventas.some(vt => vt.id_usuario_vendedor === v.id && vt.id_sucursal === Number(filtroSucursal)));

  const badgeMetodo = (m) => m.toLowerCase().includes('yape') ? 'yape' : m.toLowerCase().includes('tarjeta') ? 'tarjeta' : m.toLowerCase().includes('mixto') ? 'mixto' : 'efectivo';
  const estadoColor = (e) => e==='ACEPTADO'?{bg:'#dcfce7',c:'#16a34a'}:e==='ANULADO'?{bg:'#f1f5f9',c:'#64748b'}:e==='ERROR'||e==='RECHAZADO'?{bg:'#fee2e2',c:'#b91c1c'}:e==='SIN_CONFIRMAR'?{bg:'#ffedd5',c:'#c2410c'}:{bg:'#fef3c7',c:'#b45309'};

  const labelFiltros = [
    `${fechaDesde} al ${fechaHasta}`,
    filtroSucursal !== 'todas' ? sucursales.find(s => s.id_sucursal === Number(filtroSucursal))?.nombre_comercial : 'Todas las sedes',
    filtroVendedor !== 'todos' ? vendedoresFiltrados.find(v => v.id === Number(filtroVendedor))?.nombre : 'Todos los vendedores',
  ].join('  |  ');

  const exportarPDF = () => {
    const filas = ventasFiltradas.map((v, i) => `
      <tr style="${v.estado_anulacion === 'ANULADO' ? 'opacity:0.5;text-decoration:line-through' : ''}">
        <td>${i+1}</td>
        <td>${etiquetaComprobanteVisible(v)}</td>
        <td>${v.tipo_comprobante}</td>
        <td>${v.sucursal || '—'}</td>
        <td>${v.nombreCompleto || '—'}</td>
        <td>${new Date(v.created_at).toLocaleDateString('es-PE')} ${new Date(v.created_at).toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'})}</td>
        <td>${v.metodoStr || '—'}</td>
        <td style="text-align:right; font-weight:bold">S/ ${Number(v.total).toFixed(2)}</td>
        <td>${v.estado_anulacion === 'ANULADO' ? 'ANULADA' : (v.estado_sunat || 'PENDIENTE')}</td>
      </tr>`).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
      <title>Historial de Ventas - ${labelFiltros}</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 11px; color: #0f172a; margin: 20px; }
        h2 { font-size: 16px; margin-bottom: 4px; }
        .sub { color: #64748b; font-size: 10px; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th { background: #172545; color: white; padding: 8px 6px; text-align: left; font-size: 10px; }
        td { padding: 7px 6px; border-bottom: 1px solid #e2e8f0; }
        tr:nth-child(even) td { background: #f8fafc; }
        .totales { margin-top: 16px; text-align: right; font-size: 13px; font-weight: bold; }
        @media print { button { display: none; } }
      </style></head><body>
      <h2>Historial de Ventas - SALUD FUTURA</h2>
      <p class="sub">Filtros: ${labelFiltros}</p>
      <table>
        <thead><tr><th>#</th><th>Comprobante</th><th>Tipo</th><th>Sucursal</th><th>Vendedor</th><th>Fecha / Hora</th><th>Metodo</th><th>Total</th><th>Estado</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
      <div class="totales">
        Operaciones: ${kpisFiltrados.operaciones} &nbsp;|&nbsp;
        Total: S/ ${kpisFiltrados.total.toLocaleString('en-US',{minimumFractionDigits:2})}
      </div>
      <script>window.onload = () => { window.print(); }</script>
      </body></html>`;

    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
  };

  const exportarExcel = () => {
    const encabezado = ['#','Comprobante','Tipo','Sucursal','Vendedor','Fecha','Hora','Metodo','Total (S/)','Estado'];
    const filas = ventasFiltradas.map((v, i) => [
      i+1, etiquetaComprobanteVisible(v), v.tipo_comprobante,
      v.sucursal || '-', v.nombreCompleto || '-',
      new Date(v.created_at).toLocaleDateString('es-PE'),
      new Date(v.created_at).toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'}),
      v.metodoStr || '-', Number(v.total).toFixed(2),
      v.estado_anulacion === 'ANULADO' ? 'ANULADA' : (v.estado_sunat || 'PENDIENTE'),
    ]);
    const csv = [encabezado, ...filas].map(row => row.map(cell => `"${String(cell).replace(/"/g,'""')}"`).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `ventas_${fechaDesde}_${fechaHasta}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const fechaHoyStr = new Date().toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric' });

  const kpisMes = kpisDesdeVentasLigeras(ventasMesLigeras);
  const diaMeta = diasMes.find((d) => d.fecha === diaSeleccionado);
  const { horas: chartHoras, vendedores: vendIdsDia } = agregarPorHoraYVendedor(ventasDelDia, formatHora12AmPm);
  const mapaNombres = new Map(vendedores.map((v) => [v.id, v.nombre]));
  ventasDelDia.forEach((v) => {
    if (!mapaNombres.has(v.id_usuario_vendedor)) mapaNombres.set(v.id_usuario_vendedor, v.nombreCompleto);
  });
  const vendedoresChart = vendIdsDia.map((v, i) => ({
    id: v.id,
    nombre: mapaNombres.get(v.id) || `Vendedor #${v.id}`,
    color: AVATAR_COLORS[i % AVATAR_COLORS.length],
    total: v.total,
  }));

  const anioVistaDias = modo === 'todo' ? anioTodo : anioMes;
  const mesVistaDias = modo === 'todo' ? mesTodo : mesSel;
  const mostrarListaDias = modo === 'mes' || (modo === 'todo' && todoNivel === 'dias');

  const metodoCorto = (m) => {
    const t = (m || '').toLowerCase();
    if (t.includes('yape')) return 'Yape';
    if (t.includes('tarjeta')) return 'Tarj.';
    if (t.includes('mixto')) return 'Mixto';
    return 'Efe.';
  };
  const estadoCorto = (v) => {
    if (v.estado_anulacion === 'ANULADO') return 'Anul.';
    const e = (v.estado_sunat || 'PENDIENTE').toUpperCase();
    if (e === 'ACEPTADO') return 'OK';
    if (e === 'ERROR' || e === 'RECHAZADO') return 'Err.';
    if (e === 'SIN_CONFIRMAR') return 'S/C';
    return 'Pend.';
  };

  const renderFilasComprobantes = (lista, { compact = false } = {}) => {
    const cols = compact ? 7 : 10;
    if (cargandoDia && compact) {
      return <tr><td colSpan={cols} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>Cargando…</td></tr>;
    }
    if (!lista.length) {
      return (
        <tr>
          <td colSpan={cols} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
            Sin comprobantes este día
          </td>
        </tr>
      );
    }
    return lista.map((v) => {
      const anulada = v.estado_anulacion === 'ANULADO';
      const sc = estadoColor(v.estado_sunat);
      const hora = new Date(v.created_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false });
      return (
        <tr key={v.id_venta} style={{ opacity: anulada ? 0.5 : 1 }}>
          <td>
            <strong style={{ textDecoration: anulada ? 'line-through' : 'none', fontSize: compact ? '0.82rem' : undefined }}>
              {etiquetaComprobanteVisible(v)}
            </strong>
            {!compact && (
              <p style={{ fontSize: '0.7rem', color: '#94a3b8', margin: '2px 0 0' }}>{v.tipo_comprobante}</p>
            )}
          </td>
          {!compact && <td style={{ color: '#64748b' }}>{v.sucursal}</td>}
          <td style={{ color: '#64748b', whiteSpace: 'nowrap' }} title={v.nombreCompleto || v.cajero}>
            {v.cajero}
          </td>
          <td style={{ color: '#64748b', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{hora}</td>
          <td>
            <span className={`av-pill av-pill-${badgeMetodo(v.metodoStr)}`} title={v.metodoStr}>
              {compact ? metodoCorto(v.metodoStr) : v.metodoStr}
            </span>
          </td>
          <td style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
            <strong>S/ {Number(v.total).toFixed(2)}</strong>
          </td>
          <td>
            <span className="av-pill" style={{ background: sc.bg, color: sc.c }} title={anulada ? 'ANULADA' : (v.estado_sunat || 'PENDIENTE')}>
              {compact ? estadoCorto(v) : (anulada ? 'ANULADA' : (v.estado_sunat || 'PENDIENTE'))}
            </span>
          </td>
          <td style={{ textAlign: 'right' }}>
            {compact ? (
              <div className="av-acciones-iconos">
                <button
                  type="button"
                  className="av-btn-icon-apple av-btn-icon-print"
                  disabled={reimprimiendoId === v.id_venta}
                  onClick={() => handleReimprimir(v)}
                  title="Reimprimir ticket"
                  aria-label="Reimprimir ticket"
                >
                  {reimprimiendoId === v.id_venta ? '…' : <UiIcon name="Printer" size={16} />}
                </button>
                <button
                  type="button"
                  className="av-btn-icon-apple"
                  onClick={() => verDetalleVenta(v)}
                  title="Ver detalle"
                  aria-label="Ver detalle"
                >
                  <UiIcon name="Eye" size={16} />
                </button>
                {!anulada && (
                  <button
                    type="button"
                    className="av-btn-icon-apple av-btn-icon-anular"
                    onClick={() => { setVentaAAnular(v); setMotivoAnulacion('Error en la emisión'); }}
                    title="Anular comprobante"
                    aria-label="Anular comprobante"
                  ><UiIcon name="X" size={16} /></button>
                )}
              </div>
            ) : (
              <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <button type="button" className="av-btn-reimprimir" disabled={reimprimiendoId === v.id_venta} onClick={() => handleReimprimir(v)}>
                  {reimprimiendoId === v.id_venta ? '…' : 'Reimprimir'}
                </button>
                <button type="button" className="av-btn-icon-apple" onClick={() => verDetalleVenta(v)} title="Ver detalle"><UiIcon name="Eye" size={16} /></button>
                {!anulada && (
                  <button type="button" className="av-btn-anular" onClick={() => { setVentaAAnular(v); setMotivoAnulacion('Error en la emisión'); }}>Anular</button>
                )}
              </div>
            )}
          </td>
        </tr>
      );
    });
  };

  return (
    <div style={{ background: '#f8fafc', minHeight: '100vh', padding: '2rem 2.5rem' }}>

      <style>{`
        @keyframes appleFadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes appleSlideUp { from { opacity: 0; transform: translateY(20px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
        .av-card-apple { background: white; border-radius: 18px; box-shadow: 0 1px 3px rgba(0,0,0,0.05), 0 8px 24px rgba(0,0,0,0.04); border: 1px solid rgba(15,23,42,0.04); }
        .av-table-apple { width: 100%; border-collapse: collapse; }
        .av-table-apple thead th { background: transparent; color: #94a3b8; font-size: 0.7rem; font-weight: 600; letter-spacing: 0.8px; text-transform: uppercase; padding: 1rem 1.25rem; text-align: left; border-bottom: 1px solid #f1f5f9; }
        .av-table-apple tbody tr { transition: background 0.15s ease; }
        .av-table-apple tbody tr:hover { background: #f8fafc; }
        .av-table-apple tbody td { padding: 1rem 1.25rem; font-size: 0.88rem; color: #0f172a; border-bottom: 1px solid #f1f5f9; }
        .av-pill { display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 100px; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.2px; }
        .av-pill-efectivo { background: #dcfce7; color: #166534; }
        .av-pill-yape { background: #f3e8ff; color: #6b21a8; }
        .av-pill-tarjeta { background: #dbeafe; color: #1e40af; }
        .av-pill-mixto { background: #fef3c7; color: #92400e; }
        .av-btn-icon-apple { width: 32px; height: 32px; border-radius: 50%; background: #f1f5f9; border: none; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: all 0.2s ease; font-size: 0.9rem; }
        .av-btn-icon-apple:hover { background: #e2e8f0; transform: scale(1.08); }
        .av-btn-anular { padding: 6px 14px; border-radius: 100px; background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; font-size: 0.75rem; font-weight: 600; cursor: pointer; transition: all 0.2s ease; }
        .av-btn-anular:hover { background: #fee2e2; transform: scale(1.03); }
        .av-btn-reimprimir { padding: 6px 14px; border-radius: 100px; background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; font-size: 0.75rem; font-weight: 600; cursor: pointer; transition: all 0.2s ease; }
        .av-btn-reimprimir:hover { background: #dbeafe; transform: scale(1.03); }
        .av-btn-reimprimir:disabled { opacity: 0.55; cursor: wait; transform: none; }
        .av-input-apple { background: white; border: 1px solid #e2e8f0; border-radius: 10px; padding: 9px 14px; font-size: 0.88rem; color: #0f172a; outline: none; transition: all 0.2s ease; font-family: inherit; }
        .av-input-apple:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }
        .av-content { animation: appleFadeIn 0.4s ease-out; }
      `}</style>

      <div className="av-content" style={{ maxWidth: 1400, margin: '0 auto' }}>

        {/* HEADER */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <p style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 0.4rem' }}><UiIcon name="BarChart3" size={15} /> Administración
            </p>
            <h1 style={{ fontSize: '2rem', fontWeight: 800, color: '#0f172a', margin: 0, letterSpacing: '-0.02em' }}>
              Historial de Ventas
            </h1>
            <p style={{ fontSize: '0.95rem', color: '#64748b', margin: '0.3rem 0 0' }}>
              Administra y supervisa todas las transacciones · {fechaHoyStr}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <button type="button" onClick={exportarPDF} style={{ padding: '10px 18px', background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, fontSize: '0.85rem', fontWeight: 600, color: '#475569', cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}><UiIcon name="FileText" size={15} /> PDF
            </button>
            <button type="button" onClick={exportarExcel} style={{ padding: '10px 18px', background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, fontSize: '0.85rem', fontWeight: 600, color: '#475569', cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}><UiIcon name="BarChart3" size={15} /> Excel
            </button>
          </div>
        </div>

        <HistorialFiltros
          modo={modo}
          filtroRapido={filtroRapido}
          onFiltroRapido={setFiltroRapido}
          onModoRango={() => { setModo('rango'); setDiaSeleccionado(null); setVentasDelDia([]); }}
          onPersonalizado={() => {
            setModo('rango');
            setDiaSeleccionado(null);
            setVentasDelDia([]);
            setFiltroRapido('Personalizado');
            setMsgRangoFecha(null);
            const hoy = hoyLocal();
            if (!fechaDesde) setFechaDesde(hoy);
            if (!fechaHasta) setFechaHasta(hoy);
          }}
          onModoMes={() => {
            const a = anioMesActualLocal();
            setModo('mes');
            setAnioMes(a.anio);
            setMesSel(a.mes);
            setDiaSeleccionado(null);
            setVentasDelDia([]);
          }}
          onModoTodo={() => {
            setModo('todo');
            setTodoNivel('anios');
            setAnioTodo(null);
            setMesTodo(null);
            setDiaSeleccionado(null);
            setVentasDelDia([]);
          }}
          fechaDesde={fechaDesde}
          fechaHasta={fechaHasta}
          onFechaDesde={(val) => { setFechaDesde(val); setFiltroRapido('Personalizado'); setMsgRangoFecha(null); }}
          onFechaHasta={(val) => { setFechaHasta(val); setFiltroRapido('Personalizado'); setMsgRangoFecha(null); }}
          onAplicarRango={aplicarRangoManual}
          aplicandoRango={aplicandoRango}
          msgRangoFecha={msgRangoFecha}
          filtroSucursal={filtroSucursal}
          onSucursal={(v) => { setFiltroSucursal(v); setFiltroVendedor('todos'); setPaginaActual(1); }}
          sucursales={sucursales}
          filtroVendedor={filtroVendedor}
          onVendedor={(v) => { setFiltroVendedor(v); setPaginaActual(1); }}
          vendedores={vendedoresFiltrados}
          busquedaComprobante={busquedaComprobante}
          onBusquedaComprobante={setBusquedaComprobante}
        />

        {/* KPIs de la vista clásica (rápidos) — el explorador vive en modal fullscreen */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
          <div className="av-card-apple" style={{ padding: '1.5rem 1.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.4rem' }}>
              <p style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', margin: 0 }}>Total ventas</p>
              <div style={{ width: 38, height: 38, borderRadius: 12, background: 'linear-gradient(135deg,#dbeafe,#bfdbfe)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem' }}><UiIcon name="Wallet" size={16} /></div>
            </div>
            <h2 style={{ fontSize: '1.85rem', fontWeight: 800, color: '#0f172a', margin: '0.3rem 0 0', letterSpacing: '-0.02em' }}>
              S/ {kpisFiltrados.total.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}
            </h2>
            <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '0.3rem 0 0' }}>Período seleccionado</p>
          </div>

          <div className="av-card-apple" style={{ padding: '1.5rem 1.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.4rem' }}>
              <p style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', margin: 0 }}>Operaciones</p>
              <div style={{ width: 38, height: 38, borderRadius: 12, background: 'linear-gradient(135deg,#dcfce7,#bbf7d0)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem' }}><UiIcon name="Receipt" size={16} /></div>
            </div>
            <h2 style={{ fontSize: '1.85rem', fontWeight: 800, color: '#0f172a', margin: '0.3rem 0 0', letterSpacing: '-0.02em' }}>
              {kpisFiltrados.operaciones}
            </h2>
            <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '0.3rem 0 0' }}>Ventas registradas</p>
          </div>

          <div className="av-card-apple" style={{ padding: '1.5rem 1.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.4rem' }}>
              <p style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', margin: 0 }}>Ticket promedio</p>
              <div style={{ width: 38, height: 38, borderRadius: 12, background: 'linear-gradient(135deg,#fef3c7,#fde68a)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem' }}><UiIcon name="BarChart3" size={16} /></div>
            </div>
            <h2 style={{ fontSize: '1.85rem', fontWeight: 800, color: '#0f172a', margin: '0.3rem 0 0', letterSpacing: '-0.02em' }}>
              S/ {ticketPromedio.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}
            </h2>
            <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '0.3rem 0 0' }}>Por operación</p>
          </div>
        </div>

        {/* EXPLORAR — modal pantalla completa (Mes… / Todo el tiempo) */}
        <FullScreenModal
          open={modo === 'mes' || modo === 'todo'}
          onClose={() => {
            setModo('rango');
            setDiaSeleccionado(null);
            setVentasDelDia([]);
          }}
          eyebrow="Explorar historial"
          title={modo === 'todo' ? 'Todo el tiempo' : 'Explorar por mes'}
          subtitle={modo === 'todo'
            ? `Desde la primera venta · S/ ${kpisTodo.total.toLocaleString('es-PE', { minimumFractionDigits: 2 })} · ${kpisTodo.operaciones} ops`
            : `${NOMBRES_MES_ES[mesSel - 1]} ${anioMes}`}
          toolbar={modo === 'mes' ? (
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="av-filtros-field">
                <label>Mes</label>
                <select className="av-input-apple" value={mesSel} onChange={(e) => { setMesSel(Number(e.target.value)); setDiaSeleccionado(null); }}>
                  {NOMBRES_MES_ES.map((nombre, i) => (
                    <option key={nombre} value={i + 1}>{nombre}</option>
                  ))}
                </select>
              </div>
              <div className="av-filtros-field">
                <label>Año</label>
                <select className="av-input-apple" value={anioMes} onChange={(e) => { setAnioMes(Number(e.target.value)); setDiaSeleccionado(null); }}>
                  {(aniosDisponibles.length
                    ? aniosDisponibles
                    : [anioMesActualLocal().anio, anioMesActualLocal().anio - 1, anioMesActualLocal().anio - 2]
                  ).map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <button type="button" className="av-chip active" onClick={() => { setTodoNivel('anios'); setAnioTodo(null); setMesTodo(null); setDiaSeleccionado(null); cargarTodoAnios(); }}>
                Todo el tiempo
              </button>
              {anioTodo != null && (
                <>
                  <span style={{ color: '#94a3b8' }}>›</span>
                  <button type="button" className="av-chip" onClick={() => { cargarTodoMeses(anioTodo); setDiaSeleccionado(null); }}>{anioTodo}</button>
                </>
              )}
              {mesTodo != null && anioTodo != null && (
                <>
                  <span style={{ color: '#94a3b8' }}>›</span>
                  <button
                    type="button"
                    className="av-chip"
                    onClick={() => { setTodoNivel('dias'); setDiaSeleccionado(null); cargarListaMes(anioTodo, mesTodo); }}
                  >
                    {NOMBRES_MES_ES[mesTodo - 1]}
                  </button>
                </>
              )}
            </div>
          )}
        >
          {modo === 'todo' && todoNivel === 'anios' && (
            <div className="av-explore-fs-scroll">
              <ListaAniosMeses
                titulo="Años con ventas"
                subtitulo="Elige un año para ver el detalle por mes"
                items={itemsAnios}
                seleccionado={anioTodo}
                onSeleccionar={(it) => cargarTodoMeses(it.anio)}
                cargando={cargandoTodo}
                emptyText="Aún no hay ventas registradas"
              />
            </div>
          )}

          {modo === 'todo' && todoNivel === 'meses' && (
            <div className="av-explore-fs-scroll">
              <ListaAniosMeses
                titulo={`Meses de ${anioTodo}`}
                subtitulo="Elige un mes para ver el listado de días"
                items={itemsMeses}
                seleccionado={mesTodo}
                onSeleccionar={(it) => {
                  setMesTodo(it.mes);
                  setTodoNivel('dias');
                  setDiaSeleccionado(null);
                  cargarListaMes(anioTodo, it.mes);
                }}
                cargando={cargandoTodo}
              />
            </div>
          )}

          {mostrarListaDias && (
            <div className={`av-explore-fs-grid${diaSeleccionado ? ' has-detail' : ''}`}>
              <ListaDiasMes
                anio={anioVistaDias}
                mes={mesVistaDias}
                dias={diasMes}
                diaSeleccionado={diaSeleccionado}
                onSeleccionarDia={cargarDiaCompleto}
                cargando={cargandoMes}
                totalMes={kpisMes.total}
                opsMes={kpisMes.operaciones}
                wide
              />
              <PanelDiaVentas
                fechaIso={diaSeleccionado}
                total={diaMeta?.total || 0}
                operaciones={diaMeta?.operaciones || 0}
                chartData={chartHoras}
                vendedoresChart={vendedoresChart}
                cargando={cargandoDia}
              >
                <div className="av-tabla-dia-wrap">
                  <table className="av-table-apple av-tabla-dia av-tabla-dia-drawer">
                    <thead>
                      <tr>
                        <th>Comprobante</th>
                        <th>Cajero</th>
                        <th>Hora</th>
                        <th>Método</th>
                        <th>Total</th>
                        <th>Estado</th>
                        <th style={{ textAlign: 'right' }}>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>{renderFilasComprobantes(ventasDelDia, { compact: true })}</tbody>
                  </table>
                </div>
              </PanelDiaVentas>
            </div>
          )}
        </FullScreenModal>

        {/* PANEL VENDEDORES COLAPSABLE */}
        {vendedores.length > 0 && (
          <div className="av-card-apple" style={{ marginBottom: '1.5rem', overflow: 'hidden' }}>
            <button onClick={() => setMostrarVendedores(!mostrarVendedores)} style={{ width: '100%', padding: '1.25rem 1.5rem', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', textAlign: 'left' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 38, height: 38, borderRadius: 12, background: 'linear-gradient(135deg,#e0e7ff,#c7d2fe)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem' }}><UiIcon name="Users" size={16} /></div>
                <div>
                  <p style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>Rendimiento por vendedor</p>
                  <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: '2px 0 0' }}>
                    {vendedores.filter(v=>v.activo).length} en turno · {vendedores.length} {vendedores.length === 1 ? 'vendedor' : 'vendedores'}
                  </p>
                </div>
              </div>
              <span style={{ fontSize: '1.3rem', color: '#94a3b8', transform: mostrarVendedores ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s ease' }}>⌄</span>
            </button>

            {mostrarVendedores && (
              <div style={{ borderTop: '1px solid #f1f5f9', padding: '1.5rem', animation: 'appleFadeIn 0.3s ease-out' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
                  {vendedores.map((v, i) => {
                    const pct = maxVendedor > 0 ? (v.total/maxVendedor)*100 : 0;
                    const seleccionado = vendedorExpandido?.id === v.id;
                    return (
                      <div key={v.id} onClick={() => toggleVendedor(v)}
                        style={{ background: seleccionado ? 'linear-gradient(135deg, #f8fafc, #ffffff)' : 'white', border: seleccionado ? `2px solid ${v.color}` : '1px solid #f1f5f9', borderRadius: 14, padding: '1rem 1.1rem', cursor: 'pointer', position: 'relative', transition: 'all 0.2s ease', boxShadow: seleccionado ? `0 8px 24px ${v.color}25` : '0 1px 2px rgba(0,0,0,0.03)' }}>
                        {v.activo && <div style={{ position: 'absolute', top: 12, right: 12, width: 8, height: 8, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 0 3px rgba(16,185,129,0.2)' }} />}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                          <div style={{ width: 42, height: 42, borderRadius: '50%', background: v.color, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.95rem' }}>{getInitials(v.nombre)}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontSize: '0.92rem', fontWeight: 700, color: '#0f172a', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.nombre}</p>
                            <p style={{ fontSize: '0.72rem', color: v.activo ? '#10b981' : '#94a3b8', margin: '2px 0 0', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>{v.activo ? <><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} /> En turno</> : '○ Cerrado'} · Rank #{i+1}</p>
                          </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 10 }}>
                          <div><p style={{ fontSize: '0.65rem', color: '#94a3b8', margin: 0, fontWeight: 600, letterSpacing: '0.3px', textTransform: 'uppercase' }}>Total</p><p style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0f172a', margin: '2px 0 0' }}>S/ {v.total.toFixed(2)}</p></div>
                          <div><p style={{ fontSize: '0.65rem', color: '#94a3b8', margin: 0, fontWeight: 600, letterSpacing: '0.3px', textTransform: 'uppercase' }}>Ventas</p><p style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0f172a', margin: '2px 0 0' }}>{v.operaciones}</p></div>
                          <div><p style={{ fontSize: '0.65rem', color: '#94a3b8', margin: 0, fontWeight: 600, letterSpacing: '0.3px', textTransform: 'uppercase' }}>Ticket</p><p style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0f172a', margin: '2px 0 0' }}>S/ {v.ticketPromedio.toFixed(2)}</p></div>
                        </div>
                        <div style={{ height: 6, background: '#f1f5f9', borderRadius: 100, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: v.color, transition: 'width 0.5s ease', borderRadius: 100 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {vendedorExpandido && (
                  <div style={{ marginTop: '1.5rem', padding: '1.25rem', background: '#f8fafc', borderRadius: 14, animation: 'appleSlideUp 0.3s ease-out' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: vendedorExpandido.color, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.78rem' }}>{getInitials(vendedorExpandido.nombre)}</div>
                        <p style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>Ventas de {vendedorExpandido.nombre}</p>
                      </div>
                      <button onClick={() => { setVendedorExpandido(null); setVentasVendedor([]); }} className="av-btn-icon-apple"><UiIcon name="X" size={16} /></button>
                    </div>

                    {ventasVendedor.length === 0 ? (
                      <p style={{ textAlign: 'center', color: '#94a3b8', padding: '1rem', fontSize: '0.85rem' }}>No hay ventas en este período.</p>
                    ) : (
                      <div style={{ background: 'white', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                        <table className="av-table-apple">
                          <thead><tr><th>Comprobante</th><th>Turno</th><th>Hora</th><th>Método</th><th>Total</th><th>Estado</th><th></th></tr></thead>
                          <tbody>
                            {ventasVendedor.map(vt => {
                              const anulada = vt.estado_anulacion === 'ANULADO';
                              const sc = estadoColor(vt.estado_sunat);
                              return (
                                <tr key={vt.id_venta} style={{ opacity: anulada ? 0.5 : 1 }}>
                                  <td><strong style={{ textDecoration: anulada ? 'line-through' : 'none' }}>{etiquetaComprobanteVisible(vt)}</strong></td>
                                  <td>
                                    {vt.id_turno != null
                                      ? <span className="av-turno-chip">#{String(vt.id_turno).padStart(4, '0')}</span>
                                      : <span style={{ color: '#cbd5e1' }}>—</span>}
                                  </td>
                                  <td style={{color:'#64748b'}}>{new Date(vt.created_at).toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'})}</td>
                                  <td><span className={`av-pill av-pill-${badgeMetodo(vt.metodoStr)}`}>{vt.metodoStr}</span></td>
                                  <td><strong>S/ {Number(vt.total).toFixed(2)}</strong></td>
                                  <td><span className="av-pill" style={{ background: sc.bg, color: sc.c }}>{anulada ? 'ANULADO' : (vt.estado_sunat||'PENDIENTE')}</span></td>
                                  <td style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                                    <button
                                      type="button"
                                      className="av-btn-reimprimir"
                                      disabled={reimprimiendoId === vt.id_venta}
                                      onClick={() => handleReimprimir(vt)}
                                      title="Reimprimir ticket"
                                    >
                                      {reimprimiendoId === vt.id_venta ? '…' : 'Reimprimir'}
                                    </button>
                                    <button className="av-btn-icon-apple" onClick={() => verDetalleVenta(vt)}><UiIcon name="Eye" size={16} /></button>
                                    {!anulada && <button className="av-btn-anular" onClick={() => { setVentaAAnular(vt); setMotivoAnulacion('Error en la emisión'); }}>Anular</button>}
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
              </div>
            )}
          </div>
        )}

        {/* TABLA PRINCIPAL — vista clásica (bajo el explorador fullscreen) */}
        <div className="av-card-apple" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <p style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
                {enBusquedaComprobante ? `Resultados para "${busquedaComprobante.trim()}"` : 'Comprobantes registrados'}
              </p>
              <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: '2px 0 0' }}>
                {enBusquedaComprobante
                  ? `${filasTabla.length} ${filasTabla.length === 1 ? 'resultado' : 'resultados'} · todo el historial, sin importar el período`
                  : `${ventasFiltradas.length} ${ventasFiltradas.length === 1 ? 'venta' : 'ventas'}`}
              </p>
            </div>
            {enBusquedaComprobante ? (
              <button onClick={() => setBusquedaComprobante('')} style={{ padding: '8px 14px', background: '#f1f5f9', border: 'none', borderRadius: 10, fontSize: '0.8rem', fontWeight: 600, color: '#475569', cursor: 'pointer' }}><UiIcon name="X" size={15} /> Limpiar búsqueda
              </button>
            ) : (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.82rem', color: '#64748b', fontWeight: 600 }}>
                <input type="checkbox" checked={mostrarGanancia} onChange={e => setMostrarGanancia(e.target.checked)} />
                Mostrar ganancia (costo catálogo)
              </label>
            )}
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="av-table-apple">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Comprobante</th>
                  <th>Sucursal</th>
                  <th>Cajero</th>
                  <th>Turno</th>
                  <th>Hora</th>
                  <th>Método</th>
                  <th>Total</th>
                  {mostrarGanancia && <th>Ganancia <UiIcon name="Lock" size={12} /></th>}
                  <th>Estado</th>
                  <th style={{ textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {loading || (enBusquedaComprobante && buscandoComprobante) ? (
                  <tr><td colSpan={mostrarGanancia ? 11 : 10} style={{textAlign:'center',padding:'3rem',color:'#94a3b8'}}>{enBusquedaComprobante ? 'Buscando...' : 'Cargando registros...'}</td></tr>
                ) : filasTabla.length === 0 ? (
                  <tr><td colSpan={mostrarGanancia ? 11 : 10} style={{textAlign:'center',padding:'3rem',color:'#94a3b8'}}>
                    <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}><UiIcon name="ClipboardList" size={16} /></div>
                    <p style={{ fontSize: '0.95rem', fontWeight: 600, color: '#475569', margin: 0 }}>No se encontraron ventas</p>
                    <p style={{ fontSize: '0.8rem', margin: '4px 0 0' }}>{enBusquedaComprobante ? 'Ningún comprobante coincide con ese número.' : 'Prueba con otro rango o ajusta los filtros.'}</p>
                  </td></tr>
                ) : (() => {
                  const colSpan = mostrarGanancia ? 11 : 10;
                  let ultimoTurnoKey = null;
                  return filasTabla.flatMap((v, index) => {
                    const anulada = v.estado_anulacion === 'ANULADO';
                    const sc = estadoColor(v.estado_sunat);
                    const turnoKey = v.id_turno == null ? '__sin__' : v.id_turno;
                    const rows = [];
                    if (agruparPorTurno && turnoKey !== ultimoTurnoKey) {
                      ultimoTurnoKey = turnoKey;
                      const sub = subtotalPorTurno.get(turnoKey) || 0;
                      rows.push(
                        <tr key={`sec-${turnoKey}`} className="av-turno-section-row">
                          <td colSpan={colSpan}>
                            <div className="av-turno-section-label">
                              <span>{labelTurno(v.id_turno)}</span>
                              <strong>S/ {sub.toFixed(2)}</strong>
                            </div>
                          </td>
                        </tr>
                      );
                    }
                    rows.push(
                      <tr key={v.id_venta} style={{ opacity: anulada ? 0.5 : 1 }}>
                        <td style={{color:'#94a3b8',fontWeight:600}}>{(enBusquedaComprobante ? 0 : indexOfFirst)+index+1}</td>
                        <td>
                          <strong style={{ textDecoration: anulada ? 'line-through' : 'none' }}>{etiquetaComprobanteVisible(v)}</strong>
                          <p style={{ fontSize: '0.7rem', color: '#94a3b8', margin: '2px 0 0' }}>{v.tipo_comprobante}</p>
                        </td>
                        <td style={{color:'#64748b'}}>{v.sucursal}</td>
                        <td style={{color:'#64748b'}}>{v.cajero}</td>
                        <td>
                          {v.id_turno != null
                            ? <span className="av-turno-chip" title="Turno de caja en el que se registró esta venta">#{String(v.id_turno).padStart(4, '0')}</span>
                            : <span style={{ color: '#cbd5e1', fontSize: '0.78rem' }}>—</span>}
                        </td>
                        <td style={{color:'#64748b'}}>{new Date(v.created_at).toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'})}</td>
                        <td><span className={`av-pill av-pill-${badgeMetodo(v.metodoStr)}`}>{v.metodoStr}</span></td>
                        <td><strong>S/ {Number(v.total).toFixed(2)}</strong></td>
                        {mostrarGanancia && <td style={{color: anulada ? '#94a3b8' : '#16a34a', fontWeight:600}}>S/ {v.ganancia.toFixed(2)}</td>}
                        <td><span className="av-pill" style={{ background: sc.bg, color: sc.c }}>{anulada ? 'ANULADA' : (v.estado_sunat || 'PENDIENTE')}</span></td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                            <button
                              type="button"
                              className="av-btn-reimprimir"
                              disabled={reimprimiendoId === v.id_venta}
                              onClick={() => handleReimprimir(v)}
                              title="Reimprimir ticket"
                            >
                              {reimprimiendoId === v.id_venta ? '…' : 'Reimprimir'}
                            </button>
                            <button className="av-btn-icon-apple" onClick={() => verDetalleVenta(v)} title="Ver detalle"><UiIcon name="Eye" size={16} /></button>
                            {!anulada && <button className="av-btn-anular" onClick={() => { setVentaAAnular(v); setMotivoAnulacion('Error en la emisión'); }}>Anular</button>}
                          </div>
                        </td>
                      </tr>
                    );
                    return rows;
                  });
                })()}
              </tbody>
            </table>
          </div>

          {!enBusquedaComprobante && (
            <>
              <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                <div style={{ fontSize: '0.82rem', color: '#64748b' }}>
                  Mostrando <strong style={{ color: '#0f172a' }}>{ventasFiltradas.length===0?0:indexOfFirst+1} – {Math.min(indexOfLast,ventasFiltradas.length)}</strong> de <strong style={{ color: '#0f172a' }}>{ventasFiltradas.length}</strong>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <select value={filasPorPagina} onChange={e => { setFilasPorPagina(Number(e.target.value)); setPaginaActual(1); }} className="av-input-apple" style={{ padding: '6px 10px', fontSize: '0.8rem' }}>
                    <option value={10}>10 / página</option>
                    <option value={20}>20 / página</option>
                    <option value={50}>50 / página</option>
                  </select>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button disabled={paginaActual===1} onClick={() => setPaginaActual(p=>p-1)} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #e2e8f0', background: 'white', cursor: paginaActual===1 ? 'not-allowed' : 'pointer', color: '#475569', opacity: paginaActual===1 ? 0.4 : 1 }}>‹</button>
                    <div style={{ minWidth: 32, height: 32, borderRadius: 8, background: '#0f172a', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: '0.82rem', padding: '0 10px' }}>{paginaActual}</div>
                    <button disabled={paginaActual===totalPaginas||totalPaginas===0} onClick={() => setPaginaActual(p=>p+1)} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #e2e8f0', background: 'white', cursor: (paginaActual===totalPaginas||totalPaginas===0) ? 'not-allowed' : 'pointer', color: '#475569', opacity: (paginaActual===totalPaginas||totalPaginas===0) ? 0.4 : 1 }}>›</button>
                  </div>
                </div>
              </div>

              <div style={{ padding: '1rem 1.5rem', background: 'linear-gradient(135deg, #f8fafc, #f1f5f9)', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <p style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', margin: 0 }}>
                  Total del período {(filtroVendedor !== 'todos' || filtroSucursal !== 'todas') ? '(filtrado)' : ''}
                </p>
                <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0f172a' }}>
                  S/ {kpisFiltrados.total.toLocaleString('en-US',{minimumFractionDigits:2})}
                </div>
              </div>
            </>
          )}
        </div>

      </div>

      {/* MODAL ANULAR */}
      {ventaAAnular && (
        <div role="dialog" aria-modal="true" data-keyboard-trap style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100032, padding: '1rem' }} onClick={() => !anulando && setVentaAAnular(null)}>
          <div style={{ background: 'white', borderRadius: 20, width: '100%', maxWidth: 440, padding: '2rem', boxShadow: '0 25px 80px rgba(0,0,0,0.25)', animation: 'appleSlideUp 0.3s ease' }} onClick={e => e.stopPropagation()}>
            <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}><UiIcon name="AlertTriangle" size={16} /></div>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', margin: '0 0 4px' }}>Anular comprobante</h3>
              <p style={{ fontSize: '0.88rem', color: '#64748b', margin: 0 }}>
                {etiquetaComprobanteVisible(ventaAAnular)} · S/ {Number(ventaAAnular.total).toFixed(2)}
              </p>
            </div>
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: '12px 16px', marginBottom: '1.2rem' }}>
              <p style={{ fontSize: '0.82rem', color: '#b91c1c', margin: 0, fontWeight: 600, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <UiIcon name="AlertTriangle" size={15} /> Acción irreversible. Se devolverá el stock al inventario{nubefactIpcDisponible() ? ' y se enviará la anulación a SUNAT.' : '.'}
              </p>
            </div>
            <div style={{ marginBottom: '1.2rem' }}>
              <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: '0.4rem' }}>Motivo de anulación</label>
              <select value={motivoAnulacion} onChange={e => setMotivoAnulacion(e.target.value)} disabled={anulando} className="av-input-apple" style={{ width: '100%' }}>
                {motivosAnulacion.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            {cargandoAviso && (
              <p style={{ fontSize: '0.8rem', color: '#94a3b8', textAlign: 'center', marginBottom: '1rem' }}>Verificando datos de la venta...</p>
            )}
            {avisoAnulacion?.requiereAviso && (
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: '12px 16px', marginBottom: '1.2rem' }}>
                <p style={{ fontSize: '0.8rem', color: '#92400e', margin: '0 0 10px', fontWeight: 600, whiteSpace: 'pre-wrap', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                  <UiIcon name="AlertTriangle" size={15} /> {avisoAnulacion.mensaje}
                </p>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: '#92400e', fontWeight: 700, cursor: 'pointer' }}>
                  <input type="checkbox" checked={avisoLeido} onChange={e => setAvisoLeido(e.target.checked)} />
                  Entiendo la advertencia y quiero continuar de todas formas
                </label>
              </div>
            )}
            {msgAnulacion && (
              <div style={{ background: msgAnulacion.ok ? '#f0fdf4' : '#fef2f2', border: `1px solid ${msgAnulacion.ok ? '#bbf7d0' : '#fecaca'}`, borderRadius: 10, padding: '10px 14px', marginBottom: '1rem', fontSize: '0.85rem', fontWeight: 600, color: msgAnulacion.ok ? '#166534' : '#b91c1c' }}>
                {msgAnulacion.texto}
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button onClick={() => { setVentaAAnular(null); setMsgAnulacion(null); setMotivoAnulacion('Error en la emisión'); }} disabled={anulando} data-enter-skip="true" tabIndex={-1} style={{ flex: 1, padding: '0.85rem', background: '#f1f5f9', border: 'none', borderRadius: 12, fontWeight: 600, fontSize: '0.92rem', cursor: 'pointer', color: '#475569' }}>
                Cancelar
              </button>
              <button data-enter-primary="true" onClick={handleAnularVenta} disabled={anulando || cargandoAviso || (avisoAnulacion?.requiereAviso && !avisoLeido)} style={{ flex: 1, padding: '0.85rem', background: anulando ? '#fecaca' : '#dc2626', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: '0.92rem', cursor: (anulando || cargandoAviso || (avisoAnulacion?.requiereAviso && !avisoLeido)) ? 'not-allowed' : 'pointer', color: 'white' }}>
                {anulando ? 'Anulando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {anulando && (
        <LogoCargandoOverlay
          mensaje={anulacionExitosa ? 'Venta anulada' : 'Anulando comprobante...'}
          exito={anulacionExitosa}
        />
      )}

      {/* MODAL DETALLE */}
      {ventaSeleccionada && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100031, padding: '1rem' }} onClick={() => setVentaSeleccionada(null)}>
          <div style={{ background: 'white', borderRadius: 20, width: '100%', maxWidth: 520, maxHeight: '90vh', overflow: 'hidden', boxShadow: '0 25px 80px rgba(0,0,0,0.25)', animation: 'appleSlideUp 0.3s ease', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '1.5rem 1.75rem', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', margin: 0 }}>Comprobante</p>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#0f172a', margin: '2px 0 0' }}>{etiquetaComprobanteVisible(ventaSeleccionada)}</h3>
              </div>
              <button onClick={() => setVentaSeleccionada(null)} className="av-btn-icon-apple">✕</button>
            </div>

            <div style={{ overflowY: 'auto', padding: '1.5rem 1.75rem' }}>
              {ventaSeleccionada.estado_anulacion === 'ANULADO' && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px', marginBottom: '1rem' }}>
                  <p style={{ fontSize: '0.82rem', color: '#b91c1c', margin: 0, fontWeight: 700 }}><UiIcon name="AlertTriangle" size={15} /> Esta venta fue anulada</p>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', marginBottom: '1.5rem' }}>
                <div>
                  <p style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', margin: 0 }}>Cajero</p>
                  <p style={{ fontSize: '0.92rem', color: '#0f172a', fontWeight: 600, margin: '2px 0 0' }}>{ventaSeleccionada.cajero}</p>
                </div>
                <div>
                  <p style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', margin: 0 }}>Sucursal</p>
                  <p style={{ fontSize: '0.92rem', color: '#0f172a', fontWeight: 600, margin: '2px 0 0' }}>{ventaSeleccionada.sucursal}</p>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <p style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', margin: 0 }}>Cliente</p>
                  <p style={{ fontSize: '0.92rem', color: '#0f172a', fontWeight: 600, margin: '2px 0 0' }}>{ventaSeleccionada.cliente || 'Consumidor final'}</p>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <p style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', margin: 0 }}>Fecha y hora</p>
                  <p style={{ fontSize: '0.92rem', color: '#0f172a', fontWeight: 600, margin: '2px 0 0' }}>{new Date(ventaSeleccionada.created_at).toLocaleString('es-PE')}</p>
                </div>
              </div>

              <div style={{ background: '#f8fafc', borderRadius: 12, overflow: 'hidden', marginBottom: '1rem' }}>
                <table className="av-table-apple">
                  <thead><tr><th>Cant.</th><th>Producto</th><th style={{textAlign:'right'}}>Subtotal</th></tr></thead>
                  <tbody>
                    {cargandoDetalle
                      ? <tr><td colSpan="3" style={{textAlign:'center',color:'#94a3b8'}}>Cargando...</td></tr>
                      : detallesVenta.map((d,i) => (
                        <tr key={i}>
                          <td><strong>{d.cantidad}</strong></td>
                          <td>{d.productos?.descripcion||'Producto sin nombre'}</td>
                          <td style={{textAlign:'right'}}><strong>S/ {Number(d.subtotal).toFixed(2)}</strong></td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              {pagosVenta.length > 0 && (
                <div style={{ padding: '1rem 1.2rem', background: '#f8fafc', borderRadius: 12, marginBottom: '1rem' }}>
                  <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', margin: '0 0 0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}><UiIcon name="CreditCard" size={15} /> Forma de pago</p>

                  {pagosVenta.length === 1 ? (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', marginBottom: 6 }}>
                        <span style={{ color: '#64748b' }}>Método</span>
                        <strong>{pagosVenta[0].metodo}</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', marginBottom: 6 }}>
                        <span style={{ color: '#64748b' }}>Monto pagado</span>
                        <strong>S/ {Number(pagosVenta[0].monto).toFixed(2)}</strong>
                      </div>
                      {pagosVenta[0].metodo === 'EFECTIVO' && ventaSeleccionada.vuelto > 0 && (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', marginBottom: 6 }}>
                            <span style={{ color: '#64748b' }}>Recibido del cliente</span>
                            <strong>S/ {(Number(ventaSeleccionada.total) + Number(ventaSeleccionada.vuelto)).toFixed(2)}</strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', color: '#16a34a' }}>
                            <span style={{ fontWeight: 600 }}>Vuelto</span>
                            <strong>S/ {Number(ventaSeleccionada.vuelto).toFixed(2)}</strong>
                          </div>
                        </>
                      )}
                    </>
                  ) : (
                    <div>
                      <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: '0 0 0.5rem', fontWeight: 600 }}>PAGO MIXTO:</p>
                      {pagosVenta.map((p, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', marginBottom: 4 }}>
                          <span style={{ color: '#64748b' }}>{p.metodo}</span>
                          <strong>S/ {Number(p.monto).toFixed(2)}</strong>
                        </div>
                      ))}
                    </div>
                  )}

                  {ventaSeleccionada.descuento > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginTop: 10, paddingTop: 10, borderTop: '1px dashed #cbd5e1', color: '#dc2626' }}>
                      <span style={{ fontWeight: 600 }}>Descuento aplicado</span>
                      <strong>- S/ {Number(ventaSeleccionada.descuento).toFixed(2)}</strong>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{ padding: '1.25rem 1.75rem', background: 'linear-gradient(135deg, #0f172a, #1e293b)', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <p style={{ fontSize: '0.78rem', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', margin: 0, opacity: 0.8 }}>Total</p>
              <h2 style={{ fontSize: '1.6rem', fontWeight: 800, margin: 0, letterSpacing: '-0.01em' }}>S/ {Number(ventaSeleccionada.total).toFixed(2)}</h2>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}