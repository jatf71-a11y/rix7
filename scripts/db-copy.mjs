#!/usr/bin/env node
/**
 * Copia el catálogo público (`properties` + `partners`) de un proyecto Supabase
 * a otro.
 *
 * ¿Por qué existe? El 2026-10-13 el proyecto en vivo quedó sin dueño accesible:
 * su cuenta era solo-GitHub y ese GitHub fue eliminado. La salida del incidente
 * es levantarlo de nuevo bajo una cuenta propia, y eso tiene dos mitades:
 * aplicar el esquema (`npm run db:push`, o `npm run db:apply-sql` si no hay
 * token) y **reponer los datos**. Esto hace la segunda, sin depender de la
 * cuenta perdida: se lee con la clave pública del proyecto viejo (el catálogo es
 * público por diseño) y se escribe con un token personal de la API de
 * administración del proyecto nuevo.
 *
 *   npm run db:copy -- --from-url https://<ref-viejo>.supabase.co --ref <ref-nuevo> --replace
 *
 * Reglas que respeta:
 *
 * - **Solo lectura del origen.** Nunca escribe en el proyecto del que copia: si
 *   algo sale mal, el original queda igual.
 * - **No inventa tipos.** Los valores se traducen a literales SQL según lo que
 *   devuelve PostgREST: texto, número, booleano, `null`, arreglos como
 *   `TEXT[]` y la columna geográfica `location`, que llega como EWKB y se
 *   reconstruye con `ST_GeogFromWKB`.
 * - **Idempotente.** `ON CONFLICT (<clave>) DO NOTHING`: correrlo dos veces no
 *   duplica nada.
 * - `--replace` borra **solo** las filas de las tablas que copia, y es explícito:
 *   sin la bandera no se borra nada. `properties` referencia `partners`, así que
 *   el orden de inserción es partners → properties.
 *
 * Lo que **traduce** en vez de copiar tal cual (§`VALUE_FIXES` y
 * `DROPPED_COLUMNS`), y se informa en pantalla:
 *
 * - `properties.property_type`: `vip` → `premium`. El vocabulario vigente del
 *   código es `premium` (migración `0013`); el proyecto viejo quedó con `vip`, y
 *   copiarlo tal cual reintroduciría propiedades fuera del chip Premium.
 * - `properties.user_id`: se omite. Apunta a `auth.users`, y las cuentas de Auth
 *   **no se pueden exportar**: la fila no podría entrar por la clave foránea.
 *   La propiedad se copia sin ese vínculo, que se rehace al devolverle el acceso
 *   a la corredora (`--keep-user-id` para no omitirlo, si el destino ya tuviera
 *   esas cuentas).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { runQuery } from './db-push.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = path.join(ROOT, '.env.local');

/**
 * Tablas del catálogo, en el orden en que se pueden insertar sin violar claves
 * foráneas. Es lo que se copia por defecto: los datos que el portal necesita
 * para mostrar el catálogo y para atribuir cada propiedad a su corredora.
 *
 * @typedef {{ name: string, pk: string[], why?: string }} TableSpec
 * @type {TableSpec[]}
 */
export const TABLES = [
  { name: 'partners', pk: ['id'] },
  { name: 'properties', pk: ['id'] },
];

/**
 * Tablas que se pueden sumar con `--tables`. No se copian por defecto porque
 * llevan datos de personas, y solo salen del origen si la clave que se usa para
 * leerlos los alcanza (la pública no: RLS los esconde).
 *
 * @type {TableSpec[]}
 */
export const OPTIONAL_TABLES = [
  {
    name: 'leads',
    pk: ['id'],
    why: 'las consultas de las personas interesadas (necesita una clave del origen con permiso de lectura)',
  },
  {
    name: 'signups',
    pk: ['id'],
    why: 'las altas del boletín y de la lista de espera',
  },
  {
    name: 'share_events',
    pk: ['id'],
    why: 'quién compartió cada enlace (necesita una clave del origen con permiso de lectura)',
  },
];

/** Todo lo que la herramienta sabe copiar, con su clave. @type {TableSpec[]} */
export const KNOWN_TABLES = [...TABLES, ...OPTIONAL_TABLES];

