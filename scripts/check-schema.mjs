#!/usr/bin/env node
/**
 * Sonda de esquema: ¿la base soporta el código que se va a publicar?
 *
 * `/api/health` responde «¿el despliegue está configurado?» y `smoke:prod`
 * responde «¿las rutas responden?». Ninguno de los dos mira el **esquema**, y
 * ese hueco ya se cobró dos incidentes: el panel de corredoras quedó en vivo
 * contra `properties.rol`, `properties.rented` y la vinculación de socio que no
 * existían en producción.
 *
 * Este script contesta la pregunta que faltaba con una petición de lectura por
 * objeto requerido, contra la API pública de Supabase (PostgREST):
 *
 *   - **columnas**: `GET /rest/v1/properties?select=rol&limit=1`. Si la columna
 *     no existe, PostgREST responde `400` con código `42703` y lo dice con
 *     todas las letras; si existe, responde `200` (aunque no haya filas).
 *   - **funciones**: `POST /rest/v1/rpc/rix7_partner_id`. Si no existe responde
 *     `404` con `PGRST202` («no matches found»); si existe, `200`/`204`.
 *
 * ## Por qué no necesita `SUPABASE_ACCESS_TOKEN`
 *
 * Aplicar migraciones sí lo necesita (`npm run db:push` usa la Management API),
 * pero **comprobar** si están aplicadas no: alcanza la clave anónima, que ya es
 * pública (viaja en el bundle del navegador) y vive en `.env.local` junto a
 * `NEXT_PUBLIC_SUPABASE_URL`. Eso es lo que hace útil a esta sonda: el día que
 * el token no está a mano nadie se queda sin saber si la base está lista —
 * antes, esa era la respuesta («sin credenciales no se puede saber») y por eso
 * el release podía publicar contra una base incompleta.
 *
 * Es de **solo lectura**: no escribe ni migra nada. Solo dice qué falta y con
 * qué migración se arregla.
 *
 * Uso:
 *   npm run check:schema
 *   npm run check:schema -- --url https://xxxx.supabase.co --key <anon>
 *   npm run check:schema -- --json
 *
 * Salida: 0 = la base soporta el código · 1 = falta algo (dice qué migración) ·
 * 2 = no se pudo sondear (sin URL o sin clave) — que **no** es un «está bien».
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifySupabaseUrl, readEnvContent } from './check-auth-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** El `.env.local` del proyecto: de ahí salen la URL y la clave pública. */
const ENV_FILE = path.join(ROOT, '.env.local');

/** Tiempo máximo de espera por petición, en milisegundos. */
export const PROBE_TIMEOUT_MS = 15000;

/**
 * Los objetos de esquema que el código desplegado da por existentes.
 *
 * Cada entrada nombra la migración que lo crea: el informe no dice «falta una
 * columna», dice «aplicá `0015_rol_y_video`», que es la diferencia entre un
 * diagnóstico y una tarea.
 *
 * @typedef {{ id: string, kind: 'column' | 'rpc', table?: string, column?: string, name?: string, body?: string, migration: string, because: string }} SchemaRequirement
 * @type {SchemaRequirement[]}
 */
