/**
 * Auto-actualización (electron-updater, proveedor generic → Supabase Storage).
 * En empaquetado lee app-update.yml generado por electron-builder.
 * Dev: no revisa (evita ruido); SF_FORCE_UPDATER=1 para forzar.
 *
 * electron-updater es CommonJS: import por defecto, luego destructuring.
 * No usar `import { autoUpdater }` — Vite/Rolldown lo reescribe y Node lo rechaza.
 */

import updaterPkg from 'electron-updater'
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

const { autoUpdater } = updaterPkg

const CHECK_MS = 60 * 60 * 1000
const CHANNEL = 'updater:event'

function log(msg, extra) {
  const line = `[electron:updater] ${msg}${extra !== undefined ? ` ${typeof extra === 'string' ? extra : JSON.stringify(extra)}` : ''}`
  console.log(line)
  try {
    const file = path.join(app.getPath('userData'), 'startup.log')
    fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`)
  } catch {
    /* ignore */
  }
}

function send(win, payload) {
  if (!win || win.isDestroyed()) return
  try {
    win.webContents.send(CHANNEL, payload)
  } catch {
    /* ignore */
  }
}

export function initAutoUpdater(getWindow) {
  if (!autoUpdater) {
    log('electron-updater no expuso autoUpdater')
    return
  }
  if (!app.isPackaged && process.env.SF_FORCE_UPDATER !== '1') {
    log('omitido (no empaquetado)')
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = {
    info: (m) => log(String(m)),
    warn: (m) => log(`WARN ${m}`),
    error: (m) => log(`ERROR ${m}`),
    debug: () => {},
  }

  autoUpdater.on('checking-for-update', () => {
    log('revisando…')
  })

  autoUpdater.on('update-available', (info) => {
    log('disponible', { version: info?.version })
    send(getWindow(), { status: 'available', version: info?.version })
  })

  autoUpdater.on('update-not-available', (info) => {
    log('sin novedad', { actual: info?.version })
  })

  autoUpdater.on('download-progress', (progress) => {
    const percent = Number(progress?.percent || 0)
    send(getWindow(), {
      status: 'downloading',
      percent,
      transferred: progress?.transferred,
      total: progress?.total,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    log('descargada', { version: info?.version })
    send(getWindow(), { status: 'installing', version: info?.version })
    setTimeout(() => {
      send(getWindow(), { status: 'ready', version: info?.version })
    }, 900)
  })

  autoUpdater.on('error', (err) => {
    log('error', err?.message || String(err))
    send(getWindow(), { status: 'error', error: err?.message || String(err) })
  })

  const revisar = () => {
    autoUpdater.checkForUpdates().catch((err) => {
      log('check falló', err?.message || String(err))
    })
  }

  setTimeout(revisar, 5000)
  setInterval(revisar, CHECK_MS)
  log('programado: al iniciar + cada 1 h')
}
