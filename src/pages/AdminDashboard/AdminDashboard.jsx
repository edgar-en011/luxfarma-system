import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { contarComprobantesSunat } from '../../utils/estadoSunat';
import { useAppData } from '../../context/AppDataContext';
import { useAuth } from '../../context/AuthContext';
import { calcularProductosStockBajo, cargarIdsProductosConMovimiento } from '../../utils/stockBajo';
import { formatHora12AmPm } from '../../utils/fechas';
import { labelTurno } from '../../utils/turnosVentas';
import { gananciaDesdeDetallesVenta } from '../../utils/productoPrecios';
import VentasAreaChart from './VentasAreaChart';
import './AdminDashboard.css';
import UiIcon from '../../components/UiIcon';
import LogoLuxFarma from '../../components/LogoLuxFarma';
import { facturacionElectronica } from '../../config/empresa';

const AVATAR_COLORS = ['#E11D2E', '#F2B84B', '#1F8A4C', '#B7791F', '#6B6264', '#C8102E', '#F2B84B', '#52525B'];

// Descarta turnos "fantasma": el embed a usuarios viene null cuando el
// id_usuario_vendedor ya no existe en la tabla usuarios (usuario eliminado
// directamente en Supabase), y también los de usuarios desactivados
// (activo: false) — el soft-delete normal de AdminUsuarios.jsx.
const filtrarTurnosValidos = (turnos) => (turnos || []).filter(t =>
  t.usuarios != null && (String(t.usuarios.activo) === '1' || t.usuarios.activo === true)
);

// Sanea nombres corruptos guardados en la BD (ej: "EUNDEFINED" de un registro viejo
// donde apellidos terminó literalmente como el texto "undefined") — quita esos tokens
// para que nunca se muestren como si fueran parte del nombre real del vendedor.
const limpiarNombre = (nombre) => (nombre || '').replace(/\bundefined\b/gi, '').replace(/\bnull\b/gi, '').trim();

// A nivel de módulo (no closure del componente) para que los useCallback que dependen
// del rango no se recreen en cada render ni arrastren dependencias fantasma.
const rangoFechasPeriodo = (filtroTiempo) => {
  const start = new Date(); const end = new Date();
  end.setHours(23, 59, 59, 999);
  if (filtroTiempo === 'Hoy') { start.setHours(0, 0, 0, 0); }
  else if (filtroTiempo === 'Ayer') { start.setDate(start.getDate() - 1); start.setHours(0, 0, 0, 0); end.setDate(end.getDate() - 1); end.setHours(23, 59, 59, 999); }
  else if (filtroTiempo === 'Esta semana') { start.setDate(start.getDate() - 6); start.setHours(0, 0, 0, 0); }
  else if (filtroTiempo === 'Este mes') { start.setDate(1); start.setHours(0, 0, 0, 0); }
  return { start: start.toISOString(), end: end.toISOString() };
};

