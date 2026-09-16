import { useState, useEffect, useRef } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabaseClient';
import {
  insertarNotifConDedup,
  marcarTodasNotificacionesLeidas,
  navegarDesdeAccionUrl,
  esNotifRespuestaSoporteVendedor,
  extraerClaveDedup,
  claveDescarteDe,
  deduplicarNotifsPorClave,
  mapaDescartes,
  registrarDescartes,
  purgarDescartesNoVivas,
  EVT_ADMIN_TOAST_CERRAR,
  EVT_NOTIF_MARCADA_LEIDA,
} from '../utils/notificacionesService';
import {
  contarRespuestasSinVer,
  limpiarRespuestaTicketVista,
} from '../utils/soporteTicketVista';
import { hoyLocal, diasHastaFecha } from '../utils/fechas';
import { UMBRALES_AVISO_VENCIMIENTO } from '../utils/umbralesVencimiento';
import { marcarLotesVencidos } from '../utils/lotesVencidos';
import { calcularProductosStockBajo, cargarIdsProductosConMovimiento } from '../utils/stockBajo';
import { verificarEstadosSunatPosteriores } from '../services/comprobantesSunat';
import { clasificarBoletasPendientesSunat, listarSeriesCortas } from '../utils/estadoSunat';
import { DIAS_PLAZO_LEGAL_RESUMEN, INTERVALO_VERIFICACION_SUNAT_MS } from '../utils/plazosSunatBoleta';
import { hashPassword, verificarYMigrarSiPlano } from '../utils/passwordHash';
import icono from '../assets/icono.png';
import './MainLayout.css';
import UiIcon from '../components/UiIcon';
import { esAdmin, esRolCaja, labelRol } from '../utils/roles';
import { playNotifSound } from '../utils/notifSound';
import { scheduleWelcomeVoice } from '../utils/welcomeVoice';
import { partesMensajeNotif } from '../utils/notifDisplay';
import { APP_VERSION } from '../appVersion';

const TIPO_ICON = { warn: 'AlertTriangle', err: 'AlertCircle', ok: 'CheckCircle2', purp: 'Bell', info: 'Info' };

