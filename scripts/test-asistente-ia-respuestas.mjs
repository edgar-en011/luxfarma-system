import assert from 'node:assert/strict';
import { responderResumenDeterministico } from '../src/utils/respuestasAsistenteIA.js';

const resumen = {
  metadata: { alcance: 'Sede Centro' },
  totales: {
    stockBajo: 12,
    lotesProximosVencer: 1,
    bajaRotacion: 1,
    conMovimiento: 1,
    recomendacionesReposicion: 12,
  },
  stockBajo: [{ nombre: 'Producto A', stockBase: 2, umbralBase: 10, sucursal: 'Centro' }],
  reposicion: [{ nombre: 'Producto A', stockBase: 2, brechaMinimoBase: 8, prioridad: 'Atención', sucursal: 'Centro' }],
  proximosVencer: [{ nombre: 'Producto B', numeroLote: 'L-1', fechaVencimientoTexto: '30/10/2026', stockBase: 4 }],
  bajaRotacion: [{ nombre: 'Producto C', stockBase: 20, diasSinVentas: 30 }],
  mayorMovimiento: [{ nombre: 'Producto D', unidadesVendidas: 15, stockBase: 7 }],
};

assert.match(responderResumenDeterministico('¿Qué productos debería reponer?', resumen), /brecha al mínimo 8/);
assert.match(responderResumenDeterministico('¿Qué productos están próximos a vencer?', resumen), /lote L-1/);
assert.match(responderResumenDeterministico('¿Cuáles tienen stock bajo?', resumen), /2 disponibles; mínimo 10/);
assert.match(responderResumenDeterministico('¿Cuáles tuvieron mayor movimiento?', resumen), /15 unidades base vendidas/);
assert.match(responderResumenDeterministico('¿Qué debería revisar esta semana?', resumen), /Prioridades verificadas/);
assert.equal(responderResumenDeterministico('Explícame otra cosa', resumen), null);

assert.match(responderResumenDeterministico('¿Qué debo reponer?', {
  metadata: { alcance: 'Todas las sedes' },
  totales: { productosAnalizados: 4008, productosConStock: 0 },
}), /no hay productos con stock disponible registrados/);

console.log('OK: las preguntas principales se responden con cifras determinísticas del resumen.');

