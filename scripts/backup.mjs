#!/usr/bin/env node
/**
 * Backup completo del proyecto a una carpeta versionada (convención BACKUP9.0 /
 * BACKUP10.0): árbol fuente + `.git` + `.env.local`, con manifiesto MD5 y
 * verificación. Reproduce en un comando lo que antes se hacía a mano con
 * robocopy + md5sum + comprobaciones sueltas.
 *
 *   npm run backup                            # refresca el BACKUP más reciente
 *   npm run backup -- "C:\ruta\BACKUP11.0"    # crea o refresca una ruta explícita
 *   npm run backup -- --help
 *
 * Qué copia y qué excluye (solo regenerables):
 *   - Excluye node_modules/, .next/, .freebuff/, las carpetas .git.backup-*
 *     (cualquier sufijo) y tsconfig.tsbuildinfo — todo se reconstruye con
 *     `npm ci` / `npm run build`.
 *   - Incluye `.env.local` y el historial git completo: un backup sin
 *     credenciales ni historia no restaura nada.
 *
 * Qué verifica después de copiar (y falla si algo no cuadra):
 *   1. Cada archivo del destino tiene el MISMO MD5 que el de la fuente
 *      (comparación file-to-file, que además detecta copias omitidas).
 *   2. `git fsck` del `.git` copiado y HEAD igual al de la fuente.
 *   3. `RESTAURACION.md` se preserva si existe; si no, se genera uno mínimo.
 *
 * Es Windows-only porque usa robocopy (el motor histórico de estos backups).
 * En otro SO avisa y sale con error en vez de copiar mal.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Carpeta donde viven los backups versionados (sobrescribible con BACKUP_BASE). */
export const DEFAULT_BACKUP_BASE = join(homedir(), 'OneDrive', 'RIX7 BACKUPS');

/** Nombres de carpetas que este script considera «un backup». */
export const BACKUP_DIR_PATTERN = /^BACKUP/i;

/** Directorios excluidos de la copia: solo lo regenerable (nombres, como /XD). */
export const EXCLUDED_DIRS = ['.next', '.freebuff', 'node_modules'];

/** Archivos sueltos excluidos (nombres, como /XF). */
export const EXCLUDED_FILES = ['tsconfig.tsbuildinfo'];

/** El manifiesto y la guía son de la carpeta de destino: no se comparan contra el origen. */
export const GENERATED_FILES = ['MANIFIESTO.md5', 'RESTAURACION.md'];

/**
 * Interpreta los argumentos: una ruta destino opcional y `--help`.
 *
 * @param {string[]} argv
 * @returns {{ dest: string | null, help: boolean }}
 */
export function parseBackupArgs(argv) {
  let dest = null;
  let help = false;
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') help = true;
    else if (!arg.startsWith('--') && dest === null) dest = arg;
  }
  return { dest, help };
}

/**
 * Elige el destino: la ruta explícita si viene; si no, la carpeta BACKUP más
 * reciente por fecha de modificación (así `npm run backup` refresca el último
 * sin acordarse nadie de números de versión).
 *
 * @param {{ base: string, explicit: string | null, entries: Array<{ name: string, mtimeMs: number }> }}
 * @returns {string | null} ruta elegida, o null si no hay ninguna BACKUP en la base
 */
export function resolveBackupDir({ base, explicit, entries }) {
  if (explicit) return explicit;

  const candidates = entries.filter((entry) => BACKUP_DIR_PATTERN.test(entry.name));
  if (candidates.length === 0) return null;

  let newest = candidates[0];
  for (const entry of candidates) {
    if (entry.mtimeMs > newest.mtimeMs) newest = entry;
  }
  return join(base, newest.name);
}

/**
 * ¿Es `child` la misma ruta que `parent` o está dentro? Guardia indispensable:
 * robocopy /MIR con destino dentro del origen borraría el proyecto desde
 * dentro de sí mismo.
 */
export function isInside(child, parent) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** ¿Este nombre de directorio se excluye de la copia? */
export function isExcludedDir(name) {
  return EXCLUDED_DIRS.includes(name) || /^\.git\.backup/.test(name) || name === '.git';
}

/** ¿Este archivo se excluye de la copia? (cualquier nivel, como /XF de robocopy) */
export function isExcludedFile(relPath) {
  return EXCLUDED_FILES.includes(relPath.split('/').pop());
}

/** Línea de manifiesto en formato `md5sum -b`: `<hash> *./<ruta>`. */
export function formatManifestLine(relPath, md5) {
  return `${md5} *./${relPath}`;
}

/** Parsea un MANIFIESTO.md5 de vuelta a pares ruta→hash. */
export function parseManifest(text) {
  /** @type {Map<string, string>} */
  const map = new Map();
  for (const line of text.split('\n')) {
    const match = line.match(/^([0-9a-f]{32}) \*\.\/(.+)$/);
    if (match) map.set(match[2], match[1]);
  }
  return map;
}

