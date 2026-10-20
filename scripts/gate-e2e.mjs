#!/usr/bin/env node
/**
 * Prueba de integración del **candado de registro** en un navegador real.
 *
 * La decisión de habilitar compartir/guardar vive en dos pantallas —la ficha y
 * las tarjetas del listado— y depende de estado que solo existe en el cliente:
 * `localStorage` (registro del dispositivo) y la hidratación de React. Un test
 * de unidad puede probar `shareGateDecision`, pero no responder la pregunta que
 * importa: **¿qué pasa cuando una visita aprieta el corazón o «Copiar» en la
 * app servida?**
 *
 * Por eso este runner sigue el mismo criterio que `audit-a11y.mjs`: arranca la
 * app, abre Chrome por CDP (el `WebSocket` global de Node 24) y opera la página
 * como lo haría una persona, sin sumar Playwright ni descargar navegadores.
 *
 *   npm run test:e2e:gate
 *   npm run test:e2e:gate -- --base http://localhost:3000   # reusa un servidor
 *   npm run test:e2e:gate -- --json
 *
 * Qué comprueba:
 *
 * | Escenario            | Acción                         | Se espera                          |
 * |----------------------|--------------------------------|------------------------------------|
 * | ficha, sin registro  | WhatsApp / Copiar / Compartir  | aviso con el título de esa acción  |
 * | ficha, sin registro  | Guardar                        | aviso y el favorito no se guarda   |
 * | ficha, sin registro  | «Inscribirme»                  | se abre el modal de registro       |
 * | tarjeta, sin registro| corazón                        | aviso y `rix7_favorites` sigue vacío |
 * | con registro         | corazón de la tarjeta          | pasa a «Quitar de favoritos»       |
 * | con registro         | Navbar y ficha                 | contador 1 y la ficha dice «Guardado» |
 * | ficha, con registro  | WhatsApp                       | POST /api/share/event con su identidad |
 * | landing, con registro| WhatsApp + CTA                 | evento source=landing y enlace a /empresas/<corredora> |
 * | landing, sin registro| Copiar                         | aviso de registro                  |
 *
 * El catálogo sin Supabase sirve `scl-depto-marco-polo`, que es la ficha que
 * usa la auditoría a11y: así el runner funciona igual en CI, donde la build se
 * compila sin `.env*`.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Ficha del catálogo local, también usada por `audit-a11y.mjs`. */
export const FICHA_PATH = '/properties/scl-depto-marco-polo';

/** Claves de `localStorage` que manipula la prueba. */
export const REGISTRATION_KEY = 'rix7_contact_registration';
export const FAVORITES_KEY = 'rix7_favorites';

/** Identidad con la que se simula una visita ya registrada. */
export const REGISTRATION_SEED = {
  name: 'Ana Prueba',
  email: 'ana.prueba@example.com',
  phone: '+56911111111',
};

/** Los cuatro botones de la ficha y el aviso que debe abrir cada uno. */
export const FICHA_GATES = [
  ['WhatsApp', 'button[title="Compartir por WhatsApp"]', 'Regístrate para compartir por WhatsApp'],
  ['Copiar', 'button[title="Copiar enlace"]', 'Regístrate para copiar el enlace'],
  ['Compartir', 'button[title="Compartir"]', 'Regístrate para compartir esta propiedad'],
  ['Guardar', 'button[title*="Guardar en favoritos"]', 'Regístrate para guardar esta propiedad'],
];

/** Título del aviso al guardar desde una tarjeta del listado. */
export const CARD_GATE_TITLE = 'Regístrate para guardar esta propiedad';

// ═════════════════════════════════════════════════════════════════════════════
// Núcleo puro (probado en scripts/gate-e2e.test.ts)
// ═════════════════════════════════════════════════════════════════════════════

/** Interpreta los argumentos del runner. */
export function parseArgs(argv) {
  const args = { base: null, chrome: process.env.CHROME_PATH || null, json: false, port: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') args.json = true;
    else if (arg === '--base') args.base = argv[++i] ?? null;
    else if (arg.startsWith('--base=')) args.base = arg.slice('--base='.length);
    else if (arg === '--chrome') args.chrome = argv[++i] ?? null;
    else if (arg.startsWith('--chrome=')) args.chrome = arg.slice('--chrome='.length);
    else if (arg === '--port') args.port = Number(argv[++i]) || null;
    else if (arg.startsWith('--port=')) args.port = Number(arg.slice('--port='.length)) || null;
  }
  if (args.base) args.base = args.base.replace(/\/+$/, '');
  return args;
}

