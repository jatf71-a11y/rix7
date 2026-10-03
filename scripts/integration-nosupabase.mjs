#!/usr/bin/env node
/**
 * Prueba de integración «sin Supabase»: ejercita el portal de punta a punta con
 * un Supabase **no configurado** y comprueba que degrade con honestidad.
 *
 * La suite unitaria (`npx vitest run`) prueba cada pieza con dobles: el store, el
 * validador, el guard. Lo que ninguno de esos tests puede responder es la
 * pregunta que importa cuando no hay proyecto: **¿qué ve de verdad una persona
 * cuando usa el portal sin Supabase?** Este script arranca la app real y usa las
 * rutas reales, HTTP de por medio, sin mocks.
 *
 *   npm run test:integration:nosupabase
 *   npm run test:integration:nosupabase -- --base http://localhost:3111   # reusa un dev server
 *   npm run test:integration:nosupabase -- --json
 *
 * Qué ejercita, y qué se espera de cada camino:
 *
 * | Camino                              | Sin Supabase                          |
 * |-------------------------------------|---------------------------------------|
 * | `GET  /api/health`                  | `503`, `broken:[supabase]` (crítico)  |
 * | `GET  /api/favorites`               | `401` (no hay sesión)                 |
 * | `POST /api/favorites`               | `401`                                 |
 * | `DELETE /api/favorites`             | `401`                                 |
 * | `GET  /api/saved-searches`          | `401`                                 |
 * | `POST /api/saved-searches`          | `401`                                 |
 * | `DELETE /api/saved-searches`        | `401`                                 |
 * | `POST /api/leads` (válido)          | `201` con `persisted:false`           |
 * | `POST /api/leads` (inválido)        | `400` (la validación no depende de la base) |
 * | `GET  /api/leads`                   | `200` memory/no persistente (dev) o `503` fail-closed (prod) |
 * | `POST /api/properties/[id]/view`    | `202` con `persisted:false`           |
 * | `POST .../view` con `counted:false` | `200` con `persisted:false`           |
 * | ficha `/properties/[id]`            | 200, y el velocímetro rotula «Conteo de prueba» |
 *
 * Las comprobaciones son **fail-closed** en un punto en particular: si `GET
 * /api/favorites` o `GET /api/leads` devolvieran datos sin sesión, la suite
 * falla. Eso no es «degradar», es filtrar datos, y un test que solo mirara el
 * código de estado lo dejaría pasar.
 *
 * `GET /api/leads` es el único camino que cambia entre dev y producción, y la
 * suite lo acepta a propósito: sin Supabase, `requireAdmin` permite el bypass en
 * desarrollo (`NODE_ENV !== 'production'`) y falla cerrado en producción, así que
 * la misma ruta responde `200` con `source:"memory"` en un dev server y `503`
 * bajo `next start`. Lo que **nunca** puede pasar —y es lo que se comprueba— es
 * que devuelva contactos.
 *
 * Por qué el entorno se **sanea** (y no se confía en `.env.local`): para probar
 * «sin Supabase» hay que quitar `NEXT_PUBLIC_SUPABASE_*` del proceso, y eso hay
 * que hacerlo antes de que arranque el servidor. `next start` carga `.env.local`
 * y `.env` encima del entorno heredado, así que apagar la variable no alcanza:
 * hay que apuntar el servidor a un directorio de entorno vacío. El runner copia
 * el repo a una carpeta temporal (sin `.env*` y sin `node_modules`, que se
 * symlinkea) para que ni el `.env.local` de la máquina ni el del repo puedan
 * colarse. Si se corre contra un servidor ya levantado (`--base`), se **avisa**
 * que el entorno de ese proceso no lo controla este script: sirve para iterar
 * rápido, no como prueba limpia.
 *
 * El núcleo recibe `fetch` inyectado, así que se prueba sin red ni servidor
 * (`scripts/integration-nosupabase.test.ts`).
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..');

/** Puerto por defecto del runner propio; `--base` lo reemplaza. */
export const DEFAULT_PORT = 3211;

/** Cuánto se espera a que el servidor responda, en milisegundos. */
export const READY_TIMEOUT_MS = 120000;