export const REQUIRED_SCHEMA = [
  {
    id: 'solicitudes.kind',
    kind: 'column',
    table: 'solicitudes',
    column: 'kind',
    migration: '0018_solicitudes',
    because:
      'es la bandeja de Publicar: sin la tabla, las solicitudes de propietarios y los registros de empresa no se pueden guardar',
  },
  {
    id: 'partners.kind',
    kind: 'column',
    table: 'partners',
    column: 'kind',
    migration: '0024_socios_tipo',
    because:
      'el panel de Socios filtra por categoría y las lecturas piden la columna: sin ella, el listado de socios y el carrusel de la portada fallan',
  },
  {
    id: 'leads.source',
    kind: 'column',
    table: 'leads',
    column: 'source',
    migration: '0016_share_events_y_origen',
    because: 'el panel distingue si el contacto nació en la ficha o en la landing compartida',
  },
  {
    id: 'share_events.channel',
    kind: 'column',
    table: 'share_events',
    column: 'channel',
    migration: '0016_share_events_y_origen',
    because: 'es el registro de quién compartió cada enlace; sin la tabla, el alta de compartidos falla',
  },
  {
    id: 'properties.rol',
    kind: 'column',
    table: 'properties',
    column: 'rol',
    migration: '0015_rol_y_video',
    because: 'el panel del socio guarda el Rol del SII en cada publicación',
  },
  {
    id: 'properties.video_url',
    kind: 'column',
    table: 'properties',
    column: 'video_url',
    migration: '0015_rol_y_video',
    because: 'la ficha y la landing /compartir muestran el video de la publicación',
  },
  {
    id: 'properties.video_poster',
    kind: 'column',
    table: 'properties',
    column: 'video_poster',
    migration: '0015_rol_y_video',
    because: 'es el fotograma de portada del video (evita el recuadro negro)',
  },
  {
    id: 'properties.common_expenses',
    kind: 'column',
    table: 'properties',
    column: 'common_expenses',
    migration: '0022_gastos_contribuciones_garantia',
    because: 'la ficha del socio muestra los gastos comunes: sin la columna, la sonda del detalle falla y la ficha no se puede generar',
  },
  {
    id: 'properties.property_taxes',
    kind: 'column',
    table: 'properties',
    column: 'property_taxes',
    migration: '0022_gastos_contribuciones_garantia',
    because: 'la ficha muestra las contribuciones informadas por la corredora',
  },
  {
    id: 'properties.deposit',
    kind: 'column',
    table: 'properties',
    column: 'deposit',
    migration: '0022_gastos_contribuciones_garantia',
    because: 'la ficha muestra la garantía exigida en los arriendos',
  },
  {
    id: 'properties.property_taxes_source',
    kind: 'column',
    table: 'properties',
    column: 'property_taxes_source',
    migration: '0023_fuente_contribuciones',
    because: 'el panel guarda si el monto de contribuciones lo trajo la consulta al SII o se escribió a mano; sin la columna, guardar una publicación consultada falla',
  },
  {
    id: 'properties.property_taxes_checked_at',
    kind: 'column',
    table: 'properties',
    column: 'property_taxes_checked_at',
    migration: '0023_fuente_contribuciones',
    because: 'el panel muestra la fecha de la consulta al SII y la publica junto al monto si se usa',
  },
  {
    id: 'kyb_applications.status',
    kind: 'column',
    table: 'kyb_applications',
    column: 'status',
    migration: '0026_kyb_onboarding',
    because: 'es el alta de empresas: sin la tabla, el flujo KYB no puede ni registrar una solicitud ni moverla de estado',
  },
  {
    id: 'kyb_applications.token_hash',
    kind: 'column',
    table: 'kyb_applications',
    column: 'token_hash',
    migration: '0026_kyb_onboarding',
    because: 'es con lo que la empresa responde las preguntas y elige plan: si falta, los enlaces del correo no resuelven la solicitud',
  },
  {
    id: 'kyb_evaluations.score',
    kind: 'column',
    table: 'kyb_evaluations',
    column: 'score',
    migration: '0026_kyb_onboarding',
    because: 'el panel muestra el puntaje y el historial de corridas del motor; sin la tabla, la evaluación no deja rastro',
  },
  {
    id: 'rix7_partner_id()',
    kind: 'rpc',
    name: 'rix7_partner_id',
    migration: '0014_socio_publicaciones',
    because: 'es el vínculo cuenta ↔ corredora que usan las políticas RLS de properties: sin él, editar o dar de baja el stock de la corredora falla aunque el panel lo liste',
  },
  {
    id: 'get_properties_filtered(bbox)',
    kind: 'rpc',
    name: 'get_properties_filtered',
    // Se llama **como la llama el portal**: solo el recuadro del mapa. Esa es la
    // gracia de la sonda: con dos firmas candidatas PostgREST responde
    // `PGRST203` (300) a esta llamada, y el buscador se queda sin propiedades
    // aunque la tabla esté llena.
    body: '{"min_lng":-76,"min_lat":-56,"max_lng":-66,"max_lat":-17}',
    migration: '0005_properties_rpc',
    because: 'es el buscador: si la función quedó con dos firmas (una base vieja más el CREATE OR REPLACE), PostgREST no sabe cuál elegir y el listado cae en silencio al catálogo del código',
  },
];

// ═════════════════════════════════════════════════════════════════════════════
// Núcleo puro (probado en check-schema.test.ts)
// ═════════════════════════════════════════════════════════════════════════════

/** Quita la barra final para no armar `//rest/v1`. */
export function normalizeBaseUrl(url) {
  return String(url ?? '').trim().replace(/\/+$/, '');
}

/**
 * La petición que comprueba cada objeto requerido.
 *
 * Una columna se lee (una fila, una columna: no se trae nada); una función se
 * invoca sin argumentos —`auth.jwt()` la resuelve con la sesión anónima y
 * devuelve `NULL`, que es justo lo que queremos: que exista, no que haga algo—.
 *
 * @param {SchemaRequirement[]} [requirements]
 * @param {string} baseUrl
 * @returns {{ id: string, migration: string, because: string, url: string, method: 'GET' | 'POST', body: string | null }[]}
 */