/**
 * Lo que **no** se copia, con el motivo. Está acá para que el informe lo diga en
 * vez de que alguien lo descubra a mitad de camino.
 */
export const NOT_COPIED = [
  {
    name: 'saved_searches',
    because:
      'su `user_id` referencia `auth.users`, y las cuentas de Auth no se pueden exportar: la fila no entraría',
  },
  {
    name: 'favorites',
    because: 'igual que `saved_searches`: cuelga de `auth.users`',
  },
  {
    name: 'share_views / property_views',
    because: 'son contadores de visitas: arrancan de cero y no se pierde nada',
  },
  {
    name: 'usuarios de Auth',
    because:
      'no se pueden exportar desde acá (sí migrando el esquema `auth` completo, hashes incluidos, si el soporte devuelve el proyecto viejo); las cuentas se recrean con `npm run accesos:socias`, que además manda su enlace de acceso',
  },
];

/**
 * Valores que hay que traducir al llegar: divergencias conocidas entre lo que
 * quedó guardado en el proyecto viejo y el vocabulario vigente del código.
 *
 * @type {Record<string, Record<string, Record<string, string>>>}
 */
export const VALUE_FIXES = {
  properties: {
    property_type: { vip: 'premium' },
  },
};

/**
 * Columnas que se omiten al insertar, con el motivo.
 *
 * @type {Record<string, Record<string, string>>}
 */
export const DROPPED_COLUMNS = {
  properties: {
    user_id:
      'apunta a auth.users del origen: esa cuenta no se puede recrear en el destino, así que el vínculo se rehace al darle acceso a la corredora',
  },
};

/**
 * Lector de `.env` sin dependencias: `CLAVE=valor`, comillas y comentarios.
 *
 * @param {string} content
 * @returns {Record<string, string>}
 */
export function readEnvFile(content) {
  /** @type {Record<string, string>} */
  const result = {};
  for (const rawLine of String(content ?? '').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    if (key) result[key] = value;
  }
  return result;
}

/**
 * Traduce un valor de PostgREST a un literal SQL.
 *
 * @param {unknown} value
 * @param {string} column
 * @returns {string}
 */
export function sqlLiteral(value, column = '') {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`número no finito en ${column || 'una columna'}`);
    return String(value);
  }

  // `location` es GEOGRAPHY(POINT): PostgREST la devuelve como EWKB en hex, y
  // se reconstruye sin pasar por texto intermedio. Si algún día devolviera
  // GeoJSON, también se acepta.
  if (column === 'location') {
    if (typeof value === 'string' && /^[0-9a-f]+$/i.test(value)) {
      return `ST_GeogFromWKB(decode('${value}', 'hex'))`;
    }
    const coords = value && typeof value === 'object' ? value.coordinates : null;
    if (Array.isArray(coords) && coords.length === 2) {
      return `ST_SetSRID(ST_MakePoint(${Number(coords[0])}, ${Number(coords[1])}), 4326)::geography`;
    }
    throw new Error(`no se pudo interpretar la columna location: ${JSON.stringify(value).slice(0, 60)}`);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return `'{}'::text[]`;
    const items = value.map((item) => sqlLiteral(item, column));
    if (items.some((item) => item === 'NULL')) {
      throw new Error(`arreglo con nulos en ${column || 'una columna'}: no se puede copiar sin decidir cómo`);
    }
    return `ARRAY[${items.join(', ')}]::text[]`;
  }

  if (typeof value === 'object') {
    throw new Error(
      `valor compuesto inesperado en ${column || 'una columna'}: ${JSON.stringify(value).slice(0, 60)}`,
    );
  }

  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Aplica las traducciones conocidas a las filas de una tabla y devuelve lo que
 * hizo, para poder informarlo.
 *
 * @param {{ table: string, rows: Record<string, unknown>[], keepUserId?: boolean }} params
 * @returns {{ rows: Record<string, unknown>[], notes: string[] }}
 */