/**
 * Compara dos manifiestos (esperado contra observado).
 * @returns {{ ok: boolean, missing: string[], extra: string[], changed: string[] }}
 */
export function compareManifests(expected, observed) {
  const missing = [];
  const changed = [];
  const extra = [];

  for (const [path, md5] of expected) {
    if (!observed.has(path)) missing.push(path);
    else if (observed.get(path) !== md5) changed.push(path);
  }
  for (const path of observed.keys()) {
    if (!expected.has(path)) extra.push(path);
  }

  return { ok: missing.length === 0 && changed.length === 0 && extra.length === 0, missing, extra, changed };
}

/**
 * Guía de restauración generada cuando la carpeta no traía una propia.
 * La escrita a mano (con el contexto del momento) se preserva tal cual.
 */
export function buildRestauracionMd({ date, head, files, bytesMb }) {
  return [
    '# BACKUP — RIX7 (restauración)',
    '',
    `**Fecha**: ${date}`,
    `**Estado**: rama \`main\` @ \`${head}\` (generado por \`npm run backup\`).`,
    '**Proyecto**: Rix7 — portal inmobiliario (Next.js 14 + TS + Tailwind + Supabase + Vitest).',
    '',
    '## Contenido incluido',
    '- Árbol fuente completo (app, components, lib, scripts, supabase, docs, .github, configs, `.env.local`).',
    '- `.git` completo (historial local; remoto: https://github.com/jatf71-a11y/rix7.git).',
    '- `MANIFIESTO.md5`: checksums MD5 de todos los archivos salvo `.git`, el manifiesto y esta guía.',
    '',
    '## Exclusiones (regenerables)',
    '- `node_modules/` → regenerar con `npm ci`',
    '- `.next/` → regenerar con `npm run build`',
    '- `.freebuff/` y `tsconfig.tsbuildinfo` → internos de herramientas',
    '- `.git.backup-*/` → copias antiguas del `.git`',
    '',
    '## Pasos de restauración',
    '1. Copiar TODO el contenido de esta carpeta a la ruta del proyecto (ej. `C:\\Users\\javie\\RIX7`).',
    '   Si OneDrive marca archivos como "solo en la nube", usar "Mantener siempre en este dispositivo" antes.',
    '2. Verificar integridad: `md5sum -c MANIFIESTO.md5` (todos deben terminar en OK).',
    `3. Verificar Git: \`git log --oneline -1\` debe mostrar \`${head}\` y \`git status\` limpio.`,
    '4. Instalar dependencias: `npm ci`.',
    '5. Variables de entorno: `.env.local` está incluido; validar que siga vigente.',
    '6. Arrancar: `npm run dev` o `npm run build && npm start`.',
    '',
    `Contenido: ${files} archivos, ${bytesMb} MB (sin .git).`,
    '',
  ].join('\n');
}

/**
 * Archivos de un árbol como rutas relativas con `/`, saltando `.git` y las
 * exclusiones. `skipFile` permite filtrar archivos generados (manifiesto, guía).
 *
 * @param {string} root
 * @param {string} [dir] directorio relativo en curso
 * @param {(relPath: string) => boolean} [skipFile]
 * @returns {string[]}
 */
export function listFiles(root, dir = '', skipFile = () => false) {
  const absolute = dir ? join(root, dir) : root;
  const out = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (isExcludedDir(entry.name)) continue;
      out.push(...listFiles(root, rel, skipFile));
    } else if (entry.isFile() && !isExcludedFile(rel) && !skipFile(rel)) {
      out.push(rel);
    }
  }
  return out;
}

// ═══ IO ═══

function md5File(absolutePath) {
  return createHash('md5').update(readFileSync(absolutePath)).digest('hex');
}

/** Manifest { ruta → md5 } de un árbol, en formato listado. */
function hashTree(root, relFiles) {
  const map = new Map();
  for (const rel of relFiles) map.set(rel, md5File(join(root, rel)));
  return map;
}

