/**
 * Captura del buscador del POS con el laboratorio visible en cada resultado.
 * Usa el Vite de electron:dev y siembra sesión admin como las otras capturas.
 *
 *   npx electron scripts/captura-pos-laboratorio.cjs
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const URL_BASE = process.env.CAPTURA_URL || 'http://localhost:5173';
const SALIDA = path.join(RAIZ, 'scripts', 'pos-buscador-laboratorio.png');
const ROL_ADMIN = 2;
const TERMINO = process.env.CAPTURA_TERMINO || 'paracetamol';

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
};

async function rest(ruta) {
  const res = await fetch(`${REST}/${ruta}`, { headers: cabeceras });
  if (!res.ok) throw new Error(`${ruta} → HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

async function traerAdmin() {
  const select = '*,roles(nombre),sucursales(id_sucursal,nombre_comercial,direccion,ruc,telefono)';
  const filas = await rest(`usuarios?select=${encodeURIComponent(select)}&id_rol=eq.${ROL_ADMIN}&limit=1`);
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
    const select = 'id_producto,descripcion,laboratorios(nombre)';
    const catalogo = await rest(
      `productos?select=${encodeURIComponent(select)}&descripcion=ilike.*${TERMINO}*&activo=eq.1&limit=20`,
    );
    const conLab = catalogo.map((p) => ({
      nombre: p.descripcion,
      laboratorio: p.laboratorios?.nombre || '(sin lab)',
    }));
    const labsDistintos = new Set(conLab.map((p) => p.laboratorio));
    console.log(`OK catálogo "${TERMINO}": ${conLab.length} productos, ${labsDistintos.size} laboratorios`);
    console.log(conLab.slice(0, 8).map((p) => `  ${p.laboratorio} — ${p.nombre}`).join('\n'));

    const admin = await traerAdmin();
    console.log(`OK admin: ${admin.nombres} ${admin.apellidos}`);

    win = new BrowserWindow({
      width: 1600,
      height: 1000,
      show: false,
      webPreferences: { backgroundThrottling: false },
    });

    await cargar(win, `${URL_BASE}/login`);
    await win.webContents.executeJavaScript(
      `localStorage.setItem('saludFuturaUser', ${JSON.stringify(JSON.stringify(admin))}); true`,
    );

    await cargar(win, `${URL_BASE}/admin-pos`);
    await esperarSelector(win, '.pos-search-bar input');
    await esperar(800);

    const buscado = await win.webContents.executeJavaScript(`
      (() => {
        const input = document.querySelector('.pos-search-bar input');
        if (!input) return { ok: false, error: 'sin input' };
        const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        proto.set.call(input, ${JSON.stringify(TERMINO)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
        input.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true,
        }));
        return { ok: true, valor: input.value };
      })()
    `);
    console.log('OK búsqueda disparada:', buscado);

    await esperarSelector(win, '.pos-resultado-lab', 20000);
    await esperar(1200);

    const leido = await win.webContents.executeJavaScript(`
      (() => {
        const cards = [...document.querySelectorAll('.pos-resultado-card')].map((c) => ({
          nombre: c.querySelector('.pos-resultado-nombre')?.textContent?.trim(),
          laboratorio: c.querySelector('.pos-resultado-lab')?.textContent?.trim(),
          meta: c.querySelector('.pos-resultado-meta')?.textContent?.trim(),
        }));
        return { cards, input: document.querySelector('.pos-search-bar input')?.value };
      })()
    `);
    console.log('OK resultados POS:', JSON.stringify(leido, null, 2));
    if (!leido.cards.length) throw new Error('el buscador no mostró resultados');
    if (leido.cards.every((c) => !c.laboratorio)) throw new Error('ningún resultado tiene laboratorio visible');

    await win.webContents.executeJavaScript(`
      [...document.querySelectorAll('div')].forEach((el) => {
        const t = el.textContent || '';
        if (!/Descargando catálogo|Catálogo listo/i.test(t)) return;
        const s = window.getComputedStyle(el);
        if (s.position === 'fixed') el.style.display = 'none';
      });
      true
    `);

    await win.webContents.capturePage();
    await esperar(500);
    const full = await win.webContents.capturePage();
    fs.writeFileSync(SALIDA, full.toPNG());
    console.log('OK captura →', SALIDA);

    app.exit(0);
  } catch (err) {
    console.error('FALLO captura:', err?.message || err);
    app.exit(1);
  }
});
