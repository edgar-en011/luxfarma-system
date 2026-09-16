import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../supabaseClient';
import { anularVenta, precheckAnulacion } from '../../utils/ventasAjustes';
import {
  coincideBusquedaComprobante,
  etiquetaComprobanteVisible,
  parsearBusquedaComprobante,
  resolverIdsVentaPorComprobante,
} from '../../utils/comprobanteVisible';
import { fechaLocalStr } from '../../utils/fechas';
import { contarTurnosUnicos, agruparVentasPorTurno, labelTurno, chipTurno } from '../../utils/turnosVentas';
import { reimprimirVentaPorId } from '../../utils/ticketPrint';
import LogoCargandoOverlay from '../../components/LogoCargandoOverlay';
import './MisVentas.css';
import UiIcon from '../../components/UiIcon';
import { formatSolesUnitario } from '../../utils/precioExacto';
import { nubefactIpcDisponible } from '../../services/nubefactService';

const MOTIVOS_ANULACION = [
  'Error en la emisión',
  'Devolución del cliente',
  'Producto equivocado',
  'Precio incorrecto',
  'Solicitud del cliente',
  'Otro',
];

/** Mismos períodos y criterio de rango que AdminVentas.jsx */
const PERIODOS = ['Hoy', 'Ayer', 'Esta semana', 'Este mes', 'Mes pasado'];

function rangoFechasPeriodo(filtroRapido) {
  const hoy = new Date();
  let desde = new Date(hoy);
  let hasta = new Date(hoy);

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

  return { fechaDesde: fechaLocalStr(desde), fechaHasta: fechaLocalStr(hasta) };
}

