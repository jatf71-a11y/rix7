#!/usr/bin/env node
/**
 * Aplica las migraciones de `supabase/migrations/` a un proyecto de Supabase.
 *
 * ¿Por qué existe? El esquema vivía en un solo `schema.sql` que había que pegar
 * a mano en el SQL Editor del dashboard. Eso convertía cada ampliación de
 * esquema en un pendiente que nadie podía verificar: no se sabía si la base de
 * producción estaba al día, y el archivo se re-ejecutaba entero (con dos
 * políticas que no se podían re-crear) para completar una columna.
 *
 * Ahora cada paso es un archivo numerado e idempotente, y esto lo aplica:
 *
 *   npm run db:push              # aplica lo que falte
 *   npm run db:status            # informa, no toca nada
 *   npm run db:check             # como --status, pero sale 1 si hay pendientes
 *
 * Lo que necesita:
 *
 * - `SUPABASE_ACCESS_TOKEN`: un token personal de https://supabase.com/dashboard/account/tokens
 *   (se puede dejar en `.env.local`, que no se versiona).
 * - La referencia del proyecto: se deduce de `NEXT_PUBLIC_SUPABASE_URL`, o se
 *   pasa con `--ref`. Sin ninguno de los dos, `--ref <ref>` a mano.
 *
 * Cómo aplica: con la API de administración (`POST /v1/projects/<ref>/database/query`),
 * que es la misma puerta que usa el SQL Editor — pero desde la terminal, sin
 * pegar nada a mano. No usa `psql` ni Docker. La alternativa oficial
 * (`npx supabase db push`) lee estos mismos archivos; ver `supabase/migrations/LEEME.md`.
 *
 * Sobre la seguridad de aplicarlo sin preguntar: las migraciones son
 * **aditivas** —`CREATE ... IF NOT EXISTS`, `CREATE OR REPLACE`, `ALTER ... ADD
 * COLUMN IF NOT EXISTS` y `DROP POLICY IF EXISTS` de políticas que el propio
 * archivo vuelve a crear—, y `scripts/db-push.test.ts` se lo exige a cada
 * archivo real, incluido que no haya `DROP TABLE`, `DROP COLUMN`, `TRUNCATE` ni
 * `DELETE`. Aplicar dos veces no rompe nada.
 *
 * Las migraciones ya aplicadas se registran en `public.rix7_migrations` (con RLS
 * habilitado y sin políticas: nadie la lee por la API pública). El registro hace
 * dos cosas: no repetir trabajo y poder responder «¿la base está al día?».
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifySupabaseUrl, readEnvContent } from './check-auth-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = path.join(ROOT, '.env.local');

/** Dónde viven las migraciones. */
export const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');

/** `0001_nombre-en-minusculas.sql`: cuatro dígitos, guion bajo y nombre. */
export const MIGRATION_FILE = /^(\d{4})_([a-z0-9_-]+)\.sql$/;

/** Tabla que registra lo aplicado. */
export const LEDGER_TABLE = 'public.rix7_migrations';

/**
 * @typedef {{ version: string, name: string, fileName: string, checksum: string }} Migration
 * @typedef {{ applied: true, version?: string, status?: string, ms?: number, error?: string }} AppliedRow
 */

// ═════════════════════════════════════════════════════════════════════════════
// Núcleo puro (probado en db-push.test.ts)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Separa `0007_favorites.sql` en su número y su nombre. `null` si no sigue la
 * convención: el orden de aplicación depende del número, así que un archivo que
 * no la cumple no se puede ordenar ni registrar.
 *
 * @param {string} fileName
 * @returns {{ version: string, name: string } | null}
 */
export function parseMigrationName(fileName) {
  const match = MIGRATION_FILE.exec(fileName);
  if (!match) return null;
  return { version: match[1], name: match[2] };
}

