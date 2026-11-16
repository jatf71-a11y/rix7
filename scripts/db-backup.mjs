#!/usr/bin/env node
/**
 * Respaldo de **datos** de la base, con manifiesto verificable.
 *
 * `npm run backup` copia archivos (código, `.git`, `.env.local`), no la base: los
 * leads, las altas de empresa, los socios y la facturación viven en Supabase y no
 * tienen copia. Este comando los exporta a JSONL comprimido, una tabla por
 * archivo, y deja un manifiesto con la cantidad de filas y el SHA-256 de cada
 * uno: sin eso no se puede afirmar que la copia está completa.
 *
 *   npm run db:backup                        # exporta a .backups/db-<fecha>/
 *   npm run db:backup -- --verify <dir>      # recalcula y compara contra el manifiesto
 *   npm run db:backup -- --restore <dir> --into <url> --key <clave> --yes
 *   npm run db:backup -- --help
 *
 * Qué hace bien y qué no:
 *
 * - Exporta **filas**, no el esquema. El esquema vive en `supabase/migrations/`
 *   y se aplica con `npm run db:push`: un respaldo de datos sin migraciones no
 *   restaura nada, y las migraciones son la fuente de verdad del esquema.
 * - Pagina **ordenado por la clave primaria** de cada tabla, que se pide a la
 *   API de administración. Sin orden, PostgREST no garantiza que dos páginas
 *   cubran la tabla entera: se puede perder una fila sin que nada falle.
 * - La restauración escribe contra el destino con `merge-duplicates` sobre esa
 *   misma clave, en lotes, y se niega a apuntar a la base de origen salvo que se
 *   diga explícitamente (`--allow-same`): restaurar un respaldo encima de
 *   producción casi nunca es lo que se quiere.
 *
 * Códigos de salida: `0` = copia hecha o verificada · `1` = algo falló · `2` =
 * uso incorrecto y nada se ejecutó.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { gzipSync, gunzipSync } from 'node:zlib';

import { readEnvContent } from './check-auth-config.mjs';
import { readCredentials } from './socios-huerfanas.mjs';

export const DEFAULT_DIR = '.backups';
export const MANIFEST = 'manifest.json';
export const PAGE_SIZE = 1000;
export const RESTORE_BATCH = 500;

/**
 * Objetos que no se respaldan: son de PostGIS, no del proyecto.
 *
 * `spatial_ref_sys` trae 8.500 filas de referencia que el propio PostGIS vuelve
 * a crear, y las dos vistas de catálogo no se pueden insertar. Copiarlas infla
 * el respaldo y hace fallar la restauración.
 */
export const SKIP_TABLES = ['spatial_ref_sys', 'geography_columns', 'geometry_columns'];

/** ¿Esta tabla entra en el respaldo? */
export function isDumpable(table) {
  return !SKIP_TABLES.includes(table);
}

/**
 * @param {string[]} argv
 * @returns {{ verify: string | null, restore: string | null, into: string | null, key: string | null, yes: boolean, allowSame: boolean, help: boolean, error?: string }}
 */
export function parseArgs(argv) {
  const args = { verify: null, restore: null, into: null, key: null, yes: false, allowSame: false, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--verify') args.verify = next();
    else if (arg === '--restore') args.restore = next();
    else if (arg === '--into') args.into = next();
    else if (arg === '--key') args.key = next();
    else if (arg === '--yes') args.yes = true;
    else if (arg === '--allow-same') args.allowSame = true;
    else return { ...args, error: `Opción desconocida: ${arg}` };
  }

  if (args.restore && !args.into) {
    return { ...args, error: '--restore necesita --into <url> y --key <clave>.' };
  }
  if (args.restore && !args.yes) {
    return { ...args, error: '--restore escribe: repetilo con --yes si es eso lo que querés.' };
  }
  return args;
}

export function dumpFileName(table) {
  return `${table}.jsonl.gz`;
}

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Una entrada del manifiesto: lo que después permite afirmar «esta copia está completa». */
export function manifestEntry({ table, pk, rows, buffer }) {
  return { name: table, pk: pk ?? null, rows, bytes: buffer.length, sha256: sha256(buffer) };
}