function gitHead(dir) {
  const result = spawnSync('git', ['-C', dir, 'log', '-1', '--format=%h'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function usage() {
  console.log(
    [
      '',
      'Backup completo del proyecto (árbol + .git + .env.local) con manifiesto y verificación.',
      '',
      '  npm run backup                        refresca el BACKUP más reciente de OneDrive',
      '  npm run backup -- "C:\\ruta\\BACKUP11.0"  crea o refresca esa ruta',
      '',
      'Excluye solo lo regenerable (node_modules, .next, .freebuff, .git.backup-*, tsbuildinfo).',
      'Verifica MD5 archivo a archivo contra el origen, git fsck y HEAD; error si algo falla.',
      '',
    ].join('\n')
  );
}

function main() {
  const { dest, help } = parseBackupArgs(process.argv.slice(2));
  if (help) return usage();

  if (platform() !== 'win32') {
    console.error('✗ Este backup usa robocopy, disponible solo en Windows.');
    process.exit(1);
  }

  const base = process.env.BACKUP_BASE || DEFAULT_BACKUP_BASE;
  const entries = existsSync(base)
    ? readdirSync(base, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({ name: entry.name, mtimeMs: statSync(join(base, entry.name)).mtimeMs }))
    : [];
  const target = resolveBackupDir({ base, explicit: dest, entries });

  if (!target) {
    console.error(`✗ No hay ninguna carpeta BACKUP en ${base}. Pásame la ruta destino:`);
    console.error('    npm run backup -- "C:\\Users\\javie\\OneDrive\\RIX7 BACKUPS\\BACKUP11.0"');
    process.exit(1);
  }

  if (isInside(target, ROOT)) {
    console.error(`✗ El destino (${target}) está dentro del proyecto (${ROOT}): eso borraría el origen.`);
    process.exit(1);
  }

  mkdirSync(target, { recursive: true });

  // La guía escrita a mano viaja en memoria: /MIR la borra de destino porque
  // no existe en el origen, y restaurarla después es parte del contrato.
  const guidePath = join(target, 'RESTAURACION.md');
  const preservedGuide = existsSync(guidePath) ? readFileSync(guidePath, 'utf8') : null;

  console.log(`→ Copiando ${ROOT} → ${target}`);
  const copy = spawnSync(
    'robocopy',
    [
      ROOT,
      target,
      '/MIR',
      '/XD',
      ...EXCLUDED_DIRS,
      ...readdirSync(ROOT, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^\.git\.backup/.test(entry.name))
        .map((entry) => entry.name),
      '/XF',
      ...EXCLUDED_FILES,
      '/R:2',
      '/W:2',
      '/NP',
      '/NFL',
      '/NDL',
      '/NJH',
      '/NJS',
    ],
    { stdio: 'ignore' }
  );

  if (copy.error || copy.status === null || copy.status >= 8) {
    console.error(`✗ robocopy falló (exit ${copy.status ?? 'sin estado'}${copy.error ? `: ${copy.error.message}` : ''}).`);
    process.exit(1);
  }

  if (preservedGuide !== null) writeFileSync(guidePath, preservedGuide);

  console.log('→ Verificando copia (MD5 archivo a archivo + git)');
  const failures = [];

  // Esperado: el origen con sus exclusiones. Observado: el destino sin los
  // archivos generados. Copia correcta ⇔ ambos manifiestos idénticos.
  const isGenerated = (rel) => GENERATED_FILES.includes(rel.split('/').pop());
  const sourceFiles = listFiles(ROOT);
  const targetFiles = listFiles(target, '', isGenerated);

  let expected;
  let observed;
  try {
    expected = hashTree(ROOT, sourceFiles);
    observed = hashTree(target, targetFiles);
  } catch (error) {
    console.error(`✗ No se pudo leer un archivo para el manifiesto: ${error.message}`);
    process.exit(1);
  }

  const diff = compareManifests(expected, observed);
  if (!diff.ok) {
    failures.push(
      `MD5 fuente vs copia: ${diff.missing.length} faltantes, ${diff.changed.length} distintos, ${diff.extra.length} extra` +
        (diff.missing.length ? ` — p. ej. ${diff.missing.slice(0, 3).join(', ')}` : '') +
        (diff.changed.length ? ` — p. ej. ${diff.changed.slice(0, 3).join(', ')}` : '')
    );
  }

  const manifestText = [...observed.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([rel, md5]) => formatManifestLine(rel, md5))
    .join('\n');
  writeFileSync(join(target, 'MANIFIESTO.md5'), `${manifestText}\n`);

  if (preservedGuide === null) {
    const bytes = [...observed.keys()].reduce((total, rel) => total + statSync(join(target, rel)).size, 0);
    writeFileSync(
      guidePath,
      buildRestauracionMd({
        date: new Date().toISOString().slice(0, 10),
        head: gitHead(ROOT) ?? '?',
        files: observed.size,
        bytesMb: Math.round((bytes / 1024 / 1024) * 10) / 10,
      })
    );
  }

  const fsck = spawnSync('git', ['-C', target, 'fsck', '--no-dangling'], { stdio: 'ignore' });
  if (fsck.status !== 0) failures.push('git fsck de la copia falló');

  const sourceHead = gitHead(ROOT);
  const copyHead = gitHead(target);
  if (!sourceHead || sourceHead !== copyHead) {
    failures.push(`HEAD no coincide (fuente ${sourceHead ?? '?'} vs copia ${copyHead ?? '?'})`);
  }

  if (failures.length > 0) {
    console.error('✗ Backup incompleto:');
    for (const failure of failures) console.error(`  · ${failure}`);
    process.exit(1);
  }

  console.log(
    [
      '',
      `✔ Backup verificado: ${target}`,
      `  · ${observed.size} archivos manifiestados (sin .git) · HEAD ${copyHead}`,
      '  · MD5 identico al origen · git fsck OK · RESTAURACION.md y MANIFIESTO.md5 al día',
      '',
    ].join('\n')
  );
}

// Solo corre al ejecutarse: así los tests importan el núcleo puro.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