export function schemaPlan(requirements = REQUIRED_SCHEMA, baseUrl) {
  const base = normalizeBaseUrl(baseUrl);

  return requirements.map((requirement) => ({
    id: requirement.id,
    migration: requirement.migration,
    because: requirement.because,
    url:
      requirement.kind === 'column'
        ? `${base}/rest/v1/${requirement.table}?select=${requirement.column}&limit=1`
        : `${base}/rest/v1/rpc/${requirement.name}`,
    method: requirement.kind === 'column' ? 'GET' : 'POST',
    // PostgREST exige un cuerpo JSON en `rpc/`, aunque la función no lleve
    // parámetros: sin él responde 400 por «falta el cuerpo», que no es lo que
    // queremos medir. Cuando la función sí lleva argumentos, el cuerpo es el
    // que declara el requisito: hay que probarla como la llama el portal, no de
    // una forma que ninguna persona usa.
    body: requirement.kind === 'rpc' ? requirement.body ?? '{}' : null,
  }));
}

/** El código de error de PostgREST, si el cuerpo trae uno. */
function errorCode(body) {
  return body && typeof body === 'object' && typeof body.code === 'string' ? body.code : null;
}

const errorMessage = (body) =>
  body && typeof body === 'object' && typeof body.message === 'string' ? body.message : null;

/**
 * Cómo leer la respuesta de una columna.
 *
 * Se distinguen tres cosas que se confunden fácil: `present` (existe), `missing`
 * (no existe: `42703` de Postgres o `PGRST204` de PostgREST, los dos significan
 * lo mismo acá) y `unknown` (no se pudo decidir: otro error, un HTML de proxy,
 * un 401 por clave inválida). Un `unknown` **no** es un aprobado: la sonda lo
 * reporta y sale rojo, porque un «no sé» dado por bueno es cómo se llega a
 * publicar contra una base sin la columna.
 *
 * @param {number} status
 * @param {unknown} body
 * @returns {{ verdict: 'present' | 'missing' | 'unknown', detail: string }}
 */
export function judgeColumn(status, body) {
  if (status === 200 || status === 206) return { verdict: 'present', detail: 'existe' };

  const code = errorCode(body);
  if (code === '42703' || code === 'PGRST204' || code === 'PGRST205') {
    return { verdict: 'missing', detail: errorMessage(body) ?? `falta la columna o la tabla (${code})` };
  }

  if (status === 400) {
    return { verdict: 'unknown', detail: errorMessage(body) ?? 'HTTP 400 con un error que no identifica la columna' };
  }

  return { verdict: 'unknown', detail: `HTTP ${status}${errorMessage(body) ? `: ${errorMessage(body)}` : ''}` };
}

/**
 * Cómo leer la respuesta de una función RPC.
 *
 * `PGRST202` es el «no existe» de PostgREST («Searched for the function … but no
 * matches found»). Un `401`/`403` cuenta como **presente**: la función está —lo
 * que falta es permiso de ejecución— y eso es otra conversación. Un `500` es un
 * `unknown`: puede ser una función rota por dentro, y eso no autoriza a decir
 * que el esquema está bien.
 *
 * @param {number} status
 * @param {unknown} body
 * @returns {{ verdict: 'present' | 'missing' | 'unknown', detail: string }}
 */
export function judgeRpc(status, body) {
  if (status === 200 || status === 204) return { verdict: 'present', detail: 'existe' };

  const code = errorCode(body);
  if (code === 'PGRST202' || status === 404) {
    return { verdict: 'missing', detail: 'la función no existe en la base' };
  }
  if (code === 'PGRST203' || status === 300) {
    // «Could not choose the best candidate function»: hay más de una firma con
    // el mismo nombre. La función existe, pero **no responde** a la llamada del
    // portal, así que para el buscador es igual que faltar.
    return {
      verdict: 'missing',
      detail: 'la función quedó con más de una firma (sobrecarga): PostgREST no sabe cuál elegir',
    };
  }
  if (status === 401 || status === 403) {
    return { verdict: 'present', detail: `HTTP ${status}: existe (la ejecución anónima no está permitida, que es esperable)` };
  }

  return { verdict: 'unknown', detail: `HTTP ${status}${errorMessage(body) ? `: ${errorMessage(body)}` : ''}` };
}

/** Cómo leer la respuesta según el tipo de objeto. */
export function judgeObject(kind, status, body) {
  return kind === 'rpc' ? judgeRpc(status, body) : judgeColumn(status, body);
}