/** El registro tal como lo espera `parseStoredRegistration`. */
export function registrationJson(seed = REGISTRATION_SEED) {
  return JSON.stringify(seed);
}

/** Un check con su resultado, para poder resumir e informar. */
export function makeCheck(name, ok, detail) {
  return { name, status: ok ? 'ok' : 'fail', detail };
}

/** ¿Pasaron todas las comprobaciones? */
export function allPassed(checks) {
  return checks.length > 0 && checks.every((c) => c.status === 'ok');
}

// ═════════════════════════════════════════════════════════════════════════════
// Infraestructura: servidor, Chrome y CDP
// ═════════════════════════════════════════════════════════════════════════════

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolvePort(port));
    });
  });
}

function findChrome(explicit) {
  const candidates = explicit
    ? [explicit]
    : [
        process.env.CHROME_PATH,
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
      ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error('No encontré Chrome/Edge. Pasá la ruta con --chrome=<path> o CHROME_PATH.');
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.status > 0) return true;
    } catch {
      /* todavía no escucha */
    }
    await sleep(400);
  }
  return false;
}

async function waitForEndpoint(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return true;
    } catch {
      /* todavía no escucha */
    }
    await sleep(150);
  }
  throw new Error('Chrome no expuso el endpoint de depuración a tiempo');
}

function requireWebSocket() {
  if (typeof WebSocket !== 'function') {
    throw new Error(
      'Node sin `WebSocket` global. Usa Node 22+ (el proyecto fija Node 24 en `.nvmrc`).'
    );
  }
  return WebSocket;
}

/** Cliente CDP mínimo, el mismo patrón que `audit-a11y.mjs`. */
function connect(wsUrl) {
  const WebSocketImpl = requireWebSocket();
  const ws = new WebSocketImpl(wsUrl);
  const pending = new Map();
  const listeners = new Set();
  let nextId = 0;

  ws.addEventListener('message', (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const fn of listeners) fn(msg);
    }
  });

  const ready = new Promise((resolveReady, reject) => {
    ws.addEventListener('open', resolveReady);
    ws.addEventListener('error', () => reject(new Error('No pude abrir el WebSocket de CDP')));
  });

  return {
    ready,
    send(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolveSend, reject) => {
        pending.set(id, { resolve: resolveSend, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    /** Suscribe a un evento CDP (p. ej. `Network.requestWillBeSent`). */
    on(method, fn) {
      const listener = (msg) => {
        if (msg.method === method) fn(msg.params);
      };
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      try {
        ws.close();
      } catch {
        /* ya cerrado */
      }
    },
  };
}

async function newTab(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
  if (!res.ok) throw new Error(`No pude crear la pestaña (HTTP ${res.status})`);
  return res.json();
}

// ═════════════════════════════════════════════════════════════════════════════
// Guion de la prueba en la página
// ═════════════════════════════════════════════════════════════════════════════

async function evaluate(client, expression) {
  const res = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.exceptionDetails) {
    const d = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
    throw new Error(`Error en la página: ${d}`);
  }
  return res.result?.value;
}

/** Espera a que una expresión sea verdadera (o falla con el nombre del paso). */
/** Espera a que una condición de Node sea verdadera (para eventos de red). */
async function waitUntil(predicate, { timeout = 8000, label = 'condición' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`Se agotó el tiempo esperando ${label}`);
}

async function waitFor(client, expression, { timeout = 10000, label = 'condición' } = {}) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await evaluate(client, expression);
      if (last) return last;
    } catch {
      /* la página puede estar navegando */
    }
    await sleep(150);
  }
  throw new Error(`Se agotó el tiempo esperando ${label} (último valor: ${JSON.stringify(last)})`);
}

/**
 * Espera al documento **nuevo**.
 *
 * `document.readyState === 'complete'` por sí solo no sirve: apenas se pide la
 * navegación, el documento viejo sigue completo y la espera termina antes de
 * que llegue el nuevo. La marca en `window` desaparece con el documento, así
 * que su ausencia sí significa «este es el de después».
 */
