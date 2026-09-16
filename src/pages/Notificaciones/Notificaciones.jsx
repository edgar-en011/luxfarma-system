import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../context/AuthContext';
import {
  marcarTodasNotificacionesLeidas,
  navegarDesdeAccionUrl,
  esNotifRespuestaSoporteVendedor,
} from '../../utils/notificacionesService';
import { esRolCaja } from '../../utils/roles';
import { partesMensajeNotif } from '../../utils/notifDisplay';
import './Notificaciones.css';
import UiIcon from '../../components/UiIcon';

const TIPO_ICON  = { warn: 'AlertTriangle', err: 'AlertCircle', ok: 'CheckCircle2', purp: 'Bell', info: 'Info' };
const TIPO_LABEL = { warn: 'Advertencia', err: 'Error/Crítico', ok: 'Éxito', purp: 'Sistema', info: 'Información' };
const POR_PAGINA = 20;

function tiempoRelativo(isoStr) {
  const diff = Math.floor((Date.now() - new Date(isoStr)) / 1000);
  if (diff < 60) return 'hace un momento';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  if (diff < 172800) return 'ayer';
  const d = new Date(isoStr);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}

export default function Notificaciones() {
  const { user }  = useAuth();
  const navigate  = useNavigate();
  const isVendedor = esRolCaja(user?.id_rol);

  const [notificaciones, setNotificaciones] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [pagina,   setPagina]   = useState(1);
  const [total,    setTotal]    = useState(0);
  const [filtroTipo,  setFiltroTipo]  = useState('todos');
  const [filtroLeido, setFiltroLeido] = useState('todos');

  const cargar = async () => {
    if (!user) return;
    setLoading(true);
    try {
      let q = supabase
        .from('notificaciones')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);

      // Vendedor: solo notifs dirigidas a él. Admin: propias + globales.
      if (isVendedor) {
        q = q.eq('usuario_id', user.id_usuario);
      } else {
        q = q.or(`usuario_id.eq.${user.id_usuario},usuario_id.is.null`);
      }

      if (filtroTipo  !== 'todos')    q = q.eq('tipo',  filtroTipo);
      if (filtroLeido === 'noLeidas') q = q.eq('leido', false);
      if (filtroLeido === 'leidas')   q = q.eq('leido', true);

      const { data, count } = await q;
      setNotificaciones(data || []);
      setTotal(count || 0);
    } catch { /* empty */ }
    setLoading(false);
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { cargar(); }, [pagina, filtroTipo, filtroLeido, user, isVendedor]);

  const marcarLeida = async (notif) => {
    // Vendedor + respuesta Soporte: leída al ver el bloque (Soporte.jsx), no al clic
    const diferirLectura = isVendedor && esNotifRespuestaSoporteVendedor(notif);
    if (!diferirLectura && !notif.leido) {
      try {
        await supabase.from('notificaciones').update({ leido: true }).eq('id', notif.id);
        setNotificaciones(prev => prev.map(n => n.id === notif.id ? { ...n, leido: true } : n));
      } catch { /* empty */ }
    }
    if (notif.accion_url) {
      if (diferirLectura) {
        navegarDesdeAccionUrl(navigate, notif.accion_url, { pendingNotifId: notif.id });
      } else {
        navegarDesdeAccionUrl(navigate, notif.accion_url);
      }
    }
  };

  const marcarTodasLeidas = async () => {
    try {
      const { error } = await marcarTodasNotificacionesLeidas(user.id_usuario, {
        soloPropias: isVendedor,
      });
      if (error) return;
      setNotificaciones(prev => prev.map(n => ({ ...n, leido: true })));
      // Recargar conteo total (pueden haber miles fuera de la página actual)
      cargar();
    } catch { /* empty */ }
  };

  const totalPaginas = Math.ceil(total / POR_PAGINA);
  const noLeidas     = notificaciones.filter(n => !n.leido).length;

  return (
    <div className="notif-page">

      <div className="notif-page-header">
        <div>
          <h2 className="notif-page-title">Notificaciones</h2>
          <p className="notif-page-subtitle">{total} notificaciones · {noLeidas} sin leer</p>
        </div>
        <div className="notif-page-actions">
          <select
            className="notif-filter-select"
            value={filtroTipo}
            onChange={e => { setFiltroTipo(e.target.value); setPagina(1); }}
          >
            <option value="todos">Todos los tipos</option>
            {Object.entries(TIPO_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>

          <select
            className="notif-filter-select"
            value={filtroLeido}
            onChange={e => { setFiltroLeido(e.target.value); setPagina(1); }}
          >
            <option value="todos">Todas</option>
            <option value="noLeidas">Sin leer</option>
            <option value="leidas">Leídas</option>
          </select>

          {noLeidas > 0 && (
            <button className="notif-btn-limpiar" onClick={marcarTodasLeidas}>
              Marcar todas como leídas
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="notif-page-loading">Cargando notificaciones...</div>
      ) : notificaciones.length === 0 ? (
        <div className="notif-page-empty">
          <span style={{ fontSize: '2rem' }}><UiIcon name="CheckCircle2" size={16} /></span>
          <p>No hay notificaciones con los filtros seleccionados</p>
        </div>
      ) : (
        <div className="notif-page-list">
          {notificaciones.map(n => {
            const partes = partesMensajeNotif(n.mensaje);
            return (
            <div
              key={n.id}
              className={`notif-page-item npi-tipo-${n.tipo} ${n.leido ? 'npi-leida' : ''} ${n.accion_url ? 'npi-clickable' : ''}`}
              onClick={() => marcarLeida(n)}
            >
              <div className="npi-icon"><UiIcon name={TIPO_ICON[n.tipo] || 'Info'} size={18} /></div>
              <div className="npi-body">
                <div className="npi-top">
                  <span className="npi-categoria">{n.categoria}</span>
                  <span className="npi-tiempo">{tiempoRelativo(n.created_at)}</span>
                </div>
                {partes.kind === 'stock' ? (
                  <p className="npi-mensaje npi-mensaje-stock">
                    <strong className="npi-qty">{partes.cantidad} und</strong>
                    <span className="npi-sep" aria-hidden>—</span>
                    <span className="npi-nombre" title={partes.nombre}>{partes.nombre}</span>
                  </p>
                ) : (
                  <p className="npi-mensaje">{partes.texto}</p>
                )}
                {n.accion_label && (
                  <span className="npi-accion">{n.accion_label} →</span>
                )}
              </div>
              {!n.leido && <span className="npi-dot" />}
            </div>
            );
          })}
        </div>
      )}

      {totalPaginas > 1 && (
        <div className="notif-page-paginacion">
          <button
            className="notif-pag-btn"
            disabled={pagina === 1}
            onClick={() => setPagina(p => p - 1)}
          >
            ← Anterior
          </button>
          <span className="notif-pag-info">Página {pagina} de {totalPaginas}</span>
          <button
            className="notif-pag-btn"
            disabled={pagina === totalPaginas}
            onClick={() => setPagina(p => p + 1)}
          >
            Siguiente →
          </button>
        </div>
      )}
    </div>
  );
}
