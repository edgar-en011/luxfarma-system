import { useRef, useState } from 'react';
import './SmartDateInput.css';

function expandirAnio(valor) {
  if (valor.length === 2) return '20' + valor;
  return valor;
}

function parsearValor(v) {
  if (!v) return { d: '', m: '', y: '' };
  const [y, m, d] = v.split('-');
  return { d: d || '', m: m || '', y: y || '' };
}

export default function SmartDateInput({ value, onChange, required, readOnly, className, hasError, esFechaVencimiento, onEnterAnio, saltarEnter }) {
  const [dia, setDia] = useState(() => parsearValor(value).d);
  const [mes, setMes] = useState(() => parsearValor(value).m);
  const [anio, setAnio] = useState(() => parsearValor(value).y);
  // valorSincronizado evita reprocesar en cada render (reemplaza el array de dependencias
  // [value] del useEffect anterior); ultimoValorEmitido reemplaza al antiguo valorInternoRef
  // para distinguir si el cambio de `value` vino de este mismo componente o de afuera —
  // ambos son estado (no refs), porque leer/escribir un ref durante el render está prohibido
  // por la regla react-hooks/refs.
  const [valorSincronizado, setValorSincronizado] = useState(value);
  const [ultimoValorEmitido, setUltimoValorEmitido] = useState(value);

  const diaRef = useRef(null);
  const mesRef = useRef(null);
  const anioRef = useRef(null);

  const anioMinimo = esFechaVencimiento ? new Date().getFullYear() : null;

  // Sincroniza dia/mes/anio cuando el prop `value` cambia desde AFUERA — se hace durante
  // el render (patrón recomendado por React para "ajustar estado cuando cambia un prop"),
  // en vez de en un useEffect, para evitar el doble render que marca la regla de ESLint
  // react-hooks/set-state-in-effect. Si `value` coincide con lo último que este mismo
  // componente emitió, se ignora el eco — evitando el bug de cascada (borrar un segmento
  // ya no borra los demás).
  if (value !== valorSincronizado) {
    setValorSincronizado(value);
    if (value !== ultimoValorEmitido) {
      const { d, m, y } = parsearValor(value);
      setDia(d); setMes(m); setAnio(y);
    }
  }

  const emitirCambio = (d, m, a) => {
    const nuevoValor = (d.length === 2 && m.length === 2 && a.length === 4) ? `${a}-${m}-${d}` : '';
    setUltimoValorEmitido(nuevoValor);
    onChange(nuevoValor);
  };

  const handleDia = (e) => {
    let v = e.target.value.replace(/\D/g, '').slice(0, 2);
    if (v.length === 2 && Number(v) > 31) v = '31';
    if (v.length === 2 && Number(v) === 0) v = '01';
    setDia(v);
    if (v.length === 2) mesRef.current?.focus();
    emitirCambio(v, mes, anio);
  };

  const handleMes = (e) => {
    let v = e.target.value.replace(/\D/g, '').slice(0, 2);
    if (v.length === 2 && Number(v) > 12) v = '12';
    if (v.length === 2 && Number(v) === 0) v = '01';
    setMes(v);
    if (v.length === 2) anioRef.current?.focus();
    emitirCambio(dia, v, anio);
  };

  // Rellena con cero a la izquierda un día/mes que quedó en 1 solo dígito al salir del
  // campo (clic fuera, Tab, o flecha derecha) — sin esto, emitirCambio nunca considera
  // la fecha completa (exige 2 dígitos) y el campo queda "atascado" en inválido de forma
  // invisible, ya que un solo dígito se ve igual de "lleno" que dos en una casilla angosta.
  //
  // Lee el valor DESDE EL DOM (ref.current.value), no desde el estado `dia`/`mes` del
  // closure: cuando el 2do dígito completa el segmento, handleDia/handleMes llama a
  // focus() en el siguiente campo de forma SÍNCRONA, lo cual dispara este blur ANTES de
  // que React re-renderice con el nuevo valor — el closure de dia/mes en ese momento
  // sigue siendo el de 1 dígito de ANTES del último tecleo. Leer del DOM evita ese
  // valor obsoleto, porque el navegador ya escribió el dígito ahí antes de disparar el
  // evento. (Bug real reproducido: escribir "1" y luego "8" en DÍA terminaba en "01" en
  // vez de "18", porque confirmarDia pisaba el "18" recién calculado con un "01" armado
  // a partir del "1" desactualizado.)
  const confirmarDia = () => {
    const v = diaRef.current?.value || '';
    if (v.length === 1) {
      const relleno = v === '0' ? '01' : v.padStart(2, '0');
      setDia(relleno);
      emitirCambio(relleno, mes, anio);
    }
  };
  const confirmarMes = () => {
    const v = mesRef.current?.value || '';
    if (v.length === 1) {
      const relleno = v === '0' ? '01' : v.padStart(2, '0');
      setMes(relleno);
      emitirCambio(dia, relleno, anio);
    }
  };

  // La expansión de año de 2 dígitos ("25" → "2025") vive SOLO en confirmarAnio
  // (blur/Enter) — aplicarla aquí, en cada tecla, hacía que el campo saltara a "20XX"
  // en cuanto pasaba por 2 dígitos (al escribir un año nuevo o al borrar dígitos de uno
  // existente), interrumpiendo la edición a mitad de camino.
  const handleAnio = (e) => {
    let v = e.target.value.replace(/\D/g, '').slice(0, 4);
    if (v.length === 4 && anioMinimo && Number(v) < anioMinimo) v = String(anioMinimo);
    setAnio(v);
    const d = String(diaRef.current?.value || dia).replace(/\D/g, '').slice(0, 2);
    const m = String(mesRef.current?.value || mes).replace(/\D/g, '').slice(0, 2);
    emitirCambio(d, m, v);
  };

  // Compartida entre el blur natural del campo año y el Enter interceptado en
  // onEnterAnio (que evita el blur nativo al bloquear el salto de foco) — ambos
  // necesitan expandir un año de 2 dígitos antes de dar el valor por confirmado.
  const fechaIsoDesdeDom = () => {
    let d = String(diaRef.current?.value || '').replace(/\D/g, '').slice(0, 2);
    let m = String(mesRef.current?.value || '').replace(/\D/g, '').slice(0, 2);
    let a = String(anioRef.current?.value || '').replace(/\D/g, '').slice(0, 4);
    if (d.length === 1) d = d === '0' ? '01' : d.padStart(2, '0');
    if (m.length === 1) m = m === '0' ? '01' : m.padStart(2, '0');
    if (a.length === 2) a = expandirAnio(a);
    if (a.length === 4 && anioMinimo && Number(a) < anioMinimo) a = String(anioMinimo);
    if (d.length === 2 && m.length === 2 && a.length === 4) return { d, m, a, iso: `${a}-${m}-${d}` };
    return null;
  };

  const confirmarAnio = () => {
    const completa = fechaIsoDesdeDom();
    if (!completa) return '';
    setDia(completa.d);
    setMes(completa.m);
    setAnio(completa.a);
    emitirCambio(completa.d, completa.m, completa.a);
    return completa.iso;
  };

  const handleAnioBlur = () => confirmarAnio();

  // ↑/↓ incrementan o decrementan el segmento enfocado, respetando límites válidos.
  // ←/→ mueven el foco entre día/mes/año, igual que un date picker nativo.
  // Todo se "atrapa" aquí (preventDefault + stopPropagation) para no chocar con la
  // navegación global de flechas de MainLayout.jsx.
  const handleKeyDown = (segmento) => (e) => {
    // Opt-in: solo cuando el consumidor pasa onEnterAnio (hoy únicamente el campo
    // "Hasta" del historial por persona) — el resto de usos de SmartDateInput
    // (AdminCompras, etc.) no reciben esta prop y su Enter sigue cayendo intacto
    // al sistema global de Enter-como-Tab de MainLayout.jsx, como siempre.
    if (segmento === 'anio' && e.key === 'Enter' && onEnterAnio) {
      e.preventDefault();
      e.stopPropagation();
      const iso = confirmarAnio();
      onEnterAnio(iso);
      return;
    }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'ArrowLeft') {
      if (segmento === 'mes') diaRef.current?.focus();
      else if (segmento === 'anio') mesRef.current?.focus();
      return;
    }
    if (e.key === 'ArrowRight') {
      if (segmento === 'dia') mesRef.current?.focus();
      else if (segmento === 'mes') anioRef.current?.focus();
      return;
    }

    const delta = e.key === 'ArrowUp' ? 1 : -1;

    if (segmento === 'dia') {
      let nuevo = (Number(dia) || (delta > 0 ? 0 : 1)) + delta;
      if (nuevo < 1) nuevo = 1;
      if (nuevo > 31) nuevo = 31;
      const v = String(nuevo).padStart(2, '0');
      setDia(v);
      emitirCambio(v, mes, anio);
    } else if (segmento === 'mes') {
      let nuevo = (Number(mes) || (delta > 0 ? 0 : 1)) + delta;
      if (nuevo < 1) nuevo = 1;
      if (nuevo > 12) nuevo = 12;
      const v = String(nuevo).padStart(2, '0');
      setMes(v);
      emitirCambio(dia, v, anio);
    } else if (segmento === 'anio') {
      const base = Number(anio) || new Date().getFullYear();
      let nuevo = base + delta;
      if (anioMinimo && nuevo < anioMinimo) nuevo = anioMinimo;
      const v = String(nuevo);
      setAnio(v);
      emitirCambio(dia, mes, v);
    }
  };

  // Al ganar foco (venga de un clic, de Tab nativo, del salto automático al completar
  // un segmento, de las flechas ←/→, o del sistema global de Enter-como-Tab de
  // MainLayout.jsx) selecciona todo el contenido del segmento — así el cursor siempre
  // queda en una posición conocida y ↑/↓/←/→ funcionan igual sin importar de dónde
  // vino el foco, en vez de heredar la posición de cursor que el navegador recuerda
  // de la última vez que ese input tuvo foco.
  const seleccionarAlEnfocar = (e) => e.target.select();

  return (
    <div className={`smart-date-input ${readOnly ? 'sdi-readonly' : ''} ${hasError ? 'sdi-error' : ''} ${className || ''}`}>
      <input ref={diaRef} className="sdi-dia" type="text" inputMode="numeric" placeholder="DD" maxLength={2} value={dia} onChange={handleDia} onBlur={confirmarDia} onKeyDown={handleKeyDown('dia')} onFocus={seleccionarAlEnfocar} required={required} readOnly={readOnly} data-enter-skip={saltarEnter ? 'true' : undefined} />
      <span className="sdi-sep">/</span>
      <input ref={mesRef} className="sdi-mes" type="text" inputMode="numeric" placeholder="MM" maxLength={2} value={mes} onChange={handleMes} onBlur={confirmarMes} onKeyDown={handleKeyDown('mes')} onFocus={seleccionarAlEnfocar} required={required} readOnly={readOnly} data-enter-skip={saltarEnter ? 'true' : undefined} />
      <span className="sdi-sep">/</span>
      <input ref={anioRef} className="sdi-anio" type="text" inputMode="numeric" placeholder="AAAA" maxLength={4} value={anio} onChange={handleAnio} onBlur={handleAnioBlur} onKeyDown={handleKeyDown('anio')} onFocus={seleccionarAlEnfocar} required={required} readOnly={readOnly} data-enter-skip={saltarEnter ? 'true' : undefined} />
    </div>
  );
}
