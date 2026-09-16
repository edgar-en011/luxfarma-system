/**
 * Módulo NO usado por el POS. Conservado por si hay que restaurar el proveedor anterior.
 * El endpoint de este archivo no se cambió (no está en el flujo activo).
 *
 * Env: VITE_APIS_TOKEN
 */

const APIS_TOKEN = import.meta.env.VITE_APIS_TOKEN;

/**
 * @param {'dni'|'ruc'} tipo
 * @param {string} numero solo dígitos
 */
export async function consultarDocumentoLegacy(tipo, numero) {
  const soloNumeros = String(numero || '').replace(/\D/g, '');
  const endpoint = tipo === 'dni'
    ? `https://api.factiliza.com/v1/dni/info/${soloNumeros}`
    : `https://api.factiliza.com/v1/ruc/info/${soloNumeros}`;

  const res = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${APIS_TOKEN}` },
  });
  if (!res.ok) throw new Error('No encontrado');

  const json = await res.json();
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
    direccion: data.direccion || '',
  };
}
