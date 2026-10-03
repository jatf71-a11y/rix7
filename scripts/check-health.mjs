#!/usr/bin/env node
/**
 * Sonda de salud de un despliegue de Rix7 (plan fase 3, ítem 3.7).
 *
 * `/api/health` dice qué subsistemas quedaron configurados en un despliegue,
 * pero eso solo sirve si alguien lo mira. Este script lo mira **solo**, cada
 * pocas horas desde el CI (`.github/workflows/health-check.yml`), y sale con 1
 * cuando falta algo **crítico**: sin proyecto Supabase real el portal se sirve
 * (el catálogo vive en memoria) pero no se guarda nada de lo que hace la gente,
 * y eso merece que un job rojo lo grite en vez de descubrirlo un mes después.
 *
 * No confundir con `smoke:prod`: ese comprueba rutas de punta a punta —portada,
 * panel, alta— y se corre a mano; este vigila una sola cosa, la configuración,
 * y corre solo. Uno responde «¿el sitio responde?», el otro «¿el sitio guarda?».
 *
 * Degradados y opcionales **no** hacen fallar el job: se reportan en el resumen.
 * Un `degraded` (sin Resend, sin clave de servicio) es una carencia, no una
 * caída; castigarlo entrenaría a todos a ignorar el job.
 *
 * Uso:
 *   npm run check:health
 *   npm run check:health -- --url http://localhost:3111
 *   HEALTH_URL=https://rix7.cl node scripts/check-health.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Producción por defecto; se cambia con `--url` o `HEALTH_URL`. */
export const DEFAULT_HEALTH_URL = 'https://rix7.vercel.app';

/** Tiempo máximo de espera de la respuesta, en milisegundos. */
export const FETCH_TIMEOUT_MS = 15000;

/**
 * @typedef {object} Subsystem
 * @property {string} id
 * @property {string} label
 * @property {'critical' | 'degraded' | 'optional'} severity
 * @property {boolean} configured
 * @property {string | null} reason
 * @property {string} impact
 * @property {string} fix
 */

/**
 * @typedef {object} HealthJudgement
 * @property {boolean} ok                  ¿No falta nada crítico?
 * @property {'ok' | 'degraded' | 'broken' | 'unreachable'} status
 * @property {string[]} broken             ids de los críticos sin configurar
 * @property {string[]} degraded
 * @property {string[]} optional
 * @property {string[]} reasons            por qué falló (vacío si ok)
 * @property {Subsystem[]} subsystems
 * @property {string | null} summary       el resumen que mandó el endpoint
 */

// ═════════════════════════════════════════════════════════════════════════════
// Núcleo puro (probado en check-health.test.ts)
// ═════════════════════════════════════════════════════════════════════════════

/** Quita la barra final para no armar `//api/health`. */
export function normalizeBaseUrl(url) {
  return String(url ?? '').trim().replace(/\/+$/, '');
}

/** La URL del endpoint a partir de la base. */
export function healthUrl(baseUrl) {
  return `${normalizeBaseUrl(baseUrl)}/api/health`;
}

const ids = (value) => (Array.isArray(value) ? value.filter((x) => typeof x === 'string') : []);

/**
 * Decide si el informe de `/api/health` está sano.
 *
 * Falla **solo** por críticos: es la misma regla que el `503` del endpoint, para
 * que el job y el `curl` de una persona cuenten la misma historia.
 *
 * @param {unknown} payload  el JSON del endpoint
 * @param {number} httpStatus el código HTTP (informativo: un 503 con cuerpo válido se juzga por el cuerpo)
 * @returns {HealthJudgement}
 */