export default function AdminDashboard() {
  const { appData, refrescarSeccion } = useAppData();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [filtroTiempo, setFiltroTiempo] = useState('Hoy');

  const [kpis, setKpis] = useState({ ventasTotal: 0, operaciones: 0, ticketPromedio: 0, gananciaNeta: 0 });
  const [turnosAbiertos, setTurnosAbiertos] = useState([]);
  const [topProductos, setTopProductos] = useState([]);
  // enviados/pendientes/error salen de comprobantes_sunat.estado_envio (misma tabla que la
  // pantalla SUNAT) y aceptados de comprobantes_sunat.aceptada_por_sunat, que es un eje
  // aparte: un ENVIADO puede tardar días en ser aceptado. anulados sale de
  // ventas.estado_anulacion, que es donde vive ese dato.
  const [sunatStatus, setSunatStatus] = useState({ enviados: 0, aceptados: 0, pendientes: 0, error: 0, sin_confirmar: 0, anulados: 0 });
  const [notasVentaStatus, setNotasVentaStatus] = useState({ cantidad: 0, total: 0, anuladas: 0 });
  const [metodosPago, setMetodosPago] = useState({ efectivo: 0, yape: 0, tarjeta: 0, otros: 0, total: 0 });
  const [datosGrafico, setDatosGrafico] = useState({});
  const [ventasPorTrabajador, setVentasPorTrabajador] = useState([]);
  const [alertasUrgentes, setAlertasUrgentes] = useState({ total: 0, detalle: '' });
  const [sucursales, setSucursales] = useState([]);
  const [sucursalFiltro, setSucursalFiltro] = useState('TODAS');

  // "Rendimiento por vendedor" vive ahora en la burbuja flotante (estilo Messenger) en
  // vez de ocupar una sección fija del layout — misma tabla, mismos datos, solo cambió
  // el contenedor visual. Cierra sola con un click afuera (sin backdrop, para no
  // bloquear el resto del dashboard mientras está abierta).
  const [bubbleAbierta, setBubbleAbierta] = useState(false);
  /** ids de vendedor con desglose de turnos expandido en la burbuja */
  const [turnosExpandidos, setTurnosExpandidos] = useState(() => new Set());
  const bubbleWrapRef = useRef(null);

  useEffect(() => {
    setTurnosExpandidos(new Set());
  }, [filtroTiempo, sucursalFiltro]);
  useEffect(() => {
    if (!bubbleAbierta) return undefined;
    const handleClickFuera = (e) => {
      if (bubbleWrapRef.current && !bubbleWrapRef.current.contains(e.target)) {
        setBubbleAbierta(false);
      }
    };
    document.addEventListener('mousedown', handleClickFuera);
    return () => document.removeEventListener('mousedown', handleClickFuera);
  }, [bubbleAbierta]);

  // "Últimos valores" leídos dentro del canal Realtime de ventas (más abajo) sin forzar
  // que ese efecto se re-suscriba cada vez que appData/turnosAbiertos cambian — evita
  // recrear el canal (y perder eventos durante el re-subscribe) en cada actualización
  // ajena a ventas, ej. cuando el canal de turnos actualiza turnosAbiertos.
  const appDataRef = useRef(appData);
  appDataRef.current = appData;
  const turnosAbiertosRef = useRef(turnosAbiertos);
  turnosAbiertosRef.current = turnosAbiertos;

  useEffect(() => { cargarDatosDashboard(); }, [filtroTiempo, sucursalFiltro]);

  // Panel "Estado SUNAT": consulta propia a comprobantes_sunat, la misma tabla que lista
  // AdminSunat. Antes se contaba ventas.estado_sunat con un catch-all (`else pendientes++`)
  // que metía ENVIADO, REQUIERE_REVISION y las notas de venta (estado null) en
  // "pendientes", y además ventas.estado_sunat puede quedar desfasado del comprobante.
  const cargarEstadoSunat = useCallback(async () => {
    const { start, end } = rangoFechasPeriodo(filtroTiempo);
    try {
      const conteo = await contarComprobantesSunat(supabase, {
        idSucursal: sucursalFiltro === 'TODAS' ? null : sucursalFiltro,
        desde: start,
        hasta: end,
      });
      setSunatStatus(prev => ({
        ...prev,
        enviados: conteo.enviados,
        aceptados: conteo.aceptados,
        pendientes: conteo.pendientes,
        error: conteo.error,
        sin_confirmar: conteo.sin_confirmar,
      }));
    } catch (e) {
      console.error('Error cargando estado SUNAT:', e);
    }
  }, [filtroTiempo, sucursalFiltro]);

  useEffect(() => { if (facturacionElectronica) cargarEstadoSunat(); }, [cargarEstadoSunat]);

  // Realtime en comprobantes_sunat → el panel se corrige solo cuando el POS emite, el
  // reintento automático reenvía, o el Admin toca "Consultar estado" en la pantalla
  // SUNAT. Activo en todos los periodos (es un conteo barato), no solo en "Hoy".
  useEffect(() => {
    if (!facturacionElectronica) return undefined;
    let timeoutId = null;
    const canalSunat = supabase
      .channel('admin-dashboard-sunat-watch')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'comprobantes_sunat'
      }, () => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => { cargarEstadoSunat(); }, 400);
      })
      .subscribe();

    return () => {
      clearTimeout(timeoutId);
      supabase.removeChannel(canalSunat);
    };
  }, [cargarEstadoSunat]);

  // Red de seguridad si Realtime se cayó o el equipo estuvo suspendido: al volver a la
  // pestaña/ventana se relee el conteo.
  useEffect(() => {
    if (!facturacionElectronica) return undefined;
    const refrescar = () => {
      if (document.visibilityState === 'visible') cargarEstadoSunat();
    };
    window.addEventListener('focus', refrescar);
    document.addEventListener('visibilitychange', refrescar);
    return () => {
      window.removeEventListener('focus', refrescar);
      document.removeEventListener('visibilitychange', refrescar);
    };
  }, [cargarEstadoSunat]);

  // Realtime en caja_turnos → cuando un vendedor abre/cierra turno, refresca
  // turnosAbiertos y el flag "activo" de cada trabajador al instante, sin esperar a
  // que el Admin recargue la página. También actualiza appData.turnos (vía
  // refrescarSeccion). Nota: la carga inicial ya pide turnos fresco a Supabase
  // (no usa caché); Realtime es complemento, no el único mecanismo.
  useEffect(() => {
    const canalTurnos = supabase
      .channel('admin-dashboard-turnos-watch')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'caja_turnos'
      }, async () => {
        let query = supabase
          .from('caja_turnos')
          .select('id_turno, apertura_at, monto_apertura, id_usuario_vendedor, id_sucursal, usuarios!caja_turnos_id_usuario_vendedor_fkey(nombres, apellidos, activo)')
          .eq('estado', 'ABIERTO');
        if (sucursalFiltro !== 'TODAS') query = query.eq('id_sucursal', sucursalFiltro);
        const { data } = await query;
        const turnos = filtrarTurnosValidos(data);
        setTurnosAbiertos(turnos);
        setVentasPorTrabajador(prev => prev.map(t => ({ ...t, activo: turnos.some(x => x.id_usuario_vendedor === t.id) })));
        refrescarSeccion('turnos');
      })
      .subscribe();

    return () => {
      supabase.removeChannel(canalTurnos);
    };
  }, [sucursalFiltro, refrescarSeccion]);

  // Realtime en ventas → cuando un vendedor registra una venta (o SUNAT/anulación/
  // devolución actualiza una existente), refresca "Rendimiento por vendedor", KPIs,
  // SUNAT, métodos de pago, top productos y el gráfico, sin esperar a que el Admin
  // recargue. Solo activo en "Hoy" (los demás rangos son consultas puntuales, no
  // tiene sentido mantenerlos "vivos"). Debounce de 400ms porque una sola venta genera
  // varios eventos seguidos (INSERT en ventas + luego UPDATE de estado_sunat, y a
  // veces ráfagas de varios vendedores a la vez) y porque venta_detalle/pagos_venta
  // se insertan en llamadas separadas después de ventas — el margen evita refrescar
  // con esas tablas hijas todavía incompletas.
  useEffect(() => {
    if (filtroTiempo !== 'Hoy') return;

    let timeoutId = null;
    const canalVentas = supabase
      .channel('admin-dashboard-ventas-watch')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'ventas'
      }, () => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(async () => {
          const { start, end } = obtenerRangoFechas();
          let query = supabase
            .from('ventas')
            .select(`
              id_venta, total, created_at, estado_sunat, estado_anulacion, id_usuario_vendedor, id_sucursal, id_turno,
              pagos_venta (metodo, monto),
              venta_detalle (cantidad, subtotal, factor, costo_unitario, productos(descripcion, producto_precios(costo)))
            `)
            .gte('created_at', start)
            .lte('created_at', end);
          if (sucursalFiltro !== 'TODAS') query = query.eq('id_sucursal', sucursalFiltro);
          const { data } = await query;
          procesarVentasData(data || [], appDataRef.current?.usuarios || [], turnosAbiertosRef.current);
          cargarEstadoSunat();
          refrescarSeccion('ventas');
        }, 400);
      })
      .subscribe();

    return () => {
      clearTimeout(timeoutId);
      supabase.removeChannel(canalVentas);
    };
  }, [filtroTiempo, sucursalFiltro, refrescarSeccion]);

  useEffect(() => {
    if (appData?.sucursales) {
      setSucursales((appData.sucursales || []).filter(s => String(s.activo) === '1' || s.activo === true));
    } else {
      supabase.from('sucursales').select('id_sucursal, nombre_comercial, activo').then(({ data }) => {
        setSucursales((data || []).filter(s => String(s.activo) === '1' || s.activo === true));
      });
    }
  }, [appData]);

  useEffect(() => {
    if (appData) {
      cargarAlertasDesdeContexto();
    } else {
      cargarAlertasDesdeSupabase();
    }
  }, [appData]);

  const cargarAlertasDesdeContexto = async () => {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const tickets  = appData.ticketsPendientes || 0;
    const todosLotes = appData.lotesAlerta || [];
    const lotesFilt = sucursalFiltro !== 'TODAS'
      ? todosLotes.filter(l => String(l.id_sucursal) === String(sucursalFiltro))
      : todosLotes;
    const idsMovimiento = await cargarIdsProductosConMovimiento();
    const stockBajo = calcularProductosStockBajo(appData.productos, lotesFilt, idsMovimiento).length;
    const deudas = (appData.compras || []).filter(c => {
      const saldo = Number(c.total_compra || 0) - Number(c.monto_pagado || 0);
      if (saldo <= 0) return false;
      const dias = Math.ceil((new Date(c.fecha_vencimiento) - hoy) / 86400000);
      return dias <= 2;
    }).length;
    const total = tickets + stockBajo + deudas;
    const partes = [];
    if (tickets > 0) partes.push(`${tickets} ticket${tickets > 1 ? 's' : ''}`);
    if (stockBajo > 0) partes.push(`${stockBajo} stock bajo`);
    if (deudas > 0) partes.push(`${deudas} deuda${deudas > 1 ? 's' : ''}`);
    setAlertasUrgentes({ total, detalle: partes.join(' · ') || 'Sin alertas activas' });
  };

  const cargarAlertasDesdeSupabase = async () => {
    try {
      const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
      const idsMovimiento = await cargarIdsProductosConMovimiento();
      const idsUsados = [...idsMovimiento];
      const [resTickets, resLotes, resCompras, resProductos] = await Promise.all([
        supabase.from('tickets_soporte').select('*', { count: 'exact', head: true }).eq('estado', 'PENDIENTE'),
        idsUsados.length
          ? supabase.from('inventario_lotes').select('id_producto, cantidad_actual, id_sucursal, estado, fecha_vencimiento').eq('estado', 'VIGENTE').in('id_producto', idsUsados)
          : Promise.resolve({ data: [] }),
        supabase.from('compras').select('total_compra, monto_pagado, fecha_vencimiento').not('forma_pago', 'ilike', 'contado').neq('estado_pago', 'PAGADO'),
        idsUsados.length
          ? supabase.from('productos').select('id_producto, stock_minimo').eq('activo', 1).in('id_producto', idsUsados)
          : Promise.resolve({ data: [] }),
      ]);
      const tickets = resTickets.count || 0;
      const todosLotes = resLotes.data || [];
      const lotesFilt = sucursalFiltro !== 'TODAS'
        ? todosLotes.filter(l => String(l.id_sucursal) === String(sucursalFiltro))
        : todosLotes;
      const stockBajo = calcularProductosStockBajo(resProductos.data, lotesFilt, idsMovimiento).length;
      const deudas = (resCompras.data || []).filter(c => {
        const saldo = Number(c.total_compra || 0) - Number(c.monto_pagado || 0);
        if (saldo <= 0) return false;
        const dias = Math.ceil((new Date(c.fecha_vencimiento) - hoy) / 86400000);
        return dias <= 2;
      }).length;
      const total = tickets + stockBajo + deudas;
      const partes = [];
      if (tickets > 0) partes.push(`${tickets} ticket${tickets > 1 ? 's' : ''}`);
      if (stockBajo > 0) partes.push(`${stockBajo} stock bajo`);
      if (deudas > 0) partes.push(`${deudas} deuda${deudas > 1 ? 's' : ''}`);
      setAlertasUrgentes({ total, detalle: partes.join(' · ') || 'Sin alertas activas' });
    } catch (e) { console.error(e); }
  };

  const obtenerRangoFechas = () => rangoFechasPeriodo(filtroTiempo);

  // Filtro centralizado de anuladas (mismo criterio que ya usa AdminVentas.jsx) — se
  // aplica una sola vez acá, así ningún caller (carga inicial, appData cacheado, o el
  // refresh del canal Realtime) necesita acordarse de excluirlas por su cuenta.
  const procesarVentasData = (ventasDataCruda, usuariosData, turnosData) => {
    const cruda = ventasDataCruda || [];
    // Anulados del mismo rango que Aceptados/Pendientes/Error (obtenerRangoFechas /
    // caché Hoy). El resto de KPIs sigue excluyendo ANULADO.
    const anuladosPeriodo = cruda.filter(v => v.estado_anulacion === 'ANULADO').length;
    const ventasData = cruda.filter(v => v.estado_anulacion !== 'ANULADO');
    const esNota = (v) => String(v.tipo_comprobante || '').toUpperCase().includes('NOTA');
    const notasActivas = ventasData.filter(esNota);
    setNotasVentaStatus({
      cantidad: notasActivas.length,
      total: notasActivas.reduce((s, v) => s + Number(v.total || 0), 0),
      anuladas: cruda.filter((v) => v.estado_anulacion === 'ANULADO' && esNota(v)).length,
    });

    const usuariosMap = {};
    (usuariosData || []).forEach(u => {
      usuariosMap[u.id_usuario] = limpiarNombre(`${u.nombres || ''} ${u.apellidos || ''}`.trim());
    });

    const turnosAbiertosIds = new Set((turnosData || []).map(t => t.id_usuario_vendedor));

    let totalSoles = 0;
    let totalGanancia = 0;
    let countOperaciones = ventasData.length;
    let pagos = { efectivo: 0, yape: 0, tarjeta: 0, otros: 0, total: 0 };
    let productosMap = {};
    let graficoMap = {};
    let trabajadoresMap = {};
    const diasCortos = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

    ventasData.forEach(venta => {
      const monto = Number(venta.total || 0);
      totalSoles += monto;
      totalGanancia += gananciaDesdeDetallesVenta(venta.venta_detalle);

      const date = new Date(venta.created_at);
      if (filtroTiempo === 'Hoy' || filtroTiempo === 'Ayer') {
        const h = date.getHours();
        graficoMap[h] = (graficoMap[h] || 0) + monto;
      } else if (filtroTiempo === 'Esta semana') {
        const d = diasCortos[date.getDay()];
        graficoMap[d] = (graficoMap[d] || 0) + monto;
      } else if (filtroTiempo === 'Este mes') {
        const d = date.getDate();
        graficoMap[d] = (graficoMap[d] || 0) + monto;
      }

      venta.pagos_venta?.forEach(pago => {
        const mp = Number(pago.monto || 0);
        pagos.total += mp;
        if (pago.metodo === 'EFECTIVO') pagos.efectivo += mp;
        else if (pago.metodo === 'YAPE') pagos.yape += mp;
        else if (pago.metodo === 'TARJETA') pagos.tarjeta += mp;
        else pagos.otros += mp;
      });

      venta.venta_detalle?.forEach(det => {
        const nombre = det.productos?.descripcion || `Producto ID: ${det.id_producto || '?'}`;
        if (!productosMap[nombre]) productosMap[nombre] = 0;
        productosMap[nombre] += Number(det.subtotal || 0);
      });

      // Si la venta no tiene vendedor asociado (dato corrupto/huérfano), se sigue
      // sumando al total general de arriba, pero no genera una fila "Vendedor #undefined"
      // en el ranking.
      const idVend = venta.id_usuario_vendedor;
      if (idVend != null) {
        if (!trabajadoresMap[idVend]) {
          trabajadoresMap[idVend] = {
            id: idVend,
            nombre: usuariosMap[idVend] || `Vendedor #${idVend}`,
            total: 0,
            operaciones: 0,
            activo: turnosAbiertosIds.has(idVend),
            turnosIds: new Set(),
            turnosTotales: {},
          };
        }
        trabajadoresMap[idVend].total += monto;
        trabajadoresMap[idVend].operaciones += 1;
        if (venta.id_turno != null) {
          trabajadoresMap[idVend].turnosIds.add(venta.id_turno);
          trabajadoresMap[idVend].turnosTotales[venta.id_turno] =
            (trabajadoresMap[idVend].turnosTotales[venta.id_turno] || 0) + monto;
        }
      }
    });

    // Cualquiera con turno ABIERTO cuenta como "en turno ahora", tenga o no ventas hoy —
    // antes solo aparecían acá los que ya habían vendido algo. Se ignoran turnos sin
    // id_usuario_vendedor (dato corrupto/huérfano).
    (turnosData || []).forEach(t => {
      const idVend = t.id_usuario_vendedor;
      if (idVend == null) return;
      if (!trabajadoresMap[idVend]) {
        trabajadoresMap[idVend] = {
          id: idVend,
          nombre: usuariosMap[idVend] || `Vendedor #${idVend}`,
          total: 0,
          operaciones: 0,
          activo: true,
          turnosIds: new Set(),
          turnosTotales: {},
        };
      }
    });

    const rankingTrabajadores = Object.values(trabajadoresMap)
      .sort((a, b) => b.total - a.total)
      .map(({ turnosIds, turnosTotales, ...t }) => ({
        ...t,
        turnosCount: turnosIds instanceof Set ? turnosIds.size : 0,
        turnosDesglose: Object.entries(turnosTotales || {})
          .map(([id, total]) => ({ id_turno: Number(id), total: Number(total) }))
          .sort((a, b) => a.id_turno - b.id_turno),
        ticketPromedio: t.operaciones > 0 ? t.total / t.operaciones : 0,
      }));

    const top5 = Object.keys(productosMap)
      .map(nombre => ({ nombre, total: productosMap[nombre] }))
      .sort((a, b) => b.total - a.total).slice(0, 5);

    setKpis({ ventasTotal: totalSoles, operaciones: countOperaciones, ticketPromedio: countOperaciones > 0 ? totalSoles / countOperaciones : 0, gananciaNeta: totalGanancia });
    // Solo "anulados" viene de ventas; los estados de envío los trae cargarEstadoSunat
    // desde comprobantes_sunat, así que se hace merge en vez de sobrescribir.
    setSunatStatus(prev => ({ ...prev, anulados: anuladosPeriodo }));
    setMetodosPago(pagos);
    setTopProductos(top5);
    setDatosGrafico(graficoMap);
    setVentasPorTrabajador(rankingTrabajadores);
  };

  const cargarDatosDashboard = async () => {
    // Turnos abiertos siempre se piden fresco a Supabase: "quién está en turno ahora"
    // cambia con cada apertura/cierre y no debe depender de appData.turnos (caché de
    // sesión). Realtime ayuda, pero no es el único mecanismo de corrección.
    const fetchTurnosAbiertos = async () => {
      let queryTurnos = supabase
        .from('caja_turnos')
        .select('id_turno, apertura_at, monto_apertura, id_usuario_vendedor, id_sucursal, usuarios!caja_turnos_id_usuario_vendedor_fkey(nombres, apellidos, activo)')
        .eq('estado', 'ABIERTO');
      if (sucursalFiltro !== 'TODAS') {
        queryTurnos = queryTurnos.eq('id_sucursal', sucursalFiltro);
      }
      const { data } = await queryTurnos;
      return filtrarTurnosValidos(data);
    };

    // Siempre fetch fresco de ventas (antes "Hoy" reutilizaba appData.ventas cacheado
    // del login, sin id_sucursal fiable → ventas nuevas del Admin/POS no aparecían y el
    // filtro por sucursal podía vaciar la lista).
    setLoading(true);
    const { start, end } = obtenerRangoFechas();
    try {
      let queryVentas = supabase
        .from('ventas')
        .select(`
          id_venta, total, created_at, estado_sunat, estado_anulacion, tipo_comprobante, id_usuario_vendedor, id_sucursal, id_turno,
          pagos_venta (metodo, monto),
          venta_detalle (cantidad, subtotal, factor, costo_unitario, productos(descripcion, producto_precios(costo)))
        `)
        .gte('created_at', start)
        .lte('created_at', end);
      if (sucursalFiltro !== 'TODAS') {
        queryVentas = queryVentas.eq('id_sucursal', sucursalFiltro);
      }

      const [resVentas, turnosValidos, resUsuarios] = await Promise.all([
        queryVentas,
        fetchTurnosAbiertos(),
        supabase.from('usuarios').select('id_usuario, nombres, apellidos'),
      ]);

      const ventasData = resVentas.data || [];
      setTurnosAbiertos(turnosValidos);
      procesarVentasData(ventasData, resUsuarios.data || [], turnosValidos);

    } catch (error) {
      console.error("Error general cargando dashboard:", error);
    } finally {
      setLoading(false);
    }
  };

  const pctEfectivo = metodosPago.total > 0 ? Math.round((metodosPago.efectivo / metodosPago.total) * 100) : 0;
  const pctYape     = metodosPago.total > 0 ? Math.round((metodosPago.yape / metodosPago.total) * 100) : 0;
  const pctTarjeta  = metodosPago.total > 0 ? Math.round((metodosPago.tarjeta / metodosPago.total) * 100) : 0;
  const pctOtros    = metodosPago.total > 0 ? 100 - pctEfectivo - pctYape - pctTarjeta : 0;
  const conicGradientStr = `conic-gradient(#E11D2E 0% ${pctEfectivo}%, #FFB020 ${pctEfectivo}% ${pctEfectivo + pctYape}%, #3F3F46 ${pctEfectivo + pctYape}% ${pctEfectivo + pctYape + pctTarjeta}%, #A1A1AA ${pctEfectivo + pctYape + pctTarjeta}% 100%)`;

  let etiquetasX = [];
  if (filtroTiempo === 'Hoy' || filtroTiempo === 'Ayer') {
    // 0–23: ventas de madrugada/noche (típicas del Admin) deben aparecer en el gráfico
    etiquetasX = Array.from({ length: 24 }, (_, i) => i);
  } else if (filtroTiempo === 'Esta semana') {
    const diasCortos = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); etiquetasX.push(diasCortos[d.getDay()]); }
  } else if (filtroTiempo === 'Este mes') {
    const diasMes = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    etiquetasX = Array.from({ length: diasMes }, (_, i) => i + 1);
  }

  const maxTrabajador = ventasPorTrabajador.length > 0 ? ventasPorTrabajador[0].total : 1;
  const puntosGrafico = etiquetasX.map((etiqueta) => {
    const labelStr = (filtroTiempo === 'Hoy' || filtroTiempo === 'Ayer')
      ? formatHora12AmPm(etiqueta)
      : String(etiqueta);
    return { label: labelStr, valor: Number(datosGrafico[etiqueta] || 0) };
  });

  const getInitials = (nombre) => {
    // split(/\s+/) colapsa espacios múltiples/duplicados (ej. "EDGAR  SICCHA" con doble
    // espacio) — split(' ') a secas dejaba un elemento vacío en medio, cuyo [0] es
    // undefined y producía iniciales rotas tipo "Eundefined".
    const parts = nombre.trim().split(/\s+/).filter(Boolean);
    return parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}`.toUpperCase() : nombre.slice(0, 2).toUpperCase();
  };

  const getRankClass = (i) => i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : 'rank-other';

  if (loading) {
    return (
        <div className="dash-loading">
          <LogoLuxFarma variant="icon" size={44} color="red" />
          <span>Cargando métricas consolidadas...</span>
        </div>
    );
  }

  return (
    <div className="admin-container">

      {/* FILTROS */}
      <div className="admin-top-filters">
        <div className="filter-tabs">
          {['Hoy', 'Ayer', 'Esta semana', 'Este mes'].map(tab => (
            <button key={tab} className={`tab ${filtroTiempo === tab ? 'active' : ''}`} onClick={() => setFiltroTiempo(tab)}>{tab}</button>
          ))}
        </div>
        <div className="filter-branch">
          <select
            className="btn-sucursal-select"
            value={sucursalFiltro}
            onChange={e => setSucursalFiltro(e.target.value)}
          >
            <option value="TODAS">Todas las sucursales</option>
            {sucursales.map(s => (
              <option key={s.id_sucursal} value={s.id_sucursal}>
                {s.nombre_comercial}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* KPIs */}
      <div className="kpi-grid">
        <div className="kpi-card glow-blue">
          <div className="kpi-icon-box blue"><UiIcon name="Banknote" size={28} /></div>
          <div className="kpi-copy">
            <p className="kpi-label">VENTAS {filtroTiempo.toUpperCase()}</p>
            <h3>S/ {kpis.ventasTotal.toFixed(2)}</h3>
            <div className="kpi-trend neutral"><span>{filtroTiempo === 'Hoy' ? 'En tiempo real' : 'Consolidado'}</span></div>
          </div>
        </div>
        <div className="kpi-card glow-green">
          <div className="kpi-icon-box green"><UiIcon name="TrendingUp" size={28} /></div>
          <div className="kpi-copy">
            <p className="kpi-label">GANANCIA NETA <UiIcon name="Lock" size={12} /></p>
            <h3>S/ {kpis.gananciaNeta.toFixed(2)}</h3>
            <div className="kpi-trend neutral"><span style={{ color: 'var(--lf-text-muted)' }}>*Según costo de catálogo</span></div>
          </div>
        </div>
        <div className="kpi-card glow-red" style={{ cursor: alertasUrgentes.total > 0 ? 'pointer' : 'default' }}>
          <div className="kpi-icon-box red"><UiIcon name="AlertTriangle" size={28} /></div>
          <div className="kpi-copy">
            <p className="kpi-label">ALERTAS URGENTES</p>
            <h3 style={{ color: alertasUrgentes.total > 0 ? '#ef4444' : 'var(--lf-text)' }}>{alertasUrgentes.total}</h3>
            <div className="kpi-trend neutral"><span style={{ color: alertasUrgentes.total > 0 ? '#ef4444' : 'var(--lf-text-muted)', fontSize: '0.72rem' }}>{alertasUrgentes.detalle}</span></div>
          </div>
        </div>
        <div className="kpi-card glow-brand-light">
          <div className="kpi-icon-box amber"><UiIcon name="ClipboardList" size={28} /></div>
          <div className="kpi-copy">
            <p className="kpi-label">OPERACIONES</p>
            <h3>{kpis.operaciones} ventas</h3>
            <div className="kpi-trend neutral"><span style={{ color: 'var(--lf-text-muted)' }}>Ticket prom. S/ {kpis.ticketPromedio.toFixed(2)}</span></div>
          </div>
        </div>
      </div>

      <div className="dash-main">
      {/* GRÁFICO + TOP PRODUCTOS */}
      <div className="middle-grid-admin">
        <div className="admin-panel chart-panel">
          <div className="panel-header-admin">
            <div><h3>Ventas — {filtroTiempo}</h3><p>Todas las sucursales · Mostrando: Todos los empleados</p></div>
          </div>
          <VentasAreaChart puntos={puntosGrafico} />
        </div>

        <div className="admin-panel top-products">
          <h3>Top productos - {filtroTiempo}</h3>
          <div className="product-list">
            {topProductos.length === 0 ? (
              <div className="dash-empty">
                <div className="dash-empty-icon"><UiIcon name="Package" size={28} /></div>
                <p className="dash-empty-title">No hay ventas registradas en este periodo.</p>
                <p className="dash-empty-sub">Los productos más vendidos del período aparecerán aquí.</p>
              </div>
            ) : topProductos.map((prod, index) => {
              const colorClases = ['bg-blue', 'bg-purple', 'bg-green', 'bg-orange', 'bg-red'];
              const porcentaje = (prod.total / topProductos[0].total) * 100;
              return (
                <div className="prod-item" key={index}>
                  <span className="prod-rank">{index + 1}</span>
                  <span className="prod-name" title={prod.nombre}>{prod.nombre}</span>
                  <div className="progress-bg"><div className={`progress-fill ${colorClases[index]}`} style={{ width: `${porcentaje}%` }}></div></div>
                  <span className="prod-val">S/ {prod.total.toFixed(0)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* SECCIÓN INFERIOR */}
      <div className="bottom-grid-admin">
        <div className="admin-panel turnos-panel">
          <div className="panel-header-admin">
            <h3>Turnos activos ahora</h3>
            <span className="badge-green-soft">{turnosAbiertos.length} activos</span>
          </div>
          <div className="turnos-list">
            {turnosAbiertos.length === 0 ? (
              <div className="dash-empty">
                <div className="dash-empty-icon"><UiIcon name="Users" size={28} /></div>
                <p className="dash-empty-title">No hay cajeros en turno.</p>
                <p className="dash-empty-sub">Cuando un cajero abra su caja, lo verás en esta lista.</p>
              </div>
            ) : turnosAbiertos.map(turno => {
              const diffMs = new Date() - new Date(turno.apertura_at);
              const diffHrs = Math.floor((diffMs % 86400000) / 3600000);
              const diffMins = Math.round(((diffMs % 86400000) % 3600000) / 60000);
              const esTurnoPropio = turno.id_usuario_vendedor === user?.id_usuario;
              const nombreVendedor = esTurnoPropio
                ? 'Tú'
                : (turno.usuarios ? limpiarNombre(`${turno.usuarios.nombres || ''} ${turno.usuarios.apellidos || ''}`.trim()) : `Vendedor #${turno.id_usuario_vendedor}`);
              return (
                <div className="turno-card" key={turno.id_turno}>
                  <div className="circle-icon bg-brand-soft">CA</div>
                  <div className="turno-info">
                    <strong>{nombreVendedor || `Caja #${turno.id_turno}`}</strong>
                    <p>Sede ID: {turno.id_sucursal}<br />Desde {new Date(turno.apertura_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })} · {diffHrs}h {diffMins}min</p>
                    <span className="monto">Inició: S/ {Number(turno.monto_apertura).toFixed(2)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {facturacionElectronica ? (
        <div className="admin-panel sunat-panel">
          <div className="panel-header-admin"><h3>ESTADO SUNAT - {filtroTiempo.toUpperCase()}</h3></div>
          <div className="sunat-boxes">
            <div className="sunat-box gray"><p>ENVIADOS</p><h2>{sunatStatus.enviados}</h2></div>
            <div className="sunat-box yellow"><p>PENDIENTES</p><h2>{sunatStatus.pendientes}</h2></div>
            <div className="sunat-box orange"><p>SIN CONFIRMAR</p><h2>{sunatStatus.sin_confirmar}</h2></div>
            <div className="sunat-box red"><p><UiIcon name="AlertCircle" size={12} /> ERROR</p><h2>{sunatStatus.error}</h2></div>
            <div className="sunat-box green"><p>ACEPTADOS</p><h2>{sunatStatus.aceptados}</h2></div>
            <div className="sunat-box gray"><p>ANULADOS</p><h2>{sunatStatus.anulados}</h2></div>
          </div>
          <p className="sunat-note">
            Enviados / Pendientes / Error: ¿salió el comprobante hacia Nubefact?
            Sin confirmar: ya se envió, pero SUNAT no lo validó (2 días o más). Sigue contando como enviado.
            Aceptados: SUNAT ya lo confirmó.
            Anulados: ventas anuladas del periodo ({filtroTiempo}). Las notas de venta no van a SUNAT.
          </p>
        </div>
        ) : (
        <div className="admin-panel sunat-panel">
          <div className="panel-header-admin"><h3>NOTAS DE VENTA - {filtroTiempo.toUpperCase()}</h3></div>
          <div className="sunat-boxes">
            <div className="sunat-box gray"><p>EMITIDAS</p><h2>{notasVentaStatus.cantidad}</h2></div>
            <div className="sunat-box green"><p>TOTAL S/</p><h2>{notasVentaStatus.total.toFixed(0)}</h2></div>
            <div className="sunat-box gray"><p>ANULADAS</p><h2>{notasVentaStatus.anuladas}</h2></div>
          </div>
          <p className="sunat-note">
            Resumen de notas de venta del periodo ({filtroTiempo}). Documento interno, sin envío a SUNAT.
          </p>
        </div>
        )}

        <div className="admin-panel chart-donut-panel">
          <h3>Métodos de pago</h3>
          <div className="donut-wrapper">
            <div className={`donut-chart${metodosPago.total > 0 ? '' : ' is-empty'}`} style={{ background: metodosPago.total > 0 ? conicGradientStr : 'var(--lf-border)' }}>
              <div className="donut-inner">
                <span>S/ {metodosPago.total.toFixed(0)}</span>
                <small>Total</small>
              </div>
            </div>
            <div className="donut-legend">
              <div className="leg-item"><span className="dot bg-blue"></span> Efectivo <strong>{pctEfectivo}%</strong></div>
              <div className="leg-item"><span className="dot bg-purple"></span> Yape <strong>{pctYape}%</strong></div>
              <div className="leg-item"><span className="dot bg-gray"></span> Tarjeta <strong>{pctTarjeta}%</strong></div>
              {pctOtros > 0 && <div className="leg-item"><span className="dot bg-gray"></span> Otros <strong>{pctOtros}%</strong></div>}
            </div>
          </div>
        </div>
      </div>
      </div>

      {/* BURBUJA FLOTANTE — Rendimiento por vendedor (antes era una sección fija del
          layout; mismo contenido/lógica, solo cambió el contenedor visual) */}
      <div className="worker-bubble-wrap" ref={bubbleWrapRef}>
        {bubbleAbierta && (
          <div className="worker-bubble-panel">
            <div className="worker-bubble-header">
              <div>
                <h3><UiIcon name="Users" size={16} /> Rendimiento por vendedor — {filtroTiempo}</h3>
                <p>Ranking de ventas por cada trabajador en el período seleccionado</p>
              </div>
              <button className="worker-bubble-close" onClick={() => setBubbleAbierta(false)}><UiIcon name="X" size={16} /></button>
            </div>
            <div className="worker-bubble-body">
              <span className="badge-green-soft worker-bubble-badge-turno">{ventasPorTrabajador.filter(t => t.activo).length} en turno ahora</span>

              {ventasPorTrabajador.length === 0 ? (
                <div className="workers-empty dash-empty">
                  <div className="dash-empty-icon"><UiIcon name="Users" size={28} /></div>
                  <p className="dash-empty-title">No hay ventas registradas en este período.</p>
                  <p className="dash-empty-sub">El ranking por vendedor se arma cuando hay operaciones en el período.</p>
                </div>
              ) : (
                <div className="worker-ranking-scroll">
                  <table className="worker-ranking-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Vendedor</th>
                        <th>Ventas totales</th>
                        <th style={{ minWidth: 120 }}>Participación</th>
                        <th>Operaciones</th>
                        <th>Ticket prom.</th>
                        <th>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ventasPorTrabajador.map((trabajador, index) => {
                        const pct = maxTrabajador > 0 ? (trabajador.total / maxTrabajador) * 100 : 0;
                        const color = AVATAR_COLORS[index % AVATAR_COLORS.length];
                        const expandido = turnosExpandidos.has(trabajador.id);
                        const tieneDesglose = trabajador.turnosCount > 1 && (trabajador.turnosDesglose?.length || 0) > 1;
                        return (
                          <tr key={trabajador.id} className={expandido ? 'worker-row-expanded' : undefined}>
                            <td><div className={`worker-rank-num ${getRankClass(index)}`}>{index + 1}</div></td>
                            <td>
                              <div className="worker-name-cell">
                                <div className="worker-initials" style={{ backgroundColor: color }}>{getInitials(trabajador.nombre)}</div>
                                <div className="worker-name-text">
                                  <strong>{trabajador.nombre}</strong>
                                  <small>ID #{trabajador.id}</small>
                                  {tieneDesglose && (
                                    <>
                                      <button
                                        type="button"
                                        className={`worker-turnos-badge worker-turnos-badge-btn ${expandido ? 'is-open' : ''}`}
                                        title="Ver subtotal por turno (el total suma varios turnos, no un solo cierre de caja)"
                                        onClick={() => {
                                          setTurnosExpandidos(prev => {
                                            const next = new Set(prev);
                                            if (next.has(trabajador.id)) next.delete(trabajador.id);
                                            else next.add(trabajador.id);
                                            return next;
                                          });
                                        }}
                                      >
                                        {trabajador.turnosCount} turnos{filtroTiempo === 'Hoy' ? ' hoy' : ''} {expandido ? <UiIcon name="ChevronUp" size={14} /> : <UiIcon name="ChevronDown" size={14} />}
                                      </button>
                                      {expandido && (
                                        <ul className="worker-turnos-desglose">
                                          {trabajador.turnosDesglose.map(t => (
                                            <li key={t.id_turno}>
                                              <span>{labelTurno(t.id_turno)}</span>
                                              <strong>S/ {t.total.toFixed(2)}</strong>
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                    </>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="worker-total-cell">S/ {trabajador.total.toFixed(2)}</td>
                            <td className="worker-bar-cell">
                              <span style={{ fontSize: '0.75rem', color: 'var(--lf-text-muted)' }}>{pct.toFixed(0)}%</span>
                              <div className="worker-mini-bar-bg">
                                <div className="worker-mini-bar-fill" style={{ width: `${pct}%` }}></div>
                              </div>
                            </td>
                            <td className="worker-ops-cell">{trabajador.operaciones} ventas</td>
                            <td className="worker-ticket-cell">S/ {trabajador.ticketPromedio.toFixed(2)}</td>
                            <td>
                              <span className={`worker-status-badge ${trabajador.activo ? 'badge-activo' : 'badge-cerrado'}`}>
                                {trabajador.activo ? <><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} /> En turno</> : <><UiIcon name="Circle" size={10} /> Cerrado</>}
                              </span>
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
        )}

        <button
          type="button"
          className="worker-bubble-btn"
          onClick={() => setBubbleAbierta(v => !v)}
        >
          <span className="worker-bubble-logo-bg">
            <LogoLuxFarma variant="icon" size={28} color="white" showBadge={false} />
          </span>
          {ventasPorTrabajador.filter(t => t.activo).length > 0 && (
            <span className="worker-bubble-count">{ventasPorTrabajador.filter(t => t.activo).length}</span>
          )}
          <span className="worker-bubble-tooltip">Rendimiento por vendedor — {filtroTiempo}</span>
        </button>
      </div>

    </div>
  );
}
