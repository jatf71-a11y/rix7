#!/usr/bin/env node
/**
 * Mide los Core Web Vitals de una o varias rutas usando el protocolo DevTools
 * (CDP) de un Chrome/Edge local.
 *
 * Por qué no Lighthouse ni Playwright: los números que importan acá son los que
 * produce el propio navegador (PerformanceObserver) sobre la app real. Así se
 * puede comprobar cada optimización con evidencia, sin instalar un headless
 * browser ni un runner pesado. Node 24 ya trae `WebSocket` global, que es todo
 * lo que CDP necesita para hablar con Chrome.
 *
 * Uso:
 *   npm run vitals
 *   npm run vitals -- /properties/scl-depto-marco-polo
 *   npm run vitals -- --path=/properties/scl-depto-marco-polo
 *   npm run vitals -- --runs=3 /
 *   npm run vitals -- --base=https://rix7.vercel.app /
 *   npm run vitals -- --json
 *
 * Opciones:
 *   --base=<url>     Origen a medir (por defecto http://localhost:3000)
 *   --runs=<n>       Repeticiones por ruta; se reporta la mediana (por defecto 3)
 *   --settle=<ms>    Espera tras el `load` para estabilizar métricas (2000)
 *   --device=<d>     desktop (1280x800) o mobile (390x844) (por defecto desktop)
 *   --no-interact    No dispara una interacción sintética (INP queda sin dato)
 *   --warm-cache     Reutiliza la caché del navegador entre corridas (por defecto se limpia)
 *   --json           Salida JSON en vez de tabla
 *   --chrome=<path>  Binario de Chrome/Edge (o variable CHROME_PATH)
 *
 * Nota importante: en `next dev` el primer request compila la ruta, así que el
 * script "precalienta" con un GET antes de medir. Aun así, para comparar
 * optimizaciones hay que medir contra el server de producción (`next start`) o
 * contra el deploy: los números de dev no son representativos.
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';

// ── Umbrales oficiales de Web Vitals (good / needs improvement) ──────────────
const THRESHOLDS = {
  LCP: [2500, 4000],
  CLS: [0.1, 0.25],
  INP: [200, 500],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
};

// ── Recolector que se inyecta ANTES de que cargue la página ─────────────────
// Se registra con `addScriptToEvaluateOnNewDocument`, así el PerformanceObserver
// ve los eventos desde el primer byte. Inyectarlo después no sirve: las entradas
// de LCP no se pueden leer con getEntriesByType, solo a través del observer.
// Se usa String.raw para que las barras invertidas de los regex (`\.`) lleguen
// intactas a la página; con un template normal se degradarían.
const COLLECTOR = String.raw`
window.__vitals = { lcp: null, cls: 0, fcp: null, ttfb: null, inp: null, interactions: 0, shifts: [] };
(function () {
  var v = window.__vitals;
  try {
    new PerformanceObserver(function (list) {
      var es = list.getEntries();
      var e = es[es.length - 1];
      var el = e.element;
      v.lcp = {
        time: Math.round(e.startTime),
        size: e.size,
        tag: el ? el.tagName : null,
        cls: el && el.className && typeof el.className === 'string' ? el.className.slice(0, 80) : null,
        src: el && el.currentSrc ? el.currentSrc : (e.url || null),
      };
    }).observe({ type: 'largest-contentful-paint', buffered: true });

    // CLS real: máximo de "session windows" (<1s entre shifts, <5s de ventana),
    // no la suma plana de todos los shifts.
    var sessionValue = 0, sessionEntries = [], maxCls = 0;
    new PerformanceObserver(function (list) {
      var es = list.getEntries();
      for (var i = 0; i < es.length; i++) {
        var e = es[i];
        if (e.hadRecentInput) continue;
        var first = sessionEntries[0];
        var last = sessionEntries[sessionEntries.length - 1];
        if (sessionValue && e.startTime - last.startTime < 1000 && e.startTime - first.startTime < 5000) {
          sessionValue += e.value;
          sessionEntries.push(e);
        } else {
          sessionValue = e.value;
          sessionEntries = [e];
        }
        if (sessionValue > maxCls) maxCls = sessionValue;
      }
      v.cls = Math.round(maxCls * 10000) / 10000;
    }).observe({ type: 'layout-shift', buffered: true });

    new PerformanceObserver(function (list) {
      var es = list.getEntries();
      if (!v.fcp) v.fcp = Math.round(es[es.length - 1].startTime);
    }).observe({ type: 'paint', buffered: true });

    new PerformanceObserver(function (list) {
      var es = list.getEntries();
      for (var i = 0; i < es.length; i++) {
        var e = es[i];
        if (!e.interactionId) continue;
        v.interactions++;
        var d = Math.round(e.duration);
        if (d > (v.inp || 0)) v.inp = d;
      }
    }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
  } catch (err) {
    v.error = String(err);
  }

  function nav() {
    var n = performance.getEntriesByType('navigation')[0];
    if (n) v.ttfb = Math.round(n.responseStart);
  }
  nav();
  window.addEventListener('load', nav);
})();
`;

// Lee las métricas + un resumen de recursos (para verificar optimizaciones:
// cuántas imágenes se piden y qué pesa cada una).
const READ_METRICS = String.raw`
(function () {
  var v = window.__vitals || {};
  var res = performance.getEntriesByType('resource') || [];
  // initiatorType 'img' no alcanza: las fotos optimizadas con next/image se
  // piden por el link de preload y llegan como 'link'. Se detectan por la URL.
  var IMG_RE = /(_next\/image|\.(png|jpe?g|webp|avif|gif|svg|ico))(\?|$)/i;
  var images = res.filter(function (r) {
    return r.initiatorType === 'img' || (r.initiatorType !== 'fetch' && IMG_RE.test(r.name.split('?')[0]));
  });
  // Los tiles del mapa se piden como imágenes, pero no son contenido de la ficha:
  // si se mezclan, el conteo deja de servir para verificar la optimización de la
  // galería (que es lo que se quiere comprobar).
  var TILES = /(tile\.openstreetmap\.org|basemaps\.|tiles\.|maptiler|cartodb|arcgisonline)/i;
  var contentImages = images.filter(function (r) { return !TILES.test(r.name); });
  // transferSize es 0 cuando la respuesta viene de la caché o de otro origen sin
  // Timing-Allow-Origin; encodedBodySize es el respaldo razonable.
  function kbOf(r) { return Math.round((r.transferSize || r.encodedBodySize || 0) / 1024); }
  var slowest = res
    .map(function (r) { return { name: r.name.split('/').pop().slice(0, 60), ms: Math.round(r.duration), kb: kbOf(r) }; })
    .sort(function (a, b) { return b.ms - a.ms; })
    .slice(0, 5);
  var lcpRes = null;
  if (v.lcp && v.lcp.src) {
    var hit = res.filter(function (r) { return r.name === v.lcp.src; })[0];
    if (hit) lcpRes = { ms: Math.round(hit.duration), kb: kbOf(hit), startTime: Math.round(hit.startTime) };
  }
  return JSON.stringify({
    lcp: v.lcp, cls: v.cls, fcp: v.fcp, ttfb: v.ttfb, inp: v.inp, interactions: v.interactions,
    lcpResource: lcpRes,
    images: contentImages.length,
    mapTiles: images.length - contentImages.length,
    imageList: contentImages.slice(0, 10).map(function (r) {
      var n = r.name.indexOf('/_next/image') === 0 || r.name.indexOf('_next/image') > -1
        ? 'next/image ' + (r.name.split('&w=')[1] || '').replace(/&q=.*/, '')
        : r.name.split('?')[0].split('/').pop().slice(0, 34);
      return n + ' (' + kbOf(r) + ' KB)';
    }),
    imageBytesKb: Math.round(contentImages.reduce(function (a, r) { return a + (r.transferSize || r.encodedBodySize || 0); }, 0) / 1024),
    slowest: slowest,
  });
})()
`;

// ── Utilidades ──────────────────────────────────────────────────────────────
// Git Bash convierte los argumentos que empiezan con "/" en rutas de Windows
// (por ejemplo "/properties/x" termina siendo "C:/Program Files/Git/properties/x").
// La ruta real empieza después del prefijo de la instalación de Git.
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
    base: process.env.VITALS_BASE || 'http://localhost:3000',
    runs: 3,
    settle: 2000,
    device: 'desktop',
    interact: true,
    clearCache: true,
    json: false,
    chrome: process.env.CHROME_PATH || null,
    paths: [],
  };
  for (const arg of argv) {
    if (arg.startsWith('--base=')) opts.base = arg.slice(7).replace(/\/$/, '');
    else if (arg.startsWith('--runs=')) opts.runs = Math.max(1, Number(arg.slice(7)) || 1);
    else if (arg.startsWith('--settle=')) opts.settle = Number(arg.slice(9)) || 2000;
    else if (arg.startsWith('--device=')) opts.device = arg.slice(9);
    else if (arg.startsWith('--chrome=')) opts.chrome = arg.slice(9);
    else if (arg.startsWith('--path=')) opts.paths.push(normalizePath(arg.slice(7)));
    else if (arg === '--no-interact') opts.interact = false;
    else if (arg === '--warm-cache') opts.clearCache = false;
    else if (arg === '--json') opts.json = true;
    else if (!arg.startsWith('--')) opts.paths.push(normalizePath(arg));
  }
  if (opts.paths.length === 0) opts.paths.push('/properties/scl-depto-marco-polo');
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

/** Conexión CDP mínima sobre el WebSocket nativo de Node. */
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
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

// ── Medición de una corrida ─────────────────────────────────────────────────
async function measureRun(client, url, opts) {
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Network.enable');

  // Cada corrida debe ser una carga en frío: si la segunda reusa la caché de la
  // primera, el LCP mejora por caché y no por la optimización que querés medir.
  if (opts.clearCache) await client.send('Network.clearBrowserCache');

  const viewport =
    opts.device === 'mobile'
      ? { width: 390, height: 844, deviceScaleFactor: 3, mobile: true }
      : { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false };
  await client.send('Emulation.setDeviceMetricsOverride', viewport);

  // El colector debe existir antes de la primera navegación de este documento.
  await client.send('Page.addScriptToEvaluateOnNewDocument', { source: COLLECTOR });

  const loaded = client.once('Page.loadEventFired', 45000);
  await client.send('Page.navigate', { url });
  await loaded;

  // Margen para que lleguen el LCP final y, si hay, los POIs del mapa.
  await sleep(opts.settle);

  // Una interacción sintética (Tab) para que INP tenga un dato real: los
  // eventos sin interacción no entran en la métrica.
  if (opts.interact) {
    for (const type of ['rawKeyDown', 'keyUp']) {
      await client.send('Input.dispatchKeyEvent', {
        type,
        key: 'Tab',
        code: 'Tab',
        windowsVirtualKeyCode: 9,
        nativeVirtualKeyCode: 9,
      });
    }
    await sleep(600);
  }

  const evaluated = await client.send('Runtime.evaluate', {
    expression: READ_METRICS,
    returnByValue: true,
  });
  if (evaluated.exceptionDetails || evaluated.result?.value == null) {
    const detail = evaluated.exceptionDetails?.exception?.description || evaluated.exceptionDetails?.text || 'sin detalle';
    throw new Error(`No pude leer las métricas de la página: ${detail}`);
  }
  return JSON.parse(evaluated.result.value);
}

// ── Presentación ────────────────────────────────────────────────────────────
function grade(metric, value) {
  if (value == null) return { label: 'sin dato', ok: null };
  const [good, needs] = THRESHOLDS[metric];
  if (value <= good) return { label: 'BUENO', ok: true };
  if (value <= needs) return { label: 'MEJORABLE', ok: false };
  return { label: 'POBRE', ok: false };
}

function median(values) {
  const nums = values.filter((v) => typeof v === 'number' && !Number.isNaN(v));
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10000) / 10000;
}

function center(text, width) {
  const s = String(text);
  return s + ' '.repeat(Math.max(0, width - s.length));
}

function left(text, width) {
  const s = String(text);
  return s + ' '.repeat(Math.max(0, width - s.length));
}

function renderTable(rows) {
  const cols = ['RUTA', 'LCP', 'CLS', 'INP', 'FCP', 'TTFB', 'IMGS'];
  const widths = [52, 18, 14, 16, 12, 12, 6];
  const line = (cells) => cells.map((c, i) => (i === 0 ? left(c, widths[i]) : center(c, widths[i]))).join('');
  const out = [line(cols)];
  out.push(widths.map((w) => '─'.repeat(w)).join(''));
  for (const r of rows) {
    out.push(
      line([
        `${r.label}${r.runs > 1 ? ` (mediana de ${r.runs})` : ''}`,
        `${r.lcp} ms · ${r.lcpGrade}`,
        `${r.cls} · ${r.clsGrade}`,
        `${r.inp ?? 'n/d'} ms · ${r.inpGrade}`,
        `${r.fcp} ms`,
        `${r.ttfb} ms`,
        String(r.images),
      ]),
    );
  }
  return out.join('\n');
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const chromePath = findChrome(opts.chrome);
  const port = await freePort();
  const userDataDir = await mkdtemp(join(tmpdir(), 'rix7-vitals-'));

  // Precalentamiento: en `next dev` la primera visita compila la ruta y eso
  // contaminaría el primer número medido.
  for (const p of opts.paths) {
    try {
      await fetch(`${opts.base}${p}`, { redirect: 'follow' });
    } catch {
      /* si falla, igual intentamos medir */
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
      const runs = [];
      for (let i = 0; i < opts.runs; i++) {
        runs.push(await measureRun(client, url, opts));
      }
      summary.push({
        path,
        url,
        runs: opts.runs,
        lcp: median(runs.map((r) => r.lcp?.time)),
        cls: median(runs.map((r) => r.cls)) ?? 0,
        inp: median(runs.map((r) => r.inp ?? undefined)),
        fcp: median(runs.map((r) => r.fcp)),
        ttfb: median(runs.map((r) => r.ttfb)),
        images: runs[runs.length - 1].images,
        imageBytesKb: runs[runs.length - 1].imageBytesKb,
        imageList: runs[runs.length - 1].imageList,
        mapTiles: runs[runs.length - 1].mapTiles,
        lcpElement: runs[runs.length - 1].lcp,
        lcpResource: runs[runs.length - 1].lcpResource,
        slowest: runs[runs.length - 1].slowest,
        all: runs,
      });
    }

    client.close();

    if (opts.json) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    console.log(`\nCore Web Vitals · ${opts.base} · ${opts.device} · ${chromePath.includes('msedge') ? 'Edge' : 'Chrome'}\n`);

    const rows = summary.map((s) => ({
      label: s.path,
      runs: s.runs,
      lcp: s.lcp,
      lcpGrade: grade('LCP', s.lcp).label,
      cls: s.cls,
      clsGrade: grade('CLS', s.cls).label,
      inp: s.inp,
      inpGrade: grade('INP', s.inp).label,
      fcp: s.fcp,
      ttfb: s.ttfb,
      images: s.images,
    }));
    console.log(renderTable(rows));

    for (const s of summary) {
      console.log(`\n── ${s.path}`);
      if (s.lcpElement) {
        console.log(
          `   LCP: ${s.lcpElement.time} ms · <${(s.lcpElement.tag || '').toLowerCase()}> ${s.lcpElement.cls ? '.' + s.lcpElement.cls.split(' ')[0] : ''} · ${s.lcpElement.size} px²`,
        );
        if (s.lcpElement.src) console.log(`        ${s.lcpElement.src.slice(0, 100)}`);
        if (s.lcpResource) console.log(`        recurso: ${s.lcpResource.ms} ms · ${s.lcpResource.kb} KB (arrancó en ${s.lcpResource.startTime} ms)`);
      }
      console.log(`   Imágenes de contenido: ${s.images} · ${s.imageBytesKb} KB   (tiles del mapa aparte: ${s.mapTiles})`);
      if (s.imageList?.length) console.log(`     ${s.imageList.join(' · ')}`);
      if (s.slowest?.length) {
        console.log('   Recursos más lentos:');
        for (const r of s.slowest) console.log(`     ${String(r.ms).padStart(5)} ms  ${String(r.kb).padStart(5)} KB  ${r.name}`);
      }
      if (s.runs > 1) {
        console.log(`   Corridas: LCP ${s.all.map((r) => r.lcp?.time ?? 'n/d').join(' / ')} ms · CLS ${s.all.map((r) => r.cls).join(' / ')} · INP ${s.all.map((r) => r.inp ?? 'n/d').join(' / ')} ms`);
      }
    }
    console.log('\nUmbrales: LCP ≤2500 BUENO · CLS ≤0.1 BUENO · INP ≤200 BUENO · FCP ≤1800 BUENO · TTFB ≤800 BUENO');
    console.log('Recordá: medir contra `next dev` infla los números. Usá `next start` o el deploy.\n');
  } finally {
    // En Windows hay que matar el árbol completo: Chrome deja procesos hijos.
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
