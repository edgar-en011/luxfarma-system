/**
 * Tres niveles de Esc en "Agregar producto a la compra".
 * 1) panel derecho → lista  2) lista → buscador  3) buscador → cerrar
 *
 * @param {{ target: Node | null, buscador: Node | null, lista: Node | null, panel: Node | null }} refs
 * @returns {'lista' | 'buscador' | 'cerrar'}
 */
export function destinoEscModalAgregarProducto({ target, buscador, lista, panel }) {
  if (!target) return 'cerrar';
  if (buscador && (target === buscador || buscador.contains(target))) return 'cerrar';
  if (lista && (target === lista || lista.contains(target))) return 'buscador';
  if (panel && (target === panel || panel.contains(target))) return 'lista';
  return 'cerrar';
}
