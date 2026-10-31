import { supabase } from '../supabaseClient';

export const EVT_INVENTARIO_SESION = 'luxfarma:inventario-sesion';
const CANAL = 'inventario-sesion-broadcast';

let canal = null;
let refs = 0;
let listo = Promise.resolve();

function asegurarCanal() {
  if (canal) return canal;
  let resolver = () => {};
  listo = new Promise((resolve) => { resolver = resolve; });
  canal = supabase
    .channel(CANAL, { config: { broadcast: { ack: false } } })
    .on('broadcast', { event: 'sesion' }, () => {
      window.dispatchEvent(new Event(EVT_INVENTARIO_SESION));
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') resolver();
    });
  return canal;
}

export function suscribirInventarioSesion(onCambio) {
  asegurarCanal();
  refs += 1;
  const handler = () => onCambio?.();
  window.addEventListener(EVT_INVENTARIO_SESION, handler);
  return () => {
    window.removeEventListener(EVT_INVENTARIO_SESION, handler);
    refs -= 1;
    if (refs <= 0 && canal) {
      supabase.removeChannel(canal);
      canal = null;
      refs = 0;
      listo = Promise.resolve();
    }
  };
}

export async function publicarInventarioSesion() {
  window.dispatchEvent(new Event(EVT_INVENTARIO_SESION));
  const ch = asegurarCanal();
  try {
    await listo;
    await ch.send({ type: 'broadcast', event: 'sesion', payload: { at: Date.now() } });
  } catch {
    /* empty */
  }
}
