import { supabase } from '../supabaseClient';

export const EVT_SOPORTE_TICKET = 'luxfarma:soporte-ticket';
const CANAL = 'soporte-sync-broadcast';

let canal = null;
let refs = 0;
let lastEmit = { k: '', at: 0 };

export function sameTicketId(a, b) {
  return Number(a) === Number(b);
}

export function fusionarTicketEnLista(prev, ticket) {
  if (!ticket?.id_ticket) return prev;
  const id = Number(ticket.id_ticket);
  const idx = (prev || []).findIndex((t) => Number(t.id_ticket) === id);
  if (idx < 0) return [ticket, ...(prev || [])];
  const next = [...prev];
  next[idx] = { ...next[idx], ...ticket };
  return next;
}

export function emitirCambioTicket(tipo, ticket) {
  if (!ticket?.id_ticket) return;
  const k = `${tipo}:${ticket.id_ticket}:${ticket.estado || ''}:${ticket.respuesta_admin || ''}`;
  const now = Date.now();
  if (k === lastEmit.k && now - lastEmit.at < 2000) return;
  lastEmit = { k, at: now };
  window.dispatchEvent(new CustomEvent(EVT_SOPORTE_TICKET, { detail: { tipo, ticket } }));
}

function asegurarCanal() {
  if (canal) return canal;
  canal = supabase
    .channel(CANAL, { config: { broadcast: { ack: false } } })
    .on('broadcast', { event: 'ticket' }, ({ payload }) => {
      if (payload?.ticket) emitirCambioTicket(payload.tipo || 'UPDATE', payload.ticket);
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tickets_soporte' }, (p) => {
      emitirCambioTicket('INSERT', p.new);
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tickets_soporte' }, (p) => {
      emitirCambioTicket('UPDATE', p.new);
    })
    .subscribe();
  return canal;
}

/** Un solo canal compartido (MainLayout + páginas). */
export function suscribirSoporteSync(onEvent) {
  asegurarCanal();
  refs += 1;
  const handler = (e) => onEvent?.(e.detail);
  window.addEventListener(EVT_SOPORTE_TICKET, handler);
  return () => {
    window.removeEventListener(EVT_SOPORTE_TICKET, handler);
    refs -= 1;
    if (refs <= 0 && canal) {
      supabase.removeChannel(canal);
      canal = null;
      refs = 0;
    }
  };
}

/** Avisa a otros clientes (admin/vendedor) sin recargar. */
export async function publicarCambioTicket(tipo, ticket) {
  emitirCambioTicket(tipo, ticket);
  const ch = asegurarCanal();
  try {
    await ch.send({ type: 'broadcast', event: 'ticket', payload: { tipo, ticket } });
  } catch {
    /* empty */
  }
}
