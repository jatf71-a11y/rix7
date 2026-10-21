#!/usr/bin/env node
/**
 * Sonda del aviso de PostGIS: ¿la extensión sigue viviendo en `public`?
 *
 * El Security Advisor marca como crítica `public.spatial_ref_sys` (tabla de
 * PostGIS, sin RLS, con escritura para `anon`), y el proyecto **no puede
 * arreglarlo por su cuenta**: la tabla y la extensión pertenecen a
 * `supabase_admin`, así que ni `ENABLE ROW LEVEL SECURITY` ni `REVOKE` se pueden
 * ejecutar con las credenciales del proyecto. Queda pedirle el traslado a
 * Support (Vía A/A2) o hacerlo uno mismo con una ventana sin escrituras
 * (Vía B). Todo el contexto está en `docs/runbook-postgis-esquema.md`.
 *
 * Esa espera tenía un problema: nadie la vigilaba. El ticket es de plan Free,
 * sin plazo garantizado, y la fecha límite para pasar a la Vía B vivía solo en
 * un documento. Esta sonda la convierte en algo que **avisa solo**:
 *
 *   · la tabla ya no está en `public`  → verde (el aviso está cerrado);
 *   · sigue en `public` y hay plazo    → verde con una línea informativa;
 *   · sigue en `public` pasado el plazo → **rojo**, y el workflow de salud lo
 *     lleva a un issue del repositorio, que manda correo.
 *
 * El plazo es `DEADLINE_ISO`: viernes 2026-10-23 a las 18:00 en Chile (UTC-3),
 * o sea 21:00 UTC. Se puede mover con `--deadline` o `POSTGIS_DEADLINE` cuando
 * Support dé una fecha distinta — así el aviso se ajusta sin tocar código.
 *
 * ## Solo lee
 *
 * Una petición `GET /rest/v1/spatial_ref_sys?select=srid&limit=1` con la clave
 * pública: `200` significa que la Data API la sigue exponiendo; `404`
 * (`PGRST205`, «table not found in the schema cache») que ya no está en
 * `public`. No se prueba la escritura: un `PATCH` que no matchea filas sigue
 * siendo una escritura a producción desde un cron, y el dato que hace falta
 * para decidir la Vía B es **dónde vive la tabla**, no si `anon` puede
 * escribirle.
 *
 * Consecuencia de esa elección: si Support aplica la Vía A2 (RLS habilitado y
 * escrituras revocadas), la tabla **sigue legible** y la sonda la ve expuesta.
 * Es correcto —A2 cierra la alerta crítica pero no es el arreglo—; el informe
 * lo dice para que un rojo después del plazo no se lea como «Support no hizo
 * nada».
 *
 * ## Uso
 *
 *   npm run check:postgis
 *   npm run check:postgis -- --json
 *   npm run check:postgis -- --deadline 2026-10-30T21:00:00Z
 *
 * Salida: `0` = cerrado o todavía en plazo · `1` = plazo vencido y sigue en
 * `public` · `2` = no se pudo sondear (sin URL, sin clave o respuesta que no se
 * entiende) — que **no** es un «está bien».
 */
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { classifySupabaseUrl } from './check-auth-config.mjs';
import { readCredentials } from './check-schema.mjs';

/** La tabla que delata dónde se instaló PostGIS. */
export const EXPOSED_TABLE = 'spatial_ref_sys';

/** Viernes 2026-10-23, 18:00 en Chile (UTC-3): fin de la espera a Support. */
export const DEADLINE_ISO = '2026-10-23T21:00:00Z';

/** Tiempo máximo de espera por la petición, en milisegundos. */
export const PROBE_TIMEOUT_MS = 15000;

/** Dónde está el procedimiento completo. Se cita en el informe. */
export const RUNBOOK = 'docs/runbook-postgis-esquema.md';