/**
 * Huella del contenido, para detectar que una migración ya aplicada se editó
 * después. Se normalizan los finales de línea: el repositorio se usa en Windows
 * y en CI, y un `\r\n` no es un cambio de esquema.
 *
 * @param {string | null | undefined} sql
 * @returns {string}
 */
export function fingerprint(sql) {
  return createHash('sha256').update(String(sql ?? '').replace(/\r\n/g, '\n')).digest('hex');
}

/**
 * Ordena y valida los archivos de migración.
 *
 * @param {{ fileName: string, content: string }[]} files
 * @returns {{ migrations: Migration[], errors: string[], gaps: string[] }}
 */
export function planMigrations(files) {
  const migrations = [];
  const errors = [];
  const seen = new Map();

  for (const file of files) {
    const parsed = parseMigrationName(file.fileName);
    if (!parsed) {
      errors.push(
        `${file.fileName}: no sigue la convención NNNN_nombre.sql (cuatro dígitos, guion bajo, minúsculas).`
      );
      continue;
    }
    if (seen.has(parsed.version)) {
      errors.push(
        `Versión ${parsed.version} repetida: ${seen.get(parsed.version)} y ${file.fileName}.`
      );
      continue;
    }
    seen.set(parsed.version, file.fileName);

    migrations.push({
      version: parsed.version,
      name: parsed.name,
      fileName: file.fileName,
      checksum: fingerprint(file.content),
    });
  }

  migrations.sort((a, b) => a.version.localeCompare(b.version));

  // Un hueco no impide aplicar nada, pero suele significar que se borró una
  // migración ya aplicada en algún proyecto: conviene verlo.
  const gaps = [];
  for (let i = 0; i < migrations.length; i += 1) {
    const expected = String(i + 1).padStart(4, '0');
    if (migrations[i].version !== expected) {
      gaps.push(`Se esperaba ${expected} y hay ${migrations[i].version}.`);
      break;
    }
  }

  return { migrations, errors, gaps };
}

/**
 * Qué hacer con cada migración según lo ya registrado en la base.
 *
 * - `pending`: no está registrada — se aplica.
 * - `drifted`: está registrada con otra huella — el archivo cambió después de
 *   aplicarse; se vuelve a aplicar (son idempotentes) y se avisa.
 * - `missingFiles`: registrada en la base y sin archivo — la base tiene algo que
 *   este repositorio ya no conoce.
 *
 * @param {Migration[]} migrations
 * @param {{ version: string, checksum?: string }[]} applied
 */
export function diffAgainstLedger(migrations, applied) {
  const known = new Map((applied ?? []).map((row) => [String(row.version), row]));

  const pending = [];
  const drifted = [];
  const alreadyApplied = [];

  for (const migration of migrations) {
    const row = known.get(migration.version);
    if (!row) pending.push(migration);
    else if (row.checksum && row.checksum !== migration.checksum) drifted.push(migration);
    else alreadyApplied.push(migration);
  }

  const inFiles = new Set(migrations.map((m) => m.version));
  const missingFiles = [...known.values()]
    .filter((row) => !inFiles.has(String(row.version)))
    .map((row) => String(row.version))
    .sort();

  return { pending, drifted, alreadyApplied, missingFiles };
}

/** SQL que crea el registro de migraciones. Idempotente. */
export function ledgerBootstrapSql() {
  return [
    `CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (`,
    '    version TEXT PRIMARY KEY,',
    '    name TEXT NOT NULL,',
    '    checksum TEXT NOT NULL,',
    '    applied_at TIMESTAMPTZ NOT NULL DEFAULT timezone(\'utc\'::text, now())',
    ');',
    '',
    '-- Sin RLS esto quedaría expuesto en la API pública. Con RLS y sin políticas,',
    '-- ni la anon key ni una sesión normal pueden leerlo: solo el servidor.',
    `ALTER TABLE ${LEDGER_TABLE} ENABLE ROW LEVEL SECURITY;`,
  ].join('\n');
}

