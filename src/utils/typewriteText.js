/**
 * Typewriter breve: revela `fullText` carácter a carácter en ~durationMs
 * (default 420ms), independientemente de la longitud. No bloquea UI.
 *
 * @param {(v: string) => void} setValue
 * @param {string} fullText
 * @param {{ durationMs?: number, signal?: AbortSignal }} [opts]
 * @returns {Promise<void>}
 */
export function typewriteText(setValue, fullText, opts = {}) {
  const durationMs = opts.durationMs ?? 420;
  const signal = opts.signal;
  const text = String(fullText ?? '');

  if (signal?.aborted) {
    setValue(text);
    return Promise.resolve();
  }

  if (!text) {
    setValue('');
    return Promise.resolve();
  }

  // Textos cortos: un solo frame basta (evita “tipeo” ridículo de 2 letras).
  if (text.length <= 2) {
    setValue(text);
    return Promise.resolve();
  }

  setValue('');
  const start = performance.now();
  const len = text.length;

  return new Promise((resolve) => {
    let raf = 0;
    const finish = () => {
      if (raf) cancelAnimationFrame(raf);
      setValue(text);
      resolve();
    };

    const onAbort = () => finish();
    signal?.addEventListener('abort', onAbort, { once: true });

    const tick = (now) => {
      if (signal?.aborted) {
        finish();
        return;
      }
      const t = Math.min(1, (now - start) / durationMs);
      const chars = Math.max(1, Math.ceil(t * len));
      setValue(text.slice(0, chars));
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        signal?.removeEventListener('abort', onAbort);
        setValue(text);
        resolve();
      }
    };

    raf = requestAnimationFrame(tick);
  });
}

/**
 * Anima varios campos en paralelo (misma ventana de duración).
 * @param {Array<{ set: (v: string) => void, text: string }>} jobs
 * @param {{ durationMs?: number, signal?: AbortSignal }} [opts]
 */
export function typewriteFields(jobs, opts = {}) {
  return Promise.all(
    (jobs || []).map(({ set, text }) => typewriteText(set, text, opts)),
  );
}
