#!/usr/bin/env node
/**
 * Prueba de humo contra un despliegue: ¿está la tanda y está guardando?
 *
 * Comprueba desde afuera —como lo haría una visita— las tres piezas que se
 * desplegaron juntas: la portada, la pantalla `/admin/registros` y el alta
 * `/api/registro`. Y responde la pregunta que ningún test de la suite puede
 * responder, porque depende de la base real: **¿el alta se está guardando o la
 * respuesta se está perdiendo en la memoria del servidor?**
 *
 *   npm run smoke:prod                                  # solo mirar (no escribe nada)
 *   npm run smoke:prod -- --url http://localhost:3111
 *   npm run smoke:prod -- --write --email tu@correo.cl  # además da un alta de prueba
 *
 * Por qué la escritura es una decisión aparte: el alta manda el correo de
 * bienvenida y deja una fila en `public.signups`, que es **solo-anexa** (no hay
 * política de UPDATE). Escribir sin querer no es inofensivo: un correo a una
 * dirección inexistente rebota y eso le cuesta reputación al dominio del
 * remitente. Por eso `--write` exige decir a qué correo mandar la bienvenida —el
 * tuyo, que además te deja comprobar el correo de punta a punta— y la fila queda
 * identificada como de prueba para poder borrarla.
 *
 * Sin `--write` el informe dice honestamente que la persistencia **no se
 * verificó**: no se puede saber sin intentarlo.
 *
 * El núcleo recibe `fetch` inyectado, así que se prueba sin red
 * (`scripts/smoke-prod.test.ts`).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Producción por defecto; se cambia con `--url` o `SMOKE_URL`. */
const DEFAULT_BASE_URL = 'https://rix7.vercel.app';

/** Identidad de la fila de prueba: se ve de lejos y se puede borrar. */
export const SMOKE_NAME = 'Prueba de humo (no es una persona)';
export const SMOKE_PHONE = '+56 9 0000 0000';

/** Marcas de identidad de cada página. */
export const HOME_MARKER = 'Rix7';
export const ADMIN_MARKER = 'Registros';

/** Señales de que lo que llegó es una pantalla de error, no la página. */
const ERROR_PAGE = /Application error|Internal Server Error|a server-side exception|__next_error__/i;

/**
 * @typedef {{ level: 'ok' | 'fail' | 'warn' | 'info', label: string, detail: string }} SmokeStep
 * @typedef {object} SmokeReport
 * @property {string} baseUrl
 * @property {boolean} ok                 ¿Todo lo comprobado salió bien?
 * @property {SmokeStep[]} steps
 * @property {boolean | null} persisted   null = no se intentó (sin --write)
 */

// ═════════════════════════════════════════════════════════════════════════════
// Núcleo puro (probado en smoke-prod.test.ts)
// ═════════════════════════════════════════════════════════════════════════════

/** Quita la barra final para no armar `//api/...`. */
export function normalizeBaseUrl(url) {
  return String(url ?? '').trim().replace(/\/+$/, '');
}

/** El alta de prueba: las dos autorizaciones obligatorias y ninguna opcional. */
export function smokeSignupPayload(email) {
  return {
    name: SMOKE_NAME,
    email,
    phone: SMOKE_PHONE,
    // Las opcionales van en false a propósito: es lo que no queremos que quede
    // autorizado por una prueba.
    consents: {
      personal_data: true,
      terms: true,
      marketing: false,
      third_party: false,
    },
  };
}

const errorDetail = (error) =>
  error instanceof Error ? error.message : 'error desconocido';

/**
 * Cómo leer la portada.
 *
 * Se comprueba que sea la página y no una pantalla de error, que es lo que
 * distingue «el deploy salió bien» de «el deploy responde 200 con el error
 * adentro» — el caso que un `curl -o /dev/null -w %{http_code}` deja pasar.
 */
export function judgeHome(status, html) {
  if (status !== 200) return { level: 'fail', detail: `HTTP ${status}` };
  if (ERROR_PAGE.test(html)) {
    return { level: 'fail', detail: 'devolvió 200 pero el cuerpo es una pantalla de error' };
  }
  if (!html.includes(HOME_MARKER) || html.length < 5000) {
    return { level: 'fail', detail: `no parece la portada (${html.length} caracteres)` };
  }
  return { level: 'ok', detail: `200 · ${(html.length / 1024).toFixed(1)} kB` };
}

