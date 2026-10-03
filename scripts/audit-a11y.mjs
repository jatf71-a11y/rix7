#!/usr/bin/env node
/**
 * Auditoría de accesibilidad (plan fase 3, 3.3) sobre las rutas reales del
 * portal usando axe-core inyectado en un Chrome/Edge local vía CDP.
 *
 * Por qué así y no Playwright/Lighthouse: es el mismo criterio de
 * `measure-vitals.mjs` — correr contra la app real (localhost o el deploy) con
 * el navegador que ya está instalado, sin sumar un runner pesado a la
 * devDependencies. axe-core es el motor de reglas WCAG de referencia (el mismo
 * que usan Lighthouse y eslint-plugin-jsx-a11y por debajo) y acá se usa
 * directamente, así el barrido es reproducible y comparable entre corridas.
 *
 * Uso:
 *   npm run check:a11y
 *   npm run check:a11y -- /legal/privacidad
 *   npm run check:a11y -- --base=https://rix7.vercel.app
 *   npm run check:a11y -- --all                 (incluye moderados y menores)
 *   npm run check:a11y -- --json
 *   npm run check:a11y -- --fail-on-serious     (exit 1 si hay críticos/serios)
 *
 * Opciones:
 *   --base=<url>        Origen a auditar (por defecto http://localhost:3000)
 *   --device=<d>        desktop (1280x800) o mobile (390x844) (por defecto desktop)
 *   --settle=<ms>       Espera tras el `load` para que carguen los datos (2500)
 *   --all               Reportar también impactos moderate/minor
 *   --fail-on-serious   Exit 1 si alguna ruta tiene hallazgos critical/serious
 *   --json              Salida JSON en vez del informe de consola
 *   --chrome=<path>     Binario de Chrome/Edge (o variable CHROME_PATH)
 *
 * Qué audita: las rutas que representan cada plantilla del portal (home
 * cliente, ficha server-render, corredora, favoritos, compartir, legal).
 *
 * Falsos positivos desactivados a propósito (documentados):
 *   - `region`: el portal es una app con mapa + listado + overlays; exigir
 *     landmarks perfectos en cada estado inunda el informe sin proteger nada.
 *
 * Nota: en `next dev` la primera visita compila la ruta; el script precalienta
 * igual que `vitals`. Para el informe de la auditoría medir contra
 * `next start` o contra producción.
 *
 * Node: la conexión CDP usa el `WebSocket` **global**, estable desde Node 22 y
 * presente en la línea 24 que fijan CI y Vercel. `requireWebSocket()` aborta con
 * un mensaje claro en vez de morir con «WebSocket is not defined» si alguna vez
 * se corre con una major anterior (en Node 20 existe, pero tras
 * `--experimental-websocket`).
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';

// ── Rutas que representan cada plantilla del portal ─────────────────────────
const DEFAULT_ROUTES = [
  '/', // home 100% cliente (la más problemática según la línea base CWV)
  '/properties/scl-depto-marco-polo', // ficha server-render con galería y mapa
  '/empresas/catedral', // corredora con listado
  '/favoritos', // estado vacío
  '/compartir/scl-depto-marco-polo', // landing de compartir
  '/legal/privacidad', // contenido estático largo
];

// Sugerencia de arreglo por regla (las que axe no puede inferir solas). Lo que
// no esté acá usa el `failureSummary` del propio nodo, que ya explica el qué.
const FIX_HINTS = {
  'color-contrast': 'Subir el contraste a 4,5:1 (3:1 para texto ≥24px o bold ≥18,66px): oscurecer el texto o aclarar el fondo.',
  'image-alt': 'Agregar alt a cada <img> (descriptivo si es contenido, alt="" si es decorativa).',
  'button-name': 'Botones de solo icono: agregar aria-label descriptivo.',
  'link-name': 'Enlaces sin texto: agregar contenido textual o aria-label.',
  label: 'Asociar cada campo con <label for> o aria-label.',
  'html-has-lang': 'Agregar lang="es" a <html> en app/layout.tsx.',
  'html-lang-valid': 'Corregir el valor de lang en app/layout.tsx (ej. lang="es").',
  bypass: 'Envolver el contenido en un <main> (landmark principal).',
  'duplicate-id': 'Los id deben ser únicos: los duplicados rompen aria-* y labels.',
  'aria-allowed-attr': 'El atributo ARIA no está permitido en ese rol: revisar el rol del elemento.',
  'aria-required-attr': 'El rol exige atributos ARIA obligatorios que faltan.',
  'aria-valid-attr-value': 'El valor del atributo ARIA apunta a algo que no existe (id mal escrito).',
  'aria-roles': 'Rol ARIA inválido o mal escrito.',
  'autocomplete-valid': 'Agregar autocomplete correcto (email, name, tel…).',
  'meta-viewport': 'No bloquear el zoom: quitar user-scalable=no / maximum-scale.',
  'heading-order': 'No saltar niveles de encabezado (h2 → h4).',
  'scrollable-region-focusable': 'Las regiones scrollables por teclado necesitan tabindex="0".',
  'empty-heading': 'Encabezado vacío: eliminarlo o darle texto.',
  list: 'Los hijos de <ul>/<ol> deben ser <li> (o template/script).',
  listitem: 'Los <li> deben vivir dentro de <ul>/<ol>.',
};

const IMPACT_RANK = { critical: 0, serious: 1, moderate: 2, minor: 3 };
const IMPACT_LABEL = { critical: '🔴 crítico', serious: '🟠 serio', moderate: '🟡 moderado', minor: '⚪ menor' };
const IMPACT_ORDER = ['critical', 'serious', 'moderate', 'minor'];

// La inyección corre el axe completo y deja el resultado en window.__axe.
// String.raw para que los escapes del minified lleguen intactos.
const RUN_AXE = String.raw`
window.__axe = null; window.__axeError = null;
(function () {
  try {
    axe.run(document, { resultTypes: ['violations'], rules: { region: { enabled: false } } }, function (err, results) {
      if (err) { window.__axeError = String(err); return; }
      window.__axe = {
        violations: results.violations.map(function (v) {
          return {
            id: v.id,
            impact: v.impact,
            help: v.help,
            helpUrl: v.helpUrl,
            nodeCount: v.nodes.length,
            nodes: v.nodes.slice(0, 6).map(function (n) {
              return {
                target: n.target,
                html: (n.html || '').replace(/\s+/g, ' ').slice(0, 140),
                failureSummary: n.failureSummary || null,
              };
            }),
          };
        }),
        incomplete: results.incomplete.map(function (v) {
          return { id: v.id, impact: v.impact, help: v.help, nodeCount: v.nodes.length };
        }),
        passes: results.passes.length,
      };
    });
  } catch (e) { window.__axeError = String(e); }
})();
`;

// ── Utilidades (mismas que measure-vitals.mjs: CDP mínimo sobre WebSocket) ──
function normalizePath(arg) {
  let p = arg;
  if (/^[A-Za-z]:[\\/]/.test(p)) {
    const marker = p.replace(/\\/g, '/').indexOf('/Git/');
    p = marker === -1 ? p : p.replace(/\\/g, '/').slice(marker + 4);
  }
  return p.startsWith('/') ? p : `/${p}`;
}

function parseArgs(argv) {
  const opts = {
    base: process.env.A11Y_BASE || 'http://localhost:3000',
    settle: 2500,
    device: 'desktop',
    all: false,
    json: false,
    failOnSerious: false,
    chrome: process.env.CHROME_PATH || null,
    paths: [],
  };
  for (const arg of argv) {
    if (arg.startsWith('--base=')) opts.base = arg.slice(7).replace(/\/$/, '');
    else if (arg.startsWith('--settle=')) opts.settle = Number(arg.slice(9)) || 2500;
    else if (arg.startsWith('--device=')) opts.device = arg.slice(9);
    else if (arg.startsWith('--chrome=')) opts.chrome = arg.slice(9);
    else if (arg === '--all') opts.all = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--fail-on-serious') opts.failOnSerious = true;
    else if (!arg.startsWith('--')) opts.paths.push(normalizePath(arg));
  }
  if (opts.paths.length === 0) opts.paths = [...DEFAULT_ROUTES];
  return opts;
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

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * El `WebSocket` global de Node: estable desde Node 22, experimental en Node 20
 * (`--experimental-websocket`). Sin este chequeo, una major anterior moría con
 * un «WebSocket is not defined» que no decía ni dónde ni cómo arreglarlo.
 */