/** Propiedad del catálogo en arriendo, con ficha y velocímetros. */
export const SAMPLE_PROPERTY = 'scl-depto-marco-polo';

/** Etiqueta que el velocímetro muestra cuando el conteo no persiste. */
export const DEV_COUNT_LABEL = 'Conteo de prueba';

// ═════════════════════════════════════════════════════════════════════════════
// Núcleo puro (probado en integration-nosupabase.test.ts)
// ═════════════════════════════════════════════════════════════════════════════

/** Quita la barra final para no armar `//api/...`. */
export function normalizeBaseUrl(url) {
  return String(url ?? '').trim().replace(/\/+$/, '');
}

/**
 * @typedef {object} Check
 * @property {string} name      qué se comprobó
 * @property {'ok' | 'fail'} status
 * @property {string} detail    qué se esperaba y qué llegó
 */

/** Un check que compara un valor observado contra el esperado. */
function check(name, expected, actual, describe = (v) => JSON.stringify(v)) {
  const ok = expected === actual;
  return {
    name,
    status: ok ? 'ok' : 'fail',
    detail: ok
      ? `esperado ${describe(expected)} · recibido ${describe(actual)}`
      : `esperaba ${describe(expected)} y llegó ${describe(actual)}`,
  };
}

/**
 * El cuerpo de contacto válido de la prueba. Cumple las mismas reglas que
 * `normalizeLead` (nombre, correo, teléfono de 9+ dígitos, canal permitido).
 */
export function validLeadPayload(overrides = {}) {
  return {
    property_id: SAMPLE_PROPERTY,
    name: 'Prueba de integración',
    email: 'integracion@example.com',
    phone: '+56 9 1234 5678',
    channel: 'form',
    message: 'Contacto de prueba automatizada.',
    ...overrides,
  };
}

/** El alta de una búsqueda guardada: al menos un filtro, si no se rechaza. */
export function validSavedSearchPayload(overrides = {}) {
  return {
    operation: 'for_rent',
    propertyType: 'apartment',
    commune: 'Providencia',
    ...overrides,
  };
}

/**
 * Petición con redirecciones a mano: un 3xx es información, no un salto.
 * Devuelve siempre `{ status, body }`, aunque la red falle.
 */
export async function request(fetchImpl, url, init = {}) {
  try {
    const response = await fetchImpl(url, { redirect: 'manual', ...init });
    const text = await response.text().catch(() => '');
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text; // HTML u otra cosa: se conserva para poder describirla
    }
    return { ok: true, status: response.status, body };
  } catch (error) {
    return { ok: false, status: 0, body: null, error: error instanceof Error ? error.message : String(error) };
  }
}

const json = (payload) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

/**
 * Corre toda la suite contra una base.
 *
 * @param {{ baseUrl?: string, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<{ baseUrl: string, ok: boolean, checks: Check[] }>}
 */
