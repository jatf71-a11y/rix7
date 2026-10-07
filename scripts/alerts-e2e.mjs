#!/usr/bin/env node
/**
 * E2E de los avisos de búsquedas guardadas — contra producción.
 *
 * Repite a mano, y en el mismo orden, lo que hace el cron de las 09:17:
 *
 *   1. Crea un usuario de prueba en Supabase Auth y una búsqueda guardada que
 *      case con una propiedad real del catálogo (Vitacura · Venta).
 *   2. Corrida en seco: valida que los filtros casan y a quién se le mandaría,
 *      sin enviar nada.
 *   3. Corrida real: debe fijar la línea base (`outcome: baseline`) sin
 *      enviar correo — la regla de «un aviso, una vez».
 *   4. Retrocede `last_notified_at` y vuelve a correr: debe enviar de verdad
 *      (`outcome: sent`), que es el aviso que llega a la bandeja.
 *   5. Borra el usuario de prueba — la FK `ON DELETE CASCADE` de
 *      `saved_searches.user_id` se lleva la búsqueda — y verifica que las
 *      tablas queden como estaban.
 *
 * Cada fase imprime su resultado y el proceso sale con 1 si algo no cuadró,
 * igual que `smoke:prod`: sirve para mirarlo y para automatizarlo.
 *
 * ## Requisitos
 *
 * - `npx vercel` autenticado (lee `SUPABASE_SERVICE_ROLE_KEY` del entorno
 *   `development`, que sí devuelve valores reales).
 * - `gh` autenticado si se usa el trigger `workflow` (el que funciona sin
 *   permisos extra: el secreto del cron vive en GitHub).
 * - `--email` o la variable `ALERTS_E2E_EMAIL` / `SMOKE_EMAIL`. **Tiene que ser
 *   la dirección dueña de la cuenta de Resend**: mientras el remitente sea
 *   `onboarding@resend.dev`, Resend solo entrega a esa dirección, y con otra
 *   el test daría un falso negativo.
 *
 * ## Uso
 *
 *   npm run alerts:e2e -- --email tu@correo.cl
 *   npm run alerts:e2e -- --email tu@correo.cl --phase cleanup
 *   ALERTS_CRON_SECRET=... npm run alerts:e2e -- --trigger direct
 *
 * Fases: `all` (por defecto), `setup`, `dry`, `baseline`, `backdate`, `send`,
 * `resend` (una segunda corrida no debe repetir el aviso) y `cleanup`.
 * Triggers: `auto` (por defecto), `workflow`, `direct`.
 *
 * El secreto del servicio nunca se imprime: viaja en memoria y el archivo del
 * pull se borra en un `finally`, exista o no un error.
 */
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SITE = readFlag('--site') ?? 'https://rix7.vercel.app';
const SUPABASE_URL = 'https://wcxpkfmevrbjrjlbayba.supabase.co';
const WORKFLOW = 'alerts-run.yml';
const PHASE = readFlag('--phase') ?? 'all';
const TRIGGER = readFlag('--trigger') ?? 'auto';
const EMAIL = readFlag('--email') ?? process.env.ALERTS_E2E_EMAIL ?? process.env.SMOKE_EMAIL ?? null;

const FASES = ['all', 'setup', 'dry', 'baseline', 'backdate', 'send', 'resend', 'cleanup'];
const TRIGGERS = ['auto', 'workflow', 'direct'];

let serviceKey = null;
let tmpEnvFile = null;
let testUserId = null;
let testSearchId = null;

// ---------------------------------------------------------------- utilidades