export function judgeHealth(payload, httpStatus = 0) {
  const empty = {
    ok: false,
    status: 'unreachable',
    broken: [],
    degraded: [],
    optional: [],
    reasons: [],
    subsystems: [],
    summary: null,
  };

  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ...empty, reasons: [`La respuesta no es un objeto JSON (HTTP ${httpStatus}).`] };
  }

  const record = /** @type {Record<string, unknown>} */ (payload);
  if (!record.missing || typeof record.missing !== 'object') {
    return {
      ...empty,
      reasons: [`La respuesta no trae el campo «missing» (HTTP ${httpStatus}). ¿Es este el despliegue con /api/health?`],
    };
  }

  const missing = /** @type {Record<string, unknown>} */ (record.missing);
  const broken = ids(missing.broken);
  const degraded = ids(missing.degraded);
  const optional = ids(missing.optional);
  const subsystems = Array.isArray(record.subsystems)
    ? /** @type {Subsystem[]} */ (record.subsystems.filter((s) => s && typeof s === 'object'))
    : [];

  const reasons = broken.map((id) => {
    const subsystem = subsystems.find((s) => s.id === id);
    if (!subsystem) return `crítico sin configurar: ${id}`;
    const why = subsystem.reason ? `${subsystem.label}: ${subsystem.reason}` : subsystem.label;
    return subsystem.fix ? `${why} → ${subsystem.fix}` : why;
  });

  const status =
    broken.length > 0
      ? 'broken'
      : degraded.length > 0
        ? 'degraded'
        : 'ok';

  return {
    ok: broken.length === 0,
    status,
    broken,
    degraded,
    optional,
    reasons,
    subsystems,
    summary: typeof record.summary === 'string' ? record.summary : null,
  };
}

/**
 * Consulta `/api/health` y lo juzga.
 *
 * Un `503` **no** es un error de transporte: es la respuesta normal cuando falta
 * algo crítico y hay que juzgarla por su cuerpo. Un fallo de red sí lo es.
 *
 * @param {{ baseUrl?: string, fetchImpl?: typeof fetch, timeoutMs?: number }} [options]
 * @returns {Promise<{ url: string, ok: boolean, httpStatus: number, judgement: HealthJudgement, error: string | null }>}
 */
export async function runCheck({
  baseUrl = DEFAULT_HEALTH_URL,
  fetchImpl = fetch,
  timeoutMs = FETCH_TIMEOUT_MS,
} = {}) {
  const base = normalizeBaseUrl(baseUrl);
  const url = healthUrl(base);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'error desconocido';
    return {
      url,
      ok: false,
      httpStatus: 0,
      judgement: {
        ok: false,
        status: 'unreachable',
        broken: [],
        degraded: [],
        optional: [],
        reasons: [`No se pudo consultar ${url}: ${message}`],
        subsystems: [],
        summary: null,
      },
      error: message,
    };
  } finally {
    clearTimeout(timer);
  }

  const httpStatus = response.status;
  let payload = null;
  let parseError = null;
  try {
    payload = await response.json();
  } catch (error) {
    parseError = error instanceof Error ? error.message : 'error desconocido';
  }

  if (parseError !== null) {
    return {
      url,
      ok: false,
      httpStatus,
      judgement: {
        ok: false,
        status: 'unreachable',
        broken: [],
        degraded: [],
        optional: [],
        reasons: [`La respuesta no es JSON válido (HTTP ${httpStatus}): ${parseError}`],
        subsystems: [],
        summary: null,
      },
      error: parseError,
    };
  }

  const judgement = judgeHealth(payload, httpStatus);
  return { url, ok: judgement.ok, httpStatus, judgement, error: null };
}

