/**
 * Escena nocturna del login: 19:00–04:59 hora local.
 *
 * Forzar prueba (sin esperar):
 *   - URL: ?noche=1  (noche)  |  ?noche=0  (día)
 *   - localStorage: luxfarma_login_noche = "1" | "0"
 *     (quitar la clave para volver al horario automático)
 */
export function esEscenaNoche(date = new Date()) {
  if (typeof window !== 'undefined') {
    try {
      const q = new URLSearchParams(window.location.search).get('noche');
      if (q === '1' || q === 'true') return true;
      if (q === '0' || q === 'false') return false;
      const ls = window.localStorage.getItem('luxfarma_login_noche');
      if (ls === '1') return true;
      if (ls === '0') return false;
    } catch {
      /* ignore */
    }
  }
  const h = date.getHours();
  return h >= 19 || h < 5;
}
