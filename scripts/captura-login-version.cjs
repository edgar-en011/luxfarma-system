/**
 * Captura la pantalla de Login del build de producción para confirmar a simple
 * vista el número de versión que quedó empaquetado.
 *
 *   npm run preview           (en otra terminal, sirve dist/)
 *   npx electron scripts/captura-login-version.cjs
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const URL_BASE = process.env.CAPTURA_URL || 'http://localhost:4173';
const SALIDA = path.join(__dirname, 'login-version.png');

function esperar(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

app.commandLine.appendSwitch('force-device-scale-factor', '2');

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ width: 1280, height: 860, show: false });
    await win.loadURL(`${URL_BASE}/login`);
    await esperar(2500);

    const version = await win.webContents.executeJavaScript(`
      (() => {
        const el = document.querySelector('.login-version');
        // El pie queda bajo el corte: hay que bajar el ancestro que scrollea.
        let cont = el?.parentElement;
        while (cont && cont.scrollHeight <= cont.clientHeight + 4) cont = cont.parentElement;
        if (cont) cont.scrollTop = cont.scrollHeight;
        return el?.textContent?.trim() || '(no encontrado)';
      })()
    `);
    console.log(`OK texto de versión en el Login: ${version}`);

    // La primera capturePage() tras el scroll devuelve el frame anterior.
    await win.webContents.capturePage();
    await esperar(700);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(SALIDA, img.toPNG());
    console.log('OK captura →', SALIDA);
    app.exit(version.includes('0.4.6') ? 0 : 1);
  } catch (err) {
    console.error('FALLO captura:', err?.message || err);
    app.exit(1);
  }
});