/**
 * Traduce la respuesta de PostgREST a un estado del mundo.
 *
 * `200` es «sigue en public». `404` —y el `PGRST205` que lo acompaña— es «ya no
 * está en public», que es el estado bueno. Todo lo demás es «no sé»: una clave
 * inválida, un HTML de proxy o un 500 no pueden contar como aprobado, porque
 * este script existe justamente para no suponer.
 *
 * @param {{ status?: number, payload?: unknown }} [response]
 * @returns {{ state: 'exposed' | 'moved' | 'unknown', detail: string }}
 */
export function classifyProbe({ status, payload } = {}) {
  const code = readCode(payload);
  const suffix = code ? ` (${code})` : '';

  if (status === 200) {
    return {
      state: 'exposed',
      detail: `la Data API responde 200: public.${EXPOSED_TABLE} sigue expuesta`,
    };
  }

  if (status === 404 || code === 'PGRST205') {
    return {
      state: 'moved',
      detail: `la Data API responde ${status ?? 404}${suffix}: public.${EXPOSED_TABLE} ya no está expuesta`,
    };
  }

  if (status === 401 || status === 403) {
    return {
      state: 'unknown',
      detail: `la clave pública no pudo leer (${status}${suffix}): revisá NEXT_PUBLIC_SUPABASE_ANON_KEY`,
    };
  }

  return {
    state: 'unknown',
    detail: `respuesta inesperada${status ? ` ${status}` : ''}${suffix}: no se puede decidir`,
  };
}

/** `PGRST205` viaja en el cuerpo JSON; una lista de filas o un `null` no son eso. */
function readCode(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '';
  return String(payload.code ?? '');
}

/**
 * El veredicto: qué estado, si eso es un fallo y qué hacer.
 *
 * El plazo no es una decoración: antes de esa fecha la tabla expuesta es lo
 * **esperado** (se está esperando a Support) y un rojo sería ruido; después, es
 * el disparador de la Vía B.
 *
 * @param {{ state: 'exposed' | 'moved' | 'unknown', now?: Date | string, deadline?: string }} input
 * @returns {{ verdict: 'moved' | 'waiting' | 'overdue' | 'unknown', failed: boolean, detail: string }}
 */
export function judge({ state, now = new Date(), deadline = DEADLINE_ISO }) {
  const at = new Date(now);
  const limit = new Date(deadline);

  if (Number.isNaN(limit.getTime())) {
    return { verdict: 'unknown', failed: true, detail: `el plazo «${deadline}» no es una fecha` };
  }

  if (state === 'moved') {
    return {
      verdict: 'moved',
      failed: false,
      detail: `PostGIS ya no vive en public: el aviso del Security Advisor está cerrado`,
    };
  }

  if (state === 'exposed') {
    if (at.getTime() < limit.getTime()) {
      return {
        verdict: 'waiting',
        failed: false,
        detail: `en plazo hasta ${limit.toISOString()}: se espera la respuesta de Support (ticket SU-518175)`,
      };
    }
    return {
      verdict: 'overdue',
      failed: true,
      detail: `plazo vencido (${limit.toISOString()}) y public.${EXPOSED_TABLE} sigue expuesta`,
    };
  }

  return { verdict: 'unknown', failed: true, detail: 'no se pudo determinar dónde vive la extensión' };
}

/**
 * El informe que se lee en el log y se pega en el issue.
 *
 * La línea de fallo empieza con `✗` y lleva el arreglo después de `→` porque así
 * lo interpreta `notice-health.mjs`: `✗` es lo que marca el motivo y se corta en
 * la flecha para calcular la huella.
 *
 * @param {{ state: 'exposed' | 'moved' | 'unknown', probe: { detail: string }, judgement: { verdict: string, failed: boolean, detail: string }, now?: Date | string, deadline?: string }} input
 * @returns {string}
 */