export async function runIntegration({ baseUrl = `http://localhost:${DEFAULT_PORT}`, fetchImpl = fetch } = {}) {
  const base = normalizeBaseUrl(baseUrl);
  const checks = [];

  /** Anota el resultado de un check. */
  const expect = (name, expected, actual, describe) => {
    checks.push(check(name, expected, actual, describe));
  };
  /** Anota un fallo de transporte o una condición que no debería cumplirse. */
  const fail = (name, detail) => {
    checks.push({ name, status: 'fail', detail });
  };

  // ── 1. El despliegue se declara roto por el crítico ──────────────────────
  {
    const r = await request(fetchImpl, `${base}/api/health`);
    if (!r.ok) fail('GET /api/health', `no respondió: ${r.error}`);
    else {
      const broken = Array.isArray(r.body?.missing?.broken) ? r.body.missing.broken : [];
      expect('GET /api/health → 503 por crítico', 503, r.status, String);
      expect('GET /api/health → supabase en broken', true, broken.includes('supabase'), String);
    }
  }

  // ── 2. Favoritos: sin sesión es 401, nunca una lista ─────────────────────
  {
    const get = await request(fetchImpl, `${base}/api/favorites`);
    if (!get.ok) fail('GET /api/favorites', `no respondió: ${get.error}`);
    else {
      expect('GET /api/favorites → 401', 401, get.status, String);
      // Un 200 sería servir favoritos sin cuenta: eso no es degradar, es filtrar.
      if (get.status === 200) {
        fail('GET /api/favorites no devuelve datos sin sesión', 'respondió 200 sin sesión');
      }
    }

    const post = await request(fetchImpl, `${base}/api/favorites`, json({ propertyId: SAMPLE_PROPERTY }));
    if (!post.ok) fail('POST /api/favorites', `no respondió: ${post.error}`);
    else expect('POST /api/favorites → 401', 401, post.status, String);

    const del = await request(fetchImpl, `${base}/api/favorites?propertyId=${SAMPLE_PROPERTY}`, {
      method: 'DELETE',
    });
    if (!del.ok) fail('DELETE /api/favorites', `no respondió: ${del.error}`);
    else expect('DELETE /api/favorites → 401', 401, del.status, String);
  }

  // ── 3. Búsquedas guardadas: igual, 401 en los tres métodos ───────────────
  {
    const get = await request(fetchImpl, `${base}/api/saved-searches`);
    if (!get.ok) fail('GET /api/saved-searches', `no respondió: ${get.error}`);
    else {
      expect('GET /api/saved-searches → 401', 401, get.status, String);
      if (get.status === 200) {
        fail('GET /api/saved-searches no devuelve datos sin sesión', 'respondió 200 sin sesión');
      }
    }

    const post = await request(fetchImpl, `${base}/api/saved-searches`, json(validSavedSearchPayload()));
    if (!post.ok) fail('POST /api/saved-searches', `no respondió: ${post.error}`);
    else expect('POST /api/saved-searches → 401', 401, post.status, String);

    const del = await request(fetchImpl, `${base}/api/saved-searches?id=abc`, { method: 'DELETE' });
    if (!del.ok) fail('DELETE /api/saved-searches', `no respondió: ${del.error}`);
    else expect('DELETE /api/saved-searches → 401', 401, del.status, String);
  }

  // ── 4. Contactos: público, se acepta, pero NO se guarda ──────────────────
  {
    const valid = await request(fetchImpl, `${base}/api/leads`, json(validLeadPayload()));
    if (!valid.ok) fail('POST /api/leads (válido)', `no respondió: ${valid.error}`);
    else {
      expect('POST /api/leads válido → 201 con persisted:false', '201|false', `${valid.status}|${valid.body?.persisted}`, String);
    }

    // La validación de dominio no depende de la base: un cuerpo malo es 400.
    const invalid = await request(fetchImpl, `${base}/api/leads`, json({ name: 'solo nombre' }));
    if (!invalid.ok) fail('POST /api/leads (inválido)', `no respondió: ${invalid.error}`);
    else expect('POST /api/leads inválido → 400', 400, invalid.status, String);

    const list = await request(fetchImpl, `${base}/api/leads`);
    if (!list.ok) fail('GET /api/leads', `no respondió: ${list.error}`);
    else {
      // Honesto es 503 (producción, fail-closed) o 200 memory/no persistente
      // (desarrollo). Cualquier otra cosa —sobre todo un 200 con datos— es un
      // fallo.
      const mode =
        list.status === 503
          ? 'fail-closed (producción)'
          : list.status === 200 && list.body?.source === 'memory' && list.body?.persistent === false
            ? 'memory/no persistente (desarrollo)'
            : 'inesperado';
      expect('GET /api/leads → no filtra contactos', true, mode !== 'inesperado', (v) => (v ? `modo: ${mode}` : `llegó ${list.status} source=${list.body?.source} persistent=${list.body?.persistent}`));

      if (Array.isArray(list.body?.data) && list.body.data.length > 0) {
        fail('GET /api/leads no filtra contactos sin sesión', `respondió ${list.body.data.length} contacto(s) sin sesión de admin`);
      }
    }
  }

  // ── 5. Vistas de ficha: cuenta en memoria y lo declara ───────────────────
  {
    const counted = await request(fetchImpl, `${base}/api/properties/${SAMPLE_PROPERTY}/view`, json({ counted: true }));
    if (!counted.ok) fail('POST /api/properties/[id]/view (cuenta)', `no respondió: ${counted.error}`);
    else expect('POST .../view → 202 con persisted:false', '202|false', `${counted.status}|${counted.body?.persisted}`, String);

    const readOnly = await request(fetchImpl, `${base}/api/properties/${SAMPLE_PROPERTY}/view`, json({ counted: false }));
    if (!readOnly.ok) fail('POST /api/properties/[id]/view (solo lee)', `no respondió: ${readOnly.error}`);
    else expect('POST .../view counted:false → 200 con persisted:false', '200|false', `${readOnly.status}|${readOnly.body?.persisted}`, String);
  }

  // ── 6. La ficha muestra el conteo de prueba en su HTML ───────────────────
  {
    const page = await request(fetchImpl, `${base}/properties/${SAMPLE_PROPERTY}`);
    if (!page.ok) fail('GET /properties/[id]', `no respondió: ${page.error}`);
    else {
      const html = typeof page.body === 'string' ? page.body : '';
      expect('GET /properties/[id] → 200', 200, page.status, String);
      expect('GET /properties/[id] rotula el conteo de prueba', true, html.includes(DEV_COUNT_LABEL), String);
    }
  }

  return { baseUrl: base, ok: checks.every((c) => c.status === 'ok'), checks };
}