/**
 * Compara el manifiesto con lo que hay en disco.
 *
 * Devuelve **los problemas**, no un booleano: «faltan 3 archivos y uno cambió de
 * checksum» es un diagnóstico; `false` no.
 *
 * @param {{ tables: { name: string, rows: number, sha256: string }[] }} manifest
 * @param {Record<string, { bytes: Buffer, rows: number }>} observed
 */
export function compareWithManifest(manifest, observed) {
  const problems = [];

  for (const entry of manifest.tables ?? []) {
    const file = observed[entry.name];
    if (!file) {
      problems.push(`falta ${entry.name}`);
      continue;
    }
    if (sha256(file.bytes) !== entry.sha256) problems.push(`${entry.name}: checksum distinto`);
    if (file.rows !== entry.rows) {
      problems.push(`${entry.name}: ${file.rows} filas en disco, ${entry.rows} en el manifiesto`);
    }
  }

  for (const name of Object.keys(observed)) {
    if (!(manifest.tables ?? []).some((entry) => entry.name === name)) {
      problems.push(`${name}: archivo sin entrada en el manifiesto`);
    }
  }

  return problems;
}

/** Lee un JSONL comprimido: las filas y su cantidad. */
export function readDump(buffer) {
  const text = gunzipSync(buffer).toString('utf8');
  const rows = text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  return { rows: rows.length, data: rows, bytes: buffer };
}

/**
 * El token de administración: sin él no hay claves primarias y por lo tanto no
 * hay paginación ordenada. Se avisa en el informe en vez de fingir que está.
 */
export function accessToken({ file = '.env.local', env = process.env } = {}) {
  if (env.SUPABASE_ACCESS_TOKEN?.trim()) return env.SUPABASE_ACCESS_TOKEN.trim();
  if (!existsSync(file)) return undefined;
  return readEnvContent(readFileSync(file, 'utf8')).SUPABASE_ACCESS_TOKEN?.trim() || undefined;
}

function managementUrl(ref) {
  return `https://api.supabase.com/v1/projects/${ref}/database/query`;
}

export function projectRef(url) {
  return new URL(url).host.split('.')[0];
}

/** Claves primarias por tabla, para paginar sin perder filas. */
async function primaryKeys(url, token) {
  if (!token) return {};
  const ref = projectRef(url);
  const sql = `select tc.table_name, kcu.column_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
    where tc.constraint_type = 'PRIMARY KEY' and tc.table_schema = 'public'`;

  const response = await fetch(managementUrl(ref), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!response.ok) return {};

  const rows = await response.json();
  return Object.fromEntries((rows ?? []).map((row) => [row.table_name, row.column_name]));
}

async function listTables(url, key) {
  const response = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/openapi+json' },
  });
  if (!response.ok) throw new Error(`no se pudo leer el catálogo: HTTP ${response.status}`);
  const spec = await response.json();
  return Object.keys(spec.definitions ?? {}).sort();
}