function readFlag(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `npx` es un `.cmd` en Windows y Node no lo lanza directo desde spawnSync. */
function run(cmd, args) {
  const isWin = process.platform === 'win32';
  const [command, argv] = isWin && cmd === 'npx' ? ['cmd.exe', ['/c', 'npx', ...args]] : [cmd, args];
  const r = spawnSync(command, argv, { encoding: 'utf8' });
  if (r.error) throw new Error(`No se pudo lanzar ${cmd}: ${r.error.message}`);
  return r;
}

function fail(msg) {
  console.error(`  ✖ ${msg}`);
  process.exitCode = 1;
}

function ok(msg) {
  console.log(`  ✓ ${msg}`);
}

function info(msg) {
  console.log(`  · ${msg}`);
}

async function supa(pathname, init = {}) {
  const res = await fetch(`${SUPABASE_URL}${pathname}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

// ------------------------------------------------------------------ entorno

/**
 * La clave de servicio vive en Vercel. El pull de `development` sí devuelve el
 * valor real; el de producción la escribe como `[SENSITIVE]`, así que no sirve.
 * Se usa el archivo temporal del propio sistema (`os.tmpdir()`, no `/tmp`: en
 * Windows bash y Node no apuntan al mismo sitio) y se borra al terminar.
 */
function ensureServiceKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    info('Usando SUPABASE_SERVICE_ROLE_KEY del entorno.');
    return;
  }
  tmpEnvFile = path.join(os.tmpdir(), `rix7-alerts-e2e-${process.pid}.env`);
  const r = run('npx', ['vercel', 'env', 'pull', tmpEnvFile, '--environment=development', '--yes']);
  if (!fs.existsSync(tmpEnvFile)) {
    throw new Error(`vercel env pull no creó el archivo: ${r.stderr || r.stdout}`.slice(-400));
  }
  const line = fs.readFileSync(tmpEnvFile, 'utf8').split(/\r?\n/).find((l) => l.startsWith('SUPABASE_SERVICE_ROLE_KEY='));
  if (!line) throw new Error('El pull no trae SUPABASE_SERVICE_ROLE_KEY.');
  serviceKey = line.slice('SUPABASE_SERVICE_ROLE_KEY='.length).trim().replace(/^["']|["']$/g, '');
  info('Clave de servicio leída de un pull temporal (se borra al terminar).');
}

function cleanupTmpFile() {
  if (tmpEnvFile && fs.existsSync(tmpEnvFile)) {
    fs.rmSync(tmpEnvFile, { force: true });
  }
}

// --------------------------------------------------------------- las fases

async function phaseSetup() {
  const password = randomBytes(18).toString('base64url');
  const created = await supa('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password, email_confirm: true }),
  });

  if (created.status === 200 || created.status === 201) {
    testUserId = created.body.id;
    ok(`Usuario de prueba creado (${testUserId}).`);
  } else {
    // Reutiliza uno de una corrida anterior que no llegó a limpiarse.
    const existing = await supa('/auth/v1/admin/users?email=eq.' + encodeURIComponent(EMAIL));
    const found = Array.isArray(existing.body?.users) ? existing.body.users[0] : existing.body?.[0];
    if (!found) throw new Error(`No se pudo crear el usuario: HTTP ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);
    testUserId = found.id;
    info(`Reutilizando usuario existente (${testUserId}).`);
    await supa('/rest/v1/saved_searches?user_id=eq.' + testUserId, { method: 'DELETE' });
  }

  const search = await supa('/rest/v1/saved_searches', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      user_id: testUserId,
      filters: { operation: 'for_sale', commune: 'Vitacura' },
      label: 'Prueba de humo E2E · Venta en Vitacura',
      notify: true,
    }),
  });
  if (search.status !== 201 && search.status !== 200) {
    throw new Error(`No se pudo crear la búsqueda: HTTP ${search.status} ${JSON.stringify(search.body).slice(0, 200)}`);
  }
  testSearchId = search.body[0].id;
  ok(`Búsqueda creada (${testSearchId}) · last_notified_at: ${search.body[0].last_notified_at}`);
}

async function phaseBackdate() {
  if (!testSearchId) throw new Error('Sin búsqueda: corre primero --phase setup.');
  const r = await supa('/rest/v1/saved_searches?id=eq.' + testSearchId, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ last_notified_at: '2026-01-01T00:00:00Z' }),
  });
  if (r.status !== 200) throw new Error(`No se pudo retroceder la fecha: HTTP ${r.status}`);
  ok(`last_notified_at retrocedido a ${r.body[0].last_notified_at}.`);
}