export function normalizeRows({ table, rows, keepUserId = false }) {
  const fixes = VALUE_FIXES[table] ?? {};
  const dropped = keepUserId ? {} : DROPPED_COLUMNS[table] ?? {};
  const notes = [];
  const counters = new Map();

  const normalized = rows.map((row) => {
    const copy = { ...row };

    for (const [column, map] of Object.entries(fixes)) {
      const before = copy[column];
      const after = Object.prototype.hasOwnProperty.call(map, String(before))
        ? map[String(before)]
        : before;
      if (after !== before) {
        const key = `${column}: ${String(before)} → ${String(after)}`;
        counters.set(key, (counters.get(key) ?? 0) + 1);
        copy[column] = after;
      }
    }

    for (const [column, why] of Object.entries(dropped)) {
      if (copy[column] !== undefined && copy[column] !== null) {
        const key = `${column}: omitido (${why})`;
        counters.set(key, (counters.get(key) ?? 0) + 1);
      }
      delete copy[column];
    }

    return copy;
  });

  for (const [text, count] of counters) notes.push(`${count} ${count === 1 ? 'fila' : 'filas'} · ${text}`);

  return { rows: normalized, notes };
}

/**
 * Arma los `INSERT` de una tabla. Los valores viajan en la misma sentencia que
 * las columnas, así que un cambio de forma entre origen y destino falla con un
 * error de Postgres explícito en vez de escribir datos corridos.
 *
 * @param {{ table: string, rows: Record<string, unknown>[], columns?: string[], pk?: string[] }} params
 * @returns {string}
 */
export function insertSql({ table, rows, columns, pk = ['id'] }) {
  if (!rows.length) return '';

  const cols = columns ?? Object.keys(rows[0]);
  const values = rows
    .map((row) => `  (${cols.map((col) => sqlLiteral(row[col], col)).join(', ')})`)
    .join(',\n');

  return (
    `INSERT INTO public.${table} (${cols.map((c) => `"${c}"`).join(', ')})\n` +
    `VALUES\n${values}\n` +
    `ON CONFLICT (${pk.map((c) => `"${c}"`).join(', ')}) DO NOTHING;`
  );
}

/**
 * El SQL completo de la copia: primero el borrado opcional, después los
 * `INSERT` en el orden en que no rompen claves foráneas.
 *
 * @param {{ data: Record<string, Record<string, unknown>[]>, replace?: boolean, tables?: TableSpec[] }} params
 * @returns {string}
 */
export function copySql({ data, replace = false, tables = TABLES }) {
  const parts = [];
  if (replace) {
    // Al revés que la inserción: `properties` referencia `partners`, así que se
    // borra primero la que apunta para no chocar con la clave foránea.
    for (const { name } of [...tables].reverse()) {
      parts.push(`DELETE FROM public.${name};`);
    }
  }
  for (const { name, pk } of tables) {
    const rows = data[name] ?? [];
    const sql = insertSql({ table: name, rows, pk });
    if (sql) parts.push(sql);
  }
  return `${parts.join('\n\n')}\n`;
}

/**
 * Qué URL de las filas apunta al **storage del propio origen**. Importan porque
 * el día que el proyecto viejo se apague, esas imágenes se van con él: hay que
 * bajarlas y volver a subirlas antes.
 *
 * @param {Record<string, Record<string, unknown>[]>} data
 * @param {string} sourceUrl
 * @returns {{ url: string, count: number }[]}
 */
export function foreignStorageUrls(data, sourceUrl) {
  const base = String(sourceUrl ?? '').replace(/\/+$/, '');
  if (!base) return [];

  const seen = new Map();
  const visit = (value) => {
    if (typeof value === 'string') {
      if (value.startsWith(`${base}/storage/v1/object/`)) {
        seen.set(value, (seen.get(value) ?? 0) + 1);
      }
      return;
    }
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };

  for (const rows of Object.values(data ?? {})) {
    for (const row of rows ?? []) visit(row);
  }

  return [...seen.entries()].map(([url, count]) => ({ url, count })).sort((a, b) => b.count - a.count);
}

