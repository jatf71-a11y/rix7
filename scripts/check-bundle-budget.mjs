#!/usr/bin/env node
/**
 * Performance budget del bundle (plan fase 3, ítem 1.3).
 *
 * La fase 1 dejó el First Load JS compartido en 89,6 kB y sin este gate,
 * cualquier dependencia nueva podía inflar el bundle sin que nadie lo notara
 * hasta mirar la tabla del build a mano. Este script compara el tamaño real
 * de la build contra `scripts/bundle-baseline.json` y falla si algo crece
 * más allá de la tolerancia.
 *
 * De dónde salen los números: `.next/app-build-manifest.json` — el mismo
 * mapa de chunks que `next build` usa para su tabla de rutas — con cada
 * archivo gzip-eado con zlib (los tamaños que Next imprime son gzip, no
 * raw). El First Load de una ruta es la suma gzip de los archivos únicos de
 * su entrada; "compartido por todas" es la intersección de todas ellas. La
 * línea base la genera esta misma herramienta, así que la comparación es
 * consistente aunque el redondeo difiere en décimas de la tabla de Next.
 *
 * Fallo cerrado: si falta la build, el manifest o un archivo de chunk, el
 * script termina con código 2 — un entorno roto nunca pasa como "verde".
 *
 * Uso:
 *   npm run build && npm run check:bundle            # gate (CI y local)
 *   npm run check:bundle -- --update                 # regenerar línea base
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const ROOT = process.cwd();
const MANIFEST = join(ROOT, '.next', 'app-build-manifest.json');
const BASELINE = join(ROOT, 'scripts', 'bundle-baseline.json');
const KB = 1024;
/** Tolerancia por defecto: margen para redondeos y variaciones menores del compilador. */
const DEFAULT_TOLERANCE_KB = 5;

const UPDATE_MODE = process.argv.includes('--update');

const fail = (message) => {
  console.error(`✖ ${message}`);
  process.exit(2);
};

if (!existsSync(MANIFEST)) {
  fail(
    'No existe .next/app-build-manifest.json. Corre primero `npm run build` (el budget se calcula sobre la build real, no se inventa).'
  );
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const pages = manifest.pages ?? {};
const pageNames = Object.keys(pages).sort();
if (pageNames.length === 0) {
  fail('El manifest no tiene páginas: la build está rota o vacía.');
}

/** Tamaño gzip de un chunk (cachéado: las rutas comparten archivos). */
const gzipCache = new Map();
function gzipKb(file) {
  const absolute = resolve(ROOT, '.next', file.replace(/^\//, ''));
  if (!gzipCache.has(file)) {
    if (!existsSync(absolute)) {
      fail(`El chunk ${file} del manifest no existe en disco. La build está incompleta: corre \`npm run build\` de nuevo.`);
    }
    gzipCache.set(file, gzipSync(readFileSync(absolute), { level: 9 }).length / KB);
  }
  return gzipCache.get(file);
}

/** Suma gzip de la unión de archivos (dedup: un chunk compartido cuenta una vez). */
function firstLoadKb(files) {
  return Array.from(new Set(files)).reduce((total, file) => total + gzipKb(file), 0);
}

// First Load compartido = intersección de los archivos de TODAS las rutas.
const sharedFiles = pageNames
  .map((page) => new Set(pages[page]))
  .reduce((acc, set) => new Set([...acc].filter((file) => set.has(file))));
const sharedKb = round(firstLoadKb(sharedFiles));

function round(kb) {
  return Math.round(kb * 10) / 10;
}

const computed = Object.fromEntries(
  pageNames.map((page) => [page, round(firstLoadKb(pages[page]))])
);

if (UPDATE_MODE) {
  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
  } catch {}
  const baseline = {
    _comment:
      'Línea base del performance budget (plan fase 3, 1.3). La genera `npm run check:bundle -- --update` sobre una build real. Para subir cualquier número hace falta justificación en el PR: este archivo existe para que el bundle no crezca en silencio.',
    sharedFirstLoadKb: sharedKb,
    pages: computed,
    toleranceKb: DEFAULT_TOLERANCE_KB,
    generatedAt: new Date().toISOString().slice(0, 10),
    commit,
  };
  writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(
    `✔ Línea base actualizada: compartido ${sharedKb} kB · ${pageNames.length} rutas · tolerancia ${DEFAULT_TOLERANCE_KB} kB`
  );
  console.log('  Recuerda justificar el cambio de esta línea base en el PR (es su razón de ser).');
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  fail(
    `No existe ${BASELINE}. Genéralo una vez con: npm run check:bundle -- --update (y comitea el archivo).`
  );
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const tolerance = baseline.toleranceKb ?? DEFAULT_TOLERANCE_KB;
const violations = [];

// Compartido: el número que la auditoría vigila (89,6 kB en fase 2).
if (sharedKb > baseline.sharedFirstLoadKb + tolerance) {
  violations.push(
    `compartido: ${sharedKb} kB > ${baseline.sharedFirstLoadKb} kB +${tolerance} de tolerancia`
  );
}

for (const page of pageNames) {
  const allowed = baseline.pages[page];
  if (allowed === undefined) {
    violations.push(`nueva ruta sin línea base: ${page} (${computed[page]} kB)`);
    continue;
  }
  if (computed[page] > allowed + tolerance) {
    violations.push(`${page}: ${computed[page]} kB > ${allowed} kB +${tolerance} de tolerancia`);
  }
}

if (violations.length > 0) {
  console.error('\n✖ Performance budget excedido (plan fase 3, 1.3):\n');
  for (const violation of violations) console.error(`  · ${violation}`);
  console.error(
    '\n  Si el crecimiento es intencional: justifícalo en el PR y regenera la línea base con' +
      '\n  `npm run check:bundle -- --update`. Si no, revisa el import que infló el bundle.'
  );
  process.exit(1);
}

console.log(
  `✔ Performance budget OK: compartido ${sharedKb} kB (límite ${baseline.sharedFirstLoadKb} kB +${tolerance}) · ${pageNames.length} rutas dentro del techo`
);
