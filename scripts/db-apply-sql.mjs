#!/usr/bin/env node
/**
 * Genera **un solo archivo `.sql`** que aplica las migraciones pendientes de
 * `supabase/migrations/` y las registra en el libro de migraciones
 * (`public.rix7_migrations`), listo para pegar en el **SQL Editor** del
 * dashboard de Supabase.
 *
 * ¿Por qué existe? `npm run db:push` es el camino cómodo, pero necesita un token
 * personal (`SUPABASE_ACCESS_TOKEN`) de una cuenta **con acceso al proyecto**.
 * Cuando esa cuenta no está disponible —o cuando el proyecto acaba de nacer y
 * todavía no hay token— queda el camino manual: abrir el dashboard y ejecutar las
 * migraciones a mano. Hacerlo a mano tiene dos problemas reales:
 *
 * 1. Son quince archivos, uno por uno y en orden. Equivocarse de orden (0005
 *    antes que 0003, por ejemplo) falla a mitad de camino.
 * 2. El libro de migraciones queda **vacío**: la base sí tiene el esquema, pero
 *    `db:status` desde la CLI diría que falta todo, y el próximo `db:push` lo
 *    intentaría de nuevo a ciegas.
 *
 * Esto resuelve las dos: el SQL sale ordenado, con el registro de cada migración
 * pegado a su contenido, y envuelto en una transacción (o todo, o nada).
 *
 *   npm run db:apply-sql                        # imprime el SQL por stdout
 *   npm run db:apply-sql -- --out .deploy-tmp/migraciones.sql
 *
 * Después de pegarlo y ejecutarlo, `npm run db:status` (o `npm run check:schema`)
 * confirma qué quedó aplicado. Aplicar dos veces no rompe nada: las migraciones
 * son idempotentes y el registro es un `ON CONFLICT ... DO UPDATE`.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  MIGRATIONS_DIR,
  ledgerBootstrapSql,
  ledgerInsertSql,
  ledgerSelectSql,
  migrationSql,
  planMigrations,
} from './db-push.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Salida por defecto cuando no se pasa `--out`. */
export const DEFAULT_OUT = path.join(ROOT, '.deploy-tmp', 'migraciones.sql');

/**
 * Arma los pasos: por cada migración, su contenido y el registro que la anota.
 *
 * El registro va **inmediatamente después** de cada migración y no todos juntos
 * al final, por la misma razón por la que `db-push` aplica y registra de a una:
 * si algo falla en la migración 0010, lo que se ve en el libro es lo que de
 * verdad se aplicó.
 *
 * @param {{ fileName: string, content: string }[]} files
 * @returns {{ errors: string[], gaps: string[], steps: { version: string, name: string, fileName: string, sql: string, record: string }[] }}
 */
export function applyPlan(files) {
  const plan = planMigrations(files);
  const byName = new Map(files.map((file) => [file.fileName, file.content]));

  const steps = plan.migrations.map((migration) => ({
    version: migration.version,
    name: migration.name,
    fileName: migration.fileName,
    sql: migrationSql(migration, byName.get(migration.fileName)),
    record: ledgerInsertSql(migration),
  }));

  return { errors: plan.errors, gaps: plan.gaps, steps };
}

/**
 * El archivo completo.
 *
 * Va envuelto en `BEGIN`/`COMMIT`: el SQL Editor ejecuta el script entero en una
 * transacción, así que un error en la 0012 deja la base como estaba, sin
 * migraciones a medias ni reglas raras en el libro.
 *
 * @param {{ fileName: string, content: string }[]} files
 * @param {{ ref?: string | null }} [options]
 * @returns {string}
 */
