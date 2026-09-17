import { app, BrowserWindow, ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { printThermalTicket, getThermalPrinterStatus, listInstalledPrinters } from './printers/thermal.js'
import { readPrinterConfig, writePrinterConfig, getPrinterConfigPath } from './printerConfig.js'
import { registerSqliteIpc } from './db/ipc.js'
import { initSqlite, closeSqlite } from './db/sqlite.js'
import {
  anularComprobanteNubefactMain,
  consultarEstadoNubefact,
  emitirComprobanteNubefact,
  nubefactConfigurado,
} from './nubefact.js'
import { initAutoUpdater } from './updater.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {BrowserWindow | null} */
let mainWindow = null

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const FUNCTION_KEY_CHANNEL = 'function-key'

function readAppVersion() {
  const candidates = [
    path.join(__dirname, '..', 'package.json'),
    path.join(process.cwd(), 'package.json'),
  ]
  for (const file of candidates) {
    try {
      const v = JSON.parse(fs.readFileSync(file, 'utf8')).version
      if (v) return String(v)
    } catch {
      /* siguiente candidato */
    }
  }
  return ''
}

function resolveFunctionKey(input) {
  // En Windows a veces key viene vacío y code trae "F2".
  const candidates = [input.key, input.code].filter(Boolean)
  for (const candidate of candidates) {
    const match = /^F([1-8])$/i.exec(String(candidate))
    if (match) return `F${match[1]}`
  }
  return null
}

function startupLog(msg, extra) {
  const line = `[electron:main] ${msg}${extra !== undefined ? ` ${typeof extra === 'string' ? extra : JSON.stringify(extra)}` : ''}`
  console.log(line)
  try {
    const file = path.join(app.getPath('userData'), 'startup.log')
    fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`)
  } catch {
    /* ignore */
  }
}

function resolveWindowIcon() {
  const candidates = [
    path.join(__dirname, 'assets/icon.ico'),
    path.join(__dirname, '../electron/assets/icon.ico'),
    path.join(process.cwd(), 'electron/assets/icon.ico'),
    path.join(process.cwd(), 'build/icon.ico'),
  ]
  return candidates.find((p) => {
    try { return fs.existsSync(p) } catch { return false }
  })
}

function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.cjs')
  startupLog('preload path:', preloadPath)

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    title: 'LuxFarma',
    icon: resolveWindowIcon(),
    show: false,
    webPreferences: {
      // .cjs: el proyecto es "type":"module"; un preload.mjs con require() falla en silencio.
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.once('ready-to-show', () => {
    startupLog('ready-to-show')
    mainWindow?.show()
  })
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      startupLog('show fallback (ready-to-show no disparó)')
      mainWindow.show()
    }
  }, 4000)

  // F1–F8 solo dentro de esta ventana (no globalShortcut del SO).
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const fnKey = resolveFunctionKey(input)
    if (!fnKey) return

    console.log(`[electron:main] before-input-event → ${fnKey}`, {
      key: input.key,
      code: input.code,
      type: input.type,
    })

    event.preventDefault()
    mainWindow?.webContents.send(FUNCTION_KEY_CHANNEL, fnKey)
  })

  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level < 2) return
    startupLog(`renderer console[${level}] ${message} (${sourceId}:${line})`)
  })
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    startupLog('did-fail-load', { code, desc, url })
  })
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    startupLog('render-process-gone', details)
  })
  mainWindow.webContents.on('preload-error', (_e, preloadPathFailed, error) => {
    startupLog('preload-error', { preloadPathFailed, error: String(error) })
  })

  mainWindow.webContents.on('did-finish-load', async () => {
    try {
      const info = await mainWindow.webContents.executeJavaScript(`({
        href: String(location.href),
        pathname: String(location.pathname),
        hash: String(location.hash),
        protocol: String(location.protocol),
        hasRoot: !!document.getElementById('root'),
        rootHTML: (document.getElementById('root') && document.getElementById('root').innerHTML.slice(0, 180)) || '',
        hasApi: !!(window.electronAPI && window.electronAPI.isElectron),
      })`)
      startupLog('did-finish-load', info)
      if (!info?.hasApi) {
        startupLog('preload NO expuso electronAPI. Revisa preload.cjs / webPreferences.preload')
      }
      setTimeout(async () => {
        if (!mainWindow || mainWindow.isDestroyed()) return
        try {
          const ui = await mainWindow.webContents.executeJavaScript(`({
            href: String(location.href),
            hash: String(location.hash),
            rootLen: (document.getElementById('root') && document.getElementById('root').innerHTML.length) || 0,
            hasLogin: !!document.querySelector('.login-page, .login-card'),
            hasPassword: !!document.querySelector('input[type="password"]'),
            hasCredit: !!(document.body.innerText || '').includes('Brayan Siccha'),
            hasVersion: !!(document.body.innerText || '').includes(${JSON.stringify(`v${readAppVersion()}`)}),
            bodyText: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 280),
            welcomeGuard: (() => {
              let spoken = false
              let count = 0
              const speakOnce = () => { if (spoken) return; spoken = true; count += 1 }
              speakOnce(); speakOnce(); speakOnce()
              return count
            })(),
          })`)
          startupLog('ui-check', ui)
          if (process.env.SF_CAPTURE_LOGIN === '1' && ui?.hasLogin) {
            const png = await mainWindow.webContents.capturePage()
            const out = path.join(process.cwd(), 'scripts', 'login-credito.png')
            fs.writeFileSync(out, png.toPNG())
            startupLog('capture login', out)
          }
        } catch (err) {
          startupLog('ui-check falló', String(err?.message || err))
        }
      }, 2000)
    } catch (err) {
      startupLog('no se pudo verificar renderer', String(err?.message || err))
    }
  })

  const openDevTools =
    process.env.SF_DEVTOOLS === '1'
    || (Boolean(VITE_DEV_SERVER_URL) && process.env.SF_DEVTOOLS !== '0')
    || (
      !app.isPackaged
      && process.env.SF_CAPTURE_LOGIN !== '1'
      && process.env.SF_DEVTOOLS !== '0'
    )
  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
  } else {
    const indexHtml = path.join(__dirname, '../dist/index.html')
    startupLog('loadFile', { indexHtml, exists: fs.existsSync(indexHtml), packaged: app.isPackaged })
    mainWindow.loadFile(indexHtml)
  }
  if (openDevTools) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

ipcMain.handle('print-ticket', async (_event, payload) => {
  console.log('[electron:main] IPC print-ticket recibido')
  try {
    const result = await printThermalTicket(payload || {})
    if (result?.ok) {
      console.log('[electron:main] print-ticket OK (térmica directa)', result)
    } else {
      console.error('[electron:main] print-ticket FALLÓ (el renderer hará fallback window.print):', result)
    }
    return result
  } catch (err) {
    const error = err?.message || String(err)
    console.error('[electron:main] print-ticket excepción:', error)
    return { ok: false, error }
  }
})

ipcMain.handle('printer-status', async () => {
  try {
    return await getThermalPrinterStatus()
  } catch (err) {
    return { ok: false, connected: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('printers:list', async () => {
  try {
    return listInstalledPrinters()
  } catch (err) {
    return { ok: false, printers: [], error: err?.message || String(err) }
  }
})

ipcMain.handle('printers:getConfig', async () => {
  try {
    const cfg = readPrinterConfig()
    return { ok: true, ...cfg, path: getPrinterConfigPath() }
  } catch (err) {
    return { ok: false, printerName: null, error: err?.message || String(err) }
  }
})

ipcMain.handle('printers:setConfig', async (_event, payload) => {
  try {
    return writePrinterConfig({ printerName: payload?.printerName })
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('nubefact:configurado', async () => nubefactConfigurado())

ipcMain.handle('nubefact:emitir', async (_event, datosVenta) => {
  try {
    return await emitirComprobanteNubefact(datosVenta || {})
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('nubefact:consultar', async (_event, payload) => {
  try {
    return await consultarEstadoNubefact(payload?.tipoComprobante, payload?.serie, payload?.numero)
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('nubefact:anular', async (_event, payload) => {
  try {
    return await anularComprobanteNubefactMain(payload || {})
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

/** Prueba de impresión con la impresora indicada (puede ser distinta a la guardada). */
ipcMain.handle('printers:test', async (_event, payload) => {
  const printerName = payload?.printerName
  console.log('[electron:main] IPC printers:test', { printerName })
  try {
    return await printThermalTicket(
      { test: true },
      { printerName: printerName || undefined },
    )
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

app.whenReady().then(() => {
  startupLog('app ready — creando ventana')
  const quitAfter = Number(process.env.SF_QUIT_AFTER || 0)
  if (quitAfter > 0) {
    setTimeout(() => app.quit(), quitAfter)
  }
  try {
    registerSqliteIpc()
    initSqlite()
  } catch (err) {
    console.error('[electron:main] SQLite init falló:', err)
  }
  createWindow()
  initAutoUpdater(() => mainWindow)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  closeSqlite()
  if (process.platform !== 'darwin') app.quit()
})
app.on('before-quit', () => {
  closeSqlite()
})