function requireWebSocket() {
  if (typeof WebSocket !== 'function') {
    throw new Error(
      'Node sin `WebSocket` global. Usa Node 22+ (el proyecto fija Node 24 en `.nvmrc`), ' +
        'o corre con `--experimental-websocket` (p. ej. NODE_OPTIONS=--experimental-websocket).'
    );
  }
  return WebSocket;
}

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

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', () => reject(new Error('No pude abrir el WebSocket de CDP')));
  });

  return {
    ready,
    send(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    once(method, timeoutMs) {
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          listeners.delete(fn);
          resolve(null);
        }, timeoutMs);
        const fn = (msg) => {
          if (msg.method !== method) return;
          clearTimeout(timer);
          listeners.delete(fn);
          resolve(msg.params);
        };
        listeners.add(fn);
      });
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

async function waitForEndpoint(port, timeoutMs = 20000) {
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

async function newTab(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
  if (!res.ok) throw new Error(`No pude crear la pestaña (HTTP ${res.status})`);
  return res.json();
}

// ── Auditoría de una ruta ───────────────────────────────────────────────────
async function axeSource() {
  // Resuelto desde node_modules para que funcione en cualquier cwd.
  const require = createRequire(import.meta.url);
  return readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
}

async function evaluate(client, expression) {
  const res = await client.send('Runtime.evaluate', { expression, returnByValue: true });
  if (res.exceptionDetails) {
    const d = res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'sin detalle';
    throw new Error(`Error evaluando en la página: ${d}`);
  }
  return res.result?.value;
}

async function auditRoute(client, url, opts, axeSrc) {
  await client.send('Page.enable');
  await client.send('Runtime.enable');

  const viewport =
    opts.device === 'mobile'
      ? { width: 390, height: 844, deviceScaleFactor: 3, mobile: true }
      : { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false };
  await client.send('Emulation.setDeviceMetricsOverride', viewport);

  const loaded = client.once('Page.loadEventFired', 45000);
  await client.send('Page.navigate', { url });
  await loaded;

  // Margen para que la hidratación traiga los datos (la home carga el catálogo
  // por API después del load; sin esto se auditaría el esqueleto).
  await sleep(opts.settle);

  // Inyectar el motor y disparar el análisis (queda en window.__axe).
  await evaluate(client, axeSrc);
  await evaluate(client, RUN_AXE);

  // Pollear el resultado: axe corre async dentro de la página.
  const deadline = Date.now() + 20000;
  let result = null;
  while (Date.now() < deadline) {
    const err = await evaluate(client, 'window.__axeError');
    if (err) throw new Error(`axe falló en ${url}: ${err}`);
    result = await evaluate(client, 'window.__axe');
    if (result) break;
    await sleep(250);
  }
  if (!result) throw new Error(`axe no terminó a tiempo en ${url}`);
  return result;
}

// ── Presentación ────────────────────────────────────────────────────────────
function countByImpact(violations) {
  const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const v of violations) {
    const nodes = v.nodeCount || v.nodes.length;
    if (v.impact && counts[v.impact] != null) counts[v.impact] += nodes;
    else counts.moderate += nodes; // impacto null: axe no lo clasificó
  }
  return counts;
}

