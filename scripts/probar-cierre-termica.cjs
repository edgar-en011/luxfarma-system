/**
 * Prueba REAL del voucher de cierre por la térmica, sin pasar por la UI.
 *
 * Corre dentro de Electron y llama a printThermalTicket() exactamente como lo
 * hace el handler IPC 'print-ticket'. Si imprime acá, imprime al cerrar turno,
 * y por este camino no existe ninguna ventana que pueda abrir el diálogo de
 * Windows (nunca se llama webContents.print()).
 *
 *   npx electron scripts/probar-cierre-termica.cjs            → solo estado
 *   npx electron scripts/probar-cierre-termica.cjs --imprimir → manda el papel
 */
const { app } = require('electron');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const IMPRIMIR = process.argv.includes('--imprimir');

app.whenReady().then(async () => {
  try {
    // El main empaquetado vive en dist-electron; en desarrollo se importa el fuente.
    const thermal = await import(
      'file://' + path.join(RAIZ, 'electron/printers/thermal.js').replace(/\\/g, '/')
    );
    const { buildCierreCajaPayload } = await import(
      'file://' + path.join(RAIZ, 'src/utils/cierreCajaTicket.js').replace(/\\/g, '/')
    );

    const estado = await thermal.getThermalPrinterStatus();
    console.log('=== Estado de la impresora ===');
    console.log(JSON.stringify({
      configurada: estado.configured,
      nombre: estado.printerName,
      interface: estado.interface,
      conectada: estado.connected,
      instaladas: estado.printers,
      error: estado.error || null,
    }, null, 2));

    // Turno de prueba con faltante, para ejercitar la línea condicional.
    const payload = buildCierreCajaPayload({
      turno: {
        id_turno: 77,
        monto_apertura: 50,
        apertura_at: new Date(Date.now() - 7 * 3600 * 1000).toISOString(),
      },
      totalesPagos: { efectivo: 128.3, yape: 42.5, tarjeta: 0 },
      efectivoReal: 173.3,
      yapeReal: 42.5,
      difTotal: -5,
      observacion: 'Prueba de impresion directa a la termica al cerrar turno de caja.',
      user: { nombres: 'EDGAR', apellidos: 'SICCHA PRUEBA', sucursales: { nombre_comercial: 'La Esperanza' } },
    });

    console.log('\n=== Payload que viaja por IPC ===');
    console.log(JSON.stringify(payload, null, 2));

    if (!IMPRIMIR) {
      console.log('\n(sin --imprimir: no se mandó papel)');
      app.exit(0);
      return;
    }

    console.log('\n=== printThermalTicket (mismo camino que el ticket de venta) ===');
    const res = await thermal.printThermalTicket(payload);
    console.log(JSON.stringify(res, null, 2));
    console.log(res.ok ? 'OK voucher enviado a la térmica' : 'FALLO no se pudo imprimir');
    app.exit(res.ok ? 0 : 1);
  } catch (err) {
    console.error('FALLO prueba:', err?.stack || err?.message || err);
    app.exit(1);
  }
});