/**
 * Junta los veredictos de todas las comprobaciones.
 *
 * `ok` exige que **cada** objeto esté presente: la sonda no gradúa. Faltantes y
 * desconocidos se separan porque se arreglan distinto —uno es una migración, el
 * otro suele ser una credencial o un despliegue de Supabase a medio andar—, y
 * los faltantes se agrupan por migración para que el informe diga «aplicá
 * `0015_rol_y_video`» en vez de repetir el nombre de tres columnas.
 *
 * @param {{ id: string, migration: string, because: string, verdict: 'present' | 'missing' | 'unknown', detail: string }[]} results
 * @returns {{ ok: boolean, present: string[], missing: { id: string, migration: string, because: string, detail: string }[], unknown: { id: string, detail: string }[], migrations: string[] }}
 */
export function judgeSchema(results) {
  const present = results.filter((r) => r.verdict === 'present').map((r) => r.id);
  const missing = results
    .filter((r) => r.verdict === 'missing')
    .map((r) => ({ id: r.id, migration: r.migration, because: r.because, detail: r.detail }));
  const unknown = results
    .filter((r) => r.verdict === 'unknown')
    .map((r) => ({ id: r.id, detail: r.detail }));

  // En el orden en que aparecen en el manifiesto: el informe se lee de arriba
  // hacia abajo, y así el orden no depende de qué respondió primero la red.
  const migrations = Array.from(new Set(missing.map((item) => item.migration)));

  return { ok: missing.length === 0 && unknown.length === 0, present, missing, unknown, migrations };
}

/**
 * Consulta la API pública de Supabase y junta los veredictos.
 *
 * La red entra inyectada (`fetchImpl`) para poder probar el veredicto sin
 * depender de un proyecto real.
 *
 * @param {{ baseUrl: string, apiKey: string, requirements?: SchemaRequirement[], fetchImpl?: typeof fetch, timeoutMs?: number }} options
 * @returns {Promise<{ baseUrl: string, probeUrl: string, results: { id: string, migration: string, because: string, verdict: 'present' | 'missing' | 'unknown', detail: string }[], judgement: ReturnType<typeof judgeSchema>, error: string | null }>}
 */
