/**
 * Saludo de voz al iniciar sesión — una sola vez por día calendario
 * en esta máquina (no por usuario ni por sesión de login).
 *
 * Chromium/Electron dispara `voiceschanged` más de una vez; sin guard,
 * `speak()` se encola dos veces y se oye "Bienvenido" superpuesto.
 * StrictMode y el remount de MainLayout (loading → layout) no deben
 * cancelar el timer ni borrar la marca del día.
 */

export const WELCOME_AUDIO_STORAGE_KEY = 'ultimoAudioBienvenida'

/** Día (YYYY-MM-DD) en el que ya se decidió reproducir, vive en memoria. */
let committedYmd = null
let pendingTimer = null
let voicesHandler = null
let spoken = false

export function fechaHoyYmd(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function debeReproducirBienvenida(fechaGuardada, fechaHoy) {
  return !fechaGuardada || fechaGuardada !== fechaHoy
}

function leerMarcaDia() {
  try {
    return localStorage.getItem(WELCOME_AUDIO_STORAGE_KEY)
  } catch {
    return null
  }
}

function guardarMarcaDia(ymd) {
  try {
    localStorage.setItem(WELCOME_AUDIO_STORAGE_KEY, ymd)
  } catch {
    /* localStorage no disponible */
  }
}

function alreadySpokenToday() {
  const hoy = fechaHoyYmd()
  if (committedYmd === hoy) return true
  return !debeReproducirBienvenida(leerMarcaDia(), hoy)
}

function markSpokenToday() {
  const hoy = fechaHoyYmd()
  if (committedYmd !== hoy) spoken = false
  committedYmd = hoy
  guardarMarcaDia(hoy)
}

function limpiarTimerPendiente() {
  if (pendingTimer) {
    clearTimeout(pendingTimer)
    pendingTimer = null
  }
  if (voicesHandler) {
    try {
      window.speechSynthesis?.removeEventListener('voiceschanged', voicesHandler)
    } catch {
      /* ignore */
    }
    voicesHandler = null
  }
}

/**
 * Cancela el habla / timer en curso al logout.
 * No borra la marca del día (memoria ni localStorage).
 */
export function resetWelcomeVoice() {
  limpiarTimerPendiente()
  try {
    const keys = []
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const k = sessionStorage.key(i)
      if (k && (k.startsWith('sf_welcome_spoken_') || k.startsWith('saludoBienvenida_'))) keys.push(k)
    }
    keys.forEach((k) => sessionStorage.removeItem(k))
  } catch {
    /* ignore */
  }
  try {
    const stale = []
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i)
      if (k && k.startsWith('saludoBienvenida_')) stale.push(k)
    }
    stale.forEach((k) => localStorage.removeItem(k))
  } catch {
    /* ignore */
  }
  try {
    window.speechSynthesis?.cancel()
  } catch {
    /* ignore */
  }
}

function pickVoice(voices) {
  return (
    voices.find((v) => v.name === 'Microsoft Pablo - Spanish (Spain)')
    || voices.find((v) => v.name === 'Microsoft Raul - Spanish (Mexico)')
    || voices.find((v) => String(v.lang || '').startsWith('es'))
    || null
  )
}

function speakWelcome(user) {
  if (spoken) return
  spoken = true
  try {
    const synth = window.speechSynthesis
    synth.cancel()
    const msg = new SpeechSynthesisUtterance(`Bienvenido, ${user.nombres || 'usuario'}`)
    msg.lang = 'es-ES'
    msg.volume = 1
    msg.rate = 0.88
    msg.pitch = 0.75
    const voz = pickVoice(synth.getVoices() || [])
    if (voz) msg.voice = voz
    synth.speak(msg)
  } catch {
    /* autoplay / speech no disponible */
  }
}

/**
 * Programa el saludo ~2s después del mount. Una sola vez por día en esta PC.
 * El cleanup de React NO cancela el timer (StrictMode / remount del layout).
 * @returns {() => void} cleanup para el useEffect
 */
export function scheduleWelcomeVoice(user) {
  if (!user?.id_usuario || typeof window === 'undefined' || !window.speechSynthesis) {
    return () => {}
  }

  const hoy = fechaHoyYmd()
  if (alreadySpokenToday()) {
    committedYmd = hoy
    return () => {}
  }

  // Marca el día YA, antes de hablar. Cerrar sesión y volver a entrar
  // el mismo día no debe volver a programar el saludo.
  markSpokenToday()

  if (pendingTimer) return () => {}

  const trySpeak = () => {
    try {
      if (window.speechSynthesis.getVoices().length > 0) {
        limpiarTimerPendiente()
        speakWelcome(user)
        return true
      }
    } catch {
      /* ignore */
    }
    return false
  }

  voicesHandler = () => {
    if (trySpeak()) return
  }

  pendingTimer = setTimeout(() => {
    if (trySpeak()) return
    try {
      window.speechSynthesis.addEventListener('voiceschanged', voicesHandler)
    } catch {
      /* ignore */
    }
  }, 2000)

  return () => {}
}
