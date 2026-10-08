#!/usr/bin/env node
/**
 * Plan del dominio de corrido — verifica los nueve pasos del §8.4 de
 * `docs/runbook-resend.md` y dice **en cuál se queda**.
 *
 * El plan del día del dominio vive en el runbook como procedimiento humano
 * (paneles de NIC Chile, Vercel, Resend, Supabase). De ese procedimiento, todo
 * lo que se puede comprobar desde la CLI se comprueba aquí, en orden y sin
 * efectos secundarios:
 *
 *   1. NS delegados (DoH: dns.google, respaldo cloudflare-dns)
 *   2. TXT de Resend — DKIM, SPF y DMARC — y el estado del dominio vía
 *      `GET /api/resend.com/domains` si hay una API key legible
 *   3. HTTPS del apex (certificado emitido) y redirect 308 de `www`
 *   4. Las tres variables de Vercel vía `vercel env pull` (production, preview,
 *      development) — NEXT_PUBLIC_SITE_URL, ALERTS_FROM_EMAIL, RESEND_API_KEY
 *   5. Supabase: no consultable sin `SUPABASE_ACCESS_TOKEN` (revocado) → manual
 *   6. `vars.SITE_URL` de GitHub vía `gh variable list`
 *   7. `GET /` → 200 (deploy sirviendo)
 *   8. Salud, canonical, og:url, sitemap, `smoke:prod --url` y (opcional) el §7
 *   9. Política DMARC actual — se reporta, pero **no bloquea** (§8.4 paso 9)
 *
 * Salida: una línea por verificación (✓ / ✖ / ○) y al final el **primer paso
 * bloqueante** con su porqué y su arreglo; si no lo hay, dice que el plan pasa
 * hasta el paso 8. Los pasos que solo se pueden verificar a mano salen con ○ y
 * no cortan el plan: se listan aparte.
 *
 * Salida del proceso: `0` si ningún paso 1–8 queda pendiente (los ○ no
 * cuentan), `1` si el plan se queda en alguno.
 *
 * No escribe nada en ningún sitio: todo es lectura (DNS, HTTP, pulls de
 * variables, `gh`). La **única** excepción es `--email`, que reproduce el §7
 * con `smoke:prod --write` y deja una fila de prueba en `public.signups` que
 * hay que borrar a mano (la tabla es solo-anexa: sin UPDATE, solo borrar).
 *
 * ## Requisitos
 *
 * - Red saliente (DNS por HTTPS y producción).
 * - `npx vercel` autenticado para los pasos 2 (API) y 4; sin él, esos
 *   controles salen como ○ con el motivo.
 * - `gh` autenticado para el paso 6.
 *
 * ## Uso
 *
 *   npm run check:domain
 *   npm run check:domain -- --no-smoke
 *   npm run check:domain -- --email tu@correo.cl
 *
 * Banderas: `--email <dir>` (agrega la prueba de correo del §7, con escritura),
 * `--no-smoke` (saltea el `smoke:prod` del paso 8) y `--help`.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SITE = 'https://rix7.cl';
const WWW = 'https://www.rix7.cl';
const LEGACY = 'https://rix7.vercel.app';
const REPO = 'jatf71-a11y/rix7';
const ENVIRONMENTS = ['production', 'preview', 'development'];

const HTTP_MS = 12000;
const DNS_MS = 10000;
const PULL_MS = 90000;
const GH_MS = 30000;
const SMOKE_MS = 240000;

const PASOS = [
  'Delegar el dominio',
  'Verificar rix7.cl en Resend',
  'Dominio activo en Vercel',
  'Variables en Vercel',
  'Supabase — URL de Auth',
  'GitHub — vars.SITE_URL',
  'Desplegar',
  'Verificación final',
  'Endurecer el DMARC (no bloquea)',
];

if (hasFlag('--help') || hasFlag('-h')) {
  console.log('Uso: npm run check:domain [-- --email dir@correo.cl] [--no-smoke]');
  console.log('Verifica los 9 pasos del plan del dominio (runbook-resend.md §8.4) y');
  console.log('dice en cuál se queda. Sale con 1 si algún paso 1–8 queda pendiente.');
  process.exit(0);
}

const EMAIL = readFlag('--email') ?? null;
const NO_SMOKE = hasFlag('--no-smoke');

const steps = PASOS.map((title, n) => ({ n: n + 1, title, checks: [] }));
let envs = null;
let envsWhy = 'aún no se intentó';
let resendVerified = null; // null = desconocido

// ---------------------------------------------------------------- utilidades

function readFlag(name) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) {
    return process.argv[i + 1];
  }
  const eq = process.argv.find((a) => a.startsWith(`${name}=`));
  return eq ? eq.slice(name.length + 1) : null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

/** `npx`/`npm` son `.cmd` en Windows y Node no los lanza directo. */
function run(cmd, args, timeout = 60000) {
  const isWin = process.platform === 'win32';
  const wrap = isWin && (cmd === 'npx' || cmd === 'npm');
  const [command, argv] = wrap ? ['cmd.exe', ['/c', cmd, ...args]] : [cmd, args];
  return spawnSync(command, argv, { encoding: 'utf8', timeout });
}

