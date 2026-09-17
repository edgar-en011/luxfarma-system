/**
 * Genera el logo LuxFarma para térmica (negro sobre blanco) y el .ico de Electron.
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i]
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
  }
  return (~c) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td), 0)
  return Buffer.concat([len, td, crc])
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1)
    raw[row] = 0
    rgba.copy(raw, row + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const idat = zlib.deflateSync(raw, { level: 9 })
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function pngToIco(png, size) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)
  const entry = Buffer.alloc(16)
  entry[0] = size >= 256 ? 0 : size
  entry[1] = size >= 256 ? 0 : size
  entry.writeUInt16LE(1, 4)
  entry.writeUInt16LE(32, 6)
  entry.writeUInt32LE(png.length, 8)
  entry.writeUInt32LE(22, 12)
  return Buffer.concat([header, entry, png])
}

/** Cruz médica hueca, negro puro sobre blanco. */
function rasterCross(size) {
  const rgba = Buffer.alloc(size * size * 4)
  const t = size * 0.16
  const hole = size * 0.09
  const pad = size * 0.10
  const cx = (size - 1) / 2
  const cy = (size - 1) / 2
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4
      const inV = Math.abs(x - cx) <= t && y >= pad && y <= size - 1 - pad
      const inH = Math.abs(y - cy) <= t && x >= pad && x <= size - 1 - pad
      const inShape = inV || inH
      const inVHole = Math.abs(x - cx) <= hole && y >= pad + hole && y <= size - 1 - pad - hole
      const inHHole = Math.abs(y - cy) <= hole && x >= pad + hole && x <= size - 1 - pad - hole
      const black = inShape && !(inVHole || inHHole)
      const v = black ? 0 : 255
      rgba[i] = v
      rgba[i + 1] = v
      rgba[i + 2] = v
      rgba[i + 3] = 255
    }
  }
  return rgba
}

function writeAll(file, buf) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, buf)
  console.log('wrote', path.relative(root, file), buf.length, 'bytes')
}

const size = 256
const png = encodePng(size, size, rasterCross(size))
const ico = pngToIco(png, size)

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="#FFFFFF"/>
  <path fill="#000000" fill-rule="evenodd" d="M26.5 7c0-2.5 2-4.5 4.5-4.5h2c2.5 0 4.5 2 4.5 4.5v14.5H52c2.5 0 4.5 2 4.5 4.5v2c0 2.5-2 4.5-4.5 4.5H37.5V57c0 2.5-2 4.5-4.5 4.5h-2c-2.5 0-4.5-2-4.5-4.5V37.5H12c-2.5 0-4.5-2-4.5-4.5v-2c0-2.5 2-4.5 4.5-4.5h14.5V7zm5 6.5h1v16h16v1h-16v16h-1v-16h-16v-1h16v-16z"/>
</svg>
`

writeAll(path.join(root, 'public/ticket-logo.png'), png)
writeAll(path.join(root, 'public/ticket-logo.svg'), Buffer.from(svg))
writeAll(path.join(root, 'electron/assets/ticket-logo.png'), png)
writeAll(path.join(root, 'electron/assets/icon.png'), png)
writeAll(path.join(root, 'electron/assets/icon.ico'), ico)
writeAll(path.join(root, 'build/icon.png'), png)
writeAll(path.join(root, 'build/icon.ico'), ico)
writeAll(path.join(root, 'build/installerIcon.ico'), ico)
writeAll(path.join(root, 'build/installerHeaderIcon.ico'), ico)
writeAll(path.join(root, 'build/uninstallerIcon.ico'), ico)
console.log('ok')