async function phaseCleanup() {
  if (!testUserId) {
    const existing = await supa('/auth/v1/admin/users?email=eq.' + encodeURIComponent(EMAIL));
    const found = Array.isArray(existing.body?.users) ? existing.body.users[0] : existing.body?.[0];
    testUserId = found?.id ?? null;
  }
  if (!testUserId) {
    info('No hay usuario de prueba que borrar.');
  } else {
    const del = await supa('/auth/v1/admin/users/' + testUserId, { method: 'DELETE' });
    if (del.status !== 200) fail(`Borrar usuario → HTTP ${del.status}`);
    else ok('Usuario de prueba borrado (la búsqueda cae por CASCADE).');
  }

  const searches = await supa('/rest/v1/saved_searches?select=id');
  const users = await supa('/auth/v1/admin/users?page=1&per_page=20');
  const left = Array.isArray(users.body?.users) ? users.body.users.length : -1;
  const nSearches = Array.isArray(searches.body) ? searches.body.length : -1;
  if (nSearches === 0 && left === 0) ok(`Verificado: saved_searches=${nSearches} · auth.users=${left}`);
  else fail(`La producción no quedó limpia: saved_searches=${nSearches} · auth.users=${left}`);
}

// -------------------------------------------------------- disparo del job

/** Lee el reporte JSON que el workflow escribe en el log del paso. */
function reportFromLog(log) {
  const lines = log.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const clean = lines[i].replace(/\u001b\[[0-9;]*m/g, '');
    const start = clean.indexOf('{"success":');
    if (start < 0) continue;
    const candidate = clean.slice(start);
    const end = candidate.lastIndexOf('}');
    if (end < 0) continue;
    try {
      return JSON.parse(candidate.slice(0, end + 1));
    } catch {
      // sigue buscando hacia arriba
    }
  }
  return null;
}

function triggerWorkflow(dry) {
  const before = new Set(
    JSON.parse(run('gh', ['run', 'list', '--workflow', WORKFLOW, '--limit', '20', '--json', 'databaseId']).stdout || '[]').map((r) => r.databaseId),
  );

  const started = run('gh', ['workflow', 'run', WORKFLOW, '-f', `dry_run=${dry}`]);
  if (started.status !== 0) throw new Error(`gh workflow run falló: ${(started.stderr || started.stdout).slice(-300)}`);

  return (async () => {
    let runId = null;
    for (let i = 0; i < 20 && !runId; i++) {
      await sleep(3000);
      const listed = JSON.parse(run('gh', ['run', 'list', '--workflow', WORKFLOW, '--limit', '5', '--json', 'databaseId,status']).stdout || '[]');
      runId = listed.find((r) => !before.has(r.databaseId))?.databaseId ?? null;
    }
    if (!runId) throw new Error('La corrida no apareció en GitHub Actions.');

    for (let i = 0; i < 60; i++) {
      const state = JSON.parse(run('gh', ['run', 'view', String(runId), '--json', 'status,conclusion']).stdout || '{}');
      if (state.status === 'completed') {
        if (state.conclusion !== 'success') throw new Error(`La corrida ${runId} terminó en ${state.conclusion}.`);
        const log = run('gh', ['run', 'view', String(runId), '--log']).stdout;
        const report = reportFromLog(log);
        if (!report) throw new Error(`No se encontró el reporte en el log de la corrida ${runId}.`);
        info(`Corrida ${runId} → https://github.com/jatf71-a11y/rix7/actions/runs/${runId}`);
        return report;
      }
      await sleep(5000);
    }
    throw new Error('La corrida no terminó a tiempo.');
  })();
}

async function triggerDirect(dry) {
  const secret = process.env.ALERTS_CRON_SECRET;
  if (!secret) {
    throw new Error(
      'Sin ALERTS_CRON_SECRET en el entorno no se puede llamar directo. ' +
        'El secreto vive en Vercel (Production, donde el pull lo enmascara) y en GitHub: ' +
        'usa --trigger workflow o pásalo por variable.',
    );
  }
  const res = await fetch(`${SITE}/api/alerts/run${dry ? '?dry=1' : ''}`, { method: 'POST', headers: { 'x-alerts-secret': secret } });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`POST /api/alerts/run → HTTP ${res.status}`);
  return body;
}

async function trigger(dry) {
  const mode = TRIGGER === 'auto' ? (process.env.ALERTS_CRON_SECRET ? 'direct' : 'workflow') : TRIGGER;
  info(`Disparo: ${mode} · dry_run=${dry}`);
  return mode === 'direct' ? triggerDirect(dry) : triggerWorkflow(dry);
}