function selectorOf(target) {
  if (!Array.isArray(target)) return String(target);
  return target.join(' > ');
}

function renderReport(summary, opts) {
  const cutoff = opts.all ? 3 : 1; // por defecto solo critical + serious
  console.log(`\nAuditoría de accesibilidad (axe-core) · ${opts.base} · ${opts.device}\n`);

  const header = ['RUTA', 'CRÍTICOS', 'SERIOS', 'MODERADOS', 'MENORES', 'REGLAS'];
  const widths = [40, 10, 9, 12, 10, 8];
  const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join('');
  console.log(line(header));
  console.log(widths.map((w) => '─'.repeat(w)).join(''));
  for (const s of summary) {
    const c = s.counts;
    console.log(
      line([s.path, c.critical || '—', c.serious || '—', c.moderate || '—', c.minor || '—', s.violations.length]),
    );
  }
  console.log('');

  for (const s of summary) {
    console.log(`── ${s.path}`);
    const shown = s.violations.filter((v) => (IMPACT_RANK[v.impact] ?? 9) <= cutoff);
    if (shown.length === 0) {
      console.log('   🟢 sin hallazgos critical/serious en esta ruta');
    }
    for (const v of shown) {
      console.log(`   ${IMPACT_LABEL[v.impact] || '🟡 moderado'} · ${v.id} — ${v.nodeCount} nodo(s) — ${v.help}`);
      for (const n of v.nodes.slice(0, 3)) {
        console.log(`        · ${selectorOf(n.target)}`);
        if (n.html) console.log(`          ${n.html.slice(0, 120)}`);
      }
      const hint = FIX_HINTS[v.id];
      if (hint) console.log(`        Arreglo: ${hint}`);
    }
    if (s.incomplete.length > 0) {
      console.log(`   ⚠️  a revisar a mano (${s.incomplete.length} reglas indeterminadas): ${s.incomplete.map((v) => v.id).join(', ')}`);
    }
    console.log('');
  }

  // Los arreglos más caros primero: reglas distintas, ordenadas por impacto y
  // por cantidad de nodos afectados en todo el portal. Esa lista es el input
  // del arreglo, igual que la línea base CWV lo fue para el rendimiento.
  const byRule = new Map();
  for (const s of summary) {
    for (const v of s.violations) {
      const key = `${v.impact}|${v.id}`;
      const prev = byRule.get(key);
      if (prev) prev.total += v.nodeCount;
      else byRule.set(key, { impact: v.impact, id: v.id, help: v.help, total: v.nodeCount });
    }
  }
  const ranked = [...byRule.values()]
    .filter((r) => (IMPACT_RANK[r.impact] ?? 9) <= cutoff)
    .sort((a, b) => IMPACT_RANK[a.impact] - IMPACT_RANK[b.impact] || b.total - a.total)
    .slice(0, 5);

  if (ranked.length > 0) {
    console.log('Los 5 arreglos más caros (impacto medido, nodos afectados en todo el portal):');
    ranked.forEach((r, i) => {
      console.log(`  ${i + 1}. [${r.impact}] ${r.id} — ${r.total} nodo(s) — ${r.help}`);
      const hint = FIX_HINTS[r.id];
      if (hint) console.log(`     Arreglo: ${hint}`);
    });
  } else {
    console.log('🟢 Sin hallazgos critical/serious en ninguna ruta auditada.');
  }
  console.log('');
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const chromePath = findChrome(opts.chrome);
  const port = await freePort();
  const userDataDir = await mkdtemp(join(tmpdir(), 'rix7-a11y-'));
  const axeSrc = await axeSource();

  // Precalentamiento: en `next dev` la primera visita compila la ruta.
  for (const p of opts.paths) {
    try {
      await fetch(`${opts.base}${p}`, { redirect: 'follow' });
    } catch {
      /* si falla, igual intentamos auditar */
    }
  }

  const chrome = spawn(
    chromePath,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
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
    { stdio: 'ignore' },
  );

  let summary = [];
  try {
    await waitForEndpoint(port);
    const tab = await newTab(port);
    const client = connect(tab.webSocketDebuggerUrl);
    await client.ready;

    for (const path of opts.paths) {
      const url = `${opts.base}${path}`;
      const result = await auditRoute(client, url, opts, axeSrc);
      summary.push({
        path,
        url,
        counts: countByImpact(result.violations),
        violations: result.violations,
        incomplete: result.incomplete,
        passes: result.passes,
      });
    }
    client.close();

    if (opts.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      renderReport(summary, opts);
    }

    if (opts.failOnSerious) {
      const bad = summary.filter((s) => s.counts.critical > 0 || s.counts.serious > 0);
      if (bad.length > 0) {
        console.error(`✖ ${bad.length} ruta(s) con hallazgos critical/serious: ${bad.map((s) => s.path).join(', ')}`);
        process.exitCode = 1;
      }
    }
  } finally {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      chrome.kill('SIGKILL');
    }
    await sleep(300);
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error(`\n✖ ${err.message}\n`);
  process.exit(1);
});