export function formatReport({ state, probe, judgement, now = new Date(), deadline = DEADLINE_ISO }) {
  const at = new Date(now).toISOString();
  const lines = ['', `PostGIS en public · ${at}`, ''];

  if (judgement.failed) {
    // El `→` va en la misma línea que el `✗`: `notice-health.mjs` calcula la
    // huella del motivo cortando ahí, así que el arreglo no la hace cambiar.
    const hint =
      judgement.verdict === 'overdue'
        ? `→ Ejecutar la Vía B en una ventana sin escrituras, con los exports del día: ${RUNBOOK} §Vía B`
        : `→ Revisá ${RUNBOOK}: la sonda no pudo decidir, y un «no sé» no es un aprobado`;

    lines.push(`  ✗ ${judgement.detail} ${hint}`);
    lines.push(`    Sonda: ${probe.detail}`);
    if (judgement.verdict === 'overdue') {
      lines.push('    Si Support aplicó la A2, la tabla sigue legible a propósito: el traslado');
      lines.push('    a `extensions` sigue pendiente.');
    }
    lines.push('');
    return lines.join('\n');
  }

  if (judgement.verdict === 'moved') {
    lines.push(`  ✓ ${judgement.detail}`);
  } else {
    lines.push(`  · ${judgement.detail}`);
    lines.push(`    Sonda: ${probe.detail}`);
    lines.push(`    La tabla expuesta es el estado esperado hasta ${new Date(deadline).toISOString()}.`);
  }

  if (state === 'exposed') {
    lines.push('    Vías posibles y el disparador de la B: ' + RUNBOOK);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * La petición, sin decidir nada: eso lo hacen `classifyProbe` y `judge`.
 *
 * @param {{ baseUrl: string, apiKey: string, fetchImpl?: typeof fetch, timeoutMs?: number }} options
 * @returns {Promise<{ status: number, payload: { code?: string } | null }>}
 */
export async function probeTable({
  baseUrl,
  apiKey,
  fetchImpl = fetch,
  timeoutMs = PROBE_TIMEOUT_MS,
}) {
  const url = `${String(baseUrl).replace(/\/+$/, '')}/rest/v1/${EXPOSED_TABLE}?select=srid&limit=1`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      headers: { apikey: apiKey, Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: controller.signal,
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // Un cuerpo que no es JSON (un HTML de proxy, por ejemplo) no invalida el
      // código de estado: `classifyProbe` decide con lo que haya.
      payload = null;
    }

    return { status: response.status, payload };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * La sonda completa: pedir, clasificar y juzgar.
 *
 * @param {{ baseUrl: string, apiKey: string, now?: Date | string, deadline?: string, fetchImpl?: typeof fetch }} options
 * @returns {Promise<{ state: 'exposed' | 'moved' | 'unknown', probe: { detail: string }, judgement: { verdict: string, failed: boolean, detail: string }, error: string | null }>}
 */
export async function runPostgisCheck({
  baseUrl,
  apiKey,
  now = new Date(),
  deadline = DEADLINE_ISO,
  fetchImpl = fetch,
}) {
  let response;
  try {
    response = await probeTable({ baseUrl, apiKey, fetchImpl });
  } catch (error) {
    const probe = {
      state: 'unknown',
      detail: `la petición falló: ${error instanceof Error ? error.message : String(error)}`,
    };
    return {
      state: 'unknown',
      probe,
      judgement: judge({ state: 'unknown', now, deadline }),
      error: probe.detail,
    };
  }

  const probe = classifyProbe(response);
  return {
    state: probe.state,
    probe,
    judgement: judge({ state: probe.state, now, deadline }),
    error: null,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// CLI
// ═════════════════════════════════════════════════════════════════════════════

function parseArgs(argv) {
  const args = { url: null, key: null, now: null, deadline: null, json: false, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--url') args.url = argv[++i] ?? null;
    else if (arg.startsWith('--url=')) args.url = arg.slice('--url='.length);
    else if (arg === '--key') args.key = argv[++i] ?? null;
    else if (arg.startsWith('--key=')) args.key = arg.slice('--key='.length);
    else if (arg === '--now') args.now = argv[++i] ?? null;
    else if (arg.startsWith('--now=')) args.now = arg.slice('--now='.length);
    else if (arg === '--deadline') args.deadline = argv[++i] ?? null;
    else if (arg.startsWith('--deadline=')) args.deadline = arg.slice('--deadline='.length);
  }

  return args;
}

function usage() {
  console.log(
    [
      '',
      'Comprueba si PostGIS sigue instalada en `public` (aviso crítico del Security Advisor).',
      'Solo lee, y solo necesita la clave pública: no usa SUPABASE_ACCESS_TOKEN.',
      '',
      '  npm run check:postgis',
      '  npm run check:postgis -- --json',
      '  npm run check:postgis -- --now 2026-10-24T00:00:00Z   # simula otra fecha',
      '',
      'Opciones:',
      '  --url <url>        proyecto a sondear (por defecto, NEXT_PUBLIC_SUPABASE_URL de .env.local)',
      '  --key <anon>       clave pública (por defecto, NEXT_PUBLIC_SUPABASE_ANON_KEY de .env.local)',
      '  --deadline <iso>   fin de la espera a Support (por defecto, POSTGIS_DEADLINE o',
      `                     ${DEADLINE_ISO})`,
      '  --now <iso>        fecha con la que se juzga, para probar el aviso',
      '  --json             el veredicto en JSON, para encadenar con otras herramientas',
      '  --help             esto',
      '',
      'Salida: 0 = cerrado o todavía en plazo · 1 = plazo vencido y sigue en public ·',
      '        2 = no se pudo sondear, que no es un «está bien».',
      '',
    ].join('\n')
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();

  const credentials = readCredentials();
  const url = args.url ?? credentials.url;
  const key = args.key ?? credentials.key;
  // `||` y no `??`: el workflow pasa `POSTGIS_DEADLINE` aunque la variable no
  // exista, y una cadena vacía no es una fecha (daría «plazo inválido» en cada
  // corrida). Vacío o ausente cae al plazo por defecto.
  const deadline = args.deadline || process.env.POSTGIS_DEADLINE?.trim() || DEADLINE_ISO;
  const now = args.now ? new Date(args.now) : new Date();

  const urlCheck = classifySupabaseUrl(url);
  if (!urlCheck.ok) {
    console.error(`✖ No hay proyecto Supabase que sondear: ${urlCheck.reason}`);
    console.error('  Poné NEXT_PUBLIC_SUPABASE_URL en .env.local o pasá --url.');
    process.exitCode = 2;
    return;
  }

  if (!key) {
    console.error('✖ Falta la clave pública (NEXT_PUBLIC_SUPABASE_ANON_KEY): sin ella PostgREST no responde.');
    console.error('  Está en Project Settings » API del proyecto, y es pública: sale en el bundle del navegador.');
    process.exitCode = 2;
    return;
  }

  const result = await runPostgisCheck({ baseUrl: url, apiKey: key, now, deadline });

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          state: result.state,
          verdict: result.judgement.verdict,
          failed: result.judgement.failed,
          detail: result.judgement.detail,
          probe: result.probe.detail,
          deadline,
          now: now.toISOString(),
        },
        null,
        2
      )
    );
  } else {
    console.log(
      formatReport({
        state: result.state,
        probe: result.probe,
        judgement: result.judgement,
        now,
        deadline,
      })
    );
  }

  if (result.judgement.failed) {
    // `::error::` pinta el aviso en la lista de la corrida, además del job rojo:
    // el motivo no hay que buscarlo en el log.
    if (process.env.GITHUB_ACTIONS) {
      console.error(`::error::PostGIS en public: ${result.judgement.detail}`);
    }
    process.exitCode = result.state === 'unknown' ? 2 : 1;
  }
}

// Solo corre al ejecutarse: así los tests pueden importar el núcleo.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main().catch((error) => {
    console.error(`✖ La sonda de PostGIS falló de forma inesperada: ${error instanceof Error ? error.message : error}`);
    console.error('  Nada se modificó: la sonda es de solo lectura.');
    process.exit(2);
  });
}
