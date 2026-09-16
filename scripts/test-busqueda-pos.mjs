import { puntuarCoincidenciaProducto, ordenarResultadosBusqueda, nombreLaboratorioProducto } from '../src/utils/buscarProductosCatalogo.js';

const fallos = [];
function assert(cond, msg) {
  if (!cond) fallos.push(msg);
}

const lista = [
  { id_producto: 1, descripcion: 'COMPARANTO 500 MG', codigo_barras: '111' },
  { id_producto: 2, descripcion: 'PARACETAMOL 500 MG TAB', codigo_barras: '222' },
  { id_producto: 3, descripcion: 'IBUPROFENO 400', codigo_barras: '333' },
  { id_producto: 4, descripcion: 'AMPARO VITAMINAS', codigo_barras: '444' },
];
const orden = ordenarResultadosBusqueda(lista, 'par').map((p) => p.descripcion);
assert(orden[0] === 'PARACETAMOL 500 MG TAB', `3 letras "par" debería priorizar PARACETAMOL, obtuvo ${orden[0]}`);
assert(puntuarCoincidenciaProducto(lista[1], 'par') < puntuarCoincidenciaProducto(lista[0], 'par'), 'startsWith debe ganar a contains');
assert(puntuarCoincidenciaProducto({ descripcion: 'AMOXICILINA' }, 'amo') === 1, 'amo → AMOXICILINA startsWith');
assert(nombreLaboratorioProducto({ laboratorios: { nombre: 'GENFAR' } }) === 'GENFAR', 'embed objeto');
assert(nombreLaboratorioProducto({ laboratorios: [{ nombre: 'BAYER' }] }) === 'BAYER', 'embed array');
assert(nombreLaboratorioProducto({ laboratorio: 'MEDIFARMA' }) === 'MEDIFARMA', 'campo plano offline');
assert(nombreLaboratorioProducto({}) === '', 'sin laboratorio vacío');

if (fallos.length) {
  console.error('[test-busqueda-pos] FALLÓ:\n- ' + fallos.join('\n- '));
  process.exit(1);
}
console.log('[test-busqueda-pos] OK', orden.slice(0, 3).join(' | '));