/**
 * Cómo leer `/admin/registros`.
 *
 * Una redirección cuenta como buena: la página existe y el panel pide la sesión.
 * Un 404 significa que el deploy no trajo la ruta, que es justo lo que hay que
 * detectar; un 200 sin la marca de la página, que llegó otra cosa.
 */
export function judgeAdminPage(status, html) {
  if (status === 404) {
    return { level: 'fail', detail: 'HTTP 404: la ruta no está desplegada' };
  }
  if (status >= 300 && status < 400) {
    return {
      level: 'ok',
      detail: `HTTP ${status}: la página existe y el panel pide la sesión antes de mostrarla`,
    };
  }
  if (status !== 200) return { level: 'fail', detail: `HTTP ${status}` };
  if (ERROR_PAGE.test(html)) {
    return { level: 'fail', detail: 'devolvió 200 pero el cuerpo es una pantalla de error' };
  }
  if (!html.includes(ADMIN_MARKER)) {
    return { level: 'fail', detail: 'devolvió 200 pero no es la pantalla de registros' };
  }
  return { level: 'ok', detail: `200 · ${(html.length / 1024).toFixed(1)} kB` };
}

/**
 * Cómo leer `GET /api/registro` sin sesión.
 *
 * Lo importante es que **no** devuelva datos: es el listado de quién autorizó
 * qué, y con la guardia puesta nunca se ve sin sesión de admin. Un 404 significa
 * que la ruta no se desplegó; un 200, que la guardia dejó pasar el listado.
 */
export function judgeRegistroGuard(status) {
  if (status === 404) {
    return { level: 'fail', detail: 'HTTP 404: la ruta no está desplegada' };
  }
  if (status === 200) {
    return {
      level: 'fail',
      detail: 'HTTP 200 sin sesión: la guardia del panel dejó pasar el listado de registros',
    };
  }
  if ([401, 403, 503].includes(status)) {
    return { level: 'ok', detail: `HTTP ${status}: existe y pide sesión (no devuelve datos)` };
  }
  return { level: 'fail', detail: `HTTP ${status}: respuesta inesperada` };
}

/** Primer dato del informe de `/api/health` que explica por qué no se guarda. */
export function persistenceHint(health) {
  const broken = health?.missing?.broken ?? [];
  if (broken.includes('supabase')) {
    return 'Falta el proyecto Supabase real (NEXT_PUBLIC_SUPABASE_URL): sin él el alta se acepta pero queda en la memoria del servidor.';
  }
  return 'Puede faltar aplicar la migración 0010_signups.sql: compruébalo con `npm run db:status`.';
}

/**
 * Cómo leer la respuesta del alta.
 *
 * `persistent:false` con `saved:true` es el caso silencioso y peligroso: la
 * pantalla dice «listo», la constancia de consentimiento no quedó en ningún lado
 * y se pierde al reiniciar la función. Es lo que este script existe para ver.
 */
export function judgeSignup(status, body) {
  if (status === 429) {
    return {
      level: 'warn',
      detail: 'HTTP 429: el rate limit (10 por 10 minutos por IP) ya se gastó; no se pudo comprobar',
    };
  }
  if (status === 400) {
    return { level: 'fail', detail: `HTTP 400: ${body?.error ?? 'el alta de prueba fue rechazada'}` };
  }
  if (status !== 201) {
    return { level: 'fail', detail: `HTTP ${status}: ${JSON.stringify(body ?? {}).slice(0, 200)}` };
  }
  if (body?.stored?.saved !== true) {
    return {
      level: 'fail',
      detail: 'el alta respondió 201 pero no se guardó (stored.saved = false)',
    };
  }
  if (body?.stored?.persistent !== true) {
    return {
      level: 'fail',
      detail:
        'el alta se acepta pero NO se está guardando en Supabase (queda en la memoria del servidor)',
    };
  }
  return { level: 'ok', detail: 'el alta quedó guardada en Supabase' };
}

/**
 * Texto del informe, listo para imprimir.
 *
 * @param {SmokeReport} report
 */