/**
 * Una sola sentencia que registra la migración y responde al mismo tiempo, así
 * el script no tiene que confiar en que la escritura salió bien.
 *
 * @param {Migration} migration
 */
export function ledgerInsertSql(migration) {
  return [
    `INSERT INTO ${LEDGER_TABLE} (version, name, checksum)`,
    `VALUES ('${migration.version}', '${migration.name}', '${migration.checksum}')`,
    'ON CONFLICT (version) DO UPDATE SET checksum = EXCLUDED.checksum,',
    '    name = EXCLUDED.name, applied_at = timezone(\'utc\'::text, now())',
    'RETURNING version;',
  ].join('\n');
}

/** Consulta que lee el registro. */
export function ledgerSelectSql() {
  return `SELECT version, name, checksum FROM ${LEDGER_TABLE} ORDER BY version;`;
}

/** SQL que aplica una migración (su contenido, tal cual). */
export function migrationSql(migration, content) {
  return String(content ?? '').replace(/\r\n/g, '\n');
}

/**
 * Texto del informe de estado.
 *
 * @param {{ migrations: Migration[], errors: string[], gaps: string[], pending: Migration[], drifted: Migration[], alreadyApplied: Migration[], missingFiles: string[] }} report
 * @returns {string}
 */
export function formatStatus(report) {
  const lines = ['', '== Migraciones de Supabase ==', ''];

  lines.push(`  Archivos: ${report.migrations.length} en supabase/migrations/`);
  if (report.migrations.length) {
    lines.push(`  Rango: ${report.migrations[0].version} … ${report.migrations.at(-1).version}`);
  }

  for (const error of report.errors) lines.push(`  ✗ ${error}`);
  for (const gap of report.gaps) lines.push(`  ! ${gap}`);

  if (report.errors.length) return lines.join('\n');

  lines.push('');
  lines.push(`  Registradas en la base (${LEDGER_TABLE}): ${report.alreadyApplied.length}`);
  for (const migration of report.alreadyApplied) {
    lines.push(`    · ${migration.version}_${migration.name}`);
  }

  if (report.drifted.length) {
    lines.push('');
    lines.push('  ! Editadas después de aplicarse (se vuelven a aplicar):');
    for (const migration of report.drifted) lines.push(`    · ${migration.version}_${migration.name}`);
  }

  if (report.missingFiles.length) {
    lines.push('');
    lines.push('  ! La base tiene versiones que este repositorio no conoce:');
    for (const version of report.missingFiles) lines.push(`    · ${version}`);
  }

  lines.push('');
  if (report.pending.length || report.drifted.length) {
    lines.push(`  Pendientes (${report.pending.length + report.drifted.length}):`);
    for (const migration of [...report.pending, ...report.drifted]) {
      lines.push(`    → ${migration.version}_${migration.name}`);
    }
    lines.push('');
    lines.push('  Para aplicarlas:  npm run db:push');
  } else {
    lines.push('  ✓ La base está al día con las migraciones del repositorio.');
  }

  return lines.join('\n');
}

/**
 * Texto del resultado de aplicar.
 *
 * @param {{ applied: AppliedRow[], failed: AppliedRow | null, pending: number }} result
 */
export function formatResult(result) {
  const lines = ['', '== Aplicando migraciones ==', ''];

  for (const step of result.applied) {
    lines.push(`  ✓ ${step.version} (${step.ms} ms)`);
  }
  if (result.failed) {
    lines.push('');
    lines.push(`  ✗ ${result.failed.version} falló: ${result.failed.error}`);
    lines.push('');
    lines.push('  Se detuvo acá: las siguientes pueden depender de esta. La base queda en el');
    lines.push('  último estado consistente (las anteriores sí se registraron).');
  }
  if (!result.applied.length && !result.failed) {
    lines.push('  ✓ La base ya estaba al día.');
  }
  if (result.pending > result.applied.length + (result.failed ? 1 : 0)) {
    const left = result.pending - result.applied.length - (result.failed ? 1 : 0);
    lines.push('');
    lines.push(`  Quedaron ${left} migraciones sin intentar (por el fallo de arriba).`);
  }

  return lines.join('\n');
}