async function waitForNewDocument(client, label) {
  await waitFor(
    client,
    `typeof window.__gateMark === 'undefined' && document.readyState === 'complete' && !!document.body`,
    { timeout: 120000, label }
  );
}

/** Navega y espera al documento nuevo. */
async function goto(client, url) {
  try {
    await evaluate(client, 'window.__gateMark = 1');
  } catch {
    /* la página puede estar en medio de otra navegación */
  }
  await client.send('Page.navigate', { url });
  await waitForNewDocument(client, `el load de ${url}`);
}

/** Recarga la página y espera al documento nuevo. */
async function reload(client, beforeReload = '') {
  try {
    await evaluate(client, `window.__gateMark = 1; ${beforeReload}; location.reload()`);
  } catch {
    /* la evaluación puede morir con el documento */
  }
  await waitForNewDocument(client, 'la recarga');
}

/**
 * Aprieta un elemento y confirma el efecto.
 *
 * El clic se repite hasta que la condición se cumple: en `next dev` la página
 * puede haber pintado el HTML del servidor antes de hidratar, y un botón sin
 * handler se ve igual que uno listo. Reintentar es lo que distingue «no pasó
 * nada» de «todavía no había React».
 */
async function clickAndWait(client, selector, condition, label) {
  const clickExpr = `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.click();
    return true;
  })()`;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    await evaluate(client, clickExpr);
    try {
      if (await waitFor(client, condition, { timeout: 1200, label })) return true;
    } catch {
      /* reintentar el clic: puede faltar hidratación */
    }
  }
  throw new Error(`El clic en ${selector} no produjo ${label}`);
}

/** Texto del diálogo abierto, o `null` si no hay ninguno. */
const dialogTitleExpr = `(() => {
  const d = document.querySelector('[role=dialog]');
  return d ? (d.querySelector('h2')?.textContent || '').trim() : null;
})()`;

/** Cierra el aviso de registro por su botón «Ahora no». */
async function dismissGate(client) {
  await evaluate(
    client,
    `[...document.querySelectorAll('[role=dialog] button')]
       .find((b) => b.textContent.includes('Ahora no'))?.click()`
  );
  await waitFor(client, `!document.querySelector('[role=dialog]')`, {
    timeout: 3000,
    label: 'que se cierre el aviso',
  });
}

/**
 * Entra al listado con un filtro: sin filtros la home muestra el carrusel.
 *
 * El clic se repite hasta que aparece la grilla: en `next dev` el HTML del
 * servidor llega antes de la hidratación y un chip sin handler no hace nada.
 */
async function openGrid(client, base) {
  await goto(client, `${base}/`);
  await waitFor(client, `!!document.querySelector('button')`, { label: 'la barra de filtros' });
  await sleep(2500); // hidratación del home (el más pesado del portal)

  const clickChip = `(() => {
    const chip = [...document.querySelectorAll('button')]
      .find((b) => b.textContent.trim().startsWith('Departamentos'));
    if (!chip) return false;
    chip.click();
    return true;
  })()`;

  const deadline = Date.now() + 40000;
  let clicked = false;
  while (Date.now() < deadline) {
    clicked = (await evaluate(client, clickChip)) || clicked;
    try {
      await waitFor(client, `!!document.querySelector('button[aria-label="Guardar propiedad"]')`, {
        timeout: 2000,
        label: 'las tarjetas del listado',
      });
      return;
    } catch {
      /* todavía sin hidratar o sin resultados: se reintenta */
    }
  }
  const estado = await evaluate(
    client,
    `(() => {
      const chips = [...document.querySelectorAll('button')]
        .map((b) => b.textContent.trim())
        .filter((t) => t.startsWith('Departamentos'));
      return { chips, tarjetas: document.querySelectorAll('a[href^="/properties/"]').length };
    })()`
  );
  throw new Error(
    clicked
      ? `La grilla de tarjetas no apareció tras aplicar «Departamentos» (${JSON.stringify(estado)})`
      : 'No encontré el filtro «Departamentos»: sin grilla no hay tarjetas'
  );
}

