#!/usr/bin/env node
/**
 * Limpia los artefactos locales de build y desarrollo.
 *
 * El día a día deja cosas grandes y desechables al lado del código: la build
 * compartida (`.next`, que llegó a ~1 GB con su caché de webpack), los slots de
 * cada hilo en `.freebuff/`, copias de verificación (`.build-check`,
 * `.deploy-staging`) y logs. Nada de eso está versionado, todo se regenera, y
 * acumulado vuelve lento el ciclo (más IO, más caché obsoleta). Este comando lo
 * borra de una vez, sin que nadie tenga que recordar la lista.
 *
 * **No pisa a nadie**: los distDir de las sesiones vivas —las que registra
 * `slots.mjs`— quedan afuera por defecto; borrar un slot mientras su dev server
 * escribe ahí deja al servidor roto. Si de verdad hay que limpiarlos, hay que
 * detener el servidor o pasar `--force`.
 *
 * **No tira la caché del typecheck**: `tsconfig.tsbuildinfo` (280 KB) es lo que
 * hace que un `tsc` en frío tarde ~56 s y uno en caliente ~18 s. Como el día a
 * día typechequea mucho más que construye, se conserva por defecto y solo se
 * borra con `--deep` (el «reset total»).
 *
 * Uso:
 *   npm run clean                # limpia todo lo regenerable, respeta lo vivo
 *   npm run clean -- --dry-run   # muestra qué borraría, sin borrar
 *   npm run clean -- --deep      # además node_modules y la caché de tipos
 *   npm run clean -- --force     # incluye slots con sesión viva (¡detenlos antes!)
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SLOT_PREFIX, SLOT_ROOT } from './next-paths.mjs';
import { listSlots } from './slots.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Artefactos de un solo archivo o directorio, relativos a la raíz del proyecto. */
export const CLEAN_TARGETS = [
  '.next',
  '.build-check',
  '.deploy-staging',
  '.deploy-tmp',
  'dev-server.log',
];

/** `node_modules` no se toca salvo con `--deep`: reinstalarlo cuesta minutos. */
export const DEEP_TARGET = 'node_modules';

/**
 * Caché incremental del typecheck. No es un artefacto de build: es lo que evita
 * que el próximo `tsc` reconstruya el programa entero (de ~56 s a ~18 s). Se
 * conserva por defecto; solo `--deep` la borra.
 */
export const TYPE_CACHE_TARGET = 'tsconfig.tsbuildinfo';

/**
 * Interpreta los argumentos de `npm run clean`.
 *
 * @param {string[]} argv
 * @returns {{ dryRun: boolean, deep: boolean, force: boolean, help: boolean }}
 */
