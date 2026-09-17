/**
 * Prueba práctica de los 3 puntos: Enter del sub-modal de forma de venta,
 * resaltado tras Modificar Producto, y búsqueda en vivo desde 3 letras (POS + Compras).
 *
 *   npx electron scripts/probar-busqueda-enter-resaltado.cjs
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const URL_BASE = process.env.CAPTURA_URL || 'http://localhost:5173';
const ROL_ADMIN = 2;
const SALIDA_POS = path.join(RAIZ, 'scripts', 'pos-busqueda-viva.png');
const SALIDA_COMPRAS = path.join(RAIZ, 'scripts', 'compras-busqueda-viva.png');

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

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function esperarJs(win, expresion, timeoutMs = 25000, etiqueta = expresion) {
  const limite = Date.now() + timeoutMs;
  let ultimo = null;
  while (Date.now() < limite) {
    ultimo = await win.webContents.executeJavaScript(expresion);
    if (ultimo) return ultimo;
    await esperar(250);
  }
  throw new Error(`timeout esperando ${etiqueta} (último=${JSON.stringify(ultimo)})`);
}

async function escribirInput(win, selector, texto) {
  return win.webContents.executeJavaScript(`
    (() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!input) return { ok: false };
      const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      proto.set.call(input, ${JSON.stringify(texto)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
      return { ok: true, valor: input.value };
    })()
  `);
}

async function clickTexto(win, selector, texto) {
  return win.webContents.executeJavaScript(`
    (() => {
      const nodos = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const el = nodos.find((n) => (n.textContent || '').includes(${JSON.stringify(texto)}));
      if (!el) return false;
      el.click();
      return true;
    })()
  `);
}

async function traerAdmin() {
  const select = '*,roles(nombre),sucursales(id_sucursal,nombre_comercial,direccion,ruc,telefono)';
  const filas = await rest(`usuarios?select=${encodeURIComponent(select)}&id_rol=eq.${ROL_ADMIN}&limit=1`);
  if (!filas.length) throw new Error('no hay admin');
  const { password_hash: _omitido, ...usuario } = filas[0];
  return usuario;
}

async function sembrarSesion(win, admin) {
  await win.loadURL(`${URL_BASE}/login`);
  await esperar(400);
  await win.webContents.executeJavaScript(
    `localStorage.setItem('luxfarmaUser', ${JSON.stringify(JSON.stringify(admin))}); true`,
  );
}

let fallos = 0;
function check(cond, msg) {
  if (cond) console.log(`  OK ${msg}`);
  else { console.error(`  FALLO ${msg}`); fallos += 1; }
  return !!cond;
}

app.commandLine.appendSwitch('force-device-scale-factor', '1.25');

app.whenReady().then(async () => {
  let win;
  try {
    const admin = await traerAdmin();
    win = new BrowserWindow({
      width: 1600,
      height: 1000,
      show: false,
      webPreferences: { backgroundThrottling: false },
    });

    // ── 1) POS: 3 letras sin Enter ──
    console.log('\n[1] POS búsqueda en vivo');
    await sembrarSesion(win, admin);
    await win.loadURL(`${URL_BASE}/admin-pos`);
    await esperarJs(win, `!!document.querySelector('.pos-search-bar input')`);
    await esperar(700);
    const escritoPos = await escribirInput(win, '.pos-search-bar input', 'par');
    check(escritoPos.ok && escritoPos.valor === 'par', `POS escribió "par" (Enter no pulsado)`);
    await esperarJs(win, `document.querySelectorAll('.pos-resultado-card').length >= 2`, 20000, 'resultados POS sin Enter');
    const pos = await win.webContents.executeJavaScript(`
      (() => {
        const cards = [...document.querySelectorAll('.pos-resultado-card')].map((c) => ({
          nombre: c.querySelector('.pos-resultado-nombre')?.textContent?.trim(),
          lab: c.querySelector('.pos-resultado-lab')?.textContent?.trim(),
        }));
        return { n: cards.length, cards: cards.slice(0, 4), input: document.querySelector('.pos-search-bar input')?.value };
      })()
    `);
    check(pos.n >= 2, `POS mostró ${pos.n} resultados sin Enter`);
    console.log('   ', pos.cards.map((c) => `${c.lab} — ${c.nombre}`).join(' | '));
    await win.webContents.capturePage();
    await esperar(300);
    fs.writeFileSync(SALIDA_POS, (await win.webContents.capturePage()).toPNG());
    console.log('   captura →', SALIDA_POS);

    // ── 2 y 3) Compras: búsqueda viva + resaltado + Enter del lápiz ──
    console.log('\n[2] Compras búsqueda en vivo + resaltado + Enter forma');
    await win.loadURL(`${URL_BASE}/admin-compras`);
    await esperarJs(win, `[...document.querySelectorAll('button')].some(b => (b.textContent||'').includes('Agregar producto'))`, 25000, 'botón agregar producto');
    await esperar(800);
    check(await clickTexto(win, 'button', 'Agregar producto'), 'abrió modal Agregar producto');
    await esperarJs(win, `!!document.querySelector('.popup-search-row input')`);
    await esperar(400);
    const escritoCompras = await escribirInput(win, '.popup-search-row input', 'par');
    check(escritoCompras.ok, 'Compras escribió "par" (Enter no pulsado)');
    await esperarJs(win, `document.querySelectorAll('.popup-results-table .res-row').length >= 2`, 20000, 'resultados Compras sin Enter');
    const compras = await win.webContents.executeJavaScript(`
      (() => {
        const rows = [...document.querySelectorAll('.popup-results-table .res-row')];
        return {
          n: rows.length,
          filas: rows.slice(0, 4).map((r) => ({
            nombre: r.querySelector('.text-bold')?.textContent?.trim(),
            lab: r.querySelector('.text-muted')?.textContent?.trim(),
          })),
        };
      })()
    `);
    check(compras.n >= 2, `Compras mostró ${compras.n} resultados sin Enter`);
    console.log('   ', compras.filas.map((c) => `${c.lab} — ${c.nombre}`).join(' | '));
    await win.webContents.capturePage();
    await esperar(300);
    fs.writeFileSync(SALIDA_COMPRAS, (await win.webContents.capturePage()).toPNG());
    console.log('   captura →', SALIDA_COMPRAS);

    const segundo = await win.webContents.executeJavaScript(`
      (() => {
        const rows = [...document.querySelectorAll('.popup-results-table .res-row')];
        if (rows.length < 2) return null;
        rows[1].click();
        return {
          nombre: rows[1].querySelector('.text-bold')?.textContent?.trim(),
          idx: 1,
        };
      })()
    `);
    check(!!segundo, `seleccionó el 2º resultado: ${segundo?.nombre}`);
    await esperar(600);

    check(await clickTexto(win, 'button', 'Modificar Producto'), 'abrió Modificar Producto');
    await esperarJs(win, `[...document.querySelectorAll('button')].some(b => (b.textContent||'').includes('Guardar Producto'))`, 15000, 'modal producto');
    await esperar(900);
    check(await clickTexto(win, 'button', 'Guardar Producto'), 'Guardar Producto');
    await esperar(600);
    const hayConfirma = await win.webContents.executeJavaScript(`
      [...document.querySelectorAll('button')].map(b => (b.textContent||'').trim()).filter(Boolean)
    `);
    console.log('   botones tras Guardar:', hayConfirma.slice(0, 20).join(' | '));
    if (hayConfirma.some((t) => t.includes('Sí, guardar'))) {
      check(await clickTexto(win, 'button', 'Sí, guardar'), 'confirmó Sí, guardar');
    } else {
      check(false, `no apareció Sí, guardar (botones: ${hayConfirma.join(', ')})`);
    }
    await esperarJs(
      win,
      `![...document.querySelectorAll('button')].some(b => (b.textContent||'').includes('Guardar Producto'))`,
      25000,
      'cerró modal producto',
    );
    const okExito = await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('button')].some(b => (b.textContent||'').includes('Aceptar') || (b.className||'').includes('asm-btn-ok'))`,
    );
    if (okExito) {
      await clickTexto(win, 'button.asm-btn-ok, button.alert-btn-ok, button', 'Aceptar');
      await esperar(300);
    }
    await esperar(400);

    const resaltado = await win.webContents.executeJavaScript(`
      (() => {
        const rows = [...document.querySelectorAll('.popup-results-table .res-row')];
        const iRes = rows.findIndex((r) => r.classList.contains('resaltada'));
        const iSel = rows.findIndex((r) => r.classList.contains('selected'));
        return {
          iRes,
          iSel,
          nombreRes: rows[iRes]?.querySelector('.text-bold')?.textContent?.trim() || null,
          nombreSel: rows[iSel]?.querySelector('.text-bold')?.textContent?.trim() || null,
          esperado: ${JSON.stringify(segundo?.nombre || '')},
        };
      })()
    `);
    check(
      resaltado.nombreRes === segundo.nombre,
      `resaltado quedó en "${resaltado.nombreRes}" (esperado "${segundo.nombre}", idx=${resaltado.iRes})`,
    );
    check(resaltado.iRes !== 0 || segundo.nombre === resaltado.nombreRes, 'no saltó al primer resultado distinto');

    const lápiz = await win.webContents.executeJavaScript(`
      (() => {
        const btn = document.querySelector('button[title="Editar forma de venta"]');
        if (!btn) return { ok: false };
        btn.click();
        return { ok: true };
      })()
    `);
    check(lápiz.ok, 'abrió sub-modal Editar forma de venta');
    await esperarJs(win, `[...document.querySelectorAll('h3')].some(h => (h.textContent||'').includes('Editar forma de venta'))`);
    await esperar(200);

    const enter = await win.webContents.executeJavaScript(`
      (() => {
        const labels = [...document.querySelectorAll('label')];
        const lab = labels.find((l) => (l.textContent || '').includes('PRECIO VENTA'));
        const input = lab?.parentElement?.querySelector('input');
        if (!input) return { ok: false, error: 'sin input precio venta' };
        input.focus();
        return { ok: true };
      })()
    `);
    check(enter.ok, 'Enter en último campo del sub-modal');
    await win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    await win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    await esperar(500);
    const despuesEnter = await win.webContents.executeJavaScript(`
      (() => {
        const activo = document.activeElement;
        const cantidad = [...document.querySelectorAll('label')].find((l) => (l.textContent || '').trim().startsWith('CANTIDAD'));
        const inputCantidad = cantidad?.parentElement?.querySelector('input');
        const alerta = !!document.querySelector('.asm-overlay, .custom-alert-card');
        const tituloAlerta = document.querySelector('.asm-message, .alert-message-big')?.textContent?.trim() || '';
        const subModal = [...document.querySelectorAll('h3')].some((h) => (h.textContent || '').includes('Editar forma de venta'));
        return {
          focoEsCantidad: !!(inputCantidad && activo === inputCantidad),
          tagActivo: activo?.tagName,
          alerta,
          tituloAlerta,
          subModal,
        };
      })()
    `);
    check(!despuesEnter.focoEsCantidad, `Enter NO escapó a Cantidad (activo=${despuesEnter.tagActivo})`);
    check(despuesEnter.alerta, `apareció confirmación de guardar (${despuesEnter.tituloAlerta || 'alerta'})`);

    if (enter.alerta) {
      await clickTexto(win, 'button', 'Cancelar');
      await esperar(300);
    }

    if (fallos) {
      console.error(`\nFALLÓ con ${fallos} chequeo(s)`);
      app.exit(1);
      return;
    }
    console.log('\nOK los 3 puntos pasaron');
    app.exit(0);
  } catch (err) {
    console.error('FALLO e2e:', err?.message || err);
    app.exit(1);
  }
});
