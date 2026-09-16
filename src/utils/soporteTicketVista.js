/** localStorage: el vendedor ya vio la respuesta de este ticket. */
export function keyRespuestaTicketVista(idUsuario, idTicket) {
  return `sop_resp_visto_${idUsuario}_${idTicket}`;
}

export function marcarRespuestaTicketVista(idUsuario, idTicket) {
  if (idUsuario == null || idTicket == null) return;
  localStorage.setItem(keyRespuestaTicketVista(idUsuario, idTicket), new Date().toISOString());
  window.dispatchEvent(
    new CustomEvent('soporte-respuesta-vista', { detail: { id_ticket: idTicket, id_usuario: idUsuario } })
  );
}

export function limpiarRespuestaTicketVista(idUsuario, idTicket) {
  if (idUsuario == null || idTicket == null) return;
  localStorage.removeItem(keyRespuestaTicketVista(idUsuario, idTicket));
}

/** Tickets con respuesta que el vendedor aún no abrió/vió. */
export function contarRespuestasSinVer(idUsuario, tickets) {
  if (idUsuario == null) return 0;
  return (tickets || []).filter(
    (t) => t.respuesta_admin && !localStorage.getItem(keyRespuestaTicketVista(idUsuario, t.id_ticket))
  ).length;
}

/** Clase CSS segura para estado (EN PROCESO → en-proceso). */
export function claseEstadoTicket(estado) {
  return `e-${String(estado || 'PENDIENTE').toLowerCase().replace(/\s+/g, '-')}`;
}