/** Corre todos los escenarios y devuelve los checks. */
async function runScenarios(client, base) {
  const checks = [];
  const add = (name, ok, detail) => checks.push(makeCheck(name, ok, detail));

  // ── 1. Ficha sin registro: los cuatro botones piden registro ──────────────
  await goto(client, `${base}${FICHA_PATH}`);
  await reload(
    client,
    `localStorage.removeItem(${JSON.stringify(REGISTRATION_KEY)});
     localStorage.removeItem(${JSON.stringify(FAVORITES_KEY)})`
  );
  await waitFor(client, `!!document.querySelector('button[title="Compartir por WhatsApp"]')`, {
    timeout: 60000,
    label: 'la barra de la ficha',
  });
  await sleep(1200);

  for (const [nombre, selector, esperado] of FICHA_GATES) {
    try {
      await clickAndWait(client, selector, `(${dialogTitleExpr}) === ${JSON.stringify(esperado)}`, `el aviso de ${nombre}`);
      const titulo = await evaluate(client, dialogTitleExpr);
      add(`ficha sin registro · ${nombre}`, titulo === esperado, `aviso «${titulo}»`);
      await dismissGate(client);
    } catch (error) {
      add(`ficha sin registro · ${nombre}`, false, error.message);
    }
  }

  // Guardar no debe haber tocado los favoritos.
  const favoritosAnonimos = await evaluate(
    client,
    `localStorage.getItem(${JSON.stringify(FAVORITES_KEY)})`
  );
  add(
    'ficha sin registro · el favorito no se guarda',
    favoritosAnonimos === null,
    `rix7_favorites=${favoritosAnonimos}`
  );

  // «Inscribirme» abre el registro real del layout.
  try {
    await clickAndWait(
      client,
      'button[title="Compartir por WhatsApp"]',
      `(${dialogTitleExpr}) === ${JSON.stringify(FICHA_GATES[0][2])}`,
      'el aviso de WhatsApp'
    );
    await clickAndWait(
      client,
      '[role=dialog] button',
      `(() => {
        const h = [...document.querySelectorAll('h2')].map((x) => x.textContent.trim());
        return h.includes('Regístrate en Rix7');
      })()`,
      'el modal de registro'
    );
    add('ficha sin registro · «Inscribirme» abre el registro', true, 'modal «Regístrate en Rix7»');
    await evaluate(client, `document.querySelector('[aria-label="Cerrar el registro"]')?.click()`);
    await waitFor(client, `!document.querySelector('[aria-label="Cerrar el registro"]')`, {
      timeout: 3000,
      label: 'cerrar el registro',
    });
  } catch (error) {
    add('ficha sin registro · «Inscribirme» abre el registro', false, error.message);
  }

  // ── 2. Tarjeta sin registro: el corazón avisa y no guarda ─────────────────
  try {
    await openGrid(client, base);
    await clickAndWait(
      client,
      'button[aria-label="Guardar propiedad"]',
      `(${dialogTitleExpr}) === ${JSON.stringify(CARD_GATE_TITLE)}`,
      'el aviso de la tarjeta'
    );
    add('tarjeta sin registro · el corazón abre el aviso', true, `aviso «${CARD_GATE_TITLE}»`);
    const label = await evaluate(
      client,
      `document.querySelector('button[aria-label="Guardar propiedad"], button[aria-label="Quitar de favoritos"]')?.getAttribute('aria-label')`
    );
    add('tarjeta sin registro · el corazón no cambia', label === 'Guardar propiedad', `aria-label=${label}`);
    const favoritos = await evaluate(
      client,
      `localStorage.getItem(${JSON.stringify(FAVORITES_KEY)})`
    );
    add('tarjeta sin registro · no se guarda el favorito', favoritos === null, `rix7_favorites=${favoritos}`);
    await dismissGate(client);
  } catch (error) {
    add('tarjeta sin registro · el corazón abre el aviso', false, error.message);
  }

  // ── 3. Con registro: guardar desde la tarjeta se refleja en todas partes ──
  try {
    // La grilla vuelve a montarse porque `openGrid` navega de cero: el filtro
    // vive en el estado del cliente, no en la URL.
    await evaluate(
      client,
      `localStorage.setItem(${JSON.stringify(REGISTRATION_KEY)}, ${JSON.stringify(
        registrationJson()
      )})`
    );
    await openGrid(client, base);
    await sleep(1200);

    const href = await evaluate(
      client,
      `(() => {
        const heart = document.querySelector('button[aria-label="Guardar propiedad"]');
        return heart?.closest('a')?.getAttribute('href') ?? null;
      })()`
    );
    await clickAndWait(
      client,
      'button[aria-label="Guardar propiedad"]',
      `!!document.querySelector('button[aria-label="Quitar de favoritos"]')`,
      'que el corazón quede marcado'
    );
    add('tarjeta con registro · el corazón guarda', true, 'aria-label=Quitar de favoritos');

    const badge = await evaluate(
      client,
      `document.querySelector('a[href="/favoritos"] span')?.textContent.trim() ?? null`
    );
    add('tarjeta con registro · el Navbar cuenta 1', badge === '1', `contador=${badge}`);

    if (href) {
      await goto(client, `${base}${href}`);
      await waitFor(client, `!!document.querySelector('button[title*="Quitar de favoritos"]')`, {
        timeout: 60000,
        label: 'la ficha con el favorito guardado',
      });
      add('tarjeta con registro · la ficha dice Guardado', true, href);
    } else {
      add('tarjeta con registro · la ficha dice Guardado', false, 'no pude leer el enlace de la tarjeta');
    }
  } catch (error) {
    add('tarjeta con registro · el corazón guarda', false, error.message);
  }

  // ── 4. Con registro: compartir deja el evento con identidad ──────────────
  //
  // Se observa la petición real (no el estado interno) porque el contrato es
  // justamente que el portal avise al servidor con quién compartió. El evento
  // se guarda en el proceso de desarrollo, así que alcanza con ver el POST.
  const shareRequests = [];
  client.on('Network.requestWillBeSent', (params) => {
    const url = params?.request?.url ?? '';
    if (url.includes('/api/share/event')) shareRequests.push(params.request);
  });

  try {
    await goto(client, `${base}${FICHA_PATH}`);
    await waitFor(client, `!!document.querySelector('button[title="Compartir por WhatsApp"]')`, {
      timeout: 60000,
      label: 'la barra de la ficha con registro',
    });
    await sleep(1200);

    await evaluate(client, `document.querySelector('button[title="Compartir por WhatsApp"]')?.click()`);
    const request = await waitUntil(
      () => shareRequests.find((r) => (r.postData ?? '').includes('"channel":"whatsapp"')),
      { label: 'el POST de /api/share/event' }
    );
    const body = JSON.parse(request.postData || '{}');
    add(
      'ficha con registro · compartir registra el evento',
      body.property_id === 'scl-depto-marco-polo' && body.source === 'ficha',
      `channel=${body.channel} source=${body.source}`
    );
    add(
      'ficha con registro · el evento lleva la identidad y el enlace',
      body.name === REGISTRATION_SEED.name &&
        body.email === REGISTRATION_SEED.email &&
        String(body.share_url || '').includes('/compartir/scl-depto-marco-polo'),
      `name=${body.name} url=${body.share_url}`
    );
  } catch (error) {
    add('ficha con registro · compartir registra el evento', false, error.message);
  }

  // ── 5. Landing: resumen enlazado a la publicación y reenvío registrado ────
  try {
    shareRequests.length = 0;
    await goto(client, `${base}/compartir/scl-depto-marco-polo`);
    await waitFor(
      client,
      `!!document.querySelector('button[title="Compartir esta ficha por WhatsApp"]')`,
      { timeout: 60000, label: 'la landing de la propiedad' }
    );
    await sleep(1200);

    // El resumen tiene que llevar a la publicación de la corredora dueña.
    const cta = await evaluate(
      client,
      `!!document.querySelector('a[href="/empresas/catedral"]')`
    );
    add(
      'landing · enlaza a la publicación de la corredora',
      cta === true,
      'a[href="/empresas/catedral"]'
    );

    // La landing es también un punto de reenvío: queda registrado como tal.
    await evaluate(
      client,
      `document.querySelector('button[title="Compartir esta ficha por WhatsApp"]')?.click()`
    );
    const request = await waitUntil(
      () => shareRequests.find((r) => (r.postData ?? '').includes('"source":"landing"')),
      { label: 'el reenvío desde la landing' }
    );
    const body = JSON.parse(request.postData || '{}');
    add(
      'landing con registro · el reenvío se registra',
      body.channel === 'whatsapp' && body.property_id === 'scl-depto-marco-polo',
      `channel=${body.channel} source=${body.source}`
    );
  } catch (error) {
    add('landing con registro · el reenvío se registra', false, error.message);
  }

  // ── 6. Landing sin registro: compartir pide registrarse ──────────────────
  try {
    await goto(client, `${base}/compartir/scl-depto-marco-polo`);
    await reload(client, `localStorage.removeItem(${JSON.stringify(REGISTRATION_KEY)})`);
    await waitFor(client, `!!document.querySelector('button[title="Copiar enlace de esta ficha"]')`, {
      timeout: 60000,
      label: 'la barra de la landing',
    });
    await sleep(1200);

    await clickAndWait(
      client,
      'button[title="Copiar enlace de esta ficha"]',
      `(${dialogTitleExpr}) === ${JSON.stringify('Regístrate para copiar el enlace')}`,
      'el aviso de registro de la landing'
    );
    add(
      'landing sin registro · copiar pide registrarse',
      true,
      'aviso «Regístrate para copiar el enlace»'
    );
    await dismissGate(client);
  } catch (error) {
    add('landing sin registro · copiar pide registrarse', false, error.message);
  }

  return checks;
}

