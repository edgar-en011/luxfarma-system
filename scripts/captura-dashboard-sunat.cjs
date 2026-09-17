/**
 * Captura del panel "Estado SUNAT" del Dashboard con el indicador ACEPTADOS.
 * Usa el Electron que ya es devDependency (no agrega herramientas nuevas) y el
 * servidor de Vite que corre con electron:dev.
 *
 *   npx electron scripts/captura-dashboard-sunat.cjs
 *
 * Siembra la sesión en localStorage con un admin real (misma forma que guarda
 * Login.jsx) para poder abrir /admin-dashboard sin escribir la contraseña.
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const URL_BASE = process.env.CAPTURA_URL || 'http://localhost:5173';
const SALIDA_FULL = path.join(RAIZ, 'scripts', 'dashboard-sunat-aceptados.png');
const SALIDA_PANEL = path.join(RAIZ, 'scripts', 'dashboard-sunat-panel.png');
const ROL_ADMIN = 2;

const env = Object.fromEntries(
  fs.readFileSync(path.join(RAIZ, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

async function traerAdmin() {
  const select = '*,roles(nombre),sucursales(id_sucursal,nombre_comercial,direccion,ruc,telefono)';
  const url = `${env.VITE_SUPABASE_URL}/rest/v1/usuarios?select=${encodeURIComponent(select)}&id_rol=eq.${ROL_ADMIN}&limit=1`;
  const res = await fetch(url, {
    headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}` },
  });
  if (!res.ok) throw new Error(`usuarios: HTTP ${res.status} ${await res.text()}`);
  const filas = await res.json();
  if (!filas.length) throw new Error('no hay usuario con id_rol=2 (Administrador)');
  const { password_hash: _omitido, ...usuario } = filas[0];
  return usuario;
}

function esperar(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function esperarSelector(win, selector, timeoutMs = 30000) {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    const listo = await win.webContents.executeJavaScript(
      `!!document.querySelector(${JSON.stringify(selector)})`,
    );
    if (listo) return;
    await esperar(300);
  }
  throw new Error(`timeout esperando ${selector}`);
}

async function cargar(win, url) {
  await win.loadURL(url);
  await esperar(500);
}

app.commandLine.appendSwitch('force-device-scale-factor', '2');

app.whenReady().then(async () => {
  let win;
  try {
    const admin = await traerAdmin();
    console.log(`OK admin de la captura: ${admin.nombres} ${admin.apellidos} (id_rol=${admin.id_rol})`);

    win = new BrowserWindow({
      width: 1600,
      height: 1150,
      show: false,
      webPreferences: { backgroundThrottling: false },
    });

    // Primero cualquier página del mismo origen para poder escribir localStorage;
    // en la segunda carga AuthContext ya restaura la sesión desde ahí.
    await cargar(win, `${URL_BASE}/login`);
    await win.webContents.executeJavaScript(
      `localStorage.setItem('luxfarmaUser', ${JSON.stringify(JSON.stringify(admin))}); true`,
    );

    await cargar(win, `${URL_BASE}/admin-dashboard`);
    await esperarSelector(win, '.sunat-boxes');
    // 5 indicadores = ENVIADOS / PENDIENTES / ERROR / ACEPTADOS / ANULADOS
    await esperarSelector(win, '.sunat-boxes .sunat-box:nth-child(5)');
    // Margen para que terminen los fetch del panel (conteo SUNAT) y el gráfico.
    await esperar(3500);

    const leido = await win.webContents.executeJavaScript(`
      (() => {
        const cajas = [...document.querySelectorAll('.sunat-boxes .sunat-box')].map(b => ({
          etiqueta: b.querySelector('p')?.textContent?.trim(),
          valor: b.querySelector('h2')?.textContent?.trim(),
        }));
        // El contenido del layout scrollea en su propio contenedor, no en window:
        // scrollIntoView() no alcanza, hay que ubicar el ancestro con overflow.
        const panel = document.querySelector('.sunat-panel');
        let cont = panel.parentElement;
        while (cont && cont.scrollHeight <= cont.clientHeight + 4) cont = cont.parentElement;
        let scrolled = null;
        if (cont) {
          const destino = panel.offsetTop - Math.max(0, (cont.clientHeight - panel.offsetHeight) / 2);
          cont.scrollTop = Math.max(0, destino);
          scrolled = { contenedor: cont.className || cont.tagName, scrollTop: cont.scrollTop };
        }
        return { cajas, titulo: document.querySelector('.sunat-panel h3')?.textContent?.trim(), scrolled };
      })()
    `);
    console.log('OK panel renderizado:', JSON.stringify(leido, null, 2));

    await esperar(1500);
    // La primera capturePage() tras el scroll devuelve el frame anterior (la ventana es
    // offscreen y no repinta sola): se descarta una y se usa la siguiente.
    await win.webContents.capturePage();
    await esperar(700);
    const full = await win.webContents.capturePage();
    fs.writeFileSync(SALIDA_FULL, full.toPNG());
    console.log('OK captura completa →', SALIDA_FULL);

    const rect = await win.webContents.executeJavaScript(`
      (() => {
        const p = document.querySelector('.sunat-panel');
        const r = p.getBoundingClientRect();
        return { x: Math.floor(r.x) - 12, y: Math.floor(r.y) - 12, width: Math.ceil(r.width) + 24, height: Math.ceil(r.height) + 24 };
      })()
    `);
    const panel = await win.webContents.capturePage(rect);
    fs.writeFileSync(SALIDA_PANEL, panel.toPNG());
    console.log('OK captura del panel →', SALIDA_PANEL);

    app.exit(0);
  } catch (err) {
    console.error('FALLO captura:', err?.message || err);
    app.exit(1);
  }
});