/** El informe legible para la consola. */
export function formatReport(report, { warned = false } = {}) {
  const lines = ['', `== Integración sin Supabase · ${report.baseUrl} ==`, ''];
  if (warned) {
    lines.push('  ! Corriendo contra un servidor ya levantado: su entorno no lo controla este');
    lines.push('    script. Sirve para iterar, no como prueba limpia de «sin Supabase».');
    lines.push('');
  }

  for (const c of report.checks) {
    lines.push(`  ${c.status === 'ok' ? '✓' : '✗'} ${c.name} — ${c.detail}`);
  }

  const failed = report.checks.filter((c) => c.status === 'fail');
  lines.push('');
  lines.push(
    failed.length
      ? `  ${failed.length} de ${report.checks.length} comprobaciones fallaron.`
      : `  Las ${report.checks.length} comprobaciones pasaron: el portal degrada sin filtrar datos.`
  );
  lines.push('');
  return lines.join('\n');
}

// ═════════════════════════════════════════════════════════════════════════════
// El runner: levanta la app con el entorno saneado
// ═════════════════════════════════════════════════════════════════════════════

/** Un puerto libre, para no chocar con el dev server de otro hilo. */
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Copia lo que `next start` necesita leer, sin `.env*`.
 *
 * Se copia el **directorio** del proyecto en vez de arrancar el servidor con un
 * `cwd` distinto: `next start` resuelve `distDir` contra el proyecto y Next une
 * el `distDir` a la raíz, así que correr desde otro sitio sin la build completa
 * falla con «Could not find a production build». La copia trae `.next/` **sin
 * `cache/`** (los cientos de MB de webpack que `next start` no usa).
 *
 * La build se copia sin transformar para no tocar el `.next/` de la raíz: ese lo
 * comparten CI, Vercel y `deploy:prod`.
 */
function stageEnvFreeDir() {
  const dir = mkdtempSync(join(tmpdir(), 'rix7-nosupabase-'));
  const skip = new Set(['.git', '.freebuff', 'node_modules']);

  for (const entry of readdirSync(PROJECT_ROOT, { withFileTypes: true })) {
    // Ni `.env` ni `.env.local`: es justamente lo que hay que dejar afuera.
    if (skip.has(entry.name) || entry.name.startsWith('.env')) continue;
    const from = join(PROJECT_ROOT, entry.name);
    const to = join(dir, entry.name);
    cpSync(from, to, {
      recursive: true,
      filter: (src) => !src.includes(join('.next', 'cache')),
    });
  }

  // `next start` resuelve `next` y demás desde node_modules: un symlink evita
  // copiar cientos de MB. En Windows un symlink de directorio requiere permiso,
  // así que si falla se copia el directorio real.
  const nodeModules = join(PROJECT_ROOT, 'node_modules');
  if (existsSync(nodeModules)) {
    try {
      symlinkSync(nodeModules, join(dir, 'node_modules'), 'junction');
    } catch {
      cpSync(nodeModules, join(dir, 'node_modules'), { recursive: true });
    }
  }

  return dir;
}