// ═════════════════════════════════════════════════════════════════════════════
// Acceso al proyecto (la red entra inyectada, para poder probarla)
// ═════════════════════════════════════════════════════════════════════════════

/** @param {string} ref */
export function queryEndpoint(ref) {
  return `https://api.supabase.com/v1/projects/${ref}/database/query`;
}

/**
 * Corre una consulta contra la API de administración de Supabase.
 *
 * @param {{ ref: string, token: string, query: string, fetchImpl?: typeof fetch }} params
 * @returns {Promise<{ ok: true, rows: any[] } | { ok: false, error: string }>}
 */
export async function runQuery({ ref, token, query, fetchImpl = fetch }) {
  let res;
  try {
    res = await fetchImpl(queryEndpoint(ref), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });
  } catch (error) {
    return { ok: false, error: `no se pudo conectar: ${error instanceof Error ? error.message : 'error desconocido'}` };
  }

  const text = await res.text().catch(() => '');

  if (!res.ok) {
    return { ok: false, error: `HTTP ${res.status} ${text.slice(0, 300).trim()}` };
  }

  try {
    const body = text ? JSON.parse(text) : [];
    return { ok: true, rows: Array.isArray(body) ? body : [] };
  } catch {
    return { ok: true, rows: [] };
  }
}

/**
 * Aplica las migraciones pendientes, en orden, y las registra.
 *
 * Se detiene en el primer fallo a propósito: si 0006 no entra, aplicar 0007
 * encima deja la base en un estado que nadie pidió.
 *
 * @param {{ ref: string, token: string, migrations: Migration[], contents: Map<string, string>, fetchImpl?: typeof fetch, now?: () => number }} params
 */
export async function applyMigrations({ ref, token, migrations, contents, fetchImpl = fetch, now = Date.now }) {
  const applied = [];
  let failed = null;

  for (const migration of migrations) {
    const start = now();
    const result = await runQuery({
      ref,
      token,
      query: migrationSql(migration, contents.get(migration.fileName)),
      fetchImpl,
    });

    if (!result.ok) {
      failed = { version: `${migration.version}_${migration.name}`, error: result.error };
      break;
    }

    const record = await runQuery({ ref, token, query: ledgerInsertSql(migration), fetchImpl });
    if (!record.ok) {
      failed = {
        version: `${migration.version}_${migration.name}`,
        error: `se aplicó pero no se pudo registrar: ${record.error}`,
      };
      break;
    }

    applied.push({ version: `${migration.version}_${migration.name}`, ms: now() - start });
  }

  return { applied, failed, pending: migrations.length };
}

// ═════════════════════════════════════════════════════════════════════════════
// CLI
// ═════════════════════════════════════════════════════════════════════════════

/** @returns {{ fileName: string, content: string }[]} */
function readMigrationFiles() {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  return readdirSync(MIGRATIONS_DIR)
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort()
    .map((fileName) => ({
      fileName,
      content: readFileSync(path.join(MIGRATIONS_DIR, fileName), 'utf8'),
    }));
}

function parseArgs(argv) {
  const args = { status: false, check: false, help: false, ref: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--status') args.status = true;
    else if (arg === '--check') {
      args.status = true;
      args.check = true;
    } else if (arg === '--ref') args.ref = argv[++i] ?? null;
    else if (arg.startsWith('--ref=')) args.ref = arg.slice('--ref='.length);
  }
  return args;
}