function tiempoRelativo(isoStr) {
  const diff = Math.floor((Date.now() - new Date(isoStr)) / 1000);
  if (diff < 60) return 'hace un momento';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  if (diff < 172800) return 'ayer';
  const d = new Date(isoStr);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function MainLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const isAdmin = esAdmin(user?.id_rol);
  const isVendedor = esRolCaja(user?.id_rol);

  // Hint visual junto a "Cerrar Sesión" — usado cuando el Admin cierra su turno
  // (Dashboard.jsx, vía useOutletContext) para sugerir cerrar sesión sin forzarlo.
  const [showLogoutHint, setShowLogoutHint] = useState(false);
  const dispararHintLogout = () => {
    setShowLogoutHint(true);
    setTimeout(() => setShowLogoutHint(false), 4000);
  };

  // ── Reloj
  const [horaActual, setHoraActual] = useState(new Date());

  // ── Toast ticket (admin: nuevo | vendedor: respuesta)
  const [toastTicket, setToastTicket] = useState(null);
  const toastTimerRef = useRef(null);

  // ── Badge respuestas sin leer (vendedor → menú Soporte)
  const [respuestasNoLeidas, setRespuestasNoLeidas] = useState(0);
  const canalVendedorRef = useRef(null);
  const toastRespuestaDedupRef = useRef({ id: null, at: 0, tipo: null });

  // ── Notificaciones (tabla notificaciones, ambos roles)
  const [notificaciones, setNotificaciones] = useState([]);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [notifLimpiando, setNotifLimpiando] = useState(false);
  const notifIntervalRef = useRef(null);
  const notifPanelVaciadoRef = useRef(false);

  // ── Perfil dropdown
  const [showPerfil, setShowPerfil] = useState(false);

  // ── Modal: Cambio de contraseña
  const [showCambioClave, setShowCambioClave] = useState(false);
  const [claveActual, setClaveActual] = useState('');
  const [claveNueva, setClaveNueva] = useState('');
  const [claveConfirm, setClaveConfirm] = useState('');
  const [showOjoActual, setShowOjoActual] = useState(false);
  const [showOjoNueva, setShowOjoNueva] = useState(false);
  const [showOjoConfirm, setShowOjoConfirm] = useState(false);
  const [cambiandoClave, setCambiandoClave] = useState(false);
  const [msgClave, setMsgClave] = useState(null);

  // ── Modal: Resumen del día (vendedor)
  const [showResumen, setShowResumen] = useState(false);
  const [resumenData, setResumenData] = useState(null);
  const [loadingResumen, setLoadingResumen] = useState(false);

  // ── Modal: Config del sistema (admin)
  const [showSistema, setShowSistema] = useState(false);
  const [configSistema, setConfigSistema] = useState(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [msgConfig, setMsgConfig] = useState(null);

  // ── Modal: Gestionar usuarios (admin)
  const [showGestionUsuarios, setShowGestionUsuarios] = useState(false);
  const [usuariosGestion, setUsuariosGestion] = useState([]);
  const [loadingUsuariosG, setLoadingUsuariosG] = useState(false);
  const [accionUsrId, setAccionUsrId] = useState(null);
  const [msgGestion, setMsgGestion] = useState(null);

  // ════════════════════════════════════════
  // EFFECTS
  // ════════════════════════════════════════

  // Reloj
  useEffect(() => {
    const t = setInterval(() => setHoraActual(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Bienvenida por voz — una sola vez por día en esta máquina (localStorage).
  useEffect(() => {
    if (!user?.id_usuario) return undefined;
    return scheduleWelcomeVoice(user);
  }, [user]);

  // Carga de notificaciones + polling cada 30s (Admin: globales+propias; Vendedor: solo propias)
  const cargarNotificaciones = async () => {
    if (!user) return;
    if (!isAdmin && !isVendedor) return;
    try {
      let q = supabase
        .from('notificaciones')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30);
      if (isAdmin) {
        q = q.or(`usuario_id.eq.${user.id_usuario},usuario_id.is.null`);
      } else {
        q = q.eq('usuario_id', user.id_usuario);
      }
      const { data } = await q;
      if (notifPanelVaciadoRef.current) return;
      const descartes = await mapaDescartes();
      const visibles = deduplicarNotifsPorClave(
        (data || []).filter((n) => {
          const base = claveDescarteDe(extraerClaveDedup(n));
          return !base || !descartes.has(base);
        }),
      );
      setNotificaciones(visibles);
    } catch { /* empty */ }
  };

  useEffect(() => {
    if (!user) return;
    cargarNotificaciones();
    notifIntervalRef.current = setInterval(cargarNotificaciones, 30000);
    return () => clearInterval(notifIntervalRef.current);
  }, [user, isAdmin, isVendedor]);

  // Admin: genera alertas automáticas en la tabla notificaciones
  useEffect(() => {
    if (!isAdmin || !user) return;

    const generarAlertas = async () => {
      try {
        // Antes de alertar: lotes con fecha pasada pasan a VENCIDO (idempotente).
        // Así FEFO deja de venderlos y las notifs de vencido siguen viéndose vía
        // el select que incluye estado VENCIDO.
        await marcarLotesVencidos();

        const hoyStr = hoyLocal();
        const descartesMap = await mapaDescartes();
        const vivas = new Set();

        const [resLotes, resTickets, resCompras, idsMovimiento] = await Promise.all([
          supabase
            .from('inventario_lotes')
            .select('id_lote, id_producto, fecha_vencimiento, cantidad_actual, estado, productos(descripcion)')
            .in('estado', ['VIGENTE', 'VENCIDO'])
            .gt('cantidad_actual', 0),
          supabase.from('tickets_soporte').select('id_ticket, asunto, prioridad').eq('estado', 'PENDIENTE'),
          supabase
            .from('compras')
            .select('id_compra, total_compra, monto_pagado, fecha_vencimiento, proveedores(razon_social)')
            .not('forma_pago', 'ilike', 'contado')
            .neq('estado_pago', 'PAGADO'),
          cargarIdsProductosConMovimiento(),
        ]);

        const idsUsados = [...idsMovimiento];
        if (idsUsados.length > 0) {
          const [{ data: lotesStock }, { data: productosStock }] = await Promise.all([
            supabase
              .from('inventario_lotes')
              .select('id_producto, id_sucursal, cantidad_actual, estado')
              .eq('estado', 'VIGENTE')
              .in('id_producto', idsUsados),
            supabase
              .from('productos')
              .select('id_producto, descripcion, stock_minimo')
              .eq('activo', 1)
              .in('id_producto', idsUsados),
          ]);
          const bajos = calcularProductosStockBajo(productosStock, lotesStock, idsMovimiento);
          for (const item of bajos) {
            vivas.add(`stockbajo:prod:${item.id_producto}`);
            const nombre = item.producto?.descripcion || 'Producto';
            await insertarNotifConDedup({
              tipo: 'warn',
              categoria: 'Stock bajo',
              mensaje: `Stock bajo: ${nombre} — quedan ${item.stockTotal} unidades`,
              accion_url: '/admin-inventario',
              claveDedup: `stockbajo:prod:${item.id_producto}:${hoyStr}`,
              firma: String(item.stockTotal),
              modoFirma: 'stock',
              descartesMap,
            });
          }
        }

        for (const l of resLotes.data || []) {
          const nombre = l.productos?.descripcion || 'Producto';
          if (!l.fecha_vencimiento || l.id_lote == null) continue;
          const diff = diasHastaFecha(l.fecha_vencimiento);
          if (diff == null) continue;
          if (diff < 0 || l.estado === 'VENCIDO') {
            vivas.add(`vencido:lote:${l.id_lote}`);
            await insertarNotifConDedup({
              tipo: 'err',
              categoria: 'Vencimiento',
              mensaje: `Vencido: ${nombre} — retirar del stock`,
              accion_url: '/admin-inventario',
              claveDedup: `vencido:lote:${l.id_lote}:${hoyStr}`,
              descartesMap,
            });
          } else if (l.estado === 'VIGENTE') {
            for (const umbral of UMBRALES_AVISO_VENCIMIENTO) {
              if (diff > umbral) continue;
              vivas.add(`porvencer:lote:${l.id_lote}:u${umbral}`);
              const etiqueta = umbral >= 30
                ? `${umbral / 30} mes${umbral / 30 === 1 ? '' : 'es'}`
                : `${umbral} día${umbral === 1 ? '' : 's'}`;
              await insertarNotifConDedup({
                tipo: 'warn',
                categoria: 'Vencimiento',
                mensaje: `Vence en ≤${etiqueta} (${diff}d): ${nombre}`,
                accion_url: '/admin-inventario',
                claveDedup: `porvencer:lote:${l.id_lote}:u${umbral}`,
                descartesMap,
              });
            }
          }
        }

        for (const t of resTickets.data || []) {
          if (t.id_ticket == null) continue;
          vivas.add(`soporte:ticket:${t.id_ticket}`);
          const asunto = (t.asunto || 'Sin asunto').slice(0, 80);
          await insertarNotifConDedup({
            tipo: 'info',
            categoria: 'Soporte',
            mensaje: `Ticket #${t.id_ticket}: ${asunto}`,
            accion_url: `/admin-alertas?tab=SOPORTE&ticketId=${t.id_ticket}`,
            claveDedup: `soporte:ticket:${t.id_ticket}`,
            descartesMap,
          });
        }

        const { data: boletasSunat } = await supabase
          .from('comprobantes_sunat')
          .select('id, serie, numero, estado_envio, aceptada_por_sunat, fecha_envio, tipo_comprobante, ventas(created_at)')
          .eq('tipo_comprobante', 2)
          .eq('aceptada_por_sunat', false)
          .in('estado_envio', ['ENVIADO', 'SIN_CONFIRMAR']);
        const { enPlazo, porVencer, fueraPlazo } = clasificarBoletasPendientesSunat(boletasSunat);
        if (enPlazo.length > 0) {
          vivas.add('sunat:sinconfirmar');
          const series = listarSeriesCortas(enPlazo);
          const n = enPlazo.length;
          await insertarNotifConDedup({
            tipo: 'warn',
            categoria: 'SUNAT',
            mensaje: n === 1
              ? `La boleta ${series} todavía no figura como declarada en SUNAT. Revisala en Nubefact (resúmenes diarios de boletas).`
              : `Hay ${n} boletas (${series}) que SUNAT todavía no confirmó. Pueden no estar declaradas: revisalas en Nubefact (resúmenes diarios de boletas).`,
            accion_url: '/admin-sunat',
            claveDedup: `sunat:sinconfirmar:${hoyStr}`,
            descartesMap,
          });
        }
        if (porVencer.length > 0) {
          vivas.add('sunat:porvencer');
          const series = listarSeriesCortas(porVencer);
          const n = porVencer.length;
          const minQuedan = Math.min(...porVencer.map((f) => f.quedan).filter((q) => q != null));
          const quedanTxt = minQuedan === 1 ? '1 día' : `${minQuedan} días`;
          await insertarNotifConDedup({
            tipo: 'err',
            categoria: 'SUNAT',
            mensaje: n === 1
              ? `La boleta ${series} vence el plazo del resumen diario en ${quedanTxt}. Reclámala ahora en Nubefact.`
              : `Hay ${n} boletas (${series}) a ${quedanTxt} o menos del plazo de ${DIAS_PLAZO_LEGAL_RESUMEN} días. Reclámelas ahora en Nubefact.`,
            accion_url: '/admin-sunat',
            claveDedup: `sunat:porvencer:${hoyStr}`,
            descartesMap,
          });
        }
        if (fueraPlazo.length > 0) {
          vivas.add('sunat:plazovencido');
          const series = listarSeriesCortas(fueraPlazo);
          const n = fueraPlazo.length;
          await insertarNotifConDedup({
            tipo: 'err',
            categoria: 'SUNAT',
            mensaje: n === 1
              ? `La boleta ${series} ya pasó los ${DIAS_PLAZO_LEGAL_RESUMEN} días y SUNAT no la confirmó. Ya no se puede regularizar por la vía normal: revisala ahora en Nubefact.`
              : `Hay ${n} boletas (${series}) fuera del plazo de ${DIAS_PLAZO_LEGAL_RESUMEN} días y SUNAT no las confirmó. Ya no se pueden regularizar por la vía normal: revisalas ahora en Nubefact.`,
            accion_url: '/admin-sunat',
            claveDedup: `sunat:plazovencido:${hoyStr}`,
            descartesMap,
          });
        }

        for (const c of resCompras.data || []) {
          const saldo = Number(c.total_compra || 0) - Number(c.monto_pagado || 0);
          if (saldo <= 0 || !c.fecha_vencimiento) continue;
          const dias = diasHastaFecha(c.fecha_vencimiento);
          if (dias == null) continue;
          const prov = c.proveedores?.razon_social || 'Proveedor';
          const idCompra = c.id_compra ?? 'x';
          if (dias < 0) {
            vivas.add(`cuentas:vencida:compra:${idCompra}`);
            await insertarNotifConDedup({
              tipo: 'err',
              categoria: 'Cuentas',
              mensaje: `Deuda VENCIDA: ${prov} — S/${saldo.toFixed(2)} pendiente`,
              accion_url: '/admin-cuentas',
              claveDedup: `cuentas:vencida:compra:${idCompra}:${hoyStr}`,
              firma: String(saldo),
              modoFirma: 'cuentas',
              descartesMap,
            });
          } else if (dias <= 2) {
            vivas.add(`cuentas:porvencer:compra:${idCompra}`);
            await insertarNotifConDedup({
              tipo: 'warn',
              categoria: 'Cuentas',
              mensaje: `Deuda vence en ${dias} días: ${prov} — S/${saldo.toFixed(2)}`,
              accion_url: '/admin-cuentas',
              claveDedup: `cuentas:porvencer:compra:${idCompra}:${hoyStr}`,
              firma: String(saldo),
              modoFirma: 'cuentas',
              descartesMap,
            });
          }
        }

        await purgarDescartesNoVivas(vivas);
        cargarNotificaciones();
      } catch { /* empty */ }
    };

    generarAlertas();
    const interval = setInterval(generarAlertas, 300000); // cada 5 min

    // Toast de ticket nuevo + recarga de alertas en tiempo real
    const canal = supabase
      .channel('mainlayout-tickets-rt')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tickets_soporte' }, (payload) => {
        const ticket = payload.new;
        if ((ticket.estado || '').toUpperCase() === 'PENDIENTE') {
          setToastTicket({
            tipo: 'nuevo',
            id_ticket: ticket.id_ticket,
            asunto: ticket.asunto || 'Nuevo ticket',
            urgencia: ticket.prioridad || ticket.nivel_urgencia || 'MEDIA',
          });
          playNotifSound();
          if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
          toastTimerRef.current = setTimeout(() => setToastTicket(null), 5000);
        }
        generarAlertas();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tickets_soporte' }, (payload) => {
        generarAlertas();
        // Si el admin responde/resuelve, cerrar toast de ESE ticket (no esperar los 5s)
        const id = payload.new?.id_ticket;
        const huboRespuesta = payload.new?.respuesta_admin
          && payload.new.respuesta_admin !== payload.old?.respuesta_admin;
        const resuelto = (payload.new?.estado || '').toUpperCase() === 'RESUELTO';
        if (id != null && (huboRespuesta || resuelto)) {
          setToastTicket(prev => {
            if (!prev || prev.tipo === 'respuesta') return prev;
            if (Number(prev.id_ticket) !== Number(id)) return prev;
            if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
            return null;
          });
        }
      })
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(canal);
    };
  }, [user]);

  // Consulta a Nubefact el estado de boletas ya enviadas (no reemite).
  // Arranque del admin + cada 12 h; la campana lee el resultado desde la tabla.
  useEffect(() => {
    if (!isAdmin || !user) return undefined;
    verificarEstadosSunatPosteriores().catch(() => {});
    const interval = setInterval(() => {
      verificarEstadosSunatPosteriores().catch(() => {});
    }, INTERVALO_VERIFICACION_SUNAT_MS);
    return () => clearInterval(interval);
  }, [isAdmin, user]);

  // Cerrar toast admin al responder desde AdminAlertas (mismo cliente, inmediato)
  useEffect(() => {
    const onCerrar = (e) => {
      const id = e.detail?.id_ticket;
      if (id == null) return;
      setToastTicket(prev => {
        if (!prev || Number(prev.id_ticket) !== Number(id)) return prev;
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        return null;
      });
    };
    const onMarcada = (e) => {
      const id = e.detail?.id;
      if (id == null) return;
      setNotificaciones(prev => prev.map(n => n.id === id ? { ...n, leido: true } : n));
    };
    window.addEventListener(EVT_ADMIN_TOAST_CERRAR, onCerrar);
    window.addEventListener(EVT_NOTIF_MARCADA_LEIDA, onMarcada);
    return () => {
      window.removeEventListener(EVT_ADMIN_TOAST_CERRAR, onCerrar);
      window.removeEventListener(EVT_NOTIF_MARCADA_LEIDA, onMarcada);
    };
  }, []);

  // Vendedor: badge menú Soporte + toast (Realtime notificaciones + respaldo tickets UPDATE)
  useEffect(() => {
    if (!user || !isVendedor) return;

    const refrescarBadgeSoporte = async () => {
      try {
        const { data } = await supabase
          .from('tickets_soporte')
          .select('id_ticket, respuesta_admin')
          .eq('id_usuario', user.id_usuario);
        setRespuestasNoLeidas(contarRespuestasSinVer(user.id_usuario, data || []));
      } catch { /* empty */ }
    };

    const mostrarToastVendedor = ({ tipo, id_ticket, asunto, notifId }) => {
      const now = Date.now();
      const prev = toastRespuestaDedupRef.current;
      // Evita doble toast (Realtime notificaciones + respaldo tickets UPDATE)
      // Dedup por ticket + tipo (respuesta vs en_curso no se anulan entre sí)
      if (
        prev.id != null
        && Number(prev.id) === Number(id_ticket)
        && prev.tipo === tipo
        && now - prev.at < 8000
      ) return;
      toastRespuestaDedupRef.current = { id: id_ticket, at: now, tipo };
      setToastTicket({
        tipo: tipo || 'respuesta',
        id_ticket: id_ticket ?? null,
        asunto: asunto || (tipo === 'en_curso' ? 'Tu ticket está en curso' : 'Tu ticket tiene respuesta'),
        notifId: notifId ?? undefined,
      });
      playNotifSound();
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setToastTicket(null), 6000);
    };

    refrescarBadgeSoporte();

    const onVista = () => { refrescarBadgeSoporte(); };
    window.addEventListener('soporte-respuesta-vista', onVista);

    canalVendedorRef.current = supabase
      .channel(`vendedor-respuestas-${user.id_usuario}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tickets_soporte' }, (payload) => {
        if (payload.new.id_usuario !== user.id_usuario) return;
        const huboRespuesta = payload.new.respuesta_admin
          && payload.new.respuesta_admin !== payload.old?.respuesta_admin;
        const pasoAEnCurso = (payload.new?.estado || '').toUpperCase() === 'EN PROCESO'
          && (payload.old?.estado || '').toUpperCase() !== 'EN PROCESO';

        if (huboRespuesta) {
          // Nueva respuesta → marcar ticket como "sin ver" de nuevo
          limpiarRespuestaTicketVista(user.id_usuario, payload.new.id_ticket);
          refrescarBadgeSoporte();
          // Respaldo toast (no depende de Realtime en tabla notificaciones)
          mostrarToastVendedor({
            tipo: 'respuesta',
            id_ticket: payload.new.id_ticket,
            asunto: `Respuesta a: ${payload.new.asunto || 'tu ticket'}`,
          });
        } else if (pasoAEnCurso) {
          refrescarBadgeSoporte();
          mostrarToastVendedor({
            tipo: 'en_curso',
            id_ticket: payload.new.id_ticket,
            asunto: 'El admin vio tu ticket y ya está en curso',
          });
        } else {
          refrescarBadgeSoporte();
        }
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notificaciones',
        filter: `usuario_id=eq.${user.id_usuario}`,
      }, (payload) => {
        const n = payload.new;
        setNotificaciones((prev) => deduplicarNotifsPorClave(
          [n, ...prev.filter((x) => x.id !== n.id)],
        ).slice(0, 30));
        if ((n.categoria || '').toLowerCase() === 'soporte' || (n.accion_url || '').includes('/soporte')) {
          const m = String(n.accion_url || '').match(/ticketId=(\d+)/);
          let dedup = '';
          try {
            dedup = new URL(n.accion_url || '/', 'http://local').searchParams.get('dedup') || '';
          } catch { /* empty */ }
          const esEnCurso = dedup.includes('soporte:encurso')
            || (n.mensaje || '').toLowerCase().includes('ya está en curso');
          mostrarToastVendedor({
            tipo: esEnCurso ? 'en_curso' : 'respuesta',
            id_ticket: m ? Number(m[1]) : null,
            asunto: n.mensaje || (esEnCurso
              ? 'El admin vio tu ticket y ya está en curso'
              : 'Tu ticket tiene respuesta'),
            notifId: n.id,
          });
        }
      })
      .subscribe();

    return () => {
      window.removeEventListener('soporte-respuesta-vista', onVista);
      if (canalVendedorRef.current) supabase.removeChannel(canalVendedorRef.current);
    };
  }, [user, isVendedor]);

  // Enter y ↑/↓ mueven el foco entre campos del formulario, en todo el sistema.
  // Si el foco está dentro de un modal/panel con data-keyboard-trap o role="dialog",
  // la navegación se limita a ESE contenedor — evita que Enter "filtre" al fondo
  // (ej. buscador del POS detrás del modal de pago Mixto).
  useEffect(() => {
    const SELECTOR_FOCUSABLE =
      'input:not([disabled]):not([type="hidden"]):not([readonly]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [data-enter-target="true"]';

    const esVisible = (el) => {
      if (el.getAttribute('data-enter-skip') === 'true') return false;
      // Pestañas inactivas de ProductoFormModal (display:none) no deben entrar
      // en la cadena de Enter.
      const tabPanel = el.closest('.pfm-tab-panel');
      if (tabPanel && !tabPanel.classList.contains('is-active')) return false;
      if (el.closest('[hidden]')) return false;
      let node = el;
      while (node && node !== document.body) {
        const estilo = window.getComputedStyle(node);
        if (estilo.visibility === 'hidden' || estilo.display === 'none') return false;
        node = node.parentElement;
      }
      // offsetParent es null en position:fixed; usar client rects como respaldo
      if (el.offsetParent !== null) return true;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };

    const obtenerScope = (target) => {
      if (!(target instanceof Element)) return null;
      return target.closest('[data-keyboard-trap], [role="dialog"]');
    };

    const obtenerFocusables = (scopeRoot) => {
      const root = scopeRoot || document;
      return Array.from(root.querySelectorAll(SELECTOR_FOCUSABLE)).filter(esVisible);
    };
    // [data-enter-target="true"] es un punto de extensión genérico: cualquier control
    // compuesto (ej. un toggle de 2 botones) puede sumarse a esta lista sin ser un
    // input/select/textarea/button nativo, siempre que maneje su propio onKeyDown.

    const moverFoco = (target, delta, scopeRoot) => {
      const focusable = obtenerFocusables(scopeRoot);
      const currentIndex = focusable.indexOf(target);
      const siguienteIndex = currentIndex + delta;
      if (currentIndex > -1 && siguienteIndex >= 0 && siguienteIndex < focusable.length) {
        const siguiente = focusable[siguienteIndex];
        siguiente.focus();
        if (siguiente.select) siguiente.select(); // selecciona el texto para sobrescribir fácil
      }
      // Si no hay siguiente DENTRO del scope, no se sale al fondo — Enter queda atrapado.
    };

    const activarAccionPrincipal = (scopeRoot, formEl) => {
      if (formEl) {
        const submitBtn = formEl.querySelector(
          'button[type="submit"]:not([disabled]):not([data-enter-skip="true"])'
        );
        if (submitBtn) {
          submitBtn.click();
          return true;
        }
        if (typeof formEl.requestSubmit === 'function') {
          try {
            formEl.requestSubmit();
            return true;
          } catch { /* ignore */ }
        }
      }
      if (!scopeRoot) return false;
      const primaryAttr = scopeRoot.querySelector(
        '[data-enter-primary="true"]:not([disabled])'
      );
      if (primaryAttr) {
        primaryAttr.click();
        return true;
      }
      const submitInScope = scopeRoot.querySelector(
        'button[type="submit"]:not([disabled]):not([data-enter-skip="true"])'
      );
      if (submitInScope) {
        submitInScope.click();
        return true;
      }
      return false;
    };

    const handleKeyNav = (e) => {
      const tag = e.target.tagName;
      const scope = obtenerScope(e.target);

      if (e.key === 'Enter') {
        // No interferir en textareas (Enter debe hacer salto de línea)
        if (tag === 'TEXTAREA') return;
        // No interferir en botones (Enter ya activa el click nativo)
        if (tag === 'BUTTON') return;
        // Solo actuar sobre inputs y selects
        if (tag !== 'INPUT' && tag !== 'SELECT') return;
        // Controles con manejo propio de Enter (ej. Físico en Conteo Físico / SearchableSelect abierto):
        // si MainLayout también mueve el foco, puede aterrizar en el botón × del chip
        // y el siguiente Enter (o activación) vacía el filtro de laboratorio.
        if (e.target instanceof Element && e.target.closest('[data-enter-skip="true"]')) return;
        if (e.target instanceof Element && e.target.classList?.contains('ti-v-input-fisico-fila')) return;

        e.preventDefault();

        const formEl = e.target instanceof Element ? e.target.closest('form') : null;
        const scopeRoot = scope
          || formEl
          || (e.target instanceof Element ? e.target.closest('.modal-overlay-strict') : null);

        const focusable = obtenerFocusables(scopeRoot);
        const currentIndex = focusable.indexOf(e.target);
        const siguientes = currentIndex > -1 ? focusable.slice(currentIndex + 1) : [];
        const nextField = siguientes.find(
          (el) => el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA'
        );

        if (nextField) {
          nextField.focus();
          if (nextField.select) nextField.select();
          return;
        }

        // Último campo del formulario/modal → disparar acción principal (submit / data-enter-primary)
        if (activarAccionPrincipal(scopeRoot, formEl)) return;

        // Fallback: mover foco al siguiente control (botón primario)
        moverFoco(e.target, 1, scopeRoot);
        return;
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        // No interferir en textareas (↑/↓ navega entre líneas del texto)
        if (tag === 'TEXTAREA') return;
        if (tag === 'BUTTON') return;
        // No interferir en inputs numéricos (↑/↓ es el spinner nativo de incremento/decremento)
        if (tag === 'INPUT' && e.target.type === 'number') return;
        // Solo actuar sobre inputs y selects (← y → nunca se tocan: son el cursor de texto)
        if (tag !== 'INPUT' && tag !== 'SELECT') return;

        e.preventDefault();
        moverFoco(e.target, e.key === 'ArrowDown' ? 1 : -1, scope);
      }
    };

    document.addEventListener('keydown', handleKeyNav);
    return () => {
      document.removeEventListener('keydown', handleKeyNav);
    };
  }, []);

  // ════════════════════════════════════════
  // HANDLERS
  // ════════════════════════════════════════

  const handleLogout = async () => {
    logout();
    navigate('/login');
  };

  // Notificaciones — marcar leída al clic (baja el contador al toque) + deep-link
  const noLeidas = notificaciones.filter(n => !n.leido).length;

  const marcarNotifLeidaEnMemoriaYBd = async (notif) => {
    if (!notif?.id || notif.leido) return;
    try {
      await supabase.from('notificaciones').update({ leido: true }).eq('id', notif.id);
      setNotificaciones(prev => prev.map(n => n.id === notif.id ? { ...n, leido: true } : n));
    } catch { /* empty */ }
  };

  const marcarLeida = async (notif) => {
    // Respuesta Soporte (vendedor): leída solo al VER el bloque en Soporte.jsx
    const diferirLectura = isVendedor && esNotifRespuestaSoporteVendedor(notif);
    if (!diferirLectura) {
      await marcarNotifLeidaEnMemoriaYBd(notif);
    }
    if (notif.accion_url) {
      if (diferirLectura) {
        navegarDesdeAccionUrl(navigate, notif.accion_url, { pendingNotifId: notif.id });
      } else {
        navegarDesdeAccionUrl(navigate, notif.accion_url);
      }
      setShowNotifPanel(false);
    }
  };

  const abrirToastTicket = async () => {
    if (!toastTicket) return;
    clearTimeout(toastTimerRef.current);
    const snapshot = toastTicket;
    setToastTicket(null);

    if (snapshot.tipo === 'respuesta') {
      // No marcar leída aquí — IntersectionObserver en Soporte al ver la respuesta
      navigate('/soporte', {
        state: {
          ticketId: snapshot.id_ticket,
          pendingNotifId: snapshot.notifId ?? undefined,
          deepLinkNonce: Date.now(),
        },
      });
      return;
    }

    if (snapshot.tipo === 'en_curso') {
      if (snapshot.notifId) {
        const notif = notificaciones.find(n => n.id === snapshot.notifId)
          || { id: snapshot.notifId, leido: false };
        await marcarNotifLeidaEnMemoriaYBd(notif);
      }
      navigate('/soporte', {
        state: {
          ticketId: snapshot.id_ticket,
          deepLinkNonce: Date.now(),
        },
      });
      return;
    }

    // Admin — ticket nuevo: marcar leída al clic (comportamiento habitual)
    let notif = null;
    if (snapshot.notifId) {
      notif = notificaciones.find(n => n.id === snapshot.notifId) || { id: snapshot.notifId, leido: false };
    } else if (snapshot.id_ticket != null) {
      notif = notificaciones.find(n =>
        !n.leido && String(n.accion_url || '').includes(`ticketId=${snapshot.id_ticket}`)
      );
    }
    if (notif) await marcarNotifLeidaEnMemoriaYBd(notif);
    navigate('/admin-alertas', {
      state: {
        tab: 'SOPORTE',
        ticketId: snapshot.id_ticket,
        deepLinkNonce: Date.now(),
      },
    });
  };

  const limpiarNotificaciones = async () => {
    if (notifLimpiando || notificaciones.length === 0) return;
    setNotifLimpiando(true);
    notifPanelVaciadoRef.current = true;
    const snapshot = [...notificaciones];
    const marcar = marcarTodasNotificacionesLeidas(user.id_usuario, {
      soloPropias: isVendedor && !isAdmin,
    });
    const descartar = registrarDescartes(snapshot);
    window.setTimeout(() => {
      setNotificaciones([]);
      setNotifLimpiando(false);
    }, 500);
    try {
      await Promise.all([marcar, descartar]);
    } catch { /* empty */ }
  };

  // Cambio de contraseña
  const cerrarModalClave = () => {
    setShowCambioClave(false); setMsgClave(null);
    setClaveActual(''); setClaveNueva(''); setClaveConfirm('');
    setShowOjoActual(false); setShowOjoNueva(false); setShowOjoConfirm(false);
  };

  const handleCambiarClave = async (e) => {
    e.preventDefault();
    setMsgClave(null);
    if (claveNueva.length < 8)
      return setMsgClave({ texto: 'La nueva contraseña debe tener mínimo 8 caracteres.', ok: false });
    if (claveNueva !== claveConfirm)
      return setMsgClave({ texto: 'Las contraseñas nuevas no coinciden.', ok: false });
    if (claveNueva === claveActual)
      return setMsgClave({ texto: 'La nueva contraseña no puede ser igual a la actual.', ok: false });
    setCambiandoClave(true);
    try {
      const { data: check, error: errCheck } = await supabase
        .from('usuarios')
        .select('id_usuario, password_hash')
        .eq('id_usuario', user.id_usuario)
        .maybeSingle();
      if (errCheck || !check)
        return setMsgClave({ texto: 'La contraseña actual es incorrecta.', ok: false });

      const { ok } = await verificarYMigrarSiPlano({
        id_usuario: check.id_usuario,
        plain: claveActual,
        stored: check.password_hash,
      });
      if (!ok)
        return setMsgClave({ texto: 'La contraseña actual es incorrecta.', ok: false });

      const nuevoHash = await hashPassword(claveNueva);
      const { error } = await supabase
        .from('usuarios')
        .update({ password_hash: nuevoHash })
        .eq('id_usuario', user.id_usuario);
      if (error) throw error;
      setMsgClave({ texto: 'Contraseña actualizada correctamente.', ok: true });
      setClaveActual(''); setClaveNueva(''); setClaveConfirm('');
      setTimeout(() => cerrarModalClave(), 2000);
    } catch (err) {
      setMsgClave({ texto: 'Error: ' + err.message, ok: false });
    } finally {
      setCambiandoClave(false);
    }
  };

  // Resumen del día (vendedor)
  const cargarResumenDia = async () => {
    setLoadingResumen(true);
    setResumenData(null);
    try {
      const hoyInicio = new Date(); hoyInicio.setHours(0, 0, 0, 0);
      const hoyFin = new Date(); hoyFin.setHours(23, 59, 59, 999);
      const { data: ventas } = await supabase
        .from('ventas')
        .select('id_venta, total, created_at, estado_anulacion')
        .eq('id_usuario_vendedor', user.id_usuario)
        .gte('created_at', hoyInicio.toISOString())
        .lte('created_at', hoyFin.toISOString())
        .order('created_at', { ascending: false });

      // Excluye anuladas antes de sumar/usar como "última venta" — mismo criterio que
      // el resto del sistema (estado_anulacion !== 'ANULADO').
      const lista = (ventas || []).filter(v => v.estado_anulacion !== 'ANULADO');
      const totalVentas = lista.reduce((s, v) => s + Number(v.total || 0), 0);
      const ultimaVenta = lista[0] || null;
      const porHora = Array(24).fill(0);
      lista.forEach(v => { porHora[new Date(v.created_at).getHours()] += Number(v.total || 0); });

      let productoTop = null;
      if (lista.length > 0) {
        try {
          const { data: detalles } = await supabase
            .from('venta_detalle')
            .select('id_producto, cantidad, productos(descripcion)')
            .in('id_venta', lista.map(v => v.id_venta));
          if (detalles?.length) {
            const conteo = {};
            detalles.forEach(d => {
              const n = d.productos?.descripcion || `Producto ${d.id_producto}`;
              conteo[n] = (conteo[n] || 0) + Number(d.cantidad || 1);
            });
            productoTop = Object.entries(conteo).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
          }
        } catch { /* empty */ }
      }

      setResumenData({ totalVentas, cantidadTx: lista.length, ultimaVenta, porHora, productoTop });
    } catch {
      setResumenData(null);
    }
    setLoadingResumen(false);
  };

  // Config del sistema (admin)
  const cargarConfigSistema = async () => {
    setConfigSistema(null);
    try {
      const { data } = await supabase.from('configuracion').select('*').eq('id', 1).maybeSingle();
      setConfigSistema(data || { nombre_farmacia: 'Salud Futura', ruc: '', direccion: '', modo_mantenimiento: false, ventas_sin_stock: false });
    } catch {
      setConfigSistema({ nombre_farmacia: 'Salud Futura', ruc: '', direccion: '', modo_mantenimiento: false, ventas_sin_stock: false });
    }
  };

  const guardarConfigSistema = async () => {
    setSavingConfig(true);
    try {
      const { error } = await supabase
        .from('configuracion')
        .upsert({ id: 1, ...configSistema, updated_at: new Date().toISOString() });
      if (error) throw error;
      setMsgConfig({ texto: 'Configuración guardada correctamente.', ok: true });
      setTimeout(() => setMsgConfig(null), 3000);
    } catch (err) {
      setMsgConfig({ texto: 'Error al guardar: ' + err.message, ok: false });
    }
    setSavingConfig(false);
  };

  // Gestionar usuarios (admin)
  const cargarUsuariosGestion = async () => {
    setLoadingUsuariosG(true);
    try {
      const { data } = await supabase
        .from('usuarios')
        .select('id_usuario, nombres, apellidos, dni, id_rol, activo, created_at')
        .order('nombres');
      setUsuariosGestion(data || []);
    } catch { /* empty */ }
    setLoadingUsuariosG(false);
  };

  const toggleActivoUsuario = async (u) => {
    if (u.id_usuario === user.id_usuario) {
      setMsgGestion({ texto: 'No puedes desactivar tu propia cuenta.', ok: false });
      setTimeout(() => setMsgGestion(null), 3000);
      return;
    }
    setAccionUsrId(u.id_usuario);
    try {
      const nuevoEstado = !(u.activo === true || String(u.activo) === '1');
      const { data, error } = await supabase
        .from('usuarios')
        .update({ activo: nuevoEstado })
        .eq('id_usuario', u.id_usuario)
        .select('id_usuario, activo');
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('No se pudo actualizar el usuario (0 filas afectadas).');
      }
      setUsuariosGestion(prev => prev.map(x => x.id_usuario === u.id_usuario ? { ...x, activo: data[0].activo } : x));
    } catch (err) {
      setMsgGestion({ texto: 'Error: ' + err.message, ok: false });
      setTimeout(() => setMsgGestion(null), 3000);
    }
    setAccionUsrId(null);
  };

  const resetPasswordUsuario = async (u) => {
    if (!window.confirm(`¿Resetear contraseña de ${u.nombres} ${u.apellidos}?\nSe usará su DNI (${u.dni}) como nueva contraseña.`)) return;
    setAccionUsrId(u.id_usuario);
    try {
      const nuevoHash = await hashPassword(u.dni);
      const { error } = await supabase.from('usuarios').update({ password_hash: nuevoHash }).eq('id_usuario', u.id_usuario);
      if (error) throw error;
      setMsgGestion({ texto: `Contraseña de ${u.nombres} reseteada a su DNI.`, ok: true });
      setTimeout(() => setMsgGestion(null), 3000);
    } catch (err) {
      setMsgGestion({ texto: 'Error: ' + err.message, ok: false });
      setTimeout(() => setMsgGestion(null), 3000);
    }
    setAccionUsrId(null);
  };

  // ════════════════════════════════════════
  // HELPERS
  // ════════════════════════════════════════

  const esActivo = (u) => u.activo === true || String(u.activo) === '1';
  const rolLabel = (id) => labelRol(id);

  const iniciales = (user?.nombres?.charAt(0) || '') + (user?.apellidos?.charAt(0) || '');

  const diaStr = horaActual.toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric', month: 'short' });
  const horaStr = horaActual.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const getPageTitle = () => {
    const map = {
      '/pos': { main: 'Punto de Venta', sub: 'Nueva venta' },
      '/ventas-perdidas': { main: 'Ventas Perdidas', sub: 'Registro y seguimiento' },
      '/soporte': { main: 'Soporte', sub: 'Centro de ayuda' },
      '/mis-ventas': { main: 'Mis Ventas', sub: 'Historial del turno' },
      '/catalogo': { main: 'Catálogo', sub: 'Consulta de precios' },
      '/toma-inventario': { main: 'Inventario', sub: 'Conteo físico' },
      '/dashboard': { main: 'Mi Caja', sub: 'Apertura de turno' },
      '/admin-dashboard': { main: 'Dashboard', sub: 'Visión General' },
      '/admin-pos': { main: 'Punto de Venta', sub: 'Nueva venta' },
      '/admin-mis-ventas': { main: 'Mis Ventas', sub: 'Historial del turno' },
      '/admin-ventas': { main: 'Ventas', sub: 'Historial de ventas' },
      '/admin-sunat': { main: 'SUNAT', sub: 'Comprobantes electrónicos' },
      '/admin-series-sunat': { main: 'Configuración', sub: 'Series SUNAT por sucursal' },
      '/admin-codigos-proveedor': { main: 'Configuración', sub: 'Códigos de producto por proveedor' },
      '/admin-impresora': { main: 'Impresora', sub: 'Configuración térmica de esta PC' },
      '/admin-compras': { main: 'Compras', sub: 'Nueva compra' },
      '/admin-inventario': { main: 'Inventario', sub: 'Gestión de productos' },
      '/admin-productos': { main: 'Productos', sub: 'Catálogo de productos' },
      '/admin-pedidos': { main: 'Pedidos', sub: 'Pedidos a proveedor' },
      '/admin-cuentas': { main: 'Compras', sub: 'Cuentas por pagar' },
      '/admin-usuarios': { main: 'Configuración', sub: 'Gestión de personal' },
      '/admin-alertas': { main: 'Alertas', sub: 'Centro de control' },
      '/admin-reportes': { main: 'Reportes', sub: 'Dashboard Analítico' },
      '/admin-ganancias': { main: 'Ganancias', sub: 'Diario resumido' },
      '/admin-kardex': { main: 'Inventario', sub: 'Kardex de movimientos' },
      '/admin-toma-inventario': { main: 'Inventario', sub: 'Toma de inventario' },
      '/notificaciones': { main: 'Notificaciones', sub: 'Historial completo' },
    };
    return map[location.pathname] || { main: 'Mi Caja', sub: 'Apertura de turno' };
  };

  const pageTitle = getPageTitle();

  // ════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════

  return (
    <div className="layout-container">

      {/* ── TOAST: ticket nuevo (admin) */}
      {/* ── TOAST: ticket nuevo (admin) / respuesta (vendedor) */}
      {(isAdmin || isVendedor) && toastTicket && (
        <div
          role="button"
          tabIndex={0}
          className={[
            'ticket-toast',
            'ticket-toast-clickable',
            toastTicket.tipo === 'en_curso'
              ? 'ticket-toast-en-curso'
              : `ticket-toast-urgencia-${(toastTicket.urgencia || 'MEDIA').toLowerCase()}`,
          ].join(' ')}
          onClick={() => { abrirToastTicket(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              abrirToastTicket();
            }
          }}
        >
          <div className="ticket-toast-icon">
            <UiIcon name={toastTicket.tipo === 'en_curso' ? 'Loader' : toastTicket.tipo === 'respuesta' ? 'MessageSquare' : 'Ticket'} size={20} />
          </div>
          <div className="ticket-toast-content">
            <span className="ticket-toast-title">
              {toastTicket.tipo === 'en_curso'
                ? 'Ticket en curso'
                : toastTicket.tipo === 'respuesta'
                  ? '¡Respuesta a tu ticket!'
                  : '¡Nuevo ticket de soporte!'}
            </span>
            <span className="ticket-toast-asunto">
              {toastTicket.tipo === 'en_curso'
                ? (toastTicket.asunto || 'El admin vio tu ticket y ya está en curso')
                : toastTicket.tipo === 'respuesta'
                  ? (toastTicket.asunto || 'El administrador respondió')
                  : `"${toastTicket.asunto}"`}
            </span>
            {toastTicket.tipo !== 'respuesta' && toastTicket.tipo !== 'en_curso' && (
              <span className={`ticket-toast-urg u-${(toastTicket.urgencia || 'MEDIA').toLowerCase()}`}>{toastTicket.urgencia}</span>
            )}
            <span className="ticket-toast-hint">Clic para abrir</span>
          </div>
          <button
            type="button"
            className="ticket-toast-close"
            onClick={(e) => {
              e.stopPropagation();
              clearTimeout(toastTimerRef.current);
              setToastTicket(null);
            }}
          ><UiIcon name="X" size={16} /></button>
        </div>
      )}

      {/* ── SIDEBAR */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <img src={icono} alt="Logo" className="sidebar-logo" />
          <span className="sidebar-brand">SALUD FUTURA</span>
        </div>
        <nav className="sidebar-nav">

          {/* Menú vendedor (Rol 3) — mismo orden y rutas */}
          {isVendedor && (<>
            <div className="nav-group">
              <div className="nav-group-label">Operación</div>
            <button className={`nav-item ${location.pathname === '/dashboard' ? 'active' : ''}`} onClick={() => navigate('/dashboard')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="18" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
              Inicio
            </button>
            <button className={`nav-item ${location.pathname === '/pos' ? 'active' : ''}`} onClick={() => navigate('/pos')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2" ry="2" /><line x1="2" y1="10" x2="22" y2="10" /></svg>
              Punto de Venta
            </button>
            <button className={`nav-item ${location.pathname === '/mis-ventas' ? 'active' : ''}`} onClick={() => navigate('/mis-ventas')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>
              Mi Caja
            </button>
            </div>
            <div className="nav-group">
              <div className="nav-group-label">Inventario</div>
            <button className={`nav-item ${location.pathname === '/catalogo' ? 'active' : ''}`} onClick={() => navigate('/catalogo')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
              Catálogo
            </button>
            <button className={`nav-item ${location.pathname === '/toma-inventario' ? 'active' : ''}`} onClick={() => navigate('/toma-inventario')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
              Toma Inventario
            </button>
            </div>
            <div className="nav-group">
              <div className="nav-group-label">Registro</div>
            <button className={`nav-item ${location.pathname === '/ventas-perdidas' ? 'active' : ''}`} onClick={() => navigate('/ventas-perdidas')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><polyline points="8 16 12 12 16 14 20 10" /></svg>
              Ventas Perdidas
            </button>
            <button className={`nav-item ${location.pathname === '/soporte' ? 'active' : ''}`} onClick={() => navigate('/soporte')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6" /><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" /></svg>
              Soporte
              {respuestasNoLeidas > 0 && (
                <span className="sidebar-badge-respuesta">{respuestasNoLeidas > 9 ? '9+' : respuestasNoLeidas}</span>
              )}
            </button>
            </div>
          </>)}

          {/* Menú admin (Rol 2) — mismo orden y rutas; grupos solo visuales */}
          {isAdmin && (<>
            <div className="nav-group">
              <div className="nav-group-label">Inicio</div>
            <button className={`nav-item ${location.pathname === '/admin-dashboard' ? 'active' : ''}`} onClick={() => navigate('/admin-dashboard')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /></svg>
              Dashboard
            </button>
            <button className={`nav-item ${location.pathname === '/admin-productos' ? 'active' : ''}`} onClick={() => navigate('/admin-productos')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.5 7.27L12 12l-8.5-4.73M12 22V12" /><path d="M20.5 7.27L12 2 3.5 7.27l8.5 4.73 8.5-4.73z" /><path d="M3.5 7.27v9.46L12 22l8.5-5.27V7.27" /></svg>
              Productos
            </button>
            <button className={`nav-item ${location.pathname === '/admin-pedidos' ? 'active' : ''}`} onClick={() => navigate('/admin-pedidos')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" /><line x1="9" y1="12" x2="15" y2="12" /><line x1="9" y1="16" x2="15" y2="16" /></svg>
              Pedidos
            </button>
            </div>
            <div className="nav-group">
              <div className="nav-group-label">Operación</div>
            <button className={`nav-item ${location.pathname === '/admin-pos' ? 'active' : ''}`} onClick={() => navigate('/admin-pos')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2" ry="2" /><line x1="2" y1="10" x2="22" y2="10" /></svg>
              Punto de Venta
            </button>
            <button className={`nav-item ${location.pathname === '/dashboard' ? 'active' : ''}`} onClick={() => navigate('/dashboard')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>
              Mi Turno
            </button>
            <button className={`nav-item ${location.pathname === '/admin-mis-ventas' ? 'active' : ''}`} onClick={() => navigate('/admin-mis-ventas')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>
              Mi Caja
            </button>
            <button className={`nav-item ${location.pathname === '/admin-ventas' ? 'active' : ''}`} onClick={() => navigate('/admin-ventas')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
              Ventas
            </button>
            <button className={`nav-item ${location.pathname === '/admin-ganancias' ? 'active' : ''}`} onClick={() => navigate('/admin-ganancias')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></svg>
              Ganancias
            </button>
            </div>
            <div className="nav-group">
              <div className="nav-group-label">Facturación</div>
            <button className={`nav-item ${location.pathname === '/admin-sunat' ? 'active' : ''}`} onClick={() => navigate('/admin-sunat')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
              SUNAT
            </button>
            <button className={`nav-item ${location.pathname === '/admin-series-sunat' ? 'active' : ''}`} onClick={() => navigate('/admin-series-sunat')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 8h10M7 12h6M7 16h8" /></svg>
              Series SUNAT
            </button>
            </div>
            <div className="nav-group">
              <div className="nav-group-label">Compras</div>
            <button className={`nav-item ${location.pathname === '/admin-codigos-proveedor' ? 'active' : ''}`} onClick={() => navigate('/admin-codigos-proveedor')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M4 12h16M4 17h10" /><circle cx="19" cy="17" r="2" /></svg>
              Códigos proveedor
            </button>
            <button className={`nav-item ${location.pathname === '/admin-compras' ? 'active' : ''}`} onClick={() => navigate('/admin-compras')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" /></svg>
              Compras
            </button>
            <button className={`nav-item ${location.pathname === '/admin-cuentas' ? 'active' : ''}`} onClick={() => navigate('/admin-cuentas')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
              Cuentas por pagar
            </button>
            </div>
            <div className="nav-group">
              <div className="nav-group-label">Inventario</div>
            <button className={`nav-item ${location.pathname === '/admin-inventario' ? 'active' : ''}`} onClick={() => navigate('/admin-inventario')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></svg>
              Inventario
            </button>
            <button className={`nav-item ${location.pathname === '/admin-kardex' ? 'active' : ''}`} onClick={() => navigate('/admin-kardex')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
              Kardex
            </button>
            <button className={`nav-item ${location.pathname === '/admin-toma-inventario' ? 'active' : ''}`} onClick={() => navigate('/admin-toma-inventario')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
              Toma Inventario
            </button>
            <button className={`nav-item ${location.pathname === '/toma-inventario' ? 'active' : ''}`} onClick={() => navigate('/toma-inventario')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
              Conteo Físico
            </button>
            </div>
            <div className="nav-group">
              <div className="nav-group-label">Sistema</div>
            <button className={`nav-item ${location.pathname === '/admin-impresora' ? 'active' : ''}`} onClick={() => navigate('/admin-impresora')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg>
              Impresora
            </button>
            <button className={`nav-item ${location.pathname === '/admin-usuarios' ? 'active' : ''}`} onClick={() => navigate('/admin-usuarios')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
              Usuarios
            </button>
            <button className={`nav-item ${location.pathname === '/admin-reportes' ? 'active' : ''}`} onClick={() => navigate('/admin-reportes')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></svg>
              Reportes
            </button>
            <button className={`nav-item ${location.pathname === '/admin-alertas' ? 'active' : ''}`} onClick={() => navigate('/admin-alertas')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
              Alertas
            </button>
            </div>
          </>)}

        </nav>
        <div className="logout-button-wrapper">
          <button className={`logout-button ${showLogoutHint ? 'logout-hint-pulse' : ''}`} onClick={handleLogout}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
            Cerrar Sesión
          </button>
        </div>
      </aside>

      {/* ── MAIN CONTENT */}
      <main className="main-content">
        <header className="topbar">
          <div className="topbar-breadcrumbs">
            <strong className="topbar-crumb-main">{pageTitle.main}</strong>
            <span className="topbar-crumb-sep" aria-hidden="true">/</span>
            <span className="topbar-crumb-sub">{pageTitle.sub}</span>
          </div>

          <div className="topbar-actions">

            {/* Reloj */}
            <div className="topbar-datetime">
              <div className="datetime-dot"></div>
              <span className="datetime-day">{diaStr}</span>
              <span className="datetime-sep">|</span>
              <span className="datetime-hour">{horaStr}</span>
            </div>

            {/* ── CAMPANA NOTIFICACIONES (admin + vendedor) */}
            {(isAdmin || isVendedor) && <div className="notif-wrapper">
              <button
                className={`notification-btn${noLeidas > 0 ? ' has-alerts' : ''}${showNotifPanel ? ' is-open' : ''}`}
                onClick={() => {
                  setShowNotifPanel((v) => {
                    const next = !v;
                    if (!next) notifPanelVaciadoRef.current = false;
                    return next;
                  });
                  setShowPerfil(false);
                }}
                title={noLeidas > 0 ? `${noLeidas} notificaciones sin leer` : 'Notificaciones'}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                {noLeidas > 0 && <span className="notif-badge">{noLeidas > 99 ? '99+' : noLeidas}</span>}
              </button>

              {showNotifPanel && (
                <div className={`notif-panel${notifLimpiando ? ' is-limpiando' : ''}`}>

                  <div className="notif-panel-header">
                    <div>
                      <strong>Centro de avisos</strong>
                      {noLeidas > 0 && (
                        <div className="notif-counters">
                          <span className="notif-counter-critico">{noLeidas} sin leer</span>
                        </div>
                      )}
                    </div>
                    <div className="notif-panel-header-right">
                      {noLeidas > 0 && (
                        <button
                          className="notif-limpiar-btn"
                          disabled={notifLimpiando}
                          onClick={limpiarNotificaciones}
                        >
                          Limpiar
                        </button>
                      )}
                      <button className="notif-panel-close" onClick={() => { notifPanelVaciadoRef.current = false; setShowNotifPanel(false); }}><UiIcon name="X" size={16} /></button>
                    </div>
                  </div>

                  <div className="notif-panel-body">
                    {notificaciones.length === 0 ? (
                      <div className="notif-empty">
                        <span style={{ fontSize: '28px' }}><UiIcon name="Check" size={16} /></span>
                        Sin notificaciones
                      </div>
                    ) : (
                      notificaciones.map((n, i) => {
                        const partes = partesMensajeNotif(n.mensaje);
                        return (
                        <button
                          key={n.id}
                          className={`notif-item notif-tipo-${n.tipo} ${n.accion_url ? 'clickable' : ''} ${n.leido ? 'notif-leida' : ''}`}
                          style={{ '--i': Math.min(i, 16) }}
                          onClick={() => marcarLeida(n)}
                        >
                          <div className="notif-item-icon"><UiIcon name={TIPO_ICON[n.tipo] || 'Info'} size={18} /></div>
                          <div className="notif-item-body-col">
                            <span className="notif-item-categoria">{n.categoria}</span>
                            {partes.kind === 'stock' ? (
                              <span className="notif-item-texto notif-item-texto-stock">
                                <strong className="notif-item-qty">{partes.cantidad} und</strong>
                                <span className="notif-item-sep" aria-hidden>—</span>
                                <span className="notif-item-nombre" title={partes.nombre}>{partes.nombre}</span>
                              </span>
                            ) : (
                              <span className="notif-item-texto">{partes.texto}</span>
                            )}
                            <span className="notif-item-tiempo">
                              {tiempoRelativo(n.created_at)}
                              {n.accion_label ? ` · ${n.accion_label}` : ''}
                            </span>
                          </div>
                          {!n.leido && <span className="notif-unread-dot" />}
                        </button>
                        );
                      })
                    )}
                  </div>

                  <button
                    className="notif-panel-footer"
                    onClick={() => { navigate('/notificaciones'); setShowNotifPanel(false); }}
                  >
                    Ver todas
                  </button>

                </div>
              )}
            </div>}

            {/* ── AVATAR + PERFIL DROPDOWN */}
            <div className="profile-wrapper">
              <button
                className={`user-avatar-btn${showPerfil ? ' is-open' : ''}`}
                onClick={() => { setShowPerfil(v => !v); setShowNotifPanel(false); }}
                title="Mi perfil"
              >
                <div className="user-avatar">{iniciales}</div>
              </button>

              {showPerfil && (
                <div className="profile-panel">
                  <div className="profile-panel-header">
                    <div className="profile-avatar-big">{iniciales}</div>
                    <div>
                      <p className="profile-nombre">{user?.nombres} {user?.apellidos}</p>
                      <span className={`profile-rol-badge ${isAdmin ? 'rol-admin' : 'rol-vendedor'}`}>
                        {isAdmin
                          ? <><UiIcon name="Settings" size={12} /> Administrador</>
                          : <><UiIcon name="ShoppingCart" size={12} /> {labelRol(user?.id_rol)}</>}
                      </span>
                      {user?.sucursales?.nombre_comercial && (
                        <p className="profile-sucursal"><UiIcon name="MapPin" size={12} /> {user.sucursales.nombre_comercial}</p>
                      )}
                    </div>
                  </div>

                  <div className="profile-panel-body">
                    {/* Solo vendedor */}
                    {isVendedor && (
                      <button className="profile-option" onClick={() => { setShowResumen(true); setShowPerfil(false); cargarResumenDia(); }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M3 3v18h18" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></svg>
                        Mi resumen del día
                      </button>
                    )}
                    {/* Solo admin */}
                    {isAdmin && (<>
                      <button className="profile-option" onClick={() => { setShowSistema(true); setShowPerfil(false); cargarConfigSistema(); }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><circle cx="12" cy="12" r="3" /><path d="M19.07 4.93l-1.41 1.41M4.93 4.93l1.41 1.41M12 2v2M12 20v2M2 12h2M20 12h2M19.07 19.07l-1.41-1.41M4.93 19.07l1.41-1.41" /></svg>
                        Configuración del sistema
                      </button>
                      <button className="profile-option" onClick={() => { setShowGestionUsuarios(true); setShowPerfil(false); cargarUsuariosGestion(); }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /></svg>
                        Gestionar usuarios
                      </button>
                    </>)}
                    {/* Ambos roles */}
                    <button className="profile-option" onClick={() => { setShowCambioClave(true); setShowPerfil(false); }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                      Cambiar contraseña
                    </button>
                    <button className="profile-option danger" onClick={() => { handleLogout(); setShowPerfil(false); }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
                      Cerrar sesión
                    </button>
                  </div>

                  <button className="profile-panel-close" onClick={() => setShowPerfil(false)}><UiIcon name="X" size={16} /></button>
                </div>
              )}
            </div>

          </div>
        </header>

        <div className="page-content">
          <Outlet context={{ dispararHintLogout }} />
        </div>
      </main>

      {/* ══════════════════════════════════════════
          MODAL: Cambio de contraseña
      ══════════════════════════════════════════ */}
      {showCambioClave && (
        <div className="modal-overlay-strict" role="dialog" aria-modal="true" data-keyboard-trap>
          <div className="profile-clave-modal">
            <button type="button" className="btn-close-abs" data-enter-skip="true" tabIndex={-1} onClick={cerrarModalClave}><UiIcon name="X" size={16} /></button>
            <div className="pcm-header">
              <div className="pcm-icon"><UiIcon name="Key" size={16} /></div>
              <h3>Cambiar contraseña</h3>
              <p>{user?.nombres} {user?.apellidos}</p>
            </div>
            <form className="pcm-form" onSubmit={handleCambiarClave}>
              <label>Contraseña actual</label>
              <div className="pcm-field-group">
                <input
                  type={showOjoActual ? 'text' : 'password'}
                  value={claveActual}
                  onChange={e => setClaveActual(e.target.value)}
                  placeholder="••••••••"
                  required
                />
                <button type="button" className="pcm-eye-btn" data-enter-skip="true" tabIndex={-1} onClick={() => setShowOjoActual(v => !v)}>
                  {showOjoActual ? <UiIcon name="EyeOff" size={16} /> : <UiIcon name="Eye" size={16} />}
                </button>
              </div>

              <label>Nueva contraseña</label>
              <div className="pcm-field-group">
                <input
                  type={showOjoNueva ? 'text' : 'password'}
                  value={claveNueva}
                  onChange={e => setClaveNueva(e.target.value)}
                  placeholder="Mínimo 8 caracteres"
                  required
                />
                <button type="button" className="pcm-eye-btn" data-enter-skip="true" tabIndex={-1} onClick={() => setShowOjoNueva(v => !v)}>
                  {showOjoNueva ? <UiIcon name="EyeOff" size={16} /> : <UiIcon name="Eye" size={16} />}
                </button>
              </div>

              <label>Confirmar nueva contraseña</label>
              <div className="pcm-field-group">
                <input
                  type={showOjoConfirm ? 'text' : 'password'}
                  value={claveConfirm}
                  onChange={e => setClaveConfirm(e.target.value)}
                  placeholder="Repite la contraseña"
                  required
                />
                <button type="button" className="pcm-eye-btn" data-enter-skip="true" tabIndex={-1} onClick={() => setShowOjoConfirm(v => !v)}>
                  {showOjoConfirm ? <UiIcon name="EyeOff" size={16} /> : <UiIcon name="Eye" size={16} />}
                </button>
              </div>

              {msgClave && <p className={`pcm-msg ${msgClave.ok ? 'ok' : 'err'}`}>{msgClave.texto}</p>}
              <button type="submit" className="pcm-btn" disabled={cambiandoClave}>
                {cambiandoClave ? 'Actualizando...' : 'Guardar nueva contraseña'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════
          MODAL: Mi resumen del día (vendedor)
      ══════════════════════════════════════════ */}
      {showResumen && (
        <div className="modal-overlay-strict">
          <div className="resumen-modal">
            <button className="btn-close-abs" onClick={() => setShowResumen(false)}><UiIcon name="X" size={16} /></button>
            <div className="resumen-header">
              <h3><UiIcon name="BarChart3" size={15} /> Mi resumen del día</h3>
              <p>{new Date().toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            </div>

            {loadingResumen ? (
              <div className="resumen-loading">Cargando datos...</div>
            ) : !resumenData ? (
              <div className="resumen-loading">No hay ventas registradas hoy.</div>
            ) : (
              <>
                <div className="resumen-kpis">
                  <div className="resumen-kpi">
                    <span className="rk-label">Total ventas</span>
                    <span className="rk-value rk-green">S/ {resumenData.totalVentas.toFixed(2)}</span>
                  </div>
                  <div className="resumen-kpi">
                    <span className="rk-label">Transacciones</span>
                    <span className="rk-value">{resumenData.cantidadTx}</span>
                  </div>
                  <div className="resumen-kpi">
                    <span className="rk-label">Top producto</span>
                    <span className="rk-value rk-small">{resumenData.productoTop || '—'}</span>
                  </div>
                  <div className="resumen-kpi">
                    <span className="rk-label">Última venta</span>
                    <span className="rk-value rk-small">
                      {resumenData.ultimaVenta
                        ? `${new Date(resumenData.ultimaVenta.created_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })} — S/${Number(resumenData.ultimaVenta.total).toFixed(2)}`
                        : '—'}
                    </span>
                  </div>
                </div>

                <div className="resumen-chart-section">
                  <p className="resumen-chart-title">Ventas por hora</p>
                  <div className="resumen-chart">
                    {Array.from({ length: 14 }, (_, i) => i + 8).map(h => {
                      const val = resumenData.porHora[h] || 0;
                      const maxVal = Math.max(...resumenData.porHora.slice(8, 22), 1);
                      const pct = (val / maxVal) * 100;
                      return (
                        <div key={h} className="resumen-bar-col">
                          <div className="resumen-bar-wrap">
                            <div
                              className="resumen-bar"
                              style={{ height: `${val > 0 ? Math.max(pct, 6) : 0}%` }}
                              title={val > 0 ? `S/${val.toFixed(2)}` : 'Sin ventas'}
                            />
                          </div>
                          <span className="resumen-bar-label">{h}h</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════
          MODAL: Configuración del sistema (admin)
      ══════════════════════════════════════════ */}
      {showSistema && (
        <div className="modal-overlay-strict">
          <div className="sistema-modal">
            <button className="btn-close-abs" onClick={() => { setShowSistema(false); setMsgConfig(null); }}><UiIcon name="X" size={16} /></button>
            <div className="sistema-header">
              <h3><UiIcon name="Settings" size={15} /> Configuración del sistema</h3>
              <p>Parámetros generales de la farmacia</p>
            </div>

            {!configSistema ? (
              <div className="resumen-loading">Cargando configuración...</div>
            ) : (
              <div className="sistema-form">
                <label className="sf-label">Nombre de la farmacia</label>
                <input
                  className="sf-input"
                  value={configSistema.nombre_farmacia || ''}
                  onChange={e => setConfigSistema(p => ({ ...p, nombre_farmacia: e.target.value }))}
                />

                <label className="sf-label">
                  RUC <span style={{ color: '#94a3b8', fontWeight: 400, textTransform: 'none', fontSize: '0.68rem' }}>(solo lectura)</span>
                </label>
                <input
                  className="sf-input"
                  value={configSistema.ruc || ''}
                  readOnly
                  style={{ background: '#f8fafc', color: '#94a3b8', cursor: 'not-allowed' }}
                />

                <label className="sf-label">Dirección</label>
                <input
                  className="sf-input"
                  value={configSistema.direccion || ''}
                  onChange={e => setConfigSistema(p => ({ ...p, direccion: e.target.value }))}
                />

                <div className="sf-toggle-row">
                  <div>
                    <span className="sf-label" style={{ marginTop: 0 }}>Modo mantenimiento</span>
                    <p className="sf-toggle-desc">Deshabilita acceso a vendedores</p>
                  </div>
                  <button
                    className={`sf-toggle ${configSistema.modo_mantenimiento ? 'sf-toggle-on' : ''}`}
                    onClick={() => setConfigSistema(p => ({ ...p, modo_mantenimiento: !p.modo_mantenimiento }))}
                  >
                    <span className="sf-toggle-thumb" />
                  </button>
                </div>

                <div className="sf-toggle-row">
                  <div>
                    <span className="sf-label" style={{ marginTop: 0 }}>Ventas sin stock</span>
                    <p className="sf-toggle-desc">Permite vender con cantidad 0</p>
                  </div>
                  <button
                    className={`sf-toggle ${configSistema.ventas_sin_stock ? 'sf-toggle-on' : ''}`}
                    onClick={() => setConfigSistema(p => ({ ...p, ventas_sin_stock: !p.ventas_sin_stock }))}
                  >
                    <span className="sf-toggle-thumb" />
                  </button>
                </div>

                {msgConfig && <p className={`pcm-msg ${msgConfig.ok ? 'ok' : 'err'}`}>{msgConfig.texto}</p>}
                <button className="pcm-btn" onClick={guardarConfigSistema} disabled={savingConfig}>
                  {savingConfig ? 'Guardando...' : 'Guardar cambios'}
                </button>
                <button
                  type="button"
                  className="pcm-btn-ghost"
                  style={{ marginTop: 10, width: '100%', padding: '0.7rem', borderRadius: 10, border: '1px solid #e2e8f0', background: '#f8fafc', fontWeight: 700, cursor: 'pointer', color: '#334155' }}
                  onClick={() => { setShowSistema(false); setMsgConfig(null); navigate('/admin-series-sunat'); }}
                >
                  Series SUNAT por sucursal
                </button>
                <button
                  type="button"
                  className="pcm-btn-ghost"
                  style={{ marginTop: 8, width: '100%', padding: '0.7rem', borderRadius: 10, border: '1px solid #e2e8f0', background: '#f8fafc', fontWeight: 700, cursor: 'pointer', color: '#334155' }}
                  onClick={() => { setShowSistema(false); setMsgConfig(null); navigate('/admin-codigos-proveedor'); }}
                >
                  Códigos de producto por proveedor
                </button>
                <p className="sistema-about">
                  Salud Futura v{APP_VERSION}
                  <br />
                  Hecho por Brayan Siccha (M1000) · 2026
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════
          MODAL: Gestionar usuarios (admin)
      ══════════════════════════════════════════ */}
      {showGestionUsuarios && (
        <div className="modal-overlay-strict">
          <div className="gestion-modal">
            <button className="btn-close-abs" onClick={() => { setShowGestionUsuarios(false); setMsgGestion(null); }}><UiIcon name="X" size={16} /></button>
            <div className="sistema-header">
              <h3><UiIcon name="Users" size={15} /> Gestionar usuarios</h3>
              <p>Activar/desactivar cuentas y resetear contraseñas</p>
            </div>

            {msgGestion && (
              <p className={`pcm-msg ${msgGestion.ok ? 'ok' : 'err'}`} style={{ margin: '0 0 12px' }}>
                {msgGestion.texto}
              </p>
            )}

            {loadingUsuariosG ? (
              <div className="resumen-loading">Cargando usuarios...</div>
            ) : (
              <div className="gestion-table-wrap">
                <table className="gestion-table">
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>DNI</th>
                      <th>Rol</th>
                      <th>Estado</th>
                      <th>Última sesión</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usuariosGestion.map(u => (
                      <tr key={u.id_usuario} className={u.id_usuario === user.id_usuario ? 'gestion-row-self' : ''}>
                        <td className="gestion-nombre">{u.nombres} {u.apellidos}</td>
                        <td style={{ fontSize: '0.8rem', color: '#64748b' }}>{u.dni}</td>
                        <td>
                          <span className={`gestion-rol ${esAdmin(u.id_rol) ? 'gr-admin' : 'gr-vendedor'}`}>
                            {rolLabel(u.id_rol)}
                          </span>
                        </td>
                        <td>
                          <span className={`gestion-estado ${esActivo(u) ? 'ge-activo' : 'ge-inactivo'}`}>
                            {esActivo(u) ? 'Activo' : 'Inactivo'}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                          {u.updated_at ? tiempoRelativo(u.updated_at) : '—'}
                        </td>
                        <td>
                          <div className="gestion-actions">
                            <button
                              className={`ga-btn ${esActivo(u) ? 'ga-desactivar' : 'ga-activar'}`}
                              onClick={() => toggleActivoUsuario(u)}
                              disabled={accionUsrId === u.id_usuario || u.id_usuario === user.id_usuario}
                              title={u.id_usuario === user.id_usuario ? 'No puedes desactivarte a ti mismo' : ''}
                            >
                              {accionUsrId === u.id_usuario ? '...' : (esActivo(u) ? 'Desactivar' : 'Activar')}
                            </button>
                            <button
                              className="ga-btn ga-reset"
                              onClick={() => resetPasswordUsuario(u)}
                              disabled={accionUsrId === u.id_usuario}
                              title="Resetear contraseña al DNI del usuario"
                            >
                              {accionUsrId === u.id_usuario ? '...' : 'Reset pwd'}
                            </button>
                          </div>
                        </td>
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