/** Espera a que la base responda 200 (o cualquier código: el servidor ya está). */
async function waitForServer(base, timeoutMs = READY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5000) });
      if (res.status > 0) return true;
    } catch {
      /* todavía no escucha */
    }
    await sleep(500);
  }
  return false;
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

/**
 * Arranca la app con Supabase apagado y corre la suite.
 *
 * @param {{ port?: number, log?: (line: string) => void }} [options]
 */
export async function startAndRun({ port = DEFAULT_PORT, log = () => {} } = {}) {
  const envDir = stageEnvFreeDir();
  let server = null;

  const env = { ...process.env };
  delete env.NEXT_PUBLIC_SUPABASE_URL;
  delete env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete env.NEXT_PUBLIC_SITE_URL;
  env.NEXT_TELEMETRY_DISABLED = '1';
  env.PORT = String(port);

  const logPath = join(envDir, 'next-start.log');
  try {
    log(`  · copia sin .env en ${envDir}`);
    server = spawn(process.execPath, [join(envDir, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', String(port)], {
      cwd: envDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });

    const chunks = [];
    const capture = (buf) => {
      chunks.push(buf);
      writeFileSync(logPath, Buffer.concat(chunks));
    };
    server.stdout?.on('data', capture);
    server.stderr?.on('data', capture);

    const base = `http://localhost:${port}`;
    log(`  · next start en ${base} (Node ${process.version})`);
    const ready = await waitForServer(base);

    if (!ready) {
      const tail = existsSync(logPath) ? readFileSync(logPath, 'utf8').split('\n').slice(-20).join('\n') : '';
      throw new Error(`El servidor no respondió a tiempo. Últimas líneas:\n${tail}`);
    }

    const report = await runIntegration({ baseUrl: base });
    return report;
  } finally {
    killTree(server);
    rmSync(envDir, { recursive: true, force: true });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// CLI
// ═════════════════════════════════════════════════════════════════════════════

function parseArgs(argv) {
  const args = { base: null, json: false, port: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--base') args.base = argv[++i] ?? null;
    else if (arg.startsWith('--base=')) args.base = arg.slice('--base='.length);
    else if (arg === '--port') args.port = Number(argv[++i]) || null;
    else if (arg.startsWith('--port=')) args.port = Number(arg.slice('--port='.length)) || null;
  }
  return args;
}

function usage() {
  console.log(
    [
      '',
      'Ejercita el portal con Supabase NO configurado y comprueba que degrade sin filtrar datos.',
      '',
      '  npm run test:integration:nosupabase',
      '  npm run test:integration:nosupabase -- --base http://localhost:3111   # reusa un dev server',
      '  npm run test:integration:nosupabase -- --json',
      '',
      'Opciones:',
      '  --base <url>   usa un servidor ya levantado (no controla su entorno; avisa)',
      '  --port <n>     puerto del servidor propio (por defecto, uno libre)',
      '  --json         salida JSON en vez del informe de consola',
      '  --help         esto',
      '',
      'Sin --base levanta su propio `next start` desde una copia del repo SIN .env*,',
      'sobre una build existente (`.next`): si cambiaste el código, corre `npm run build` antes.',
      '',
    ].join('\n')
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();

  if (args.base) {
    const report = await runIntegration({ baseUrl: args.base });
    if (args.json) console.log(JSON.stringify(report, null, 2));
    else console.log(formatReport(report, { warned: true }));
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (!existsSync(join(PROJECT_ROOT, '.next', 'BUILD_ID'))) {
    console.error(
      [
        '',
        '✗ No hay build en .next/. Corre `npm run build` antes de esta suite, o pásale',
        '  --base <url> para reusar un dev server ya levantado.',
        '',
      ].join('\n')
    );
    process.exitCode = 1;
    return;
  }

  const port = args.port ?? (await freePort());
  console.log(`\nLevantando la app con Supabase apagado (puerto ${port})…`);
  const report = await startAndRun({ port, log: (line) => console.log(line) });

  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(formatReport(report));

  if (!report.ok) process.exitCode = 1;
}

// Solo corre al ejecutarse: así los tests pueden importar el núcleo.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`\n✖ ${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  });
}
