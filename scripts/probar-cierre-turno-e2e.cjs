/**
 * Prueba de punta a punta del cierre de turno: abre un turno de PRUEBA, lo cierra
 * desde la pantalla real (Dashboard → "Cerrar mi caja") y verifica que:
 *   1. el voucher sale por la térmica (IPC print-ticket con tipoDocumento CIERRE_CAJA),
 *   2. nadie llama window.print() → no aparece el diálogo de impresión de Windows,
 *   3. no se abre ninguna ventana nueva.
 * Al final borra el turno de prueba para no dejar rastro en los reportes.
 *
 * Necesita el servidor de Vite arriba (npm run electron:dev).
 *   npx electron scripts/probar-cierre-turno-e2e.cjs
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const URL_BASE = process.env.CAPTURA_URL || 'http://localhost:5173';
const PRELOAD = path.join(RAIZ, 'dist-electron/preload.cjs');
const SALIDA = path.join(__dirname, 'cierre-turno-e2e.png');
const ID_ADMIN = 5;
const ID_SUCURSAL = 1;
const APERTURA = 50;

const env = Object.fromEntries(
  fs.readFileSync(path.join(RAIZ, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const REST = `${env.VITE_SUPABASE_URL}/rest/v1`;
const cabeceras = {
  apikey: env.VITE_SUPABASE_ANON_KEY,
  Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
};

async function rest(ruta, opciones = {}) {
  const res = await fetch(`${REST}/${ruta}`, { ...opciones, headers: { ...cabeceras, ...opciones.headers } });
  const texto = await res.text();
  if (!res.ok) throw new Error(`${ruta} → HTTP ${res.status} ${texto}`);
  return texto ? JSON.parse(texto) : null;
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function esperarJs(win, expresion, timeoutMs = 30000, etiqueta = expresion) {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    if (await win.webContents.executeJavaScript(expresion)) return true;
    await esperar(300);
  }
  throw new Error(`timeout esperando ${etiqueta}`);
}

let fallos = 0;
function check(cond, msg) {
  if (cond) console.log(`OK ${msg}`);
  else { console.error(`FALLO ${msg}`); fallos++; }
}

// Registro de lo que pasó por IPC y de ventanas creadas.
const trabajosImpresion = [];
let ventanasCreadas = 0;

app.commandLine.appendSwitch('force-device-scale-factor', '2');

app.whenReady().then(async () => {
  let idTurno = null;
  let win;
  try {
    const thermal = await import(
      'file://' + path.join(RAIZ, 'electron/printers/thermal.js').replace(/\\/g, '/')
    );

    // Mismo handler que electron/main.js — este es el camino real de impresión.
    ipcMain.handle('print-ticket', async (_e, payload) => {
      trabajosImpresion.push(payload);
      console.log(`[e2e] IPC print-ticket → tipoDocumento=${payload?.tipoDocumento || 'VENTA'}`);
      return thermal.printThermalTicket(payload || {});
    });
    ipcMain.handle('printer-status', () => thermal.getThermalPrinterStatus());
    // Stubs de lo que la app consulta al arrancar y no interviene en esta prueba.
    const stubs = {
      'printers:list': () => thermal.listInstalledPrinters(),
      'printers:getConfig': () => ({ ok: true, printerName: null }),
      'db:init': () => ({ ok: false, error: 'stub e2e' }),
      'db:path': () => null,
      'db:getMeta': () => null,
      'db:setMeta': () => ({ ok: true }),
      'db:catalogCount': () => 0,
      'db:countPending': () => 0,
      'db:listPending': () => [],
      'db:clearSynced': () => ({ ok: true }),
      'db:searchProductos': () => [],
      'db:listUnidades': () => [],
      'nubefact:configurado': () => ({ ok: true, configurado: false }),
    };
    for (const [canal, fn] of Object.entries(stubs)) ipcMain.handle(canal, fn);

    // ── Turno de PRUEBA ──
    const abiertos = await rest('caja_turnos?estado=eq.ABIERTO&select=id_turno');
    if (abiertos.length) {
      throw new Error(`hay ${abiertos.length} turno(s) ABIERTO(s); la prueba no toca turnos reales`);
    }
    const creado = await rest('caja_turnos', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        id_sucursal: ID_SUCURSAL,
        id_usuario_vendedor: ID_ADMIN,
        apertura_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
        monto_apertura: APERTURA,
        estado: 'ABIERTO',
      }),
    });
    idTurno = creado[0].id_turno;
    console.log(`OK turno de prueba abierto: #${idTurno} (apertura S/ ${APERTURA})`);

    // ── App real, en una sesión aparte para no pisar la del usuario ──
    const admin = (await rest(
      `usuarios?select=${encodeURIComponent('*,roles(nombre),sucursales(id_sucursal,nombre_comercial,direccion,ruc,telefono)')}&id_usuario=eq.${ID_ADMIN}`,
    ))[0];
    delete admin.password_hash;

    win = new BrowserWindow({
      width: 1500,
      height: 1000,
      show: false,
      webPreferences: { preload: PRELOAD, partition: 'persist:prueba-cierre-e2e' },
    });
    win.webContents.on('did-create-window', () => { ventanasCreadas += 1; });

    await win.loadURL(`${URL_BASE}/login`);
    await win.webContents.executeJavaScript(
      `localStorage.setItem('saludFuturaUser', ${JSON.stringify(JSON.stringify(admin))}); true`,
    );
    await win.loadURL(`${URL_BASE}/dashboard`);
    await esperarJs(win, `!!window.electronAPI?.isElectron`, 20000, 'puente electronAPI');
    check(true, 'la app corre con el puente de Electron (mismo caso que el usuario)');

    // ── Espías: si algo pide imprimir por el navegador, queda registrado ──
    await win.webContents.executeJavaScript(`
      window.__spy = { print: 0, open: 0 };
      window.print = function () { window.__spy.print += 1; };
      window.open = function () { window.__spy.open += 1; return null; };
      true
    `);

    // ── Cerrar el turno desde la UI ──
    await esperarJs(
      win,
      `!![...document.querySelectorAll('button')].find(b => /Cerrar mi caja/i.test(b.textContent))`,
      30000,
      'botón "Cerrar mi caja"',
    );
    await win.webContents.executeJavaScript(`
      [...document.querySelectorAll('button')].find(b => /Cerrar mi caja/i.test(b.textContent)).click(); true
    `);
    await esperarJs(win, `!!document.querySelector('form.apertura-body-modern')`, 15000, 'modal de cierre');
    console.log('OK modal de cierre abierto');

    // Efectivo 45 con esperado 50 → faltante de 5, para ejercitar esa línea del voucher.
    const datos = await win.webContents.executeJavaScript(`
      (() => {
        const form = document.querySelector('form.apertura-body-modern');
        const inputs = [...form.querySelectorAll('input[type=number]')];
        const set = (input, valor) => {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(input, valor);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        };
        set(inputs[0], '45');
        set(inputs[1], '0');
        return { inputs: inputs.length, esperado: form.textContent.match(/Esperado: S\\/ [\\d.]+/g) };
      })()
    `);
    console.log('OK montos ingresados en el modal:', JSON.stringify(datos));

    await win.webContents.executeJavaScript(`
      document.querySelector('form.apertura-body-modern button[type=submit]').click(); true
    `);

    // ── Resultado ──
    await esperarJs(win, `window.__spy && ${'true'}`, 5000);
    const limite = Date.now() + 45000;
    while (Date.now() < limite && !trabajosImpresion.length) await esperar(400);
    await esperar(2500);

    const spy = await win.webContents.executeJavaScript(`window.__spy`);
    const aviso = await win.webContents.executeJavaScript(
      `document.querySelector('.asm-card, .alerta-sistema, [role=dialog]')?.textContent?.trim()?.slice(0, 400) || '(sin aviso)'`,
    );

    console.log('\n=== Resultado ===');
    console.log('trabajos por IPC:', trabajosImpresion.length);
    console.log('espías del renderer:', JSON.stringify(spy));
    console.log('aviso en pantalla:', aviso);

    check(trabajosImpresion.length === 1, 'se mandó 1 trabajo de impresión por IPC');
    check(
      trabajosImpresion[0]?.tipoDocumento === 'CIERRE_CAJA',
      'el trabajo es el voucher de cierre (tipoDocumento CIERRE_CAJA)',
    );
    check(spy.print === 0, 'window.print() NO se llamó → no apareció el diálogo de Windows');
    check(spy.open === 0, 'window.open() NO se llamó → no se abrió ventana de impresión');
    check(ventanasCreadas === 0, 'no se creó ninguna ventana hija en Electron');
    check(
      BrowserWindow.getAllWindows().length === 1,
      `sigue habiendo una sola ventana (${BrowserWindow.getAllWindows().length})`,
    );

    const cierre = trabajosImpresion[0]?.cierre;
    if (cierre) {
      console.log('\ndatos del voucher:', JSON.stringify({
        turno: cierre.turnoId,
        apertura: cierre.apertura,
        esperadoEfectivo: cierre.esperadoEfectivo,
        efectivoContado: cierre.efectivoDeclarado,
        difEfectivo: cierre.difEfectivo,
        estado: cierre.estado,
      }));
      check(cierre.difEfectivo === -5, 'el voucher registra el faltante de S/ 5.00');
      check(cierre.estado === 'CON FALTANTE', 'el voucher sale marcado CON FALTANTE');
    }

    const turnoBd = (await rest(`caja_turnos?id_turno=eq.${idTurno}&select=estado,diferencia_total,efectivo_real`))[0];
    console.log('turno en la base:', JSON.stringify(turnoBd));
    check(turnoBd?.estado === 'CERRADO', 'el turno quedó CERRADO en Supabase');

    await win.webContents.capturePage();
    await esperar(600);
    fs.writeFileSync(SALIDA, (await win.webContents.capturePage()).toPNG());
    console.log('captura →', SALIDA);
  } catch (err) {
    console.error('FALLO prueba e2e:', err?.stack || err?.message || err);
    fallos++;
  } finally {
    if (idTurno) {
      try {
        await rest(`caja_turnos?id_turno=eq.${idTurno}`, { method: 'DELETE' });
        const queda = await rest(`caja_turnos?id_turno=eq.${idTurno}&select=id_turno`);
        console.log(queda.length === 0
          ? `OK turno de prueba #${idTurno} borrado (no queda rastro)`
          : `AVISO no se pudo borrar el turno #${idTurno}`);
      } catch (err) {
        console.error(`AVISO fallo al borrar el turno #${idTurno}:`, err?.message || err);
      }
    }
    console.log(fallos === 0 ? '\nOK prueba e2e completa sin diálogos' : `\nFALLO ${fallos} verificación(es)`);
    app.exit(fallos === 0 ? 0 : 1);
  }
});