export async function runSchemaCheck({
  baseUrl,
  apiKey,
  requirements = REQUIRED_SCHEMA,
  fetchImpl = fetch,
  timeoutMs = PROBE_TIMEOUT_MS,
}) {
  const base = normalizeBaseUrl(baseUrl);
  const plan = schemaPlan(requirements, base);
  const results = [];

  for (const probe of plan) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(probe.url, {
        method: probe.method,
        headers: {
          apikey: apiKey,
          authorization: `Bearer ${apiKey}`,
          accept: 'application/json',
          ...(probe.body ? { 'content-type': 'application/json' } : {}),
        },
        body: probe.body,
        signal: controller.signal,
      });

      // El cuerpo se lee como texto y se intenta parsear: PostgREST a veces
      // contesta HTML (un proxy en el medio, un error del borde) y un `json()`
      // a secas convertiría ese caso en una excepción sin diagnóstico.
      const raw = await response.text().catch(() => '');
      let body = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = null;
      }

      const requirement = requirements.find((item) => item.id === probe.id);
      const { verdict, detail } = judgeObject(requirement?.kind ?? 'column', response.status, body);
      results.push({ id: probe.id, migration: probe.migration, because: probe.because, verdict, detail });
    } catch (error) {
      results.push({
        id: probe.id,
        migration: probe.migration,
        because: probe.because,
        verdict: 'unknown',
        detail: `no se pudo consultar: ${error instanceof Error ? error.message : 'error desconocido'}`,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  const judgement = judgeSchema(results);
  const firstUnknown = judgement.unknown[0];
  const error =
    judgement.ok || judgement.missing.length
      ? null
      : `no se pudo decidir sobre ${firstUnknown?.id ?? 'un objeto'}: ${firstUnknown?.detail ?? ''}`;

  return { baseUrl: base, probeUrl: `${base}/rest/v1/`, results, judgement, error };
}

/** El informe legible para la consola. */
export function formatReport({ baseUrl, results, judgement }) {
  const mark = { present: '✓', missing: '✗', unknown: '?' };
  const lines = ['', `== Sonda de esquema · ${baseUrl} ==`, ''];

  for (const result of results) {
    lines.push(`  ${mark[result.verdict]} ${result.id} — ${result.detail}`);
    if (result.verdict !== 'present') lines.push(`      para qué: ${result.because}`);
  }

  lines.push('');

  for (const migration of judgement.migrations) {
    const ids = judgement.missing.filter((item) => item.migration === migration).map((item) => item.id);
    lines.push(`  ✗ Aplicá ${migration} (crea ${ids.join(', ')}).`);
  }

  if (judgement.missing.length > 0) {
    lines.push(
      '    Se aplica con `npm run db:push` (necesita SUPABASE_ACCESS_TOKEN en .env.local) o, sin token,'
    );
    lines.push('    generando el SQL con `npm run db:apply-sql` y ejecutándolo en el SQL Editor.');
    lines.push('    Publicar el código así deja el portal con funciones que fallan al usarse, no al desplegarse.');
  }

  if (judgement.unknown.length > 0) {
    lines.push(`  ? No se pudo decidir sobre ${judgement.unknown.length} objeto(s):`);
    for (const item of judgement.unknown) lines.push(`      · ${item.id}: ${item.detail}`);
    lines.push('    Un «no sé» no es un aprobado: revisá la URL, la clave pública y que el proyecto responda.');
  }

  if (judgement.ok) lines.push('  ✓ La base soporta el código: todo lo requerido existe.');

  lines.push('');
  return lines.join('\n');
}

// ═════════════════════════════════════════════════════════════════════════════
// CLI
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Las claves del entorno: primero `process.env` (lo que ya está exportado),
 * después `.env.local` —el mismo orden que `db-push.mjs`—, para que el script
 * funcione desde un `npm run` y desde el release sin exportar nada a mano.
 *
 * @param {{ env?: Record<string, string | undefined>, envFile?: string, exists?: (filePath: string) => boolean, read?: (filePath: string) => string }} [options]
 * @returns {{ url: string | null, key: string | null }}
 */
export function readCredentials({
  env = process.env,
  envFile = ENV_FILE,
  exists = existsSync,
  read = (filePath) => readFileSync(filePath, 'utf8'),
} = {}) {
  const fromFile = exists(envFile) ? readEnvContent(read(envFile)) : {};
  const readEnv = (key) => env[key] || fromFile[key] || null;

  return {
    url: readEnv('NEXT_PUBLIC_SUPABASE_URL'),
    key: readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  };
}

function parseArgs(argv) {
  const args = { url: null, key: null, json: false, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--url') args.url = argv[++i] ?? null;
    else if (arg.startsWith('--url=')) args.url = arg.slice('--url='.length);
    else if (arg === '--key') args.key = argv[++i] ?? null;
    else if (arg.startsWith('--key=')) args.key = arg.slice('--key='.length);
  }

  return args;
}

function usage() {
  console.log(
    [
      '',
      'Comprueba que la base de Supabase tenga todo lo que el código desplegado usa.',
      'Es de solo lectura y solo necesita la clave pública: no usa SUPABASE_ACCESS_TOKEN.',
      '',
      '  npm run check:schema',
      '  npm run check:schema -- --url https://xxxx.supabase.co --key <anon>',
      '  npm run check:schema -- --json',
      '',
      'Opciones:',
      '  --url <url>   proyecto a sondear (por defecto, NEXT_PUBLIC_SUPABASE_URL de .env.local)',
      '  --key <anon>  clave pública (por defecto, NEXT_PUBLIC_SUPABASE_ANON_KEY de .env.local)',
      '  --json        el veredicto en JSON, para encadenar con otras herramientas',
      '  --help        esto',
      '',
      'Salida: 0 = la base soporta el código · 1 = falta algo, dice qué migración ·',
      '        2 = no se pudo sondear (sin URL o sin clave), que no es un «está bien».',
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

  const result = await runSchemaCheck({ baseUrl: url, apiKey: key });

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          baseUrl: result.baseUrl,
          ok: result.judgement.ok,
          missing: result.judgement.missing,
          unknown: result.judgement.unknown,
          migrations: result.judgement.migrations,
        },
        null,
        2
      )
    );
  } else {
    console.log(formatReport(result));
  }

  if (!result.judgement.ok) {
    const detail = result.judgement.missing.length
      ? `falta aplicar ${result.judgement.migrations.join(', ')}`
      : result.error ?? 'no se pudo decidir sobre el esquema';
    // `::error::` pinta el aviso en la lista de la corrida de GitHub, además del
    // job rojo: el motivo no hay que buscarlo en el log.
    if (process.env.GITHUB_ACTIONS) console.error(`::error::Esquema de la base: ${detail}`);
    process.exitCode = 1;
  }
}

// Solo corre al ejecutarse: así los tests pueden importar el núcleo.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main().catch((error) => {
    console.error(`✖ La sonda de esquema falló de forma inesperada: ${error instanceof Error ? error.message : error}`);
    console.error('  Nada se modificó: la sonda es de solo lectura.');
    process.exit(2);
  });
}