/** El informe legible para la consola. */
export function formatReport({ url, httpStatus, judgement }) {
  const lines = ['', `== Sonda de salud · ${url} ==`, '', `  HTTP ${httpStatus || '—'}`];

  if (judgement.ok) {
    lines.push('  ✓ Sin subsistemas críticos pendientes.');
  } else if (judgement.status === 'unreachable') {
    lines.push('  ✗ No se pudo leer el informe:');
  } else {
    lines.push(`  ✗ Falta ${judgement.broken.length === 1 ? 'un subsistema crítico' : `${judgement.broken.length} subsistemas críticos`}:`);
  }

  for (const reason of judgement.reasons) lines.push(`      · ${reason}`);

  if (judgement.degraded.length > 0) {
    lines.push('', `  ! Degradados (no bloquean): ${judgement.degraded.join(', ')}`);
  }
  if (judgement.optional.length > 0) {
    lines.push(`  · Opcionales sin configurar: ${judgement.optional.join(', ')}`);
  }
  if (judgement.ok && judgement.degraded.length === 0 && judgement.optional.length === 0) {
    lines.push('', '  Todo lo que el portal necesita está configurado.');
  }

  lines.push('');
  return lines.join('\n');
}

/** El bloque de Markdown que se adjunta al resumen de la corrida de CI. */
export function summaryMarkdown({ url, httpStatus, judgement }) {
  const icon = judgement.ok ? '✅' : '❌';
  const lines = [
    `## ${icon} Salud del despliegue`,
    '',
    `- Endpoint: \`${url}\``,
    `- HTTP: **${httpStatus || '—'}**`,
    `- Estado: **${judgement.status}**`,
  ];

  if (judgement.summary) lines.push(`- Informe: ${judgement.summary}`);

  if (judgement.reasons.length > 0) {
    lines.push('', '### Sin configurar');
    for (const reason of judgement.reasons) lines.push(`- ${reason}`);
  }
  if (judgement.degraded.length > 0) {
    lines.push('', `> ⚠️ Degradados (no bloquean): ${judgement.degraded.join(', ')}`);
  }
  if (judgement.optional.length > 0) {
    lines.push(`> ℹ️ Opcionales sin configurar: ${judgement.optional.join(', ')}`);
  }

  lines.push('');
  return lines.join('\n');
}

// ═════════════════════════════════════════════════════════════════════════════
// CLI
// ═════════════════════════════════════════════════════════════════════════════

function parseArgs(argv) {
  const args = { url: process.env.HEALTH_URL || DEFAULT_HEALTH_URL, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--url') args.url = argv[++i] ?? args.url;
    else if (arg.startsWith('--url=')) args.url = arg.slice('--url='.length);
  }

  return args;
}

function usage() {
  console.log(
    [
      '',
      'Consulta /api/health de un despliegue y sale con 1 si falta algo crítico.',
      '',
      '  npm run check:health',
      '  npm run check:health -- --url http://localhost:3111',
      '',
      'Opciones:',
      '  --url <url>     despliegue a consultar (por defecto, producción; o HEALTH_URL)',
      '  --help          esto',
      '',
      'Pensado para correr solo desde el CI cada pocas horas. Un 503 con el informe',
      'de críticos es un fallo del job —que es exactamente lo que se quiere saber—.',
      '',
    ].join('\n')
  );
}

/**
 * Añade el bloque de Markdown al resumen de la corrida, si `GITHUB_STEP_SUMMARY`
 * está definido. Va en try/catch: no poder escribir el resumen no puede tumbar
 * la sonda, que es la que decide el color del job.
 */
async function appendSummary(markdown) {
  const target = process.env.GITHUB_STEP_SUMMARY;
  if (!target) return;
  try {
    const { appendFile } = await import('node:fs/promises');
    await appendFile(target, markdown);
  } catch (error) {
    console.warn('⚠ No se pudo escribir el resumen de la corrida:', error instanceof Error ? error.message : error);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();

  const result = await runCheck({ baseUrl: args.url });
  console.log(formatReport(result));
  await appendSummary(summaryMarkdown(result));

  if (!result.ok) {
    // `::error::` pinta el aviso en la lista de la corrida de GitHub, además del
    // job rojo. Así el motivo no hay que buscarlo en el log.
    const detail = result.judgement.reasons[0] ?? 'el informe no se pudo leer';
    console.error(`::error::Salud de producción: ${detail}`);
    process.exitCode = 1;
  }
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