// ═════════════════════════════════════════════════════════════════════════════
// Runner
// ═════════════════════════════════════════════════════════════════════════════

function renderReport(checks, base, { startedServer }) {
  const lines = ['', `== Candado de registro · ${base} ==`, ''];
  if (startedServer) lines.push('  · servidor de desarrollo propio (se apaga al terminar)', '');
  for (const c of checks) {
    lines.push(`  ${c.status === 'ok' ? '✓' : '✗'} ${c.name} — ${c.detail}`);
  }
  const failed = checks.filter((c) => c.status !== 'ok');
  lines.push('');
  lines.push(
    failed.length
      ? `  ${failed.length} de ${checks.length} comprobaciones fallaron.`
      : `  Las ${checks.length} comprobaciones pasaron.`
  );
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const chromePath = findChrome(args.chrome);
  const chromePort = await freePort();
  const userDataDir = mkdtempSync(join(tmpdir(), 'rix7-gate-'));

  let server = null;
  let base = args.base;
  let startedServer = false;

  if (!base) {
    const port = args.port ?? (await freePort());
    base = `http://localhost:${port}`;
    startedServer = true;
    server = spawn(
      process.execPath,
      [join(ROOT, 'scripts', 'dev.mjs'), '--port', String(port)],
      {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
      }
    );
    server.stdout?.on('data', () => {});
    server.stderr?.on('data', () => {});

    const ready = await waitForHttp(`${base}/`, 240000);
    if (!ready) {
      killTree(server);
      throw new Error(`El servidor no respondió a tiempo en ${base}`);
    }
  } else {
    const ready = await waitForHttp(`${base}/`, 30000);
    if (!ready) throw new Error(`No hay servidor en ${base}`);
  }

  const chrome = spawn(
    chromePath,
    [
      '--headless=new',
      // Tamaño de escritorio: la grilla virtualizada necesita alto real; con la
      // ventana mínima de Chrome el contenedor mide cero y no pinta tarjetas.
      '--window-size=1440,900',
      `--remote-debugging-port=${chromePort}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      '--hide-scrollbars',
      '--mute-audio',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  let checks = [];
  try {
    await waitForEndpoint(chromePort);
    const tab = await newTab(chromePort);
    const client = connect(tab.webSocketDebuggerUrl);
    await client.ready;
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    // Para comprobar que compartir deja el registro en /api/share/event.
    await client.send('Network.enable');

    checks = await runScenarios(client, base);
    client.close();
  } finally {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      chrome.kill('SIGKILL');
    }
    killTree(server);
    await sleep(300);
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      /* Windows puede retener el perfil un instante */
    }
  }

  if (args.json) console.log(JSON.stringify({ base, checks }, null, 2));
  else console.log(renderReport(checks, base, { startedServer }));

  if (!allPassed(checks)) process.exitCode = 1;
}

// Solo corre al ejecutarse: los tests importan el núcleo puro.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`\n✖ ${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  });
}