function tail(text, lines = 10) {
  return String(text ?? '')
    .trim()
    .split(/\r?\n/)
    .slice(-lines)
    .join(' | ')
    .slice(0, 400);
}

function describeNet(e) {
  const code = e?.cause?.code ?? e?.code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'no resuelve en DNS (¿zona sin delegar?)';
  if (e?.name === 'TimeoutError' || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return 'sin respuesta (timeout)';
  }
  return `no responde (${code ?? e?.message ?? 'error'})`;
}

async function http(url, { redirect = 'follow' } = {}) {
  try {
    const res = await fetch(url, { redirect, signal: AbortSignal.timeout(HTTP_MS) });
    return { status: res.status, error: null };
  } catch (e) {
    return { status: 0, error: describeNet(e) };
  }
}

async function httpText(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(HTTP_MS) });
    const text = await res.text();
    return { status: res.status, text, error: null };
  } catch (e) {
    return { status: 0, text: null, error: describeNet(e) };
  }
}

const DNS_TYPES = { NS: 2, TXT: 16 };
const DOH_ENDPOINTS = [
  {
    url: (name, type) => `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`,
    headers: { accept: 'application/json' },
  },
  {
    url: (name, type) => `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
    headers: { accept: 'application/dns-json' },
  },
];

/**
 * Consulta DNS por HTTPS (JSON, parseable: `nslookup` cambia de forma entre
 * plataformas). `answers: null` = sin red; `[]` = no existe/no resuelve.
 */
async function dnsQuery(name, type) {
  for (const endpoint of DOH_ENDPOINTS) {
    try {
      const res = await fetch(endpoint.url(name, type), {
        headers: endpoint.headers,
        signal: AbortSignal.timeout(DNS_MS),
      });
      if (!res.ok) continue;
      const body = await res.json();
      const answers = (body.Answer ?? [])
        .filter((a) => a.type === DNS_TYPES[type])
        .map((a) => String(a.data).replace(/^"|"$/g, '').replace(/\.$/, ''));
      return { answers, status: body.Status ?? 0 };
    } catch {
      // probar el siguiente endpoint
    }
  }
  return { answers: null, status: -1 };
}

function parseEnv(text) {
  const map = Object.create(null);
  for (const line of String(text).split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    map[line.slice(0, i)] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return map;
}

/** Un solo pull por entorno, en un temporal de `os.tmpdir()` borrado al tiro. */
function pullEnvs() {
  if (envs) return envs;
  const out = Object.create(null);
  const files = [];
  try {
    for (const environment of ENVIRONMENTS) {
      const file = path.join(os.tmpdir(), `rix7-check-domain-${environment}-${process.pid}.env`);
      files.push(file);
      const r = run('npx', ['vercel', 'env', 'pull', file, `--environment=${environment}`, '--yes'], PULL_MS);
      if (r.error || r.status !== 0 || !fs.existsSync(file)) {
        envsWhy = r.error ? `${r.error.code ?? r.error.message}` : tail(r.stderr || r.stdout, 4);
        return null;
      }
      out[environment] = parseEnv(fs.readFileSync(file, 'utf8'));
    }
    envs = out;
    return envs;
  } catch (e) {
    envsWhy = e.message;
    return null;
  } finally {
    for (const file of files) fs.rmSync(file, { force: true });
  }
}

/** Estado del dominio en Resend (requiere una API key legible). */
async function resendStatus() {
  const key = process.env.RESEND_API_KEY ?? envs?.development?.RESEND_API_KEY ?? null;
  if (!key || key === '[SENSITIVE]') {
    return { status: null, why: 'sin API key legible (el pull la esconde como [SENSITIVE])' };
  }
  try {
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(DNS_MS),
    });
    if (!res.ok) return { status: null, why: `la API respondió HTTP ${res.status}` };
    const body = await res.json();
    const domain = (body.data ?? []).find((d) => String(d.name).toLowerCase() === 'rix7.cl');
    if (!domain) return { status: null, why: 'el dominio no aparece en la lista' };
    return { status: String(domain.status ?? domain.state ?? '').toLowerCase(), why: null };
  } catch (e) {
    return { status: null, why: describeNet(e) };
  }
}

// ------------------------------------------------------------------ registro

function add(n, status, label, detail = '', hint = null) {
  steps[n - 1].checks.push({ status, label, detail, hint });
}
const ok = (n, label, detail = '') => add(n, 'ok', label, detail);
const pend = (n, label, detail, hint) => add(n, 'pendiente', label, detail, hint);
const manual = (n, label, detail, hint = null) => add(n, 'manual', label, detail, hint);

function printStep(n) {
  const step = steps[n - 1];
  console.log(`\nPaso ${step.n} · ${step.title}`);
  for (const c of step.checks) {
    const icon = c.status === 'ok' ? '✓' : c.status === 'pendiente' ? '✖' : '○';
    console.log(`  ${icon} ${c.detail ? `${c.label} — ${c.detail}` : c.label}`);
    if (c.status !== 'ok' && c.hint) console.log(`      → ${c.hint}`);
  }
}

// -------------------------------------------------------------- los 9 pasos

async function step1() {
  const ns = await dnsQuery('rix7.cl', 'NS');
  if (ns.answers === null) {
    manual(1, 'NS delegados', 'sin DNS por HTTPS (¿red?) — probá de nuevo', 'nslookup -querytype=NS rix7.cl');
  } else if (!ns.answers.length) {
    pend(
      1,
      'NS delegados',
      'el registro existe pero no hay Name Server: la zona no entra al DNS',
      '§8.1: pegá ns1.vercel-dns.com y ns2.vercel-dns.com en la sección 4 de NIC Chile (propagación ≤ 24 h). Sin zona, nada de lo demás tiene dónde apoyarse.',
    );
  } else if (ns.answers.some((a) => a.includes('vercel-dns'))) {
    ok(1, 'NS delegados', ns.answers.join(' · '));
  } else {
    ok(1, 'NS delegados (otro proveedor)', ns.answers.join(' · '));
  }
  printStep(1);
}

async function step2() {
  const [dkim, spf, dmarc] = await Promise.all([
    dnsQuery('resend._domainkey.rix7.cl', 'TXT'),
    dnsQuery('send.rix7.cl', 'TXT'),
    dnsQuery('_dmarc.rix7.cl', 'TXT'),
  ]);

  if (dkim.answers === null) manual(2, 'DKIM', 'sin DNS por HTTPS (¿red?)');
  else if (dkim.answers.length) ok(2, 'DKIM en resend._domainkey', 'TXT presente (§8.3)');
  else
    pend(
      2,
      'DKIM en resend._domainkey',
      'no resuelve',
      '§8.2: la clave pública que genera Resend en la pestaña Records, entera y sin comillas.',
    );

  const spfTxt = (spf.answers ?? []).find((a) => /v=spf1/i.test(a));
  if (spf.answers === null) manual(2, 'SPF en send', 'sin DNS por HTTPS (¿red?)');
  else if (spfTxt) ok(2, 'SPF en send', 'v=spf1 en el subdominio (§8.3)');
  else
    pend(
      2,
      'SPF en send',
      'sin TXT con v=spf1',
      '§8.2: el SPF va en send, no en la raíz (y el MX con punto final). Si la pestaña Records muestra CNAME —dominios desde ago-2026—, replicá esos dos en lugar de TXT+MX.',
    );

  const dmarcTxt = (dmarc.answers ?? []).find((a) => /v=DMARC1/i.test(a));
  const policy = dmarcTxt ? (/(?<![a-z])p=([a-z]+)/i.exec(dmarcTxt)?.[1] ?? null) : null;
  if (dmarcTxt) ok(2, 'DMARC en _dmarc', `v=DMARC1 · p=${policy ?? '?'}`);
  else manual(2, 'DMARC en _dmarc', 'ausente — opcional (⭕ §8.2), recomendado antes de operar');

  // El estado «Verified» del panel: con API si hay key, si no queda manual.
  const pulled = pullEnvs();
  if (!pulled) console.log(`  · Vercel no deja leer las variables (${envsWhy}) — el estado en Resend queda manual.`);
  const rs = await resendStatus();
  if (rs.status !== null) {
    if (rs.status.includes('verified')) {
      ok(2, 'Estado en Resend (API)', 'verified');
      resendVerified = true;
    } else {
      pend(
        2,
        'Estado en Resend (API)',
        rs.status ? `status: ${rs.status}` : 'sin campo status en la respuesta',
        '§8.3: Restart verification en Resend; la propagación puede tardar hasta 72 h.',
      );
      resendVerified = false;
    }
  } else {
    manual(2, 'Estado en Resend (API)', `no consultable (${rs.why}) — mirá Resend → Domains`, 'los TXT de arriba son la verificación automática del §8.3');
    resendVerified = (dkim.answers ?? []).length > 0 && !!spfTxt;
  }
  printStep(2);
}

async function step3() {
  const apex = await http(`${SITE}/`, { redirect: 'manual' });
  if (apex.status === 200) {
    ok(3, 'Apex HTTPS', 'HTTP 200 — certificado emitido (TLS Active)');
  } else if (apex.status === 0) {
    pend(
      3,
      'Apex HTTPS',
      apex.error,
      '¿Paso 1 sin delegar? Si la zona ya existe: Settings → Domains en Vercel y esperá el certificado (§8.4 paso 3).',
    );
  } else {
    pend(3, 'Apex HTTPS', `HTTP ${apex.status} (esperado 200)`, 'mirá el estado del dominio y del certificado en Vercel → Domains');
  }

  const www = await http(`${WWW}/`, { redirect: 'manual' });
  if (www.status === 308) {
    ok(3, 'www → apex', 'HTTP 308');
  } else if (www.status === 0) {
    pend(3, 'www → apex', www.error, 'añadí www.rix7.cl en Vercel → Domains con redirect 308 al primario');
  } else {
    pend(3, 'www → apex', `HTTP ${www.status} (esperado 308)`, 'dominio primario = rix7.cl, www = redirect 308');
  }
  printStep(3);
}

async function step4() {
  if (!envs) {
    pend(
      4,
      'Variables en Vercel',
      `no se pudieron leer (${envsWhy})`,
      '`npx vercel login` y volvé a correr; los valores esperados están en el §5 y en el paso 4 del plan.',
    );
    return printStep(4);
  }

  const shown = ENVIRONMENTS.map((e) => `${e}=${envs[e]?.NEXT_PUBLIC_SITE_URL ?? '(sin definir)'}`);
  const allSites = ENVIRONMENTS.every((e) => envs[e]?.NEXT_PUBLIC_SITE_URL === SITE);
  if (allSites) ok(4, '4a · NEXT_PUBLIC_SITE_URL', `= ${SITE} en los 3 entornos`);
  else
    pend(
      4,
      '4a · NEXT_PUBLIC_SITE_URL',
      shown.join(' · '),
      '§8.4 paso 4a: https://rix7.cl sin barra final, en Production, Preview y Development (hoy sigue en el dominio temporal). El efecto llega con el deploy del paso 7.',
    );

  if (resendVerified === false || resendVerified === null) {
    manual(4, '4b · ALERTS_FROM_EMAIL', 'no exigido: el paso 2 aún no está en Verified (§4)', 'cuando lo esté: Rix7 <avisos@rix7.cl>');
  } else {
    const value = envs.production?.ALERTS_FROM_EMAIL;
    if (value === 'Rix7 <avisos@rix7.cl>') ok(4, '4b · ALERTS_FROM_EMAIL', value);
    else if (value === undefined) pend(4, '4b · ALERTS_FROM_EMAIL', 'sin definir en production', '§4: Rix7 <avisos@rix7.cl> (Resend ya está Verified)');
    else if (value === '[SENSITIVE]') manual(4, '4b · ALERTS_FROM_EMAIL', 'valor oculto en el pull', 'miralo en el panel: debe decir Rix7 <avisos@rix7.cl>');
    else pend(4, '4b · ALERTS_FROM_EMAIL', `sigue en ${value}`, '§4: Rix7 <avisos@rix7.cl> — Resend Verified ya lo permite');
  }

  const key = envs.production?.RESEND_API_KEY;
  if (key) ok(4, '4c · RESEND_API_KEY', key === '[SENSITIVE]' ? 'presente como Secret (el pull no expone el valor)' : 'presente');
  else
    pend(
      4,
      '4c · RESEND_API_KEY',
      'sin definir en production',
      '§5: `vercel env add RESEND_API_KEY` en los 3 entornos — con No expiration, para que el cron no pase a email-skipped un martes.',
    );

  printStep(4);
}

function step5() {
  manual(
    5,
    'Site URL y Redirect URLs',
    'no consultables por CLI (SUPABASE_ACCESS_TOKEN revocado) — revisalo en el dashboard',
    'Authentication → URL Configuration: Site URL https://rix7.cl · añadir https://rix7.cl/** y https://www.rix7.cl/** · conservar https://rix7.vercel.app/** (§8.4 paso 5)',
  );
  printStep(5);
}

function step6() {
  const gh = run('gh', ['variable', 'list', '--repo', REPO], GH_MS);
  if (gh.error || gh.status !== 0) {
    manual(6, 'vars.SITE_URL', gh.error ? `gh no está en el PATH` : `gh falló: ${tail(gh.stderr, 2)}`, '`gh auth status`; manual: `gh variable set SITE_URL --body "https://rix7.cl"`');
    return printStep(6);
  }
  const line = gh.stdout.split(/\r?\n/).find((l) => l.trim().startsWith('SITE_URL'));
  const value = line ? line.trim().split(/\s+/)[1] : null;
  if (!value) ok(6, 'vars.SITE_URL', 'ausente — el workflow usa el fallback https://rix7.cl (§8.4 paso 6)');
  else if (value === SITE) ok(6, 'vars.SITE_URL', value);
  else pend(6, 'vars.SITE_URL', `sigue en ${value}`, 'gh variable set SITE_URL --body "https://rix7.cl" — o borrala: el fallback ya es rix7.cl');
  printStep(6);
}

async function step7() {
  const root = await http(`${SITE}/`, { redirect: 'manual' });
  if (root.status === 200) ok(7, 'Deploy sirviendo', 'GET / → 200');
  else
    pend(
      7,
      'Deploy sirviendo',
      root.status ? `HTTP ${root.status}` : root.error,
      'npm run deploy:prod (§8.4 paso 7): las NEXT_PUBLIC_* se inlinean en build, sin redeploy el canonical sigue viejo.',
    );
  printStep(7);
}

async function step8() {
  const health = await httpText(`${SITE}/api/health`);
  if (!health.text) {
    pend(8, 'Salud', health.error, 'vuelve al paso 3: sin dominio sirviendo no hay salud que verificar');
  } else {
    try {
      const body = JSON.parse(health.text);
      const siteUrl = (body.subsystems ?? []).find((s) => s.id === 'site_url');
      if (body.status === 'ok' && siteUrl?.configured === true && !(siteUrl.notes ?? []).length) {
        ok(8, 'Salud', `status: ok · site_url: true · único opcional: ${(body.missing?.optional ?? []).join(', ') || 'ninguno'}`);
      } else {
        const reasons = (body.missing?.broken ?? []).concat(body.missing?.degraded ?? []);
        pend(
          8,
          'Salud',
          `status: ${body.status ?? '?'}${reasons.length ? ` · falta ${reasons.join(', ')}` : ''}`,
          'el cuerpo de /api/health dice qué subsistema y cómo arreglarlo; site_url debe estar en true sin notas',
        );
      }
    } catch {
      pend(8, 'Salud', 'la respuesta no es JSON', '¿es este el despliegue con /api/health?');
    }
  }

  const page = await httpText(`${SITE}/`);
  if (!page.text) {
    pend(8, 'Canonical y og:url', page.error, 'vuelve al paso 3');
  } else {
    const canonical = /<link rel="canonical" href="([^"]*)"/.exec(page.text)?.[1] ?? null;
    if (canonical && canonical.startsWith(SITE)) ok(8, 'Canonical', canonical);
    else
      pend(
        8,
        'Canonical',
        canonical ?? 'sin etiqueta',
        'el build sigue con la URL vieja: falta la 4a + `npm run deploy:prod` (pasos 4 y 7).',
      );
    const og = /property="og:url" content="([^"]*)"/.exec(page.text)?.[1] ?? null;
    if (og && og.startsWith(SITE)) ok(8, 'og:url', og);
    else pend(8, 'og:url', og ?? 'sin etiqueta', 'mismo origen que el canonical: NEXT_PUBLIC_SITE_URL + redeploy');
  }

  const sitemap = await httpText(`${SITE}/sitemap.xml`);
  if (!sitemap.text) pend(8, 'Sitemap', sitemap.error, 'vuelve al paso 3');
  else if (sitemap.text.includes(LEGACY)) pend(8, 'Sitemap', `todavía menciona ${LEGACY}`, 'mismo origen que el canonical: NEXT_PUBLIC_SITE_URL + redeploy');
  else if (sitemap.text.includes(SITE)) ok(8, 'Sitemap', 'solo https://rix7.cl');
  else pend(8, 'Sitemap', 'no menciona el dominio nuevo', 'revisá sitemap.xml y la variable del paso 4a');

  if (NO_SMOKE) {
    manual(8, 'Humo', 'omitido con --no-smoke', `npm run smoke:prod -- --url ${SITE}`);
  } else {
    console.log('  · corriendo smoke:prod (solo lectura)…');
    const smoke = run('npm', ['run', 'smoke:prod', '--', '--url', SITE], SMOKE_MS);
    if (smoke.status === 0) ok(8, 'Humo', `smoke:prod --url ${SITE} en verde`);
    else pend(8, 'Humo', smoke.error ? `no terminó (${smoke.error.code ?? smoke.error.message})` : `exit ${smoke.status}`, tail(smoke.stdout || smoke.stderr, 8));
  }

  if (!EMAIL) {
    manual(8, 'Correo §7 (escritura)', 'no corre solo: deja una fila en public.signups', `reproducilo con --email tu@correo.cl y borrá la fila después (§7)`);
  } else {
    const mail = run('npm', ['run', 'smoke:prod', '--', '--write', '--email', EMAIL], SMOKE_MS);
    if (mail.status === 0) ok(8, 'Correo §7', `enviado a ${EMAIL} — recordá borrar la fila de public.signups`);
    else pend(8, 'Correo §7', mail.error ? `no terminó (${mail.error.code ?? mail.error.message})` : `exit ${mail.status}`, tail(mail.stdout || mail.stderr, 8));
  }
  printStep(8);
}

async function step9() {
  const dmarc = await dnsQuery('_dmarc.rix7.cl', 'TXT');
  const txt = (dmarc.answers ?? []).find((a) => /v=DMARC1/i.test(a));
  const policy = txt ? (/(?<![a-z])p=([a-z]+)/i.exec(txt)?.[1] ?? null) : null;
  if (!policy) manual(9, 'Política DMARC', 'sin registro _dmarc (opcional, ⭕ §8.2)', '§8.4 paso 9: conviene endurecerlo antes de operar');
  else if (policy === 'none') pend(9, 'Política DMARC', 'p=none — recién Verified; endurecer exige ≥7 días de logs (no bloquea)', '§8.4 paso 9: p=none → p=quarantine en _dmarc.rix7.cl');
  else ok(9, 'Política DMARC', `p=${policy}`);
  printStep(9);
}

// ------------------------------------------------------------------ veredicto

function verdict() {
  const bloqueantes = steps
    .slice(0, 8)
    .filter((step) => step.checks.some((c) => c.status === 'pendiente'));

  console.log(`\n${'─'.repeat(66)}`);
  if (bloqueantes.length) {
    const step = bloqueantes[0];
    const first = step.checks.find((c) => c.status === 'pendiente');
    console.log(`✖ El plan se queda en el PASO ${step.n} · ${step.title}`);
    console.log(`   ${first.label}: ${first.detail}`);
    if (first.hint) console.log(`   → ${first.hint}`);
    if (bloqueantes.length > 1) {
      console.log(`   (también pendientes: ${bloqueantes.slice(1).map((s) => s.n).join(', ')})`);
    }
    if (step.n === 1) {
      console.log('   (hasta que exista la zona, los pasos 2, 3, 7 y 8 no tienen dónde responder; el 4 y el 6 tocan Vercel y GitHub igual)');
    }
    process.exitCode = 1;
  } else {
    console.log('✓ El plan pasa hasta el paso 8 (todo lo verificable por CLI).');
    const d9 = steps[8].checks.find((c) => c.status === 'pendiente');
    if (d9) console.log(`○ Paso 9 pendiente, no bloquea: ${d9.detail}`);
  }

  const manuales = steps.flatMap((step) => step.checks.filter((c) => c.status === 'manual').map((c) => ({ step, c })));
  if (manuales.length) {
    console.log('\nRevisión manual pendiente (no corta el plan):');
    for (const { step, c } of manuales) console.log(`  ○ paso ${step.n} · ${c.label} — ${c.detail}`);
  }
}

// --------------------------------------------------------------------- main

async function main() {
  console.log(`\nPlan del dominio · rix7.cl — verificación de corrido (runbook-resend.md §8.4)`);
  console.log('Lectura sin efectos secundarios; al final dice en qué paso se queda.');
  await step1();
  await step2();
  await step3();
  await step4();
  step5();
  step6();
  await step7();
  await step8();
  await step9();
  verdict();
}

main().catch((error) => {
  console.error(`\nError inesperado: ${error.stack ?? error.message}`);
  process.exitCode = 1;
});