function usage() {
  console.log(
    [
      '',
      'Aplica las migraciones de supabase/migrations/ al proyecto de Supabase.',
      '',
      '  npm run db:push              # aplica lo que falte',
      '  npm run db:status            # solo informa',
      '  npm run db:check             # informa y sale 1 si hay pendientes',
      '',
      'Opciones:',
      '  --ref <ref>   referencia del proyecto (si no se deduce de NEXT_PUBLIC_SUPABASE_URL)',
      '  --status      no aplica nada',
      '  --check       como --status, pero falla si hay pendientes',
      '  --help        esto',
      '',
      'Necesita SUPABASE_ACCESS_TOKEN (https://supabase.com/dashboard/account/tokens).',
      'Se puede dejar en .env.local.',
      '',
    ].join('\n')
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();

  const envFromFile = existsSync(ENV_FILE) ? readEnvContent(readFileSync(ENV_FILE, 'utf8')) : {};
  const readEnv = (key) => process.env[key] || envFromFile[key] || null;

  const files = readMigrationFiles();
  const contents = new Map(files.map((file) => [file.fileName, file.content]));
  const plan = planMigrations(files);

  if (plan.errors.length) {
    console.log(formatStatus({ ...plan, pending: [], drifted: [], alreadyApplied: [], missingFiles: [] }));
    console.error('\n✗ Los nombres de archivo tienen que arreglarse antes de aplicar nada.');
    process.exitCode = 1;
    return;
  }

  // La referencia del proyecto: `--ref`, la variable, o deducida de la URL.
  const urlCheck = classifySupabaseUrl(readEnv('NEXT_PUBLIC_SUPABASE_URL'));
  const ref = args.ref || readEnv('SUPABASE_PROJECT_REF') || (urlCheck.ok ? urlCheck.ref : null);
  const token = readEnv('SUPABASE_ACCESS_TOKEN');

  if (!ref || !token) {
    console.log('');
    console.log('== Migraciones de Supabase ==');
    console.log('');
    console.log(`  Archivos: ${plan.migrations.length} en supabase/migrations/`);
    for (const migration of plan.migrations) {
      console.log(`    · ${migration.version}_${migration.name}`);
    }
    console.log('');
    if (!ref) {
      console.log(
        urlCheck.ok
          ? '  ✗ No se pudo deducir la referencia del proyecto (usa --ref <ref>).'
          : `  ✗ ${urlCheck.reason}`
      );
    }
    if (!token) {
      console.log('  ✗ Falta SUPABASE_ACCESS_TOKEN (https://supabase.com/dashboard/account/tokens).');
      console.log('    Ponlo en .env.local o pásalo por el entorno.');
    }
    console.log('');
    console.log('  Sin credenciales no se puede saber qué está aplicado. Nada se modificó.');
    process.exitCode = 1;
    return;
  }

  // Registro de lo aplicado.
  const bootstrap = await runQuery({ ref, token, query: ledgerBootstrapSql() });
  if (!bootstrap.ok) {
    console.error(`\n✗ No se pudo preparar ${LEDGER_TABLE}: ${bootstrap.error}`);
    console.error('  Revisa que la referencia y el token sean del proyecto.');
    process.exitCode = 1;
    return;
  }

  const ledger = await runQuery({ ref, token, query: ledgerSelectSql() });
  if (!ledger.ok) {
    console.error(`\n✗ No se pudo leer ${LEDGER_TABLE}: ${ledger.error}`);
    process.exitCode = 1;
    return;
  }

  const diff = diffAgainstLedger(plan.migrations, ledger.rows);
  const report = { ...plan, ...diff };
  console.log(formatStatus(report));

  if (args.status) {
    if (args.check && (diff.pending.length || diff.drifted.length)) {
      console.error('\n✗ Hay migraciones sin aplicar.');
      process.exitCode = 1;
    }
    return;
  }

  const toApply = [...diff.pending, ...diff.drifted];
  if (!toApply.length) return;

  const result = await applyMigrations({ ref, token, migrations: toApply, contents });
  console.log(formatResult(result));
  if (result.failed) process.exitCode = 1;
}

// Solo corre al ejecutarse: así los tests pueden importar el núcleo.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main().catch((error) => {
    console.error(`✗ ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
