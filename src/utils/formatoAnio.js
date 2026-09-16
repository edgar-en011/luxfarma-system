export function autocompletarAnio(valor) {
  const limpio = String(valor).replace(/\D/g, '').slice(0, 4);
  if (limpio.length === 2) return '20' + limpio;
  return limpio;
}