/** Trae todas las filas de una tabla por PostgREST, paginando. */
export async function fetchRows({ url, key, table, fetchImpl = fetch, pageSize = 1000 }) {
  /** @type {Record<string, unknown>[]} */
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const res = await fetchImpl(`${url.replace(/\/$/, '')}/rest/v1/${table}?select=*`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Range: `${offset}-${offset + pageSize - 1}`,
        'Range-Unit': 'items',
      },
    });
    if (!res.ok) {
      throw new Error(`no se pudo leer ${table}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
    const page = await res.json();
    if (!Array.isArray(page) || page.length === 0) break;
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

/**
 * Lee las tablas pedidas del proyecto de origen.
 *
 * @param {{ url: string, key: string, tables?: TableSpec[], fetchImpl?: typeof fetch }} params
 */
export async function readCatalog({ url, key, tables = TABLES, fetchImpl = fetch }) {
  /** @type {Record<string, Record<string, unknown>[]>} */
  const data = {};
  for (const { name } of tables) {
    data[name] = await fetchRows({ url, key, table: name, fetchImpl });
  }
  return data;
}

/** La referencia del proyecto destino, deducida de la URL o del token. */
export function projectRefFromUrl(url) {
  const match = /https?:\/\/([a-z0-9]+)\.supabase\.co/i.exec(String(url ?? ''));
  return match ? match[1] : null;
}

/**
 * Resuelve `--tables` contra el catálogo de tablas conocidas.
 *
 * @param {string | null | undefined} value
 * @returns {{ tables: TableSpec[] } | { error: string }}
 */
export function resolveTables(value) {
  if (!value) return { tables: TABLES };

  const wanted = String(value)
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  const tables = [];
  for (const name of wanted) {
    const spec = KNOWN_TABLES.find((table) => table.name === name);
    if (!spec) {
      const notas = NOT_COPIED.filter((entry) => entry.name.split(' / ').includes(name));
      const reason = notas.length
        ? `no se puede copiar: ${notas[0].because}`
        : `no conozco esa tabla (las que sé: ${KNOWN_TABLES.map((t) => t.name).join(', ')})`;
      return { error: `«${name}» ${reason}` };
    }
    if (!tables.some((table) => table.name === spec.name)) tables.push(spec);
  }

  // Las tablas del catálogo van siempre, y todas en el orden canónico: si no,
  // `properties` podría insertarse antes que `partners` y violar la clave
  // foránea, y el mismo `--tables` daría dos SQL distintos según cómo se
  // escriba la lista.
  const ordered = [...TABLES];
  for (const { name } of KNOWN_TABLES) {
    if (!tables.some((table) => table.name === name)) continue;
    if (!ordered.some((known) => known.name === name)) ordered.push(KNOWN_TABLES.find((t) => t.name === name));
  }
  return { tables: ordered };
}

function parseArgs(argv) {
  const args = { dryRun: false, replace: false, out: null, keepUserId: false, tables: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--from-url') args.fromUrl = argv[++i];
    else if (arg.startsWith('--from-url=')) args.fromUrl = arg.slice('--from-url='.length);
    else if (arg === '--from-key') args.fromKey = argv[++i];
    else if (arg === '--ref') args.ref = argv[++i];
    else if (arg === '--token') args.token = argv[++i];
    else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--tables') args.tables = argv[++i];
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--replace') args.replace = true;
    else if (arg === '--keep-user-id') args.keepUserId = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function usage() {
  console.log(
    [
      '',
      'Copia el catálogo (partners + properties) de un proyecto Supabase a otro.',
      '',
      '  npm run db:copy -- --from-url https://<ref-viejo>.supabase.co --ref <ref-nuevo> --replace',
      '',
      'Opciones:',
      '  --from-url <url>   proyecto de origen (o SUPABASE_FROM_URL en .env.local)',
      '  --from-key <key>   clave de lectura del origen (o SUPABASE_FROM_ANON_KEY)',
      '  --ref <ref>        proyecto destino (o se deduce de NEXT_PUBLIC_SUPABASE_URL)',
      '  --tables <lista>   además del catálogo: leads, signups',
      '  --replace          borra las filas de las tablas que copia antes de insertar',
      '  --keep-user-id     no omite properties.user_id (solo si el destino ya tiene esas cuentas)',
      '  --out <archivo>    deja el SQL en un archivo, además de aplicarlo',
      '  --dry-run          lee el origen y genera el SQL, sin escribir en el destino',
      '',
      'Necesita SUPABASE_ACCESS_TOKEN (una cuenta con acceso al proyecto destino).',
      '',
    ].join('\n'),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();

  const envFile = existsSync(ENV_FILE) ? readEnvFile(readFileSync(ENV_FILE, 'utf8')) : {};
  const env = { ...envFile, ...process.env };

  // Origen por defecto: lo que hoy apunta `.env.local` (el proyecto viejo se
  // respalda ahí antes de repuntar nada).
  const fromUrl = args.fromUrl || env.SUPABASE_FROM_URL;
  const fromKey = args.fromKey || env.SUPABASE_FROM_ANON_KEY;
  const token = args.token || env.SUPABASE_ACCESS_TOKEN;
  const ref = args.ref || projectRefFromUrl(env.NEXT_PUBLIC_SUPABASE_URL);

  const resolved = resolveTables(args.tables);
  if ('error' in resolved) {
    console.error(`\n✗ ${resolved.error}\n`);
    process.exitCode = 2;
    return;
  }
  const tables = resolved.tables;

  if (!fromUrl || !fromKey) {
    console.error(
      'Falta el origen: pasá --from-url y --from-key (o SUPABASE_FROM_URL / SUPABASE_FROM_ANON_KEY).',
    );
    process.exitCode = 2;
    return;
  }
  if (!ref) {
    console.error('Falta el destino: pasá --ref <ref> o dejá NEXT_PUBLIC_SUPABASE_URL en .env.local.');
    process.exitCode = 2;
    return;
  }
  if (!token && !args.dryRun) {
    console.error('Falta SUPABASE_ACCESS_TOKEN (el token del proyecto destino) para escribir.');
    process.exitCode = 2;
    return;
  }

  console.log(`\n== Copia del catálogo ==\n\n  Origen:  ${fromUrl}\n  Destino: ${ref}`);
  console.log(`  Tablas:  ${tables.map((table) => table.name).join(', ')}`);
  if (args.replace) console.log('  --replace: se borran las filas de esas tablas antes de insertar.');

  const raw = await readCatalog({ url: fromUrl, key: fromKey, tables });

  /** @type {Record<string, Record<string, unknown>[]>} */
  const data = {};
  const notes = [];
  for (const { name } of tables) {
    const normalized = normalizeRows({ table: name, rows: raw[name] ?? [], keepUserId: args.keepUserId });
    data[name] = normalized.rows;
    console.log(`  ${name}: ${normalized.rows.length} filas leídas`);
    for (const note of normalized.notes) notes.push(`${name} · ${note}`);
  }

  const sql = copySql({ data, replace: args.replace, tables });
  console.log(`  SQL: ${sql.length} caracteres${args.replace ? ' (incluye borrado previo)' : ''}`);

  if (notes.length) {
    console.log('\n  Traducciones aplicadas:');
    for (const note of notes) console.log(`    · ${note}`);
  }

  const foreign = foreignStorageUrls(data, fromUrl);
  if (foreign.length) {
    console.log(`\n  ! ${foreign.length} archivo(s) viven en el storage del origen y no viajan en la copia:`);
    for (const entry of foreign.slice(0, 5)) console.log(`    · ${entry.url} (${entry.count})`);
    console.log('    Bajalos y subilos al bucket del destino antes de apagar el proyecto viejo.');
  }

  console.log('\n  No se copia (por diseño):');
  for (const entry of NOT_COPIED) console.log(`    · ${entry.name}: ${entry.because}`);

  if (args.out) {
    writeFileSync(args.out, sql, 'utf8');
    console.log(`\n  Escrito en ${args.out}`);
  }

  if (args.dryRun) {
    console.log('\n  --dry-run: no se escribió nada en el destino.\n');
    return;
  }

  const result = await runQuery({ ref, token, query: sql });
  if (!result.ok) {
    console.error(`\n✖ Falló la escritura: ${result.error}\n`);
    process.exitCode = 1;
    return;
  }
  console.log('\n✓ Copia aplicada. Verificá con `npm run check:schema` y `npm run smoke:prod`.\n');
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  await main();
}
