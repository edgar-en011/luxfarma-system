import React, { useState, useEffect, useRef } from 'react';
import AlertaSistemaModal from '../../components/AlertaSistemaModal';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../supabaseClient';
import { EVT_NOTIF_MARCADA_LEIDA } from '../../utils/notificacionesService';
import { limpiarRespuestaTicketVista, marcarRespuestaTicketVista, ticketRespuestaSinVer } from '../../utils/soporteTicketVista';
import { fusionarTicketEnLista, publicarCambioTicket, sameTicketId, suscribirSoporteSync } from '../../utils/soporteRealtime';
import { notificarNuevoTicketAdmins } from '../../utils/notificacionesService';
import './Soporte.css';
import UiIcon from '../../components/UiIcon';

export default function Soporte() {
  const { user } = useAuth();
  const location = useLocation();

  const [asunto, setAsunto] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [nivelUrgencia, setNivelUrgencia] = useState('ALTA');
  const [enviando, setEnviando] = useState(false);
  const [alertaSistema, setAlertaSistema] = useState(null);
  const mostrarAlerta = (mensaje, tipo = 'info') => setAlertaSistema({ mensaje, tipo });
  const alertOkBtnRef = useRef(null);
  const precargaTicketAplicada = useRef(false);
  useEffect(() => {
    if (alertaSistema && alertOkBtnRef.current) alertOkBtnRef.current.focus();
  }, [alertaSistema]);

  // Precarga desde Mi Caja → "Enviar ticket" (stock bajo / sin stock)
  useEffect(() => {
    if (precargaTicketAplicada.current) return;
    const pre = location.state?.ticketPredefinido;
    if (!pre) return;
    precargaTicketAplicada.current = true;
    if (pre.asunto) setAsunto(pre.asunto);
    if (pre.descripcion) setDescripcion(pre.descripcion);
    if (pre.prioridad) setNivelUrgencia(pre.prioridad);
  }, [location.state]);

  const [reportes, setReportes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ticketExpandido, setTicketExpandido] = useState(null);
  const [ticketResaltado, setTicketResaltado] = useState(null);
  const [respHighlightId, setRespHighlightId] = useState(null);
  const [nuevasRespuestas, setNuevasRespuestas] = useState(new Set());
  const deepLinkTicketRef = useRef(null);
  const deepLinkNonceRef = useRef(null);
  const deepLinkAplicadoNonceRef = useRef(null);
  const pendingNotifIdRef = useRef(null);
  const notifsMarcadasVistaRef = useRef(new Set());
  const highlightTimerRef = useRef(null);

  const cargarReportes = async () => {
    try {
      const { data, error } = await supabase
        .from('tickets_soporte')
        .select('*')
        .eq('id_usuario', user.id_usuario)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setReportes(data || []);
    } catch (error) {
      console.error('Error cargando reportes:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargarReportes();
    const poll = setInterval(() => { cargarReportes(); }, 8000);
    const off = suscribirSoporteSync(({ ticket }) => {
      if (!ticket || !sameTicketId(ticket.id_usuario, user.id_usuario)) return;
      setReportes((prev) => {
        const habia = prev.find((r) => sameTicketId(r.id_ticket, ticket.id_ticket));
        const nuevaResp = ticket.respuesta_admin
          && ticket.respuesta_admin !== (habia?.respuesta_admin || '');
        if (nuevaResp) {
          limpiarRespuestaTicketVista(user.id_usuario, ticket.id_ticket);
          queueMicrotask(() => {
            const id = Number(ticket.id_ticket);
            setTicketExpandido(id);
            setTicketResaltado(id);
            requestAnimationFrame(() => enfocarBloqueRespuesta(id));
          });
        }
        return fusionarTicketEnLista(prev, ticket);
      });
    });
    return () => {
      clearInterval(poll);
      off();
    };
  }, [user.id_usuario]);

  useEffect(() => {
    if (!user?.id_usuario) return;
    const s = new Set();
    for (const t of reportes) {
      if (ticketRespuestaSinVer(user.id_usuario, t)) s.add(Number(t.id_ticket));
    }
    setNuevasRespuestas(s);
  }, [reportes, user?.id_usuario]);

  // Deep-link: campana / toast → abrir ticket + scroll/highlight (re-aplica con deepLinkNonce)
  useEffect(() => {
    const fromState = location.state?.ticketId;
    const fromQuery = new URLSearchParams(location.search).get('ticketId');
    const raw = fromState ?? fromQuery;
    if (raw == null || raw === '') return;
    deepLinkTicketRef.current = Number(raw) || raw;
    deepLinkNonceRef.current = location.state?.deepLinkNonce ?? `q-${raw}-${Date.now()}`;
    if (location.state?.pendingNotifId != null) {
      pendingNotifIdRef.current = location.state.pendingNotifId;
    }
  }, [location.state, location.search]);

  const enfocarBloqueRespuesta = (idTicket) => {
    const el = document.getElementById(`sop-resp-${idTicket}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setRespHighlightId(Number(idTicket));
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setRespHighlightId(null), 2000);
  };

  useEffect(() => {
    const id = deepLinkTicketRef.current;
    const nonce = deepLinkNonceRef.current;
    if (id == null || reportes.length === 0) return;
    // Re-aplicar si hay nonce nuevo (mismo ticketId / ya en /soporte)
    if (nonce != null && deepLinkAplicadoNonceRef.current === nonce) return;
    if (nonce == null && deepLinkAplicadoNonceRef.current === `once-${id}`) return;

    deepLinkAplicadoNonceRef.current = nonce ?? `once-${id}`;
    const ticket = reportes.find(t => Number(t.id_ticket) === Number(id));
    if (!ticket) return;
    setTicketResaltado(Number(ticket.id_ticket));
    if (ticket.respuesta_admin) {
      setTicketExpandido(ticket.id_ticket);
      marcarRespuestaTicketVista(user.id_usuario, Number(ticket.id_ticket));
      requestAnimationFrame(() => {
        requestAnimationFrame(() => enfocarBloqueRespuesta(ticket.id_ticket));
      });
    } else {
      requestAnimationFrame(() => {
        document.getElementById(`sop-ticket-${ticket.id_ticket}`)?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      });
    }
  }, [reportes, location.state?.deepLinkNonce, location.state?.ticketId]);

  // Marcar leída al VER el bloque de respuesta (IntersectionObserver) — solo notifs Soporte/Vendedor
  useEffect(() => {
    if (!user?.id_usuario || ticketExpandido == null) return;
    const el = document.getElementById(`sop-resp-${ticketExpandido}`);
    if (!el) return;

    let cancelled = false;

    const marcarVistas = async () => {
      const idTicket = ticketExpandido;
      const pendingId = pendingNotifIdRef.current;

      // Badge menú Soporte: este ticket ya fue visto
      marcarRespuestaTicketVista(user.id_usuario, idTicket);

      const marcarUna = async (notifId) => {
        if (notifId == null || notifsMarcadasVistaRef.current.has(notifId)) return;
        notifsMarcadasVistaRef.current.add(notifId);
        try {
          await supabase.from('notificaciones').update({ leido: true }).eq('id', notifId);
          window.dispatchEvent(new CustomEvent(EVT_NOTIF_MARCADA_LEIDA, { detail: { id: notifId } }));
        } catch {
          notifsMarcadasVistaRef.current.delete(notifId);
        }
      };

      if (pendingId != null) {
        await marcarUna(pendingId);
        pendingNotifIdRef.current = null;
      }

      try {
        const { data } = await supabase
          .from('notificaciones')
          .select('id, accion_url, leido, categoria')
          .eq('usuario_id', user.id_usuario)
          .eq('leido', false)
          .ilike('categoria', 'soporte')
          .limit(40);
        if (cancelled) return;
        for (const n of data || []) {
          if (!String(n.accion_url || '').includes(`ticketId=${idTicket}`)) continue;
          if (!String(n.accion_url || '').includes('/soporte')) continue;
          await marcarUna(n.id);
        }
      } catch { /* empty */ }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some(e => e.isIntersecting && e.intersectionRatio >= 0.35)) {
          marcarVistas();
        }
      },
      { threshold: [0.35, 0.5, 0.75] }
    );
    observer.observe(el);

    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    if (rect.top < vh * 0.9 && rect.bottom > vh * 0.1) {
      marcarVistas();
    }

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [ticketExpandido, user?.id_usuario, reportes]);

  useEffect(() => () => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
  }, []);

  const handleEnviarTicket = async (e) => {
    e.preventDefault();
    if (!asunto.trim() || !descripcion.trim())
      return mostrarAlerta('Completa el asunto y la descripción antes de enviar.', 'warning');

    setEnviando(true);
    try {
      const { data: creado, error } = await supabase.from('tickets_soporte').insert({
        id_usuario: user.id_usuario,
        id_sucursal: user.id_sucursal,
        asunto,
        descripcion,
        prioridad: nivelUrgencia,
        tipo: 'Prob. técnico',
        estado: 'PENDIENTE',
      }).select().single();
      if (error) throw error;

      await notificarNuevoTicketAdmins({
        id_ticket: creado?.id_ticket,
        asunto: creado?.asunto,
        prioridad: creado?.prioridad,
      });
      await publicarCambioTicket('INSERT', creado);

      setAsunto(''); setDescripcion(''); setNivelUrgencia('ALTA');
      mostrarAlerta(
        'Ticket enviado. El administrador lo revisará y recibirás respuesta aquí mismo.',
        'success'
      );
      cargarReportes();
    } catch (error) {
      mostrarAlerta('Error al enviar: ' + error.message, 'error');
    } finally {
      setEnviando(false);
    }
  };

  const marcarAbierto = (idTicket) => {
    const id = Number(idTicket);
    marcarRespuestaTicketVista(user.id_usuario, id);
    setNuevasRespuestas((prev) => {
      const s = new Set(prev);
      s.delete(id);
      s.delete(idTicket);
      return s;
    });
  };

  const ticketsSinAbrir = reportes.filter((t) => nuevasRespuestas.has(Number(t.id_ticket)) || ticketRespuestaSinVer(user.id_usuario, t));
  const numeroSinAbrir = (idTicket) => {
    const i = ticketsSinAbrir.findIndex((t) => Number(t.id_ticket) === Number(idTicket));
    return i >= 0 ? i + 1 : null;
  };

  const getEstadoStyle = (estado) => {
    const e = (estado || '').toUpperCase();
    if (e === 'RESUELTO') return { label: 'Resuelto', cls: 'green' };
    if (e === 'EN PROCESO') return { label: <><UiIcon name="Loader" size={12} /> En proceso</>, cls: 'yellow' };
    return { label: <><UiIcon name="Timer" size={12} /> Pendiente</>, cls: 'blue' };
  };

  return (
    <div className="soporte-container">

      <AlertaSistemaModal alerta={alertaSistema} onClose={() => setAlertaSistema(null)} />

      <div className="sop-page-card">

      <div className="sop-top-grid">

        <div className="sop-card">
          <div className="sop-card-header">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 22h14a2 2 0 0 0 2-2V7.5L14.5 2H6a2 2 0 0 0-2 2v4"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M2 15h10"></path><path d="m9 18 3-3-3-3"></path></svg>
            <h3>Reportar un problema</h3>
          </div>

          <form className="sop-form" onSubmit={handleEnviarTicket} data-keyboard-trap>
            <div className="sop-form-group">
              <label>Asunto</label>
              <input type="text" placeholder="Ej: Error al cerrar caja, producto no aparece..." value={asunto} onChange={e => setAsunto(e.target.value)} required />
            </div>
            <div className="sop-form-group">
              <label>Descripción detallada</label>
              <textarea placeholder="Describe el problema con el mayor detalle posible..." rows="4" value={descripcion} onChange={e => setDescripcion(e.target.value)} required></textarea>
            </div>
            <div className="sop-form-footer">
              <div className="sop-priority-group">
                <label>Prioridad</label>
                <div className="sop-toggles">
                  <button type="button" data-enter-skip="true" tabIndex={-1} className={`sop-toggle-btn red ${nivelUrgencia === 'ALTA' ? 'active' : ''}`} onClick={() => setNivelUrgencia('ALTA')}>Alta</button>
                  <button type="button" data-enter-skip="true" tabIndex={-1} className={`sop-toggle-btn yellow ${nivelUrgencia === 'MEDIA' ? 'active' : ''}`} onClick={() => setNivelUrgencia('MEDIA')}>Media</button>
                  <button type="button" data-enter-skip="true" tabIndex={-1} className={`sop-toggle-btn green ${nivelUrgencia === 'BAJA' ? 'active' : ''}`} onClick={() => setNivelUrgencia('BAJA')}>Baja</button>
                </div>
              </div>
              <button type="submit" className="sop-btn-submit" disabled={enviando}>
                {enviando ? 'Enviando...' : 'Enviar ticket'}
              </button>
            </div>
          </form>
        </div>

        <div className="sop-card sop-contact-card">
          <div className="sop-card-header">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
            <h3>Estado de mis tickets</h3>
          </div>
          <div className="sop-stats-grid">
            <div className="sop-stat-item stat-total">
              <span className="sop-stat-icon"><UiIcon name="BarChart3" size={16} /></span>
              <span className="sop-stat-num">{reportes.length}</span>
              <span className="sop-stat-label">Total enviados</span>
            </div>
            <div className="sop-stat-item stat-pendientes">
              <span className="sop-stat-icon"><UiIcon name="Loader" size={16} /></span>
              <span className="sop-stat-num">{reportes.filter(r => (r.estado || '').toUpperCase() === 'PENDIENTE').length}</span>
              <span className="sop-stat-label">Pendientes</span>
            </div>
            <div className="sop-stat-item stat-resueltos">
              <span className="sop-stat-icon"><UiIcon name="CheckCircle2" size={16} /></span>
              <span className="sop-stat-num">{reportes.filter(r => (r.estado || '').toUpperCase() === 'RESUELTO').length}</span>
              <span className="sop-stat-label">Resueltos</span>
            </div>
          </div>
          {ticketsSinAbrir.length > 0 && (
            <div className="sop-new-reply-banner">
              <span className="sop-badge-num">{ticketsSinAbrir.length}</span>
              <strong>{ticketsSinAbrir.length === 1 ? 'respuesta por abrir' : 'respuestas por abrir'}</strong>
            </div>
          )}
        </div>
      </div>

      <div className="sop-card sop-table-card">
        <div className="sop-table-header">
          <h3>Mis reportes enviados</h3>
          {ticketsSinAbrir.length > 0 && (
            <span className="sop-badge-num sop-badge-num-header" title="Respuestas que aún no abriste">{ticketsSinAbrir.length}</span>
          )}
        </div>

        {loading ? (
          <p className="sop-lista-vacia">Cargando tus reportes...</p>
        ) : reportes.length === 0 ? (
          <p className="sop-lista-vacia">No tienes reportes enviados aún.</p>
        ) : (
          <div className="sop-lista-tickets">
            {reportes.map((ticket) => {
              const { label, cls } = getEstadoStyle(ticket.estado);
              const tieneRespuesta = !!ticket.respuesta_admin;
              const esNueva = nuevasRespuestas.has(Number(ticket.id_ticket));
              const resaltado = Number(ticket.id_ticket) === Number(ticketResaltado);
              const expandido = Number(ticketExpandido) === Number(ticket.id_ticket);
              const fecha = ticket.created_at
                ? `${new Date(ticket.created_at).toLocaleDateString('es-PE')} ${new Date(ticket.created_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}`
                : '';
              const preview = tieneRespuesta
                ? String(ticket.respuesta_admin).replace(/\s+/g, ' ').slice(0, 80)
                : 'Esperando respuesta del administrador';
              return (
                <article
                  key={ticket.id_ticket}
                  id={`sop-ticket-${ticket.id_ticket}`}
                  className={[
                    'sop-ticket-hilo',
                    esNueva ? 'es-nueva' : '',
                    resaltado ? 'es-resaltado' : '',
                    expandido ? 'esta-abierto' : '',
                  ].filter(Boolean).join(' ')}
                >
                  <button
                    type="button"
                    className="sop-hilo-cabecera"
                    onClick={() => {
                      const id = Number(ticket.id_ticket);
                      const abrir = Number(ticketExpandido) !== id;
                      setTicketExpandido(abrir ? ticket.id_ticket : null);
                      setTicketResaltado(id);
                      if (abrir && tieneRespuesta) {
                        marcarAbierto(id);
                        requestAnimationFrame(() => enfocarBloqueRespuesta(id));
                      }
                    }}
                  >
                    <div className="sop-hilo-titulo">
                      <strong>{ticket.asunto}</strong>
                      <span className="sop-hilo-meta">#{String(ticket.id_ticket).padStart(4, '0')} · {fecha}</span>
                      {!expandido && (
                        <span className={`sop-hilo-preview${esNueva && tieneRespuesta ? ' es-nueva' : ''}`}>
                          {tieneRespuesta ? `Admin: ${preview}${String(ticket.respuesta_admin).length > 80 ? '…' : ''}` : preview}
                        </span>
                      )}
                    </div>
                    <div className="sop-hilo-badges">
                      {esNueva && tieneRespuesta && (
                        <span className="sop-badge-num" title="Falta abrir esta respuesta">{numeroSinAbrir(ticket.id_ticket)}</span>
                      )}
                      <span className={`sop-badge-tipo prio-${(ticket.prioridad || 'media').toLowerCase()}`}>{ticket.prioridad || 'Media'}</span>
                      <span className={`sop-badge-estado ${cls}`}>{label}</span>
                      <UiIcon name={expandido ? 'ChevronUp' : 'ChevronDown'} size={16} />
                    </div>
                  </button>
                  {expandido && (
                    <div className="sop-hilo-mensajes">
                      <div className="sop-burbuja sop-burbuja-yo">
                        <span className="sop-burbuja-quien">Tú</span>
                        <p>{ticket.descripcion || '—'}</p>
                      </div>
                      {tieneRespuesta ? (
                        <div
                          id={`sop-resp-${ticket.id_ticket}`}
                          className={`sop-burbuja sop-burbuja-admin${Number(respHighlightId) === Number(ticket.id_ticket) ? ' sop-resp-highlight' : ''}${esNueva ? ' es-nueva' : ''}`}
                        >
                          <span className="sop-burbuja-quien">Administrador</span>
                          <p>{ticket.respuesta_admin}</p>
                        </div>
                      ) : (
                        <div className="sop-burbuja sop-burbuja-espera">
                          <UiIcon name="Loader" size={14} /> Esperando respuesta del administrador
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>

      </div>

    </div>
  );
}
