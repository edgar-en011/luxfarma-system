/**
 * Genera el buffer ESC/POS del ticket real y lo vuelca a un archivo.
 * No envía nada al spooler: interface = ruta de archivo (File de node-thermal-printer).
 *
 *   npx electron scripts/test-escpos-buffer.cjs
 */
const { app } = require('electron')
const fs = require('fs')
const path = require('path')

const RAIZ = path.join(__dirname, '..')
const OUT = path.join(RAIZ, 'scripts', 'escpos-buffer.bin')

function hexPreview(buf, n = 48) {
  return Buffer.from(buf.subarray(0, n)).toString('hex').replace(/(..)/g, '$1 ').trim()
}

function countCmd(buf, bytes) {
  const needle = Buffer.from(bytes)
  let n = 0
  let i = 0
  while (i <= buf.length - needle.length) {
    const at = buf.indexOf(needle, i)
    if (at < 0) break
    n += 1
    i = at + needle.length
  }
  return n
}

app.whenReady().then(async () => {
  try {
    fs.writeFileSync(OUT, Buffer.alloc(0))
    process.env.THERMAL_PRINTER_INTERFACE = OUT

    const thermal = await import(
      'file://' + path.join(RAIZ, 'electron/printers/thermal.js').replace(/\\/g, '/')
    )
    const { buildTicketPruebaPayload } = await import(
      'file://' + path.join(RAIZ, 'src/utils/ticketSunat.js').replace(/\\/g, '/')
    )

    const payload = buildTicketPruebaPayload('Boleta')
    const res = await thermal.printThermalTicket(payload)
    if (!res.ok) {
      console.error('FALLO printThermalTicket:', res)
      app.exit(1)
      return
    }

    const buf = fs.readFileSync(OUT)
    const escInit = countCmd(buf, [0x1b, 0x40])
    const raster = countCmd(buf, [0x1d, 0x76, 0x30])
    const cut = countCmd(buf, [0x1d, 0x56])

    console.log('=== ESC/POS buffer (sin hardware) ===')
    console.log(JSON.stringify({
      ok: res.ok,
      interface: res.interface,
      bytes: buf.length,
      archivo: OUT,
      escInit,
      rasterGsV0: raster,
      cut: cut,
      hex48: hexPreview(buf),
    }, null, 2))

    if (buf.length < 200) {
      console.error('FALLO buffer demasiado corto')
      app.exit(1)
      return
    }
    if (raster < 1) {
      console.error('FALLO no hay GS v 0 (logo/QR raster); pngjs o printImageBuffer no corrieron')
      app.exit(1)
      return
    }
    console.log('OK buffer ESC/POS generado (logo/QR raster presentes)')
    app.exit(0)
  } catch (err) {
    console.error('FALLO prueba:', err?.stack || err?.message || err)
    app.exit(1)
  }
})