export function formatReport(report) {
  const mark = { ok: '✓', fail: '✗', warn: '!', info: '·' };
  const lines = ['', `== Prueba de humo · ${report.baseUrl} ==`, ''];

  for (const step of report.steps) {
    lines.push(`  ${mark[step.level]} ${step.label} — ${step.detail}`);
  }

  const failed = report.steps.filter((step) => step.level === 'fail');
  lines.push('');

  if (report.persisted === true) {
    lines.push('  ✓ El alta quedó guardada: el registro y sus autorizaciones persisten.');
  } else if (report.persisted === false) {
    lines.push('  ✗ El alta NO persiste. Quien se registre va a ver el aviso ámbar del modal y');
    lines.push('    sus autorizaciones se pierden al reiniciar el servidor.');
    const hint = report.hint ?? 'Mira `npm run db:status` y `GET /api/health`.';
    for (const line of hint.split('\n')) lines.push(`    ${line}`);
  } else {
    lines.push('  · Sin `--write` no se intentó ningún alta: la persistencia no se verificó.');
    if (report.hint) lines.push(`    ${report.hint}`);
  }

  lines.push('');
  lines.push(
    failed.length
      ? `  ${failed.length} comprobación(es) fallaron.`
      : '  Todo lo comprobado está en orden.'
  );
  lines.push('');

  return lines.join('\n');
}

// ═════════════════════════════════════════════════════════════════════════════
// La corrida (la red entra inyectada)
// ═════════════════════════════════════════════════════════════════════════════

/** Petición con redirecciones a mano: un 3xx es información, no un salto. */
async function probe(fetchImpl, url, init = {}) {
  try {
    return { ok: true, response: await fetchImpl(url, { redirect: 'manual', ...init }) };
  } catch (error) {
    return { ok: false, error: errorDetail(error) };
  }
}

/**
 * Corre todas las comprobaciones.
 *
 * @param {{ baseUrl?: string, write?: boolean, email?: string | null, fetchImpl?: typeof fetch }} options
 * @returns {Promise<SmokeReport>}
 */
export async function runSmoke({
  baseUrl = DEFAULT_BASE_URL,
  write = false,
  email = null,
  fetchImpl = fetch,
}) {
  const base = normalizeBaseUrl(baseUrl);
  const steps = [];
  let hint = null;

  // ── Portada ──
  const home = await probe(fetchImpl, `${base}/`);
  if (!home.ok) {
    steps.push({ level: 'fail', label: 'GET /', detail: `no respondió: ${home.error}` });
  } else {
    const html = await home.response.text().catch(() => '');
    steps.push({ label: 'GET /', ...judgeHome(home.response.status, html) });
  }

  // ── Panel de registros ──
  const admin = await probe(fetchImpl, `${base}/admin/registros`);
  if (!admin.ok) {
    steps.push({
      level: 'fail',
      label: 'GET /admin/registros',
      detail: `no respondió: ${admin.error}`,
    });
  } else {
    const html = await admin.response.text().catch(() => '');
    steps.push({ label: 'GET /admin/registros', ...judgeAdminPage(admin.response.status, html) });
  }

  // ── El alta: existe y está protegida ──
  const registro = await probe(fetchImpl, `${base}/api/registro`);
  if (!registro.ok) {
    steps.push({
      level: 'fail',
      label: 'GET /api/registro (sin sesión)',
      detail: `no respondió: ${registro.error}`,
    });
  } else {
    steps.push({
      label: 'GET /api/registro (sin sesión)',
      ...judgeRegistroGuard(registro.response.status),
    });
  }

  // ── Qué dice el despliegue de su propia configuración ──
  const health = await probe(fetchImpl, `${base}/api/health`);
  if (health.ok && health.response.status !== 404) {
    const report = await health.response.json().catch(() => null);
    const missing = [
      ...(report?.missing?.broken ?? []),
      ...(report?.missing?.degraded ?? []),
    ];
    steps.push({
      level: missing.length ? 'warn' : 'info',
      label: 'GET /api/health',
      detail: report?.summary ?? 'respondió algo que no se pudo leer',
    });
    if (!report || report.status === 'broken') hint = persistenceHint(report ?? {});
  } else {
    steps.push({
      level: 'info',
      label: 'GET /api/health',
      detail: health.ok ? 'HTTP 404: no está en este despliegue' : `no respondió: ${health.error}`,
    });
  }

  // ── El alta de verdad: ¿se guarda? ──
  let persisted = null;
  if (write) {
    const post = await probe(fetchImpl, `${base}/api/registro`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(smokeSignupPayload(email)),
    });

    if (!post.ok) {
      steps.push({
        level: 'fail',
        label: 'POST /api/registro',
        detail: `no respondió: ${post.error}`,
      });
      persisted = false;
    } else {
      const body = await post.response.json().catch(() => null);
      const verdict = judgeSignup(post.response.status, body);
      steps.push({ label: 'POST /api/registro', ...verdict });
      if (verdict.level === 'warn') persisted = null;
      else persisted = verdict.level === 'ok';

      if (verdict.level !== 'warn' && persisted === false && !hint) {
        hint = persistenceHint({});
      }

      // El correo: ni se finge que salió ni se oculta que salió.
      if (persisted !== null) {
        if (body?.email?.sent === true) {
          steps.push({
            level: 'warn',
            label: 'Correo de bienvenida',
            detail: `enviado a ${email} — revisa la bandeja (y el spam)`,
          });
        } else if (body?.email?.skipped === true) {
          steps.push({
            level: 'info',
            label: 'Correo de bienvenida',
            detail: 'saltado: falta RESEND_API_KEY en este despliegue',
          });
        } else {
          steps.push({
            level: 'warn',
            label: 'Correo de bienvenida',
            detail: 'el envío se intentó y falló (mira los registros del despliegue)',
          });
        }
      }
    }
  }

  const ok = !steps.some((step) => step.level === 'fail');
  return { baseUrl: base, ok, steps, persisted, hint };
}

