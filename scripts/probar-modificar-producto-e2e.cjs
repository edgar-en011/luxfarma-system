/**
 * Prueba de punta a punta de "Modificar Producto" DENTRO del modal de Compras.
 *
 * Crea un producto de prueba y, campo por campo, desde la pantalla real:
 *   Compras → "+ Agregar producto" → busca el producto → "Modificar Producto"
 *   → cambia UN solo campo → guarda → confirma.
 * Después de cada campo verifica en Supabase que:
 *   1. el campo cambiado quedó guardado de verdad (no solo el mensaje de éxito),
 *   2. NINGÚN otro campo se borró ni cambió de rebote,
 * y reabre el modal para confirmar que el formulario relee el valor persistido.
 * Al final borra el producto de prueba.
 *
 * Necesita el servidor de Vite arriba (npm run electron:dev).
 *   npx electron scripts/probar-modificar-producto-e2e.cjs
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const URL_BASE = process.env.CAPTURA_URL || 'http://localhost:5173';
const PRELOAD = path.join(RAIZ, 'dist-electron/preload.cjs');
const SALIDA = path.join(__dirname, 'modificar-producto-e2e.png');
const ID_ADMIN = 5;

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
  let ultimo = null;
  while (Date.now() < limite) {
    ultimo = await win.webContents.executeJavaScript(expresion);
    if (ultimo) return ultimo;
    await esperar(250);
  }
  throw new Error(`timeout esperando ${etiqueta}`);
}

let fallos = 0;
const resultados = [];
function check(cond, msg) {
  if (cond) console.log(`  OK ${msg}`);
  else { console.error(`  FALLO ${msg}`); fallos++; }
  return !!cond;
}

/** Columnas del formulario, en el orden en que aparecen en pantalla. */
const CAMPOS_PRODUCTO = [
  'descripcion', 'codigo_barras', 'principio_activo', 'id_familia', 'id_laboratorio',
  'id_presentacion', 'fraccion', 'dolencias', 'stock_minimo', 'cod_digemid',
  'tipo_item', 'ubicacion', 'rotar', 'inafecto', 'requiere_receta',
];

app.commandLine.appendSwitch('force-device-scale-factor', '1');