export function parseCleanArgs(argv) {
  const args = { dryRun: false, deep: false, force: false, help: false };
  for (const arg of argv) {
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--deep') args.deep = true;
    else if (arg === '--force') args.force = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

/**
 * De los nombres presentes dentro de `.freebuff/`, cuáles son de slots.
 *
 * Reconoce tanto las carpetas de artefactos (`rix7-next-<puerto>`) como sus
 * tsconfigs (`rix7-next-<puerto>.tsconfig.json`), para que una limpieza no deje
 * el tsconfig huérfano cuando borra el distDir.
 *
 * @param {string[]} names
 */
export function slotArtifactNames(names) {
  return names.filter((name) => name.startsWith(SLOT_PREFIX));
}

/**
 * ¿Esta ruta pertenece a una sesión viva?
 *
 * Compara contra el distDir y el tsconfig de cada sesión registrada que siga
 * viva, en rutas absolutas: así `--dry-run` y la limpieza real deciden igual.
 *
 * @param {string} absolutePath
 * @param {{ root: string, live: Array<{ distDir: string }> }} context
 */
export function isLivePath(absolutePath, { root, live }) {
  for (const slot of live) {
    const distDir = resolve(root, slot.distDir);
    if (absolutePath === distDir || absolutePath === `${distDir}.tsconfig.json`) return true;
  }
  return false;
}

/**
 * Decide qué se va a borrar. No toca el disco: recibe lo que existe ya listado.
 *
 * @param {{ root: string, exists: (path: string) => boolean, list: (path: string) => string[], live?: Array<{ distDir: string }>, deep?: boolean, force?: boolean }} input
 * @returns {{ targets: string[], blocked: string[] }}
 */
export function planClean({ root, exists, list, live = [], deep = false, force = false }) {
  const candidates = [...CLEAN_TARGETS];
  // `--deep` es el reset total: se lleva también `node_modules` y la caché de
  // tipos, que en el uso normal conviene conservar.
  if (deep) candidates.push(DEEP_TARGET, TYPE_CACHE_TARGET);

  // Los slots se descubren, no se enumeran: cada hilo crea el del puerto que usa.
  const slotRoot = resolve(root, SLOT_ROOT);
  if (exists(slotRoot)) {
    for (const name of slotArtifactNames(list(slotRoot))) candidates.push(`${SLOT_ROOT}/${name}`);
  }

  const targets = [];
  const blocked = [];
  for (const candidate of candidates) {
    const absolute = resolve(root, candidate);
    if (!exists(absolute)) continue;
    if (!force && isLivePath(absolute, { root, live })) {
      blocked.push(candidate);
      continue;
    }
    targets.push(candidate);
  }

  return { targets, blocked };
}

/** Tamaño legible (B/KB/MB/GB). */
export function humanSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

/**
 * El informe para la consola.
 *
 * @param {{ targets: string[], blocked: string[], bytes: number, dryRun: boolean }} input
 */
export function formatCleanReport({ targets, blocked, bytes, dryRun }) {
  const lines = [''];

  if (targets.length === 0) {
    lines.push('No hay nada que limpiar.');
  } else {
    lines.push(`${dryRun ? 'Se borrarían' : 'Se borraron'} ${targets.length} ruta(s) · ${humanSize(bytes)}:`);
    for (const target of targets) lines.push(`  · ${target}`);
  }

  if (blocked.length > 0) {
    lines.push(
      '',
      `⚠ Omitidas por tener una sesión viva: ${blocked.join(', ')}`,
      '  Detén esos dev servers (o usa --force) para incluirlas.'
    );
  }

  lines.push('');
  return lines.join('\n');
}

// ═════════════════════════════════════════════════════════════════════════════
// IO
// ═════════════════════════════════════════════════════════════════════════════

/** Tamaño de un archivo o de un árbol; nunca lanza (un archivo bloqueado vale 0). */
function sizeOf(path) {
  try {
    const stats = statSync(path);
    if (!stats.isDirectory()) return stats.size;
    let total = 0;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      total += sizeOf(resolve(path, entry.name));
    }
    return total;
  } catch {
    return 0;
  }
}

function usage() {
  console.log(
    [
      '',
      'Borra los artefactos locales regenerables (build, slots, copias, logs).',
      '',
      '  npm run clean',
      '  npm run clean -- --dry-run',
      '  npm run clean -- --deep        también node_modules y la caché de tipos',
      '  npm run clean -- --force       incluye slots con sesión viva',
      '',
      'Respeta por defecto los slots de las sesiones que `npm run slots` ve vivas,',
      'para no romper un dev server que está escribiendo ahí.',
      '',
    ].join('\n')
  );
}

function main() {
  const args = parseCleanArgs(process.argv.slice(2));
  if (args.help) return usage();

  const live = args.force ? [] : listSlots().live;
  if (live.length > 0) {
    console.log(`→ ${live.length} sesión(es) viva(s): sus slots quedan fuera de la limpieza.`);
  }

  const { targets, blocked } = planClean({
    root: ROOT,
    exists: existsSync,
    list: (path) => readdirSync(path),
    live,
    deep: args.deep,
    force: args.force,
  });

  const bytes = targets.reduce((total, target) => total + sizeOf(resolve(ROOT, target)), 0);

  if (!args.dryRun) {
    for (const target of targets) {
      try {
        rmSync(resolve(ROOT, target), { recursive: true, force: true, maxRetries: 3 });
      } catch (error) {
        // Un archivo retenido (antivirus, un proceso) no debe abortar el resto.
        console.warn(`⚠ No se pudo borrar ${target}: ${error.code ?? error.message}`);
      }
    }
  }

  console.log(formatCleanReport({ targets, blocked, bytes, dryRun: args.dryRun }));
}

// Solo corre al ejecutarse: así los tests importan el núcleo.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
