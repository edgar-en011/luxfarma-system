/**
 * Fachada Nubefact desde el renderer.
 * El HTTP sale del proceso principal (Electron IPC). Aquí no hay URL ni token.
 */

export const TIPO_COMPROBANTE_NUBEFACT = {
  FACTURA: 1,
  BOLETA: 2,
};

export const TIPO_DOC_NUBEFACT = {
  SIN_DOC: '-',
  DNI: 1,
  CE: 4,
  RUC: 6,
  PASAPORTE: 7,
};

export function medioPagoNubefact(metodoPago, mixtoData) {
  const m = String(metodoPago || '').trim();
  const upper = m.toUpperCase();
  if (upper === 'EFECTIVO') return 'Efectivo';
  if (upper === 'YAPE') return 'Yape';
  if (upper === 'TARJETA') return 'Tarjeta';
  if (upper === 'MIXTO' && mixtoData) {
    const p1 = mixtoData.metodo1 || '';
    const p2 = mixtoData.metodo2 || '';
    return `Mixto (${p1}/${p2})`;
  }
  if (upper === 'MIXTO') return 'Mixto';
  return m || 'Efectivo';
}

function apiNubefact() {
  if (typeof window === 'undefined') return null;
  return window.electronAPI?.nubefact || null;
}

export function nubefactIpcDisponible() {
  return Boolean(apiNubefact()?.emitir);
}

export async function nubefactCredencialesOk() {
  const api = apiNubefact();
  if (!api?.configurado) return false;
  try {
    return !!(await api.configurado());
  } catch {
    return false;
  }
}

function sinElectron() {
  return {
    ok: false,
    error: 'Nubefact solo está disponible en la app de escritorio (proceso principal).',
  };
}

export async function emitirComprobante(datosVenta) {
  const api = apiNubefact();
  if (!api?.emitir) return sinElectron();
  try {
    return await api.emitir(datosVenta);
  } catch (err) {
    return { ok: false, error: err?.message || 'Error IPC al emitir comprobante.' };
  }
}

export async function consultarEstado(tipoComprobante, serie, numero) {
  const api = apiNubefact();
  if (!api?.consultar) return sinElectron();
  try {
    return await api.consultar(tipoComprobante, serie, numero);
  } catch (err) {
    return { ok: false, error: err?.message || 'Error IPC al consultar comprobante.' };
  }
}

export async function anularComprobanteNubefact(payload) {
  const api = apiNubefact();
  if (!api?.anular) return sinElectron();
  try {
    return await api.anular(payload);
  } catch (err) {
    return { ok: false, error: err?.message || 'Error IPC al anular comprobante.' };
  }
}