// ------------------------------------------------------------ verificaciones

function entries(report) {
  return report?.report?.entries ?? [];
}

function phaseDry(report) {
  const r = report?.report;
  if (!r) return fail('Sin reporte de la corrida en seco.');
  if (r.searches === 1 && r.matched >= 1) ok(`En seco: searches=${r.searches} · matched=${r.matched} · sent=${r.sent}`);
  else fail(`En seco no cuadra: searches=${r.searches} · matched=${r.matched} (se esperaba 1 y ≥1).`);
  const detail = entries(report)[0]?.detail ?? '';
  if (detail.includes(EMAIL)) ok(`El destinatario resuelto es ${EMAIL}`);
  else info(`El detalle no menciona el correo: ${detail.slice(0, 120)}`);
}

function phaseBaseline(report) {
  const e = entries(report)[0];
  if (e?.outcome === 'baseline' && (report?.report?.sent ?? -1) === 0) {
    ok(`Línea base fijada sin enviar (${e.detail})`);
  } else {
    fail(`Se esperaba baseline/sent=0 y llegó ${JSON.stringify({ outcome: e?.outcome, sent: report?.report?.sent })}`);
  }
}

function phaseSend(report) {
  const e = entries(report)[0];
  if (e?.outcome === 'sent' && (report?.report?.sent ?? -1) === 1) {
    ok(`Aviso enviado de verdad (matched=${e.matched}) — revisa la bandeja y el spam.`);
  } else {
    fail(`Se esperaba sent=1 y llegó ${JSON.stringify({ outcome: e?.outcome, sent: report?.report?.sent })}`);
  }
}

/**
 * La regla de «un aviso, una vez»: tras un envío exitoso `markSearchNotified`
 * avanzó `last_notified_at`, así que en esta segunda corrida la propiedad del
 * catálogo ya no es nueva y no debe salir otro correo. Si la fecha no hubiera
 * avanzado, aquí se vería `sent=1` de nuevo.
 */
function phaseResend(report) {
  const e = entries(report)[0];
  const r = report?.report;
  if (!r) return fail('Sin reporte en la corrida de reenvío.');
  if ((r.sent ?? -1) === 0 && e?.outcome === 'no-matches') {
    ok('Segunda corrida con la misma búsqueda: no-matches · sent=0 — no repite el aviso.');
  } else {
    fail(`Se esperaba no-matches/sent=0 y llegó ${JSON.stringify({ outcome: e?.outcome, matched: e?.matched, sent: r.sent })}`);
  }
}

function wants(phase) {
  return PHASE === 'all' || PHASE === phase;
}

function usage() {
  console.log('Uso: npm run alerts:e2e -- --email <correo> [--phase all|setup|dry|baseline|backdate|send|resend|cleanup] [--trigger auto|workflow|direct] [--site <url>]');
}

// --------------------------------------------------------------------- main

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) return usage();
  if (!FASES.includes(PHASE)) return (fail(`Fase desconocida: ${PHASE}`), usage());
  if (!TRIGGERS.includes(TRIGGER)) return (fail(`Trigger desconocido: ${TRIGGER}`), usage());
  if (!EMAIL) {
    fail('Falta el correo: pásalo con --email o con ALERTS_E2E_EMAIL/SMOKE_EMAIL.');
    info('Tiene que ser la dirección dueña de la cuenta de Resend mientras el remitente sea onboarding@resend.dev.');
    return usage();
  }

  console.log(`\n== E2E de avisos · ${SITE} · fase ${PHASE} ==\n`);
  ensureServiceKey();

  if (wants('setup')) await phaseSetup();
  if (wants('dry')) phaseDry(await trigger(true));
  if (wants('baseline')) phaseBaseline(await trigger(false));
  if (wants('backdate')) await phaseBackdate();
  if (wants('send')) phaseSend(await trigger(false));
  if (wants('resend')) phaseResend(await trigger(false));
  if (wants('cleanup')) await phaseCleanup();

  console.log('');
  if (process.exitCode) console.log('  Hay comprobaciones fallidas (arriba).');
  else console.log('  Todo lo comprobado está en orden.');
  console.log('');
}

main()
  .catch((err) => fail(err.message))
  .finally(cleanupTmpFile);
