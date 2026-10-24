import { supabase } from '../supabaseClient';
import { calcularProductosStockBajo } from './stockBajo';
import { hoyLocal } from './fechas';

export async function insertarNotificacion({
  usuario_id = null, tipo, categoria, mensaje,
  accion_label = null, accion_url = null,
}) {
  try {
    await supabase.from('notificaciones').insert({
      usuario_id, tipo, categoria, mensaje, leido: false, accion_label, accion_url,
    });
  } catch { /* empty */ }
}

/** Adjunta clave estable a la URL de acción para deduplicar sin columna extra. */
export function urlConDedup(baseUrl, claveDedup) {
  if (!claveDedup) return baseUrl || null;
  const base = baseUrl || '/';
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}dedup=${encodeURIComponent(claveDedup)}`;
}

/** Quita ?dedup= de la URL al navegar (solo sirve para deduplicar inserts). */
export function urlSinDedup(url) {
  if (!url) return url;
  try {
    const u = new URL(url, 'http://local');
    u.searchParams.delete('dedup');
    const q = u.searchParams.toString();
    return u.pathname + (q ? `?${q}` : '') + u.hash;
  } catch {
    return url;
  }
}

/**
 * Navega desde accion_url de una notificación.
 * Si trae ?tab= / ?ticketId=, los pasa como location.state (deep-link AdminAlertas / Soporte).
 * extraState se fusiona; siempre añade deepLinkNonce para forzar re-aplicación del deep-link.
 */
export function navegarDesdeAccionUrl(navigate, url, extraState = undefined) {
  if (!navigate || !url) return;
  const clean = urlSinDedup(url);
  const nonceState = { deepLinkNonce: Date.now() };
  try {
    const u = new URL(clean, 'http://local');
    const tab = u.searchParams.get('tab');
    const ticketIdRaw = u.searchParams.get('ticketId');
    if (tab || ticketIdRaw != null) {
      const ticketId = ticketIdRaw != null && ticketIdRaw !== ''
        ? (Number(ticketIdRaw) || ticketIdRaw)
        : undefined;
      navigate(u.pathname, {
        state: {
          ...(tab ? { tab } : {}),
          ...(ticketId != null ? { ticketId } : {}),
          ...nonceState,
          ...(extraState && typeof extraState === 'object' ? extraState : {}),
        },
      });
      return;
    }
    navigate(clean, {
      state: {
        ...nonceState,
        ...(extraState && typeof extraState === 'object' ? extraState : {}),
      },
    });
  } catch {
    navigate(clean);
  }
}

/** Notif de respuesta de soporte dirigida al vendedor (deep-link /soporte?ticketId=).
 *  Excluye "en curso" (esa se marca leída al clic, no al ver el ticket). */
export function esNotifRespuestaSoporteVendedor(notif) {
  if (!notif?.accion_url) return false;
  const clean = urlSinDedup(notif.accion_url);
  try {
    const u = new URL(clean, 'http://local');
    if (u.pathname !== '/soporte') return false;
    if (!u.searchParams.get('ticketId')) return false;
    if ((notif.categoria || '').toLowerCase() !== 'soporte') return false;
    const dedup = String(new URL(notif.accion_url, 'http://local').searchParams.get('dedup') || '');
    if (dedup.includes('soporte:encurso')) return false;
    if ((notif.mensaje || '').toLowerCase().includes('ya está en curso')) return false;
    return true;
  } catch {
    return false;
  }
}

/** Evento: MainLayout cierra toast admin de ese ticket. */
export const EVT_ADMIN_TOAST_CERRAR = 'admin-ticket-toast-cerrar';
/** Evento: notif marcada leída desde Soporte (viewport) → actualizar campana. */
export const EVT_NOTIF_MARCADA_LEIDA = 'notif-marcada-leida';

/**
 * Quita cantidades / montos variables del mensaje para comparar alertas "iguales"
 * aunque un cliente legacy escriba "quedan 10" y otro "quedan 9", o "(3 uds.)".
 */
export function normalizarMensajeNotif(mensaje) {
  return String(mensaje || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/quedan\s+\d+\s+unidades?/gi, 'quedan N unidades')
    .replace(/\(\s*\d+\s*uds?\.?\s*\)/gi, '(N uds.)')
    .replace(/vence en\s+\d+\s*d(?:[ií]as?)?/gi, 'vence en N dias')
    .replace(/s\/\s*[\d.,]+/gi, 's/N')
    .replace(/\b\d+([.,]\d+)?\b/g, 'N')
    .replace(/\s+/g, ' ')
    .trim();
}

const PREFIJO_ALERTA_AUTO = /^(stockbajo:prod:|vencido:lote:|porvencer:lote:|soporte:ticket:|cuentas:vencida:compra:|cuentas:porvencer:compra:|sunat:sinconfirmar|sunat:porvencer|sunat:plazovencido)/;

export function extraerClaveDedup(notif) {
  if (notif?.clave_dedup) return String(notif.clave_dedup);
  const url = notif?.accion_url;
  if (!url) return '';
  try {
    return new URL(url, 'http://local').searchParams.get('dedup') || '';
  } catch {
    return '';
  }
}

/** Quita la fecha final (YYYY-MM-DD) para agrupar el mismo aviso entre días. */
export function claveDescarteDe(claveDedup) {
  return String(claveDedup || '').replace(/:\d{4}-\d{2}-\d{2}$/, '');
}

/** Columna o ?dedup= de la URL; sin fecha de día para agrupar el mismo aviso. */
export function claveLogicaNotif(notif) {
  return claveDescarteDe(extraerClaveDedup(notif));
}

/** Una fila por clave lógica. La lista debe ir de más nueva a más vieja. */
export function deduplicarNotifsPorClave(notifs) {
  const seen = new Set();
  const out = [];
  for (const n of notifs || []) {
    const clave = claveLogicaNotif(n);
    const key = clave || `id:${n.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

export function firmaYModoDesdeNotif(notif) {
  const clave = claveDescarteDe(extraerClaveDedup(notif));
  const msg = String(notif?.mensaje || '');
  if (clave.startsWith('stockbajo:')) {
    const m = /quedan\s+(\d+)\s+unidades/i.exec(msg);
    return { clave, firma: m ? m[1] : '0', modo: 'stock' };
  }
  if (clave.startsWith('cuentas:')) {
    const m = /s\/\s*([\d.,]+)/i.exec(msg);
    return { clave, firma: m ? String(Number(m[1].replace(/,/g, ''))) : '', modo: 'cuentas' };
  }
  return { clave, firma: '1', modo: 'unico' };
}

export async function mapaDescartes() {
  try {
    const { data, error } = await supabase
      .from('notificaciones_descartes')
      .select('clave, firma, modo');
    if (error) return new Map();
    return new Map((data || []).map((d) => [d.clave, d]));
  } catch {
    return new Map();
  }
}

export async function registrarDescartes(notifs) {
  const rows = (notifs || [])
    .map(firmaYModoDesdeNotif)
    .filter((r) => r.clave);
  if (!rows.length) return;
  try {
    await supabase.from('notificaciones_descartes').upsert(
      rows.map((r) => ({ clave: r.clave, firma: r.firma, modo: r.modo })),
      { onConflict: 'clave' },
    );
  } catch { /* empty */ }
}

export async function purgarDescartesNoVivas(clavesVivas) {
  const vivas = clavesVivas instanceof Set ? clavesVivas : new Set(clavesVivas || []);
  try {
    const { data } = await supabase.from('notificaciones_descartes').select('clave');
    const stale = (data || [])
      .map((d) => d.clave)
      .filter((c) => PREFIJO_ALERTA_AUTO.test(c) && !vivas.has(c));
    if (!stale.length) return;
    await supabase.from('notificaciones_descartes').delete().in('clave', stale);
  } catch { /* empty */ }
}

function debeReaparecer(discard, firma, modoFirma) {
  if (!discard) return { insertar: true, reactivar: false };
  const modo = discard.modo || modoFirma || 'unico';
  if (modo === 'stock') {
    if (Number(firma) < Number(discard.firma)) return { insertar: true, reactivar: true };
    return { insertar: false, reactivar: false };
  }
  if (modo === 'cuentas') {
    if (Number(firma) !== Number(discard.firma)) return { insertar: true, reactivar: true };
    return { insertar: false, reactivar: false };
  }
  return { insertar: false, reactivar: false };
}

/**
 * Insert atómico vía RPC (UNIQUE clave_dedup + ON CONFLICT).
 * Si está descartada, solo reaparece cuando la firma empeora (stock baja más,
 * o cambia el saldo) o cuando el descarte se purgó (episodio resuelto).
 */
export async function insertarNotifConDedup({
  usuario_id = null, tipo, categoria, mensaje,
  accion_label = null, accion_url = null,
  claveDedup,
  firma = '', modoFirma = 'unico', descartesMap,
}) {
  try {
    if (!claveDedup) {
      console.warn('insertarNotifConDedup: falta claveDedup, se omite insert');
      return;
    }
    const base = claveDescarteDe(claveDedup);
    let discard = null;
    if (descartesMap) {
      discard = descartesMap.get(base) || null;
    } else {
      const { data } = await supabase
        .from('notificaciones_descartes')
        .select('clave, firma, modo')
        .eq('clave', base)
        .maybeSingle();
      discard = data;
    }
    const { insertar, reactivar } = debeReaparecer(discard, firma, modoFirma);
    if (!insertar) return;

    const url = urlConDedup(accion_url, claveDedup);
    const { error } = await supabase.rpc('insertar_notif_dedup', {
      p_usuario_id: usuario_id,
      p_tipo: tipo,
      p_categoria: categoria,
      p_mensaje: mensaje,
      p_accion_label: accion_label,
      p_accion_url: url,
      p_clave_dedup: claveDedup,
      p_reactivar: reactivar,
    });
    if (error) {
      console.warn('insertar_notif_dedup:', error.message);
      return;
    }
    if (reactivar && base) {
      await supabase.from('notificaciones_descartes').delete().eq('clave', base);
      if (descartesMap) descartesMap.delete(base);
    }
  } catch { /* empty */ }
}

/** Marca leídas TODAS las notificaciones visibles para el usuario.
 *  - Admin: globales (usuario_id null) + propias
 *  - Vendedor (soloPropias): solo las dirigidas a él
 */
export async function marcarTodasNotificacionesLeidas(idUsuario, { soloPropias = false } = {}) {
  if (!idUsuario) return { error: new Error('Sin usuario') };
  let q = supabase
    .from('notificaciones')
    .update({ leido: true })
    .eq('leido', false);
  if (soloPropias) {
    q = q.eq('usuario_id', idUsuario);
  } else {
    q = q.or(`usuario_id.eq.${idUsuario},usuario_id.is.null`);
  }
  const { error } = await q;
  return { error };
}

/**
 * Notifica al vendedor cuando el admin marca el ticket EN PROCESO.
 * Dedup estable por ticket (no re-spamea si marcan en curso varias veces).
 */
/** Aviso inmediato a admins cuando un vendedor abre un ticket (no espera el ciclo de 5 min). */
export async function notificarNuevoTicketAdmins({ id_ticket, asunto, prioridad }) {
  if (id_ticket == null) return;
  const asuntoCorto = (asunto || 'Sin asunto').slice(0, 80);
  await insertarNotifConDedup({
    tipo: 'info',
    categoria: 'Soporte',
    mensaje: `Ticket #${id_ticket}: ${asuntoCorto}`,
    accion_label: 'Ver ticket',
    accion_url: `/admin-alertas?tab=SOPORTE&ticketId=${id_ticket}`,
    claveDedup: `soporte:ticket:${id_ticket}`,
  });
}

export async function notificarTicketEnCursoVendedor({
  id_usuario,
  id_ticket,
  asunto,
}) {
  if (id_usuario == null || id_ticket == null) return;
  const asuntoCorto = (asunto || 'Sin asunto').slice(0, 60);
  await insertarNotifConDedup({
    usuario_id: id_usuario,
    tipo: 'info',
    categoria: 'Soporte',
    mensaje: `El admin vio tu ticket #${id_ticket} y ya está en curso${asuntoCorto ? `: ${asuntoCorto}` : ''}`,
    accion_label: 'Ver ticket',
    accion_url: `/soporte?ticketId=${id_ticket}`,
    claveDedup: `soporte:encurso:${id_ticket}`,
    horasDedup: 8760,
  });
}

/**
 * Notifica al vendedor dueño del ticket cuando el admin responde/actualiza.
 * Dedup por ticket + fingerprint del texto (re-respuesta distinta → nueva notif).
 */
export async function notificarRespuestaTicketVendedor({
  id_usuario,
  id_ticket,
  asunto,
  respuesta = '',
}) {
  if (id_usuario == null || id_ticket == null) return;
  const asuntoCorto = (asunto || 'Sin asunto').slice(0, 80);
  const s = String(respuesta || '');
  let h = 0;
  for (let i = 0; i < Math.min(s.length, 800); i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  const fp = Math.abs(h).toString(36);
  await insertarNotifConDedup({
    usuario_id: id_usuario,
    tipo: 'ok',
    categoria: 'Soporte',
    mensaje: `Respondieron tu ticket #${id_ticket}: ${asuntoCorto}${s ? ` — «${s.slice(0, 120)}${s.length > 120 ? '…' : ''}»` : ''}`,
    accion_label: 'Ver respuesta',
    accion_url: `/soporte?ticketId=${id_ticket}`,
    claveDedup: `soporte:respuesta:${id_ticket}:${fp}`,
    horasDedup: 8760,
  });
}

// Llama desde POS después de registrar una venta para detectar stock bajo.
// Antes miraba un solo lote al azar (.limit(1), sin sumar el resto de lotes del mismo
// producto) contra un umbral fijo de 10 — ahora suma todos los lotes VIGENTE del
// producto y usa el mismo criterio que el resto del sistema (calcularProductosStockBajo,
// stock_minimo o 3, y solo si el producto ya tuvo movimiento).
export async function verificarStockPostVenta(items = []) {
  const hoy = hoyLocal();
  for (const item of items) {
    try {
      if (!item.id_producto) continue;
      const [{ data: lotes }, { data: producto }] = await Promise.all([
        supabase.from('inventario_lotes')
          .select('id_producto, cantidad_actual, id_sucursal, estado')
          .eq('id_producto', item.id_producto)
          .eq('estado', 'VIGENTE'),
        supabase.from('productos')
          .select('id_producto, descripcion, stock_minimo')
          .eq('id_producto', item.id_producto)
          .maybeSingle(),
      ]);
      if (!producto) continue;
      const lotesParaCalculo = (lotes && lotes.length > 0)
        ? lotes
        : [{ id_producto: item.id_producto, cantidad_actual: 0, id_sucursal: null, estado: 'VIGENTE' }];
      const [resultado] = calcularProductosStockBajo(
        [producto],
        lotesParaCalculo,
        new Set([Number(item.id_producto)]),
      );
      if (!resultado) continue;
      const nombre = producto.descripcion || item.nombre || 'Producto';
      await insertarNotifConDedup({
        tipo: 'warn',
        categoria: 'Stock bajo',
        mensaje: `Stock bajo: ${nombre} — quedan ${resultado.stockTotal} unidades`,
        accion_label: 'Ver inventario',
        accion_url: '/admin-inventario',
        claveDedup: `stockbajo:prod:${item.id_producto}:${hoy}`,
        firma: String(resultado.stockTotal),
        modoFirma: 'stock',
      });
    } catch { /* empty */ }
  }
}
