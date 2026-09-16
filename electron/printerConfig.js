/**
 * Configuración local de impresora térmica (por máquina).
 * Archivo: {userData}/printer-config.json
 */

import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

const LOG = '[electron:printer-config]'
const FILENAME = 'printer-config.json'

/** Fallback histórico si nunca se configuró nada. */
export const LEGACY_DEFAULT_PRINTER = 'POS-80-Series'

function configPath() {
  return path.join(app.getPath('userData'), FILENAME)
}

/**
 * @returns {{ printerName: string|null, updatedAt: string|null }}
 */
export function readPrinterConfig() {
  const file = configPath()
  try {
    if (!fs.existsSync(file)) {
      return { printerName: null, updatedAt: null }
    }
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    const printerName = raw?.printerName ? String(raw.printerName).trim() : null
    return {
      printerName: printerName || null,
      updatedAt: raw?.updatedAt || null,
    }
  } catch (err) {
    console.error(`${LOG} read FALLÓ:`, err?.message || err)
    return { printerName: null, updatedAt: null }
  }
}

/**
 * @param {{ printerName: string }} opts
 */
export function writePrinterConfig({ printerName }) {
  const name = String(printerName || '').trim()
  if (!name) throw new Error('Nombre de impresora vacío')
  const file = configPath()
  const data = {
    printerName: name,
    updatedAt: new Date().toISOString(),
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
  console.log(`${LOG} guardado →`, data)
  return { ok: true, ...data, path: file }
}

export function getPrinterConfigPath() {
  return configPath()
}

/**
 * Convierte nombre Windows → interface de node-thermal-printer.
 * @param {string} printerName
 */
export function toPrinterInterface(printerName) {
  const name = String(printerName || '').trim()
  if (!name) return null
  if (name.startsWith('printer:')) return name
  return `printer:${name}`
}