app.whenReady().then(async () => {
  let idProducto = null;
  let win;
  try {
    // ── Stubs de IPC (la app los consulta al arrancar; no intervienen acá) ──
    const stubs = {
      'print-ticket': () => ({ ok: true }),
      'printer-status': () => ({ ok: true, printerName: null }),
      'printers:list': () => [],
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

    // ── Catálogos: dos valores distintos por FK, para que el cambio sea real ──
    const labs = await rest('laboratorios?select=id_laboratorio,nombre&activo=eq.1&order=id_laboratorio&limit=2');
    const fams = await rest('familias?select=idfamilia,nombre&order=idfamilia&limit=2');
    const pres = await rest('presentaciones?select=id_presentacion,nombre&order=id_presentacion&limit=2');
    if (labs.length < 2 || fams.length < 2 || pres.length < 2) {
      throw new Error('se necesitan al menos 2 laboratorios, 2 familias y 2 presentaciones');
    }

    const INICIAL = {
      codigo_barras: '9900000000001',
      descripcion: 'ZZZ AUDITORIA CAMPOS COMPRAS',
      id_familia: fams[0].idfamilia,
      id_laboratorio: labs[0].id_laboratorio,
      id_presentacion: pres[0].id_presentacion,
      principio_activo: 'PA INICIAL',
      fraccion: 10,
      dolencias: 'DOLENCIA INICIAL',
      stock_minimo: 5,
      rotar: false,
      cod_digemid: 'DIG-INI',
      tipo_item: 'PRODUCTO',
      ubicacion: 'ESTANTE INICIAL',
      inafecto: false,
      requiere_receta: false,
    };

    // ── Producto de prueba ──
    const maxProd = await rest('productos?select=id_producto&order=id_producto.desc&limit=1');
    idProducto = (maxProd[0]?.id_producto || 0) + 1;
    await rest('productos', {
      method: 'POST',
      body: JSON.stringify({ id_producto: idProducto, ...INICIAL, activo: 1 }),
    });
    const maxPre = await rest('producto_precios?select=id_precio&order=id_precio.desc&limit=1');
    await rest('producto_precios', {
      method: 'POST',
      body: JSON.stringify({
        id_precio: (maxPre[0]?.id_precio || 0) + 1,
        id_producto: idProducto,
        costo: 1.5,
        precio_venta: 3.5,
      }),
    });
    console.log(`OK producto de prueba #${idProducto} creado ("${INICIAL.descripcion}")\n`);

    // ── App real ──
    const admin = (await rest(
      `usuarios?select=${encodeURIComponent('*,roles(nombre),sucursales(id_sucursal,nombre_comercial,direccion,ruc,telefono)')}&id_usuario=eq.${ID_ADMIN}`,
    ))[0];
    delete admin.password_hash;

    win = new BrowserWindow({
      width: 1600,
      height: 1050,
      show: false,
      webPreferences: { preload: PRELOAD, partition: 'persist:prueba-modprod-e2e' },
    });
    await win.loadURL(`${URL_BASE}/login`);
    await win.webContents.executeJavaScript(
      `localStorage.setItem('saludFuturaUser', ${JSON.stringify(JSON.stringify(admin))}); true`,
    );
    await win.loadURL(`${URL_BASE}/admin-compras`);
    await esperarJs(win, `!!window.electronAPI?.isElectron`, 20000, 'puente electronAPI');

    // ── Helpers dentro de la página ──
    await win.webContents.executeJavaScript(`
      window.__t = (() => {
        const setValor = (el, valor) => {
          const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype
            : el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(valor));
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        const card = () => document.querySelector('.pfm-card');
        // Ubica el control por el texto de su etiqueta. Los checkboxes viven DENTRO
        // de su propia etiqueta; el resto, como hermano dentro del mismo grupo.
        const control = (textoLabel) => {
          const c = card();
          if (!c) return null;
          const t = textoLabel.toLowerCase();
          const labels = [...c.querySelectorAll('label')];
          const l = labels.find((x) => x.textContent.trim().toLowerCase().startsWith(t));
          if (!l) return null;
          return l.querySelector('input, select, textarea')
            || l.parentElement?.querySelector('input, select, textarea')
            || null;
        };
        const clickTexto = (sel, re) => {
          const b = [...document.querySelectorAll(sel)].find((x) => new RegExp(re, 'i').test(x.textContent));
          if (b) { b.click(); return true; }
          return false;
        };
        return {
          setValor, card, control, clickTexto,
          tab: (re) => clickTexto('.pfm-tab-btn', re),
          // Lee del DOM lo que muestra el formulario, para comparar contra la base.
          leerFormulario: () => {
            const v = (t) => { const el = control(t); if (!el) return null; return el.type === 'checkbox' ? el.checked : el.value; };
            return {
              descripcion: v('Descripción'),
              codigo_barras: v('Código de Barras'),
              principio_activo: v('Principio Activo'),
              id_familia: v('Familia'),
              id_presentacion: v('Presentación'),
              fraccion: v('Fracción'),
              costo: v('Precio Costo Base'),
              precio_venta: v('Precio Venta Público'),
              dolencias: v('Dolencias'),
              stock_minimo: v('Stock Mínimo'),
              cod_digemid: v('Cód. DIGEMID'),
              tipo_item: v('Tipo'),
              ubicacion: v('Ubicación'),
              rotar: v('Rotar'),
              inafecto: v('Inafecto'),
              requiere_receta: v('Requiere receta'),
              laboratorio_chip: card()?.querySelector('.pfm-lab-select .ss-chip-text')?.textContent?.trim() || null,
            };
          },
        };
      })();
      true
    `);

    // ── Abrir modal de compra y seleccionar el producto de prueba ──
    async function abrirModalCompraYSeleccionar() {
      await esperarJs(win, `window.__t.clickTexto('button.btn-add-product', 'Agregar producto')`, 30000, 'botón "+ Agregar producto"');
      await esperarJs(win, `!!document.querySelector('.popup-search-row input')`, 15000, 'buscador del modal');
      await win.webContents.executeJavaScript(`
        (() => {
          const i = document.querySelector('.popup-search-row input');
          window.__t.setValor(i, ${JSON.stringify(INICIAL.descripcion)});
          i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          return true;
        })()
      `);
      await esperarJs(win, `document.querySelectorAll('.res-row').length > 0`, 25000, 'resultados de búsqueda');
      await win.webContents.executeJavaScript(`document.querySelector('.res-row').click(); true`);
      await esperar(900);
    }

    async function abrirModificarProducto() {
      await esperarJs(win, `window.__t.clickTexto('button', 'Modificar Producto')`, 15000, 'botón "Modificar Producto"');
      // El formulario precarga leyendo de la base: se espera a que llegue la descripción.
      await esperarJs(
        win,
        `!!window.__t.card() && !!window.__t.control('Descripción')?.value`,
        15000,
        'formulario precargado',
      );
      await esperar(400);
    }

    /** Guarda y atiende las dos alertas: confirmación y resultado. */
    async function guardarFormulario() {
      await win.webContents.executeJavaScript(
        `window.__t.card().querySelector('button[type=submit]').click(); true`,
      );
      const textoAlerta = await esperarJs(
        win,
        `document.querySelector('.asm-card')?.textContent || ''`,
        15000,
        'alerta de confirmación',
      );
      if (/Seguro que quieres guardar/i.test(textoAlerta)) {
        await win.webContents.executeJavaScript(`document.querySelector('.asm-btn-ok').click(); true`);
      } else {
        // Validación bloqueó el guardado (campo obligatorio vacío, duplicado, etc.)
        await win.webContents.executeJavaScript(`document.querySelector('.asm-btn-ok').click(); true`);
        return { ok: false, mensaje: textoAlerta.trim() };
      }
      const resultado = await esperarJs(
        win,
        `document.querySelector('.asm-card')?.textContent || ''`,
        20000,
        'alerta de resultado',
      );
      await win.webContents.executeJavaScript(`document.querySelector('.asm-btn-ok')?.click(); true`);
      await esperar(700);
      return { ok: /con éxito/i.test(resultado), mensaje: resultado.trim() };
    }

    const leerBd = async () => (await rest(
      `productos?id_producto=eq.${idProducto}&select=${CAMPOS_PRODUCTO.join(',')},laboratorios(nombre)`,
    ))[0];

    await abrirModalCompraYSeleccionar();
    console.log('OK modal "Agregar producto a la compra" abierto y producto seleccionado\n');

    // ── Casos: un campo por vuelta ──
    const CASOS = [
      { campo: 'descripcion', label: 'Descripción', tab: 'Datos', tipo: 'texto', valor: 'ZZZ AUDITORIA CAMPOS COMPRAS MOD', esperado: 'ZZZ AUDITORIA CAMPOS COMPRAS MOD' },
      { campo: 'codigo_barras', label: 'Código de Barras', tab: 'Datos', tipo: 'texto', valor: '9900000000777', esperado: '9900000000777' },
      { campo: 'principio_activo', label: 'Principio Activo', tab: 'Datos', tipo: 'texto', valor: 'PA MODIFICADO', esperado: 'PA MODIFICADO' },
      { campo: 'id_familia', label: 'Familia', tab: 'Datos', tipo: 'select', valor: String(fams[1].idfamilia), esperado: fams[1].idfamilia },
      { campo: 'id_laboratorio', label: 'Laboratorio', tab: 'Datos', tipo: 'lab', valor: labs[1].nombre, esperado: labs[1].id_laboratorio },
      // Mismo campo, elegido con el teclado en vez del ratón: es el camino que usa el
      // usuario y el que reprodujo el bug del laboratorio que no se guardaba.
      { campo: 'id_laboratorio', etiqueta: 'id_laboratorio (teclado)', label: 'Laboratorio', tab: 'Datos', tipo: 'lab-teclado', valor: labs[0].nombre, esperado: labs[0].id_laboratorio },
      { campo: 'id_presentacion', label: 'Presentación', tab: 'Datos', tipo: 'select', valor: String(pres[1].id_presentacion), esperado: pres[1].id_presentacion },
      { campo: 'fraccion', label: 'Fracción', tab: 'Datos', tipo: 'texto', valor: '20', esperado: 20 },
      { campo: 'dolencias', label: 'Dolencias', tab: 'Adicional', tipo: 'texto', valor: 'DOLENCIA MODIFICADA', esperado: 'DOLENCIA MODIFICADA' },
      { campo: 'stock_minimo', label: 'Stock Mínimo', tab: 'Adicional', tipo: 'texto', valor: '9', esperado: 9 },
      { campo: 'cod_digemid', label: 'Cód. DIGEMID', tab: 'Adicional', tipo: 'texto', valor: 'DIG-MOD', esperado: 'DIG-MOD' },
      { campo: 'tipo_item', label: 'Tipo', tab: 'Adicional', tipo: 'select', valor: 'SERVICIO', esperado: 'SERVICIO' },
      { campo: 'ubicacion', label: 'Ubicación', tab: 'Adicional', tipo: 'texto', valor: 'ESTANTE MODIFICADO', esperado: 'ESTANTE MODIFICADO' },
      { campo: 'rotar', label: 'Rotar', tab: 'Adicional', tipo: 'check', esperado: true },
      { campo: 'inafecto', label: 'Inafecto', tab: 'Adicional', tipo: 'check', esperado: true },
      { campo: 'requiere_receta', label: 'Requiere receta', tab: 'Adicional', tipo: 'check', esperado: true },
    ];

    for (const caso of CASOS) {
      console.log(`── Campo: ${caso.campo} ──`);
      const antes = await leerBd();
      await abrirModificarProducto();
      await win.webContents.executeJavaScript(`window.__t.tab(${JSON.stringify(caso.tab)}); true`);
      await esperar(250);

      if (caso.tipo === 'lab' || caso.tipo === 'lab-teclado') {
        // El desplegable se abre con click en el control.
        await win.webContents.executeJavaScript(
          `window.__t.card().querySelector('.pfm-lab-select .ss-control').click(); true`,
        );
        await esperarJs(win, `!!window.__t.card().querySelector('.pfm-lab-select .ss-input')`, 8000, 'input del select de laboratorio');

        if (caso.tipo === 'lab') {
          // Camino con ratón: escribir para filtrar y elegir la opción.
          // Las opciones responden a mousedown (no a click), igual que un ratón real.
          await win.webContents.executeJavaScript(`
            window.__t.setValor(window.__t.card().querySelector('.pfm-lab-select .ss-input'), ${JSON.stringify(caso.valor)});
            true
          `);
          await esperarJs(
            win,
            `[...window.__t.card().querySelectorAll('.pfm-lab-select li[role=option]')].some(o => o.textContent.trim().startsWith(${JSON.stringify(caso.valor)}))`,
            8000,
            `opción "${caso.valor}" en el desplegable`,
          );
          await win.webContents.executeJavaScript(`
            (() => {
              const li = [...window.__t.card().querySelectorAll('.pfm-lab-select li[role=option]')]
                .find(o => o.textContent.trim().startsWith(${JSON.stringify(caso.valor)}));
              li.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
              return true;
            })()
          `);
        } else {
          // Camino con teclado, SIN escribir nada: bajar hasta el laboratorio y Enter.
          // Es como trabaja el usuario en este sistema (todo el flujo es de teclado).
          const idx = await win.webContents.executeJavaScript(`
            [...window.__t.card().querySelectorAll('.pfm-lab-select li[role=option]')]
              .findIndex(o => o.textContent.trim().startsWith(${JSON.stringify(caso.valor)}))
          `);
          if (idx < 0) throw new Error(`no se encontró "${caso.valor}" en la lista de laboratorios`);
          console.log(`  (teclado: ${idx} pulsaciones de flecha abajo hasta "${caso.valor}", luego Enter)`);
          for (let i = 0; i < idx; i++) {
            await win.webContents.executeJavaScript(`
              window.__t.card().querySelector('.pfm-lab-select .ss-input')
                .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
              true
            `);
          }
          await esperar(200);
          const resaltado = await win.webContents.executeJavaScript(
            `window.__t.card().querySelector('.pfm-lab-select li.ss-option.is-active')?.textContent?.trim() || null`,
          );
          console.log(`  (opción resaltada antes de Enter: ${JSON.stringify(resaltado)})`);
          await win.webContents.executeJavaScript(`
            window.__t.card().querySelector('.pfm-lab-select .ss-input')
              .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            true
          `);
        }

        await esperar(400);
        // ¿El formulario registró el cambio ANTES de guardar? Distingue "el widget no
        // seleccionó" de "seleccionó pero el guardado no lo escribió".
        const chip = await win.webContents.executeJavaScript(
          `window.__t.card().querySelector('.pfm-lab-select .ss-chip-text')?.textContent?.trim() || null`,
        );
        console.log(`  (chip del laboratorio antes de guardar: ${JSON.stringify(chip)})`);
        check(chip === caso.valor, `el formulario tomó el laboratorio "${caso.valor}" antes de guardar`);
      } else if (caso.tipo === 'check') {
        await win.webContents.executeJavaScript(
          `window.__t.control(${JSON.stringify(caso.label)}).click(); true`,
        );
      } else {
        await win.webContents.executeJavaScript(`
          window.__t.setValor(window.__t.control(${JSON.stringify(caso.label)}), ${JSON.stringify(caso.valor)});
          true
        `);
      }
      await esperar(250);

      const guardado = await guardarFormulario();
      check(guardado.ok, `guardado aceptado ("${guardado.mensaje.slice(0, 60)}")`);

      // 1. ¿Persistió el campo?
      const despues = await leerBd();
      const real = despues[caso.campo];
      const persiste = String(real) === String(caso.esperado);
      check(persiste, `${caso.campo}: base tiene ${JSON.stringify(real)} (esperado ${JSON.stringify(caso.esperado)})`);

      // 2. ¿Se dañó algún otro campo? (esto detecta el borrado silencioso)
      const colaterales = CAMPOS_PRODUCTO
        .filter((c) => c !== caso.campo)
        .filter((c) => String(antes[c]) !== String(despues[c]))
        .map((c) => `${c}: ${JSON.stringify(antes[c])} → ${JSON.stringify(despues[c])}`);
      check(colaterales.length === 0, colaterales.length === 0
        ? 'ningún otro campo se alteró'
        : `se alteraron otros campos → ${colaterales.join(' | ')}`);

      // 3. Reabrir el modal: ¿el formulario muestra el valor persistido?
      await abrirModificarProducto();
      const enForm = await win.webContents.executeJavaScript(`window.__t.leerFormulario()`);
      const mostrado = caso.tipo === 'lab' ? enForm.laboratorio_chip : enForm[caso.campo];
      const esperadoForm = caso.tipo === 'lab' ? caso.valor : caso.esperado;
      const reflejado = caso.tipo === 'check'
        ? mostrado === caso.esperado
        : String(mostrado ?? '').toUpperCase().startsWith(String(esperadoForm).toUpperCase());
      check(reflejado, `al reabrir, el formulario muestra ${JSON.stringify(mostrado)}`);
      await win.webContents.executeJavaScript(`window.__t.card().querySelector('button[type=button]')?.click(); true`);
      await esperarJs(win, `!window.__t.card()`, 8000, 'cierre del formulario');
      await esperar(300);

      resultados.push({ campo: caso.campo, persiste, sinDanio: colaterales.length === 0, reflejado });
      console.log('');
    }

    // ── El síntoma que reportó el usuario: el laboratorio en la UI de Compras ──
    console.log('── UI de Compras después de cambiar el laboratorio ──');
    const ui = await win.webContents.executeJavaScript(`
      (() => {
        const fila = [...document.querySelectorAll('.res-row')]
          .find(r => /ZZZ AUDITORIA/i.test(r.textContent));
        return {
          filaResultado: fila ? fila.textContent.trim() : null,
          sidebar: document.querySelector('.sidebar-config-area .config-label')?.textContent?.trim() || null,
        };
      })()
    `);
    console.log('  fila del buscador:', ui.filaResultado);
    check(
      ui.filaResultado && ui.filaResultado.includes(labs[1].nombre),
      `el buscador muestra el laboratorio NUEVO (${labs[1].nombre})`,
    );
    check(
      ui.filaResultado && !ui.filaResultado.includes(labs[0].nombre),
      `el buscador ya NO muestra el laboratorio viejo (${labs[0].nombre})`,
    );

    fs.writeFileSync(SALIDA, (await win.webContents.capturePage()).toPNG());
    console.log('captura →', SALIDA);

    console.log('\n=== Resumen por campo ===');
    for (const r of resultados) {
      console.log(`${r.persiste && r.sinDanio && r.reflejado ? 'OK  ' : 'FALLO'} ${r.campo.padEnd(18)} persiste=${r.persiste} sin-daño-colateral=${r.sinDanio} recarga-ok=${r.reflejado}`);
    }
  } catch (err) {
    console.error('FALLO prueba e2e:', err?.stack || err?.message || err);
    fallos++;
  } finally {
    if (idProducto) {
      try {
        await rest(`producto_formas_venta?id_producto=eq.${idProducto}`, { method: 'DELETE' });
        await rest(`producto_precios?id_producto=eq.${idProducto}`, { method: 'DELETE' });
        await rest(`productos?id_producto=eq.${idProducto}`, { method: 'DELETE' });
        const queda = await rest(`productos?id_producto=eq.${idProducto}&select=id_producto`);
        console.log(queda.length === 0
          ? `\nOK producto de prueba #${idProducto} borrado (no queda rastro)`
          : `\nAVISO quedó el producto #${idProducto}`);
      } catch (err) {
        console.error(`AVISO fallo al borrar el producto #${idProducto}:`, err?.message || err);
      }
    }
    console.log(fallos === 0 ? 'OK prueba e2e sin fallos' : `FALLO ${fallos} verificación(es)`);
    app.exit(fallos === 0 ? 0 : 1);
  }
});