export default function MisVentas() {
  const { user } = useAuth();
  const [ventas, setVentas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState('Todas');
  const [busqueda, setBusqueda] = useState('');
  // 'turno' = vista por turno abierto (default); o un período AdminVentas (Hoy/Ayer/…)
  const [modoVista, setModoVista] = useState('turno');
  const cargarIdRef = useRef(0);

  const [ticketSeleccionado, setTicketSeleccionado] = useState(null);
  const [detallesTicket, setDetallesTicket] = useState([]);
  const [pagosTicket, setPagosTicket] = useState([]);
  const [cargandoTicket, setCargandoTicket] = useState(false);

  const [horaApertura, setHoraApertura] = useState(null);
  const [idTurnoActual, setIdTurnoActual] = useState(null);
  const esModoTurno = modoVista === 'turno';

  // ── Buscar y anular un comprobante propio (de cualquier turno, no solo el actual) ──
  const [busquedaAnular, setBusquedaAnular] = useState('');
  const [buscandoAnular, setBuscandoAnular] = useState(false);
  const [resultadoAnular, setResultadoAnular] = useState(null); // null = sin buscar; false = no encontrado; objeto = encontrado
  const [ventaParaAnular, setVentaParaAnular] = useState(null);
  const [motivoAnulacionPropia, setMotivoAnulacionPropia] = useState(MOTIVOS_ANULACION[0]);
  const [anulandoPropia, setAnulandoPropia] = useState(false);
  const [anulacionPropiaExitosa, setAnulacionPropiaExitosa] = useState(false);
  const [msgAnulacionPropia, setMsgAnulacionPropia] = useState(null);
  const [reimprimiendoId, setReimprimiendoId] = useState(null);

  // ── Aviso de "venta anterior al fix de factor" (ver ventasAjustes.js/precheckAnulacion)
  // — mismo patrón que AdminVentas.jsx: se calcula al abrir el modal, y el checkbox
  // "Entiendo" gatea el botón Confirmar. ──
  const [avisoAnulacionPropia, setAvisoAnulacionPropia] = useState(null);
  const [cargandoAvisoPropia, setCargandoAvisoPropia] = useState(false);
  const [avisoLeidoPropia, setAvisoLeidoPropia] = useState(false);

  useEffect(() => {
    if (!ventaParaAnular) {
      setAvisoAnulacionPropia(null);
      setAvisoLeidoPropia(false);
      return;
    }
    let cancelado = false;
    setCargandoAvisoPropia(true);
    precheckAnulacion({ venta: ventaParaAnular }).then(resultado => {
      if (!cancelado) { setAvisoAnulacionPropia(resultado); setCargandoAvisoPropia(false); }
    });
    return () => { cancelado = true; };
  }, [ventaParaAnular]);

  useEffect(() => {
    cargarHistorialVentas();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recarga solo al cambiar modoVista
  }, [modoVista]);

  const SELECT_VENTAS = `id_venta, serie, correlativo, total, vuelto, created_at, tipo_comprobante, estado_sunat, estado_anulacion, id_turno, pagos_venta(metodo, monto), comprobantes_sunat(serie, numero)`;

  const cargarHistorialVentas = async () => {
    const idLlamada = ++cargarIdRef.current;
    setLoading(true);
    try {
      const { data: turno, error: errTurno } = await supabase
        .from('caja_turnos')
        .select('*')
        .eq('id_usuario_vendedor', user.id_usuario)
        .eq('estado', 'ABIERTO')
        .maybeSingle();

      if (errTurno) {
        console.error('[MisVentas] Error buscando turno:', errTurno);
      }

      if (idLlamada !== cargarIdRef.current) return;

      if (turno) {
        setIdTurnoActual(turno.id_turno);
        setHoraApertura(turno.apertura_at || turno.fecha_apertura || turno.created_at || turno.fecha_inicio);
      } else {
        setIdTurnoActual(null);
        setHoraApertura(null);
      }

      let data = [];
      let error = null;

      if (modoVista === 'turno') {
        if (!turno) {
          console.warn('[MisVentas] No se encontró turno ABIERTO para el usuario', user.id_usuario);
          data = [];
        } else {
          const res = await supabase
            .from('ventas')
            .select(SELECT_VENTAS)
            .eq('id_turno', turno.id_turno)
            .order('created_at', { ascending: false });
          data = res.data || [];
          error = res.error;
        }
      } else {
        // Período completo (mismo criterio de fechas que AdminVentas), solo ventas del vendedor.
        const { fechaDesde, fechaHasta } = rangoFechasPeriodo(modoVista);
        const fechaInicio = new Date(fechaDesde + 'T00:00:00-05:00');
        const fechaFin = new Date(fechaHasta + 'T23:59:59-05:00');
        if (isNaN(fechaInicio.getTime()) || isNaN(fechaFin.getTime())) {
          console.error('[MisVentas] Rango de fechas inválido:', { fechaDesde, fechaHasta });
          data = [];
        } else {
          const res = await supabase
            .from('ventas')
            .select(SELECT_VENTAS)
            .eq('id_usuario_vendedor', user.id_usuario)
            .gte('created_at', fechaInicio.toISOString())
            .lte('created_at', fechaFin.toISOString())
            .order('created_at', { ascending: false });
          data = res.data || [];
          error = res.error;
        }
      }

      if (idLlamada !== cargarIdRef.current) return;

      if (error) {
        console.error('[MisVentas] Error cargando ventas:', error);
        throw error;
      }

      setVentas(data);
    } catch (error) {
      console.error('[MisVentas] Error general:', error);
      if (idLlamada === cargarIdRef.current) setVentas([]);
    } finally {
      if (idLlamada === cargarIdRef.current) setLoading(false);
    }
  };

  const abrirTicket = async (venta) => {
    setTicketSeleccionado(venta);
    setCargandoTicket(true);
    try {
      const [resDetalle, resPagos] = await Promise.all([
        supabase.from('venta_detalle')
          .select('cantidad, precio_unitario, subtotal, productos(descripcion)')
          .eq('id_venta', venta.id_venta),
        supabase.from('pagos_venta')
          .select('metodo, monto')
          .eq('id_venta', venta.id_venta),
      ]);
      if (resDetalle.error) throw resDetalle.error;
      setDetallesTicket(resDetalle.data || []);
      setPagosTicket(resPagos.data || []);
    } catch (error) {
      console.error('Error cargando detalle:', error);
    } finally {
      setCargandoTicket(false);
    }
  };

  const handleReimprimir = async (venta) => {
    if (!venta?.id_venta || reimprimiendoId != null) return;
    console.info('[MisVentas] Reimprimir click', { id_venta: venta.id_venta, serie: venta.serie, correlativo: venta.correlativo });
    setReimprimiendoId(venta.id_venta);
    try {
      const result = await reimprimirVentaPorId(supabase, venta.id_venta);
      console.info('[MisVentas] Reimprimir resultado', result);
      if (result?.error && result.via !== 'window.print' && result.via !== 'thermal') {
        window.alert(`No se pudo reimprimir el ticket.\n${result.error}`);
      }
    } catch (err) {
      console.error('[MisVentas] Reimprimir falló (carga de datos / payload):', err);
      window.alert(`No se pudo armar el ticket para reimprimir.\n${err?.message || err}`);
    } finally {
      setReimprimiendoId(null);
    }
  };

  // Busca un comprobante por número, filtrando SIEMPRE por id_usuario_vendedor = el
  // usuario logueado — si el número existe pero es de otro vendedor, la consulta
  // simplemente no lo trae (no hay forma de distinguir "no existe" de "es de otra
  // persona" desde el resultado, así que nunca se revela lo segundo). Busca en
  // cualquier turno, no solo el actual (a diferencia de la tabla "Mis comprobantes del
  // turno" de arriba).
  const buscarComprobantePropio = async () => {
    if (!parsearBusquedaComprobante(busquedaAnular)) { setResultadoAnular(false); return; }
    setBuscandoAnular(true);
    setResultadoAnular(null);
    try {
      const ids = await resolverIdsVentaPorComprobante(supabase, busquedaAnular);
      if (ids.length === 0) {
        setResultadoAnular(false);
        return;
      }
      const { data, error } = await supabase
        .from('ventas')
        .select('id_venta, serie, correlativo, total, created_at, tipo_comprobante, id_sucursal, id_usuario_vendedor, estado_sunat, estado_anulacion, comprobantes_sunat(serie, numero)')
        .in('id_venta', ids)
        .eq('id_usuario_vendedor', user.id_usuario)
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      setResultadoAnular(data && data.length > 0 ? data[0] : false);
    } catch (error) {
      console.error('Error buscando comprobante:', error);
      setResultadoAnular(false);
    } finally {
      setBuscandoAnular(false);
    }
  };

  // Reutiliza anularVenta() de src/utils/ventasAjustes.js — misma lógica de
  // devolución de stock/kardex que ya usa AdminVentas.jsx, sin duplicarla.
  const handleAnularPropia = async () => {
    if (!ventaParaAnular) return;
    setAnulandoPropia(true);
    setAnulacionPropiaExitosa(false);
    setMsgAnulacionPropia(null);

    const resultado = await anularVenta({ venta: ventaParaAnular, motivo: motivoAnulacionPropia });

    if (resultado.ok) {
      setResultadoAnular(prev => prev ? { ...prev, estado_anulacion: 'ANULADO', estado_sunat: 'ANULADO' } : prev);
      // El comprobante buscado puede estar TAMBIÉN en "Mis comprobantes del turno" (son
      // dos arrays de state independientes) — se actualiza acá también, sin esperar
      // un refetch ni depender de Realtime, ya que es la propia acción del usuario.
      setVentas(prev => prev.map(v =>
        v.id_venta === ventaParaAnular.id_venta
          ? { ...v, estado_anulacion: 'ANULADO', estado_sunat: 'ANULADO' }
          : v
      ));

      // Igual que en AdminVentas.jsx: el overlay muestra el check verde ~1.1s y luego
      // cierra TODO de una — antes había un segundo cierre encadenado (banner chico +
      // 2s extra dentro del modal, detrás del overlay) que sumaba un retraso adicional
      // desconectado de este tiempo de exhibición configurado.
      setAnulacionPropiaExitosa(true);
      await new Promise(resolve => setTimeout(resolve, 1100));
      setAnulandoPropia(false);
      setAnulacionPropiaExitosa(false);
      setVentaParaAnular(null);
      setMsgAnulacionPropia(null);
      setMotivoAnulacionPropia(MOTIVOS_ANULACION[0]);
    } else {
      console.error('Error al anular venta:', resultado.error);
      setAnulandoPropia(false);
      setMsgAnulacionPropia({ ok: false, texto: 'Error al anular: ' + resultado.error.message });
    }
  };

  const getMetodo = (v) =>
    v.pagos_venta?.length > 1 ? 'Mixto' : (v.pagos_venta?.[0]?.metodo || 'Efectivo');

  const ventasFiltradas = ventas.filter(v => {
    const coincide = coincideBusquedaComprobante(v, busqueda);
    if (filtro === 'Todas') return coincide;
    return coincide && getMetodo(v).toLowerCase() === filtro.toLowerCase();
  });

  // Las ventas ANULADAS se quedan en "ventas" (siguen apareciendo en la tabla de abajo
  // con su badge de estado, como historial) — pero se excluyen de acá en adelante para
  // que ningún cálculo de dinero (Total cobrado, cuadre de caja por método) las cuente.
  const ventasActivas = ventas.filter(v => v.estado_anulacion !== 'ANULADO');

  const totalTurno = ventasActivas.reduce((s, v) => s + Number(v.total || 0), 0);
  const operacionesTurno = ventasActivas.length;
  const ticketPromedio = operacionesTurno > 0 ? totalTurno / operacionesTurno : 0;

  const totalEfectivo = ventasActivas
    .filter(v => v.pagos_venta?.length === 1 && v.pagos_venta[0].metodo === 'EFECTIVO')
    .reduce((s, v) => s + Number(v.total || 0), 0);
  const totalYape = ventasActivas
    .filter(v => v.pagos_venta?.length === 1 && v.pagos_venta[0].metodo === 'YAPE')
    .reduce((s, v) => s + Number(v.total || 0), 0);
  const totalTarjeta = ventasActivas
    .filter(v => v.pagos_venta?.length === 1 && v.pagos_venta[0].metodo === 'TARJETA')
    .reduce((s, v) => s + Number(v.total || 0), 0);
  const totalMixto = ventasActivas
    .filter(v => v.pagos_venta?.length > 1)
    .reduce((s, v) => s + Number(v.total || 0), 0);

  const horaAperturaStr = horaApertura
    ? new Date(horaApertura).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })
    : '—';
  const fechaHoyStr = new Date().toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric' });
  const nombreCorto = `${user?.nombres?.split(' ')[0] || ''} ${user?.apellidos?.split(' ')[0] || ''}`.trim();

  const badgeMetodo = (m) => m.toLowerCase().includes('yape') ? 'yape' : m.toLowerCase().includes('tarjeta') ? 'tarjeta' : m.toLowerCase().includes('mixto') ? 'mixto' : 'efectivo';
  const estadoColor = (e) => e==='ACEPTADO'?{bg:'#dcfce7',c:'#16a34a'}:e==='ANULADO'?{bg:'#f1f5f9',c:'#64748b'}:e==='ERROR'||e==='RECHAZADO'?{bg:'#fee2e2',c:'#b91c1c'}:e==='SIN_CONFIRMAR'?{bg:'#ffedd5',c:'#c2410c'}:{bg:'#fef3c7',c:'#b45309'};

  // En períodos (Hoy/Ayer/…) con >1 turno: agrupar; en "Mi turno" o un solo turno: lista plana.
  const agruparPorTurno = !esModoTurno && contarTurnosUnicos(ventasFiltradas) > 1;
  const gruposTurno = agruparPorTurno ? agruparVentasPorTurno(ventasFiltradas) : null;

  const renderFilaVenta = (v, idx) => {
    const metodo = getMetodo(v);
    const sc = estadoColor(v.estado_sunat);
    const chip = chipTurno(v.id_turno);
    return (
      <tr key={v.id_venta}>
        <td style={{color:'#94a3b8',fontWeight:600}}>{idx + 1}</td>
        <td>
          <strong>{etiquetaComprobanteVisible(v)}</strong>
          <p style={{ fontSize: '0.7rem', color: '#94a3b8', margin: '2px 0 0' }}>{v.tipo_comprobante}</p>
        </td>
        <td>
          {chip
            ? <span className="mv-turno-chip" title="Turno de caja en el que se registró esta venta">{chip}</span>
            : <span style={{ color: '#cbd5e1', fontSize: '0.78rem' }}>—</span>}
        </td>
        <td style={{color:'#64748b'}}>{new Date(v.created_at).toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'})}</td>
        <td><span className={`mv-pill mv-pill-${badgeMetodo(metodo)}`}>{metodo}</span></td>
        <td><strong>S/ {Number(v.total).toFixed(2)}</strong></td>
        <td>
          <span className="mv-pill" style={{ background: sc.bg, color: sc.c }}>
            {v.estado_sunat || 'PENDIENTE'}
          </span>
        </td>
        <td style={{ textAlign: 'right' }}>
          <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <button
              type="button"
              className="mv-btn-reimprimir"
              disabled={reimprimiendoId === v.id_venta}
              onClick={() => handleReimprimir(v)}
              title="Reimprimir ticket"
            >
              {reimprimiendoId === v.id_venta ? '…' : 'Reimprimir'}
            </button>
            <button className="mv-btn-icon-apple" onClick={() => abrirTicket(v)} title="Ver ticket"><UiIcon name="Eye" size={16} /></button>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div style={{ background: '#f8fafc', minHeight: '100vh', padding: '2rem 2.5rem' }}>

      <style>{`
        @keyframes mvFadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes mvSlideUp { from { opacity: 0; transform: translateY(20px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
        .mv-card-apple { background: white; border-radius: 18px; box-shadow: 0 1px 3px rgba(0,0,0,0.05), 0 8px 24px rgba(0,0,0,0.04); border: 1px solid rgba(15,23,42,0.04); }
        .mv-table-apple { width: 100%; border-collapse: collapse; }
        .mv-table-apple thead th { background: transparent; color: #94a3b8; font-size: 0.7rem; font-weight: 600; letter-spacing: 0.8px; text-transform: uppercase; padding: 1rem 1.25rem; text-align: left; border-bottom: 1px solid #f1f5f9; }
        .mv-table-apple tbody tr { transition: background 0.15s ease; }
        .mv-table-apple tbody tr:hover { background: #f8fafc; }
        .mv-table-apple tbody td { padding: 1rem 1.25rem; font-size: 0.88rem; color: #0f172a; border-bottom: 1px solid #f1f5f9; }
        .mv-pill { display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 100px; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.2px; }
        .mv-pill-efectivo { background: #dcfce7; color: #166534; }
        .mv-pill-yape { background: #f3e8ff; color: #6b21a8; }
        .mv-pill-tarjeta { background: #dbeafe; color: #1e40af; }
        .mv-pill-mixto { background: #fef3c7; color: #92400e; }
        .mv-chip { padding: 8px 16px; border-radius: 100px; font-size: 0.82rem; font-weight: 600; cursor: pointer; border: 1px solid #e2e8f0; background: white; color: #64748b; transition: all 0.2s ease; }
        .mv-chip:hover { background: #f8fafc; border-color: #cbd5e1; }
        .mv-chip.active { background: #0f172a; color: white; border-color: #0f172a; }
        .mv-chip.mv-chip-turno.active { background: #012B63; border-color: #012B63; }
        .mv-turno-chip { display: inline-block; padding: 0.15rem 0.45rem; border-radius: 6px; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.02em; color: #475569; background: #f1f5f9; border: 1px solid #e2e8f0; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .mv-turno-section-row td { padding: 0.55rem 1.25rem !important; background: #f1f5f9; border-bottom: 1px solid #e2e8f0 !important; }
        .mv-turno-section-label { display: flex; justify-content: space-between; align-items: center; gap: 1rem; font-size: 0.78rem; font-weight: 800; color: #012B63; letter-spacing: 0.02em; }
        .mv-turno-section-label strong { color: #0f172a; font-variant-numeric: tabular-nums; }
        .mv-btn-icon-apple { width: 32px; height: 32px; border-radius: 50%; background: #f1f5f9; border: none; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: all 0.2s ease; font-size: 0.9rem; }
        .mv-btn-icon-apple:hover { background: #e2e8f0; transform: scale(1.08); }
        .mv-input-apple { background: white; border: 1px solid #e2e8f0; border-radius: 10px; padding: 9px 14px; font-size: 0.88rem; color: #0f172a; outline: none; transition: all 0.2s ease; font-family: inherit; width: 280px; }
        .mv-input-apple:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }
        .mv-content { animation: mvFadeIn 0.4s ease-out; }
        .mv-btn-anular { padding: 6px 14px; border-radius: 100px; background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; font-size: 0.75rem; font-weight: 600; cursor: pointer; transition: all 0.2s ease; }
        .mv-btn-anular:hover { background: #fee2e2; transform: scale(1.03); }
        .mv-btn-reimprimir { padding: 6px 14px; border-radius: 100px; background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; font-size: 0.75rem; font-weight: 600; cursor: pointer; transition: all 0.2s ease; }
        .mv-btn-reimprimir:hover { background: #dbeafe; transform: scale(1.03); }
        .mv-btn-reimprimir:disabled { opacity: 0.55; cursor: wait; transform: none; }
      `}</style>

      <div className="mv-content" style={{ maxWidth: 1400, margin: '0 auto' }}>

        {/* HEADER */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <p style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 0.4rem' }}>
              {esModoTurno ? <><UiIcon name="Receipt" size={14} /> Mi turno</> : <><UiIcon name="ClipboardList" size={14} /> Historial</>}
            </p>
            <h1 style={{ fontSize: '2rem', fontWeight: 800, color: '#0f172a', margin: 0, letterSpacing: '-0.02em' }}>
              Mis Ventas
            </h1>
            <p style={{ fontSize: '0.95rem', color: '#64748b', margin: '0.3rem 0 0' }}>
              {nombreCorto || 'Vendedor'} · {fechaHoyStr}
              {esModoTurno && idTurnoActual != null && <> · Turno #{String(idTurnoActual).padStart(4, '0')}</>}
              {esModoTurno && horaAperturaStr && horaAperturaStr !== '—' && <> · desde las {horaAperturaStr}</>}
              {!esModoTurno && <> · Período: {modoVista}</>}
            </p>
            <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: '0.35rem 0 0' }}>
              {esModoTurno
                ? 'Solo ventas del turno abierto (útil para cuadre de caja).'
                : 'Todas tus ventas del período, sin importar en qué turno se hicieron.'}
            </p>
          </div>
        </div>

        {/* SELECTOR DE MODO / PERÍODO */}
        <div className="mv-card-apple" style={{ padding: '1rem 1.25rem', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', marginRight: 2 }}>
              Ver
            </span>
            <button
              type="button"
              onClick={() => setModoVista('turno')}
              className={`mv-chip mv-chip-turno ${esModoTurno ? 'active' : ''}`}
              title="Ventas del turno de caja abierto"
            >
              Mi turno actual
            </button>
            <span style={{ width: 1, height: 22, background: '#e2e8f0', margin: '0 2px' }} aria-hidden />
            {PERIODOS.map(p => (
              <button
                key={p}
                type="button"
                onClick={() => setModoVista(p)}
                className={`mv-chip ${modoVista === p ? 'active' : ''}`}
                title="Todas tus ventas del período (todos los turnos)"
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
          <div className="mv-card-apple" style={{ padding: '1.5rem 1.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.4rem' }}>
              <p style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', margin: 0 }}>Total cobrado</p>
              <div style={{ width: 38, height: 38, borderRadius: 12, background: 'linear-gradient(135deg,#dbeafe,#bfdbfe)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem' }}><UiIcon name="Wallet" size={16} /></div>
            </div>
            <h2 style={{ fontSize: '1.85rem', fontWeight: 800, color: '#0f172a', margin: '0.3rem 0 0', letterSpacing: '-0.02em' }}>
              S/ {totalTurno.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}
            </h2>
            <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '0.3rem 0 0' }}>
              {esModoTurno ? 'Tu turno actual' : `Período: ${modoVista}`}
            </p>
          </div>

          <div className="mv-card-apple" style={{ padding: '1.5rem 1.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.4rem' }}>
              <p style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', margin: 0 }}>Operaciones</p>
              <div style={{ width: 38, height: 38, borderRadius: 12, background: 'linear-gradient(135deg,#dcfce7,#bbf7d0)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem' }}><UiIcon name="Receipt" size={16} /></div>
            </div>
            <h2 style={{ fontSize: '1.85rem', fontWeight: 800, color: '#0f172a', margin: '0.3rem 0 0', letterSpacing: '-0.02em' }}>
              {operacionesTurno}
            </h2>
            <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '0.3rem 0 0' }}>Ventas realizadas</p>
          </div>

          <div className="mv-card-apple" style={{ padding: '1.5rem 1.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.4rem' }}>
              <p style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', margin: 0 }}>Ticket promedio</p>
              <div style={{ width: 38, height: 38, borderRadius: 12, background: 'linear-gradient(135deg,#fef3c7,#fde68a)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem' }}><UiIcon name="BarChart3" size={16} /></div>
            </div>
            <h2 style={{ fontSize: '1.85rem', fontWeight: 800, color: '#0f172a', margin: '0.3rem 0 0', letterSpacing: '-0.02em' }}>
              S/ {ticketPromedio.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}
            </h2>
            <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '0.3rem 0 0' }}>Por venta</p>
          </div>
        </div>

        {/* RESUMEN POR MÉTODO DE PAGO */}
        {operacionesTurno > 0 && (
          <div className="mv-card-apple" style={{ padding: '1.25rem 1.5rem', marginBottom: '1.5rem' }}>
            <p style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', margin: '0 0 0.85rem' }}>
              {esModoTurno ? <><UiIcon name="CreditCard" size={14} /> Resumen para cuadre de caja</> : <><UiIcon name="CreditCard" size={14} /> Resumen por método de pago</>}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
              <div style={{ padding: '0.85rem 1rem', background: '#f0fdf4', borderRadius: 12, border: '1px solid #bbf7d0' }}>
                <span style={{ fontSize: '0.72rem', color: '#166534', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}><UiIcon name="Banknote" size={15} /> Efectivo</span>
                <p style={{ fontSize: '1.15rem', fontWeight: 800, color: '#166534', margin: '4px 0 0' }}>S/ {totalEfectivo.toFixed(2)}</p>
              </div>
              <div style={{ padding: '0.85rem 1rem', background: '#faf5ff', borderRadius: 12, border: '1px solid #e9d5ff' }}>
                <span style={{ fontSize: '0.72rem', color: '#6b21a8', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase', display: 'inline-flex', alignItems: 'center', gap: 4 }}><UiIcon name="Smartphone" size={14} /> Yape</span>
                <p style={{ fontSize: '1.15rem', fontWeight: 800, color: '#6b21a8', margin: '4px 0 0' }}>S/ {totalYape.toFixed(2)}</p>
              </div>
              <div style={{ padding: '0.85rem 1rem', background: '#eff6ff', borderRadius: 12, border: '1px solid #bfdbfe' }}>
                <span style={{ fontSize: '0.72rem', color: '#1e40af', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}><UiIcon name="CreditCard" size={15} /> Tarjeta</span>
                <p style={{ fontSize: '1.15rem', fontWeight: 800, color: '#1e40af', margin: '4px 0 0' }}>S/ {totalTarjeta.toFixed(2)}</p>
              </div>
              <div style={{ padding: '0.85rem 1rem', background: '#fffbeb', borderRadius: 12, border: '1px solid #fde68a' }}>
                <span style={{ fontSize: '0.72rem', color: '#92400e', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase', display: 'inline-flex', alignItems: 'center', gap: 4 }}><UiIcon name="Shuffle" size={14} /> Mixto</span>
                <p style={{ fontSize: '1.15rem', fontWeight: 800, color: '#92400e', margin: '4px 0 0' }}>S/ {totalMixto.toFixed(2)}</p>
              </div>
            </div>
          </div>
        )}

        {/* BUSCAR Y ANULAR UN COMPROBANTE — de cualquiera de tus turnos, no solo el
            actual; solo encuentra comprobantes tuyos (filtrado server-side por
            id_usuario_vendedor). Reutiliza la misma función de anulación que Admin. */}
        <div className="mv-card-apple" style={{ padding: '1.25rem 1.5rem', marginBottom: '1.5rem' }}>
          <p style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0f172a', margin: '0 0 0.25rem' }}><UiIcon name="Search" size={15} /> Buscar y anular un comprobante</p>
          <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: '0 0 1rem' }}>
            Busca por N° de boleta/factura, de cualquiera de tus turnos — no solo el actual.
          </p>
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="N° de boleta/factura (ej: B004-10)"
              value={busquedaAnular}
              onChange={e => setBusquedaAnular(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') buscarComprobantePropio(); }}
              className="mv-input-apple"
              style={{ width: 260 }}
            />
            <button
              onClick={buscarComprobantePropio}
              disabled={buscandoAnular}
              style={{ padding: '9px 18px', background: '#0f172a', color: 'white', border: 'none', borderRadius: 10, fontSize: '0.85rem', fontWeight: 600, cursor: buscandoAnular ? 'default' : 'pointer' }}
            >
              {buscandoAnular ? 'Buscando...' : 'Buscar'}
            </button>
          </div>

          {resultadoAnular === false && (
            <p style={{ marginTop: '1rem', fontSize: '0.85rem', color: '#b91c1c', fontWeight: 600 }}>
              No se encontró ningún comprobante tuyo con ese número.
            </p>
          )}

          {resultadoAnular && (
            <div style={{ marginTop: '1rem', padding: '1rem 1.2rem', background: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div>
                <strong style={{ fontSize: '0.95rem', color: '#0f172a' }}>{etiquetaComprobanteVisible(resultadoAnular)}</strong>
                <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '4px 0 0' }}>
                  {new Date(resultadoAnular.created_at).toLocaleString('es-PE')} · Consumidor final · S/ {Number(resultadoAnular.total).toFixed(2)}
                </p>
              </div>
              {resultadoAnular.estado_anulacion === 'ANULADO' ? (
                <span className="mv-pill" style={{ background: '#f1f5f9', color: '#64748b' }}>ANULADA</span>
              ) : (
                <button
                  className="mv-btn-anular"
                  onClick={() => { setVentaParaAnular(resultadoAnular); setMotivoAnulacionPropia(MOTIVOS_ANULACION[0]); }}
                >
                  Anular
                </button>
              )}
            </div>
          )}
        </div>

        {/* FILTROS Y BÚSQUEDA */}
        <div className="mv-card-apple" style={{ padding: '1.25rem 1.5rem', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', marginRight: 4 }}>
                Filtrar
              </span>
              {['Todas', 'Efectivo', 'Yape', 'Tarjeta', 'Mixto'].map(f => (
                <button
                  key={f}
                  onClick={() => setFiltro(f)}
                  className={`mv-chip ${filtro === f ? 'active' : ''}`}
                >
                  {f}
                </button>
              ))}
            </div>
            <input
              type="text"
              placeholder="Buscar ticket (Ej: B004-10)"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              className="mv-input-apple"
            />
          </div>
        </div>

        {/* TABLA PRINCIPAL */}
        <div className="mv-card-apple" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #f1f5f9' }}>
            <p style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
              {esModoTurno ? 'Mis comprobantes del turno' : `Mis comprobantes · ${modoVista}`}
            </p>
            <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: '2px 0 0' }}>
              {ventasFiltradas.length} {ventasFiltradas.length === 1 ? 'venta' : 'ventas'}
              {!esModoTurno && ' · pueden incluir varios turnos'}
            </p>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="mv-table-apple">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Comprobante</th>
                  <th>Turno</th>
                  <th>Hora</th>
                  <th>Método</th>
                  <th>Total</th>
                  <th>Estado</th>
                  <th style={{ textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="8" style={{textAlign:'center',padding:'3rem',color:'#94a3b8'}}>Cargando historial...</td></tr>
                ) : ventasFiltradas.length === 0 ? (
                  <tr><td colSpan="8" style={{textAlign:'center',padding:'3rem',color:'#94a3b8'}}>
                    <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}><UiIcon name="Receipt" size={16} /></div>
                    <p style={{ fontSize: '0.95rem', fontWeight: 600, color: '#475569', margin: 0 }}>No se encontraron ventas</p>
                    <p style={{ fontSize: '0.8rem', margin: '4px 0 0' }}>
                      {busqueda
                        ? 'Prueba con otro término de búsqueda.'
                        : esModoTurno
                          ? (idTurnoActual == null
                            ? 'No hay un turno abierto. Abre caja o usa un período (Hoy/Ayer) para ver ventas anteriores.'
                            : 'Las ventas de tu turno aparecerán aquí.')
                          : `No hay ventas tuyas en el período “${modoVista}”.`}
                    </p>
                  </td></tr>
                ) : agruparPorTurno ? (() => {
                  let idxGlobal = 0;
                  return gruposTurno.flatMap((grupo) => {
                    const section = (
                      <tr key={`sec-${grupo.id_turno ?? 'sin'}`} className="mv-turno-section-row">
                        <td colSpan="8">
                          <div className="mv-turno-section-label">
                            <span>{labelTurno(grupo.id_turno)}</span>
                            <strong>S/ {grupo.total.toFixed(2)}</strong>
                          </div>
                        </td>
                      </tr>
                    );
                    const filas = [...grupo.ventas]
                      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
                      .map((v) => renderFilaVenta(v, idxGlobal++));
                    return [section, ...filas];
                  });
                })() : ventasFiltradas.map((v, idx) => renderFilaVenta(v, idx))}
              </tbody>
            </table>
          </div>

          {ventasFiltradas.length > 0 && (
            <div style={{ padding: '1rem 1.5rem', background: 'linear-gradient(135deg, #f8fafc, #f1f5f9)', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <p style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', margin: 0 }}>
                Total filtrado
              </p>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0f172a' }}>
                S/ {ventasFiltradas.filter(v => v.estado_anulacion !== 'ANULADO').reduce((s,v) => s + Number(v.total||0), 0).toLocaleString('en-US',{minimumFractionDigits:2})}
              </div>
            </div>
          )}
        </div>

      </div>

      {/* MODAL DETALLE DE COMPROBANTE */}
      {ticketSeleccionado && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100030, padding: '1rem' }} onClick={() => setTicketSeleccionado(null)}>
          <div style={{ background: 'white', borderRadius: 20, width: '100%', maxWidth: 520, maxHeight: '90vh', overflow: 'hidden', boxShadow: '0 25px 80px rgba(0,0,0,0.25)', animation: 'mvSlideUp 0.3s ease', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>

            <div style={{ padding: '1.5rem 1.75rem', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', margin: 0 }}>
                  Comprobante
                </p>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#0f172a', margin: '2px 0 0' }}>
                  {etiquetaComprobanteVisible(ticketSeleccionado)}
                </h3>
              </div>
              <button onClick={() => setTicketSeleccionado(null)} className="mv-btn-icon-apple">✕</button>
            </div>

            <div style={{ overflowY: 'auto', padding: '1.5rem 1.75rem' }}>

              {cargandoTicket ? (
                <p style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>Cargando ticket...</p>
              ) : (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', marginBottom: '1.5rem' }}>
                    <div>
                      <p style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', margin: 0 }}>Tipo</p>
                      <p style={{ fontSize: '0.92rem', color: '#0f172a', fontWeight: 600, margin: '2px 0 0' }}>{ticketSeleccionado.tipo_comprobante}</p>
                    </div>
                    <div>
                      <p style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', margin: 0 }}>Sucursal</p>
                      <p style={{ fontSize: '0.92rem', color: '#0f172a', fontWeight: 600, margin: '2px 0 0' }}>{user?.sucursales?.nombre_comercial || 'Principal'}</p>
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <p style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', margin: 0 }}>Fecha y hora</p>
                      <p style={{ fontSize: '0.92rem', color: '#0f172a', fontWeight: 600, margin: '2px 0 0' }}>{new Date(ticketSeleccionado.created_at).toLocaleString('es-PE')}</p>
                    </div>
                  </div>

                  <div style={{ background: '#f8fafc', borderRadius: 12, overflow: 'hidden', marginBottom: '1rem' }}>
                    <table className="mv-table-apple">
                      <thead><tr><th>Cant.</th><th>Producto</th><th style={{textAlign:'right'}}>Subtotal</th></tr></thead>
                      <tbody>
                        {detallesTicket.map((d, i) => (
                          <tr key={i}>
                            <td><strong>{d.cantidad}</strong></td>
                            <td>
                              {d.productos?.descripcion}
                              <p style={{ fontSize: '0.72rem', color: '#94a3b8', margin: '2px 0 0' }}>P. unit: {formatSolesUnitario(d.precio_unitario)}</p>
                            </td>
                            <td style={{textAlign:'right'}}><strong>S/ {Number(d.subtotal).toFixed(2)}</strong></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {pagosTicket.length > 0 && (
                    <div style={{ padding: '1rem 1.2rem', background: '#f8fafc', borderRadius: 12, marginBottom: '1rem' }}>
                      <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', margin: '0 0 0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}><UiIcon name="CreditCard" size={15} /> Forma de pago
                      </p>

                      {pagosTicket.length === 1 ? (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', marginBottom: 6 }}>
                            <span style={{ color: '#64748b' }}>Método</span>
                            <strong>{pagosTicket[0].metodo}</strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', marginBottom: 6 }}>
                            <span style={{ color: '#64748b' }}>Monto del cobro</span>
                            <strong>S/ {Number(pagosTicket[0].monto).toFixed(2)}</strong>
                          </div>
                          {pagosTicket[0].metodo === 'EFECTIVO' && (
                            <>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', marginBottom: 6 }}>
                                <span style={{ color: '#64748b' }}>Recibido del cliente</span>
                                <strong>S/ {(Number(ticketSeleccionado.total) + Number(ticketSeleccionado.vuelto || 0)).toFixed(2)}</strong>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', color: Number(ticketSeleccionado.vuelto || 0) > 0 ? '#16a34a' : '#64748b' }}>
                                <span style={{ fontWeight: 600 }}>Vuelto entregado</span>
                                <strong>S/ {Number(ticketSeleccionado.vuelto || 0).toFixed(2)}</strong>
                              </div>
                            </>
                          )}
                        </>
                      ) : (
                        <div>
                          <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: '0 0 0.5rem', fontWeight: 600 }}>PAGO MIXTO:</p>
                          {pagosTicket.map((p, i) => (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', marginBottom: 4 }}>
                              <span style={{ color: '#64748b' }}>{p.metodo}</span>
                              <strong>S/ {Number(p.monto).toFixed(2)}</strong>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

            </div>

            <div style={{ padding: '1.25rem 1.75rem', background: 'linear-gradient(135deg, #0f172a, #1e293b)', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <p style={{ fontSize: '0.78rem', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', margin: 0, opacity: 0.8 }}>Total</p>
              <h2 style={{ fontSize: '1.6rem', fontWeight: 800, margin: 0, letterSpacing: '-0.01em' }}>
                S/ {Number(ticketSeleccionado.total).toFixed(2)}
              </h2>
            </div>
          </div>
        </div>
      )}

      {/* MODAL ANULAR (comprobante propio, buscado por número) */}
      {ventaParaAnular && (
        <div role="dialog" aria-modal="true" data-keyboard-trap style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100030, padding: '1rem' }} onClick={() => !anulandoPropia && setVentaParaAnular(null)}>
          <div style={{ background: 'white', borderRadius: 20, width: '100%', maxWidth: 440, padding: '2rem', boxShadow: '0 25px 80px rgba(0,0,0,0.25)', animation: 'mvSlideUp 0.3s ease' }} onClick={e => e.stopPropagation()}>
            <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}><UiIcon name="AlertTriangle" size={16} /></div>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', margin: '0 0 4px' }}>Anular comprobante</h3>
              <p style={{ fontSize: '0.88rem', color: '#64748b', margin: 0 }}>
                {etiquetaComprobanteVisible(ventaParaAnular)} · S/ {Number(ventaParaAnular.total).toFixed(2)}
              </p>
            </div>
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: '12px 16px', marginBottom: '1.2rem' }}>
              <p style={{ fontSize: '0.82rem', color: '#b91c1c', margin: 0, fontWeight: 600, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <UiIcon name="AlertTriangle" size={15} /> Acción irreversible. Se devolverá el stock al inventario{nubefactIpcDisponible() ? ' y se enviará la anulación a SUNAT.' : '.'}
              </p>
            </div>
            <div style={{ marginBottom: '1.2rem' }}>
              <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: '0.4rem' }}>Motivo de anulación</label>
              <select value={motivoAnulacionPropia} onChange={e => setMotivoAnulacionPropia(e.target.value)} disabled={anulandoPropia} className="mv-input-apple" style={{ width: '100%' }}>
                {MOTIVOS_ANULACION.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            {cargandoAvisoPropia && (
              <p style={{ fontSize: '0.8rem', color: '#94a3b8', textAlign: 'center', marginBottom: '1rem' }}>Verificando datos de la venta...</p>
            )}
            {avisoAnulacionPropia?.requiereAviso && (
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: '12px 16px', marginBottom: '1.2rem' }}>
                <p style={{ fontSize: '0.8rem', color: '#92400e', margin: '0 0 10px', fontWeight: 600, whiteSpace: 'pre-wrap', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                  <UiIcon name="AlertTriangle" size={15} /> {avisoAnulacionPropia.mensaje}
                </p>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: '#92400e', fontWeight: 700, cursor: 'pointer' }}>
                  <input type="checkbox" checked={avisoLeidoPropia} onChange={e => setAvisoLeidoPropia(e.target.checked)} />
                  Entiendo la advertencia y quiero continuar de todas formas
                </label>
              </div>
            )}
            {msgAnulacionPropia && (
              <div style={{ background: msgAnulacionPropia.ok ? '#f0fdf4' : '#fef2f2', border: `1px solid ${msgAnulacionPropia.ok ? '#bbf7d0' : '#fecaca'}`, borderRadius: 10, padding: '10px 14px', marginBottom: '1rem', fontSize: '0.85rem', fontWeight: 600, color: msgAnulacionPropia.ok ? '#166534' : '#b91c1c' }}>
                {msgAnulacionPropia.texto}
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button onClick={() => { setVentaParaAnular(null); setMsgAnulacionPropia(null); setMotivoAnulacionPropia(MOTIVOS_ANULACION[0]); }} disabled={anulandoPropia} data-enter-skip="true" tabIndex={-1} style={{ flex: 1, padding: '0.85rem', background: '#f1f5f9', border: 'none', borderRadius: 12, fontWeight: 600, fontSize: '0.92rem', cursor: 'pointer', color: '#475569' }}>
                Cancelar
              </button>
              <button data-enter-primary="true" onClick={handleAnularPropia} disabled={anulandoPropia || cargandoAvisoPropia || (avisoAnulacionPropia?.requiereAviso && !avisoLeidoPropia)} style={{ flex: 1, padding: '0.85rem', background: anulandoPropia ? '#fecaca' : '#dc2626', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: '0.92rem', cursor: (anulandoPropia || cargandoAvisoPropia || (avisoAnulacionPropia?.requiereAviso && !avisoLeidoPropia)) ? 'not-allowed' : 'pointer', color: 'white' }}>
                {anulandoPropia ? 'Anulando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {anulandoPropia && (
        <LogoCargandoOverlay
          mensaje={anulacionPropiaExitosa ? 'Venta anulada' : 'Anulando comprobante...'}
          exito={anulacionPropiaExitosa}
        />
      )}

    </div>
  );
}