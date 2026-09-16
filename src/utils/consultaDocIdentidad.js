/**
 * Consulta DNI/RUC — proveedor activo: json.pe
 *   POST https://api.json.pe/api/dni
 *   POST https://api.json.pe/api/ruc
 *
 * Env: VITE_JSONPE_TOKEN
 *
 * Formato interno:
 *   DNI → { nombres, apellido_paterno, apellido_materno, sexo? }
 *   RUC → { nombre_o_razon_social, direccion }
 */

const JSONPE_TOKEN = import.meta.env.VITE_JSONPE_TOKEN;
const JSONPE_BASE = 'https://api.json.pe';

/**
 * @param {'dni'|'ruc'} tipo
 * @param {string} numero solo dígitos
 */
export async function consultarDocumento(tipo, numero) {
  const soloNumeros = String(numero || '').replace(/\D/g, '');
  if (!JSONPE_TOKEN) {
    throw new Error('VITE_JSONPE_TOKEN no configurado');
  }

  const path = tipo === 'dni' ? '/api/dni' : '/api/ruc';
  const body = tipo === 'dni' ? { dni: soloNumeros } : { ruc: soloNumeros };

  let res;
  try {
    res = await fetch(`${JSONPE_BASE}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${JSONPE_TOKEN}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('No encontrado');
  }

  if (!res.ok) throw new Error('No encontrado');

  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error('No encontrado');
  }

  if (json?.success === false) throw new Error('No encontrado');

  const data = json?.data;
  if (tipo === 'dni') {
    if (!data?.nombres) throw new Error('DNI no encontrado');
    return {
      nombres: data.nombres || '',
      apellido_paterno: data.apellido_paterno || '',
      apellido_materno: data.apellido_materno || '',
      sexo: data.sexo || '',
    };
  }

  if (!data?.nombre_o_razon_social) throw new Error('RUC no encontrado');
  return {
    nombre_o_razon_social: data.nombre_o_razon_social || '',
    direccion: data.direccion || data.direccion_completa || '',
  };
}

/** Alias explícito del proveedor activo. */
export const consultarJsonPe = consultarDocumento;

export async function consultarDni(dni) {
  return consultarDocumento('dni', dni);
}

export async function consultarRuc(ruc) {
  return consultarDocumento('ruc', ruc);
}