export function renderApplySql(files, { ref = null } = {}) {
  const { errors, gaps, steps } = applyPlan(files);
  if (errors.length) {
    throw new Error(`Hay archivos de migración con problemas:\n  · ${errors.join('\n  · ')}`);
  }
  if (!steps.length) {
    throw new Error(`No hay migraciones en ${path.relative(ROOT, MIGRATIONS_DIR)}.`);
  }

  const lines = [
    '-- ═══════════════════════════════════════════════════════════════════════════',
    '-- Migraciones de rix7-portal — generado por `npm run db:apply-sql`',
    '-- ═══════════════════════════════════════════════════════════════════════════',
    '--',
    `-- Proyecto destino: ${ref ? ref : '(el que tengas abierto en el dashboard)'}`,
    `-- Migraciones incluidas: ${steps.length} (${steps[0].version} … ${steps.at(-1).version})`,
    '--',
    '-- Cómo usarlo: pegá todo esto en el SQL Editor y ejecutalo. Va en una sola',
    '-- transacción: o se aplica completo, o no cambia nada.',
    '--',
    '-- Es idempotente. Volver a ejecutarlo no duplica ni borra nada: cada objeto se',
    '-- crea con IF NOT EXISTS / CREATE OR REPLACE y el libro se actualiza con',
    `-- ON CONFLICT. Después, \`npm run db:status\` confirma qué quedó aplicado.`,
    '--',
    '-- No borra ni modifica datos de personas: lo único que reescribe filas es',
    '-- 0013, que corrige el vocabulario de tipos (vip → premium).',
    '',
  ];

  if (gaps.length) {
    for (const gap of gaps) lines.push(`-- ! ${gap}`, '');
  }

  lines.push('BEGIN;', '');
  lines.push('-- ── Libro de migraciones ────────────────────────────────────────────────────');
  lines.push(ledgerBootstrapSql());
  lines.push('');

  for (const step of steps) {
    lines.push(
      `-- ── ${step.version}_${step.name} ${'─'.repeat(Math.max(0, 60 - step.name.length))}`,
    );
    lines.push('', step.sql.trimEnd(), '', '-- Registro de la migración:', step.record, '');
  }

  lines.push('-- ── Verificación ───────────────────────────────────────────────────────────');
  lines.push(ledgerSelectSql());
  lines.push('', 'COMMIT;', '');

  return lines.join('\n');
}

/** Los archivos de migración, tal como los lee `db-push`. */
export function readMigrationFiles(dir = MIGRATIONS_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort()
    .map((fileName) => ({
      fileName,
      content: readFileSync(path.join(dir, fileName), 'utf8'),
    }));
}

function parseArgs(argv) {
  const args = { out: null, ref: null, stdout: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') args.out = argv[++i] ?? null;
    else if (arg.startsWith('--out=')) args.out = arg.slice('--out='.length);
    else if (arg === '--ref') args.ref = argv[++i] ?? null;
    else if (arg.startsWith('--ref=')) args.ref = arg.slice('--ref='.length);
    else if (arg === '--stdout') args.stdout = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function usage() {
  console.log(
    [
      '',
      'Genera el SQL que aplica las migraciones y las registra en el libro.',
      '',
      '  npm run db:apply-sql                          # escribe .deploy-tmp/migraciones.sql',
      '  npm run db:apply-sql -- --stdout              # lo imprime, no escribe archivo',
      '  npm run db:apply-sql -- --out ruta.sql        # a un archivo puntual',
      '',
      'Después: pegá el archivo en el SQL Editor del dashboard y ejecutalo.',
      'Verificá con `npm run check:schema` (solo necesita la clave pública) y, si',
      'tenés token, `npm run db:status`.',
      '',
    ].join('\n'),
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();

  const files = readMigrationFiles();
  const sql = renderApplySql(files, { ref: args.ref });

  if (args.stdout) {
    process.stdout.write(sql);
    return;
  }

  const out = args.out ? path.resolve(args.out) : DEFAULT_OUT;
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, sql, 'utf8');

  const { steps, gaps } = applyPlan(files);
  console.log('');
  console.log('== SQL para el SQL Editor ==');
  console.log('');
  console.log(`  Archivo:      ${path.relative(ROOT, out)} (${sql.length} caracteres)`);
  console.log(`  Migraciones:  ${steps.length} (${steps[0].version} … ${steps.at(-1).version})`);
  for (const gap of gaps) console.log(`  ! ${gap}`);
  console.log('');
  console.log('  1. Abrí el SQL Editor del proyecto y pegá el archivo entero.');
  console.log('  2. Ejecutalo: va en una transacción, o entra todo o no entra nada.');
  console.log('  3. Verificá con `npm run check:schema`.');
  console.log('');
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    console.error(`✗ ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
