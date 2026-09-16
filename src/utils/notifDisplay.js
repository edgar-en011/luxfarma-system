/**
 * Separa el texto de la campana para no cortar el dato clave.
 * El mensaje en BD no se reescribe: solo cambia cómo se muestra.
 *
 * Stock bajo (formato actual):
 *   "Stock bajo: ACARIL CREMA X 42G — quedan 2 unidades"
 */

export function partesMensajeNotif(mensaje) {
  const raw = String(mensaje || '').trim();

  const stock = /^Stock bajo:\s*(.+?)\s+[—–-]\s+quedan\s+(\d+)\s+unidades?\.?$/i.exec(raw);
  if (stock) {
    return { kind: 'stock', cantidad: Number(stock[2]), nombre: stock[1].trim() };
  }

  const yaReordenado = /^(\d+)\s+und\s+[—–-]\s+(.+)$/i.exec(raw);
  if (yaReordenado) {
    return { kind: 'stock', cantidad: Number(yaReordenado[1]), nombre: yaReordenado[2].trim() };
  }

  return { kind: 'plain', texto: raw };
}