// ═════════════════════════════════════════════════════════════════════════════
// CLI
// ═════════════════════════════════════════════════════════════════════════════

function parseArgs(argv) {
  const args = { url: process.env.SMOKE_URL || DEFAULT_BASE_URL, write: false, email: null, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--write') args.write = true;
    else if (arg === '--url') args.url = argv[++i] ?? args.url;
    else if (arg.startsWith('--url=')) args.url = arg.slice('--url='.length);
    else if (arg === '--email') args.email = argv[++i] ?? null;
    else if (arg.startsWith('--email=')) args.email = arg.slice('--email='.length);
  }

  return args;
}

function usage() {
  console.log(
    [
      '',
      'Prueba de humo contra un despliegue: portada, /admin/registros y /api/registro.',
      '',
      '  npm run smoke:prod                                  # solo mira (no escribe nada)',
      '  npm run smoke:prod -- --url http://localhost:3111',
      '  npm run smoke:prod -- --write --email tu@correo.cl  # además da un alta de prueba',
      '',
      'Opciones:',
      '  --url <url>     despliegue a probar (por defecto, producción; o SMOKE_URL)',
      '  --write         da de alta una visita de prueba para ver si persiste',
      '  --email <correo> a dónde mandar la bienvenida de esa alta (obligatorio con --write)',
      '  --help          esto',
      '',
      'El smoke test NO escribe nada sin --write: un alta de prueba manda un correo real',
      `y deja una fila en public.signups (solo-anexa) con el nombre «${SMOKE_NAME}».`,
      '',
    ].join('\n')
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();

  if (args.write && !args.email) {
    console.error(
      [
        '',
        '✗ --write necesita --email <correo>.',
        '',
        '  El alta manda el correo de bienvenida, y una prueba contra una dirección que no',
        '  existe rebota: eso le cuesta reputación al dominio del remitente. Usa tu propio',
        '  correo, que además te deja comprobar la bienvenida de punta a punta.',
        '',
        '  npm run smoke:prod -- --write --email tu@correo.cl',
        '',
      ].join('\n')
    );
    process.exitCode = 1;
    return;
  }

  const report = await runSmoke({ baseUrl: args.url, write: args.write, email: args.email });
  console.log(formatReport(report));

  if (!report.ok) process.exitCode = 1;
}

// Solo corre al ejecutarse: así los tests pueden importar el núcleo.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