async function dumpTable(url, key, table, pk) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const params = new URLSearchParams({ select: '*', limit: String(PAGE_SIZE), offset: String(offset) });
    if (pk) params.set('order', `${pk}.asc`);
    const response = await fetch(`${url}/rest/v1/${table}?${params}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!response.ok) throw new Error(`${table}: HTTP ${response.status}`);
    const batch = await response.json();
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }

  const jsonl = rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
  return { rows: rows.length, buffer: gzipSync(Buffer.from(jsonl, 'utf8')) };
}

async function restore(dir, into, key, { allowSame, sourceUrl }) {
  const manifest = JSON.parse(readFileSync(path.join(dir, MANIFEST), 'utf8'));
  if (!allowSame && into === sourceUrl) {
    throw new Error('el destino es la misma base de origen; usá --allow-same si es a propósito');
  }

  let restored = 0;
  for (const entry of manifest.tables ?? []) {
    const file = path.join(dir, dumpFileName(entry.name));
    if (!existsSync(file)) throw new Error(`falta ${entry.name}: la copia está incompleta`);

    const { data } = readDump(readFileSync(file));
    const query = new URLSearchParams();
    if (entry.pk) query.set('on_conflict', entry.pk);

    for (let i = 0; i < data.length; i += RESTORE_BATCH) {
      const batch = data.slice(i, i + RESTORE_BATCH);
      const response = await fetch(`${into}/rest/v1/${entry.name}?${query}`, {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(batch),
      });
      if (!response.ok) throw new Error(`${entry.name}: restaurar respondió ${response.status}`);
      restored += batch.length;
    }
  }
  return restored;
}

function usage() {
  console.log(
    [
      '',
      'Respaldo de datos de la base.',
      '',
      '  npm run db:backup                      exporta a .backups/db-<fecha>/',
      '  npm run db:backup -- --verify <dir>    comprueba checksums y filas',
      '  npm run db:backup -- --restore <dir> --into <url> --key <clave> --yes',
      '',
    ].join('\n')
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();
  if (args.error) {
    console.error(`✖ ${args.error}`);
    process.exit(2);
  }

  if (args.verify) {
    const manifest = JSON.parse(readFileSync(path.join(args.verify, MANIFEST), 'utf8'));
    const observed = {};
    for (const entry of manifest.tables ?? []) {
      const file = path.join(args.verify, dumpFileName(entry.name));
      if (!existsSync(file)) continue;
      const { rows, bytes } = readDump(readFileSync(file));
      observed[entry.name] = { rows, bytes };
    }
    const problems = compareWithManifest(manifest, observed);
    if (problems.length === 0) {
      const total = (manifest.tables ?? []).reduce((sum, entry) => sum + entry.rows, 0);
      console.log(`\n✓ Copia íntegra: ${manifest.tables.length} tablas, ${total} filas.\n`);
      process.exit(0);
    }
    for (const problem of problems) console.error(`  ✖ ${problem}`);
    process.exit(1);
  }

  const credentials = readCredentials();
  if (credentials.error) {
    console.error(`✖ ${credentials.error}`);
    process.exit(1);
  }
  const { url, key } = credentials;

  if (args.restore) {
    const restored = await restore(args.restore, args.into, args.key, {
      allowSame: args.allowSame,
      sourceUrl: url,
    });
    console.log(`\n✓ ${restored} filas restauradas en ${args.into}.\n`);
    process.exit(0);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = path.join(DEFAULT_DIR, `db-${stamp}`);
  mkdirSync(dir, { recursive: true });

  console.log(`\n== Respaldo de datos · ${projectRef(url)}\n`);

  const tables = (await listTables(url, key)).filter(isDumpable);
  const token = accessToken();
  const keys = await primaryKeys(url, token);
  if (!token) console.warn('  ⚠ Sin SUPABASE_ACCESS_TOKEN: se pagina sin orden por clave (menos fiable).\n');
  const manifest = { version: 1, created_at: new Date().toISOString(), source: projectRef(url), tables: [] };

  for (const table of tables) {
    const { rows, buffer } = await dumpTable(url, key, table, keys[table]);
    writeFileSync(path.join(dir, dumpFileName(table)), buffer);
    manifest.tables.push(manifestEntry({ table, pk: keys[table], rows, buffer }));
    console.log(`  ✓ ${table.padEnd(28)} ${String(rows).padStart(6)} filas`);
  }

  writeFileSync(path.join(dir, MANIFEST), JSON.stringify(manifest, null, 2) + '\n');
  const total = manifest.tables.reduce((sum, entry) => sum + entry.rows, 0);
  console.log(`\n✓ ${manifest.tables.length} tablas, ${total} filas · ${dir}`);
  console.log(`  Verificá con: npm run db:backup -- --verify ${dir}\n`);
}

if (process.argv[1] && process.argv[1].endsWith('db-backup.mjs')) {
  main().catch((error) => {
    console.error(`✖ ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
