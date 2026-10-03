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
 * Antes de medir nada, el script comprueba que `.next` sea una build de
 * producción y no los restos de `next dev`: el servidor de desarrollo también
 * escribe `app-build-manifest.json`, pero sus chunks van sin minificar ni
 * partir —pesan ~10× los de producción— y los va evictando, así que el
 * manifest termina apuntando a archivos que ya no existen. Comparar eso
 * contra la línea base daba un rojo espectacular (todas las rutas excedidas a
 * la vez) que no tenía nada que ver con el código. La marca que los separa es
 * `.next/BUILD_ID`, que solo escribe `next build`. Se falla cerrado (código 2)
 * tanto si falta el manifest como si falta el BUILD_ID: un entorno de
 * desarrollo nunca puede pasar por bueno ni envenenar la línea base con
 * `--update`.
 *
 * Dónde busca la build: `NEXT_DIST_DIR` si está definido (los slots de hilo que
 * crea `scripts/dev.mjs`), `.next` si no. En CI no se define nada, así que el
 * job mide exactamente el `.next` que reconstruye su artefacto.
 *
 * Uso:
 *   npm run build && npm run check:bundle            # gate (CI y local)
 *   npm run check:bundle -- --update                 # regenerar línea base
 *   npm run check:bundle -- --dir /ruta/al/dist      # medir otro directorio
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isDefaultDistDir, resolveDistDir } from './next-paths.mjs';

const ROOT = process.cwd();
const BASELINE = join(ROOT, 'scripts', 'bundle-baseline.json');
const KB = 1024;

/** Tolerancia por defecto: margen para redondeos y variaciones menores del compilador. */
export const DEFAULT_TOLERANCE_KB = 5;

/**
 * Interpreta los argumentos de la línea de órdenes.
 *
 * `--update` regenera la línea base; `--dir` apunta a un distDir distinto del
 * que resuelve el entorno (útil para medir una copia de verificación sin tocar
 * el `.next` de nadie).
 *
 * @param {string[]} argv
 * @returns {{ update: boolean, dist: string | undefined }}
 */
export function parseBudgetArgs(argv) {
  const args = { update: argv.includes('--update'), dist: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dir') args.dist = argv[++i] ?? args.dist;
    else if (arg.startsWith('--dir=')) args.dist = arg.slice('--dir='.length);
  }
  return args;
}

const ARGS = parseBudgetArgs(process.argv.slice(2));
const UPDATE_MODE = ARGS.update;

const fail = (message) => {
  console.error(`✖ ${message}`);
  process.exit(2);
};

// ═════════════════════════════════════════════════════════════════════════════
// Núcleo puro (probado en check-bundle-budget.test.ts)
// ═════════════════════════════════════════════════════════════════════════════

/** Redondea a una décima, como la tabla de Next. */
export function round(kb) {
  return Math.round(kb * 10) / 10;
}

/**
 * ¿`.next` viene de `next build` o de `next dev`?
 *
 * El manifest existe en ambos casos —por eso no basta con comprobarlo, que es
 * el agujero que dejaba pasar números de desarrollo. `next build` es el único
 * que además escribe `.next/BUILD_ID`, así que esa es la marca que se exige.
 *
 * `exists` se inyecta para poder probar los tres estados sin tocar el disco.
 *
 * @param {{ root?: string, distDir?: string, exists?: (path: string) => boolean }} [options]
 * @returns {{ production: boolean, reason: 'production' | 'sin-manifest' | 'sin-build-id', message: string | null }}
 */
export function inspectBuild({ root = ROOT, distDir = resolveDistDir({ root }), exists = existsSync } = {}) {
  const manifestPath = join(distDir, 'app-build-manifest.json');
  const buildIdPath = join(distDir, 'BUILD_ID');
  // El default se nombra corto (`.next`, como en la documentación); un slot
  // ajeno se nombra por su ruta, porque «¿cuál de todos mis directorios?» es
  // justo la duda que este guard existe para resolver.
  const label = isDefaultDistDir(distDir, { root }) ? '.next' : distDir;

  if (!exists(manifestPath)) {
    return {
      production: false,
      reason: 'sin-manifest',
      message: `No existe ${join(label, 'app-build-manifest.json')}. Corre primero \`npm run build\` (el budget se calcula sobre la build real, no se inventa).`,
    };
  }

  if (!exists(buildIdPath)) {
    return {
      production: false,
      reason: 'sin-build-id',
      message: `\`${label}\` no es una build de producción: hay manifest pero falta ${join(label, 'BUILD_ID')}, que solo escribe \`next build\`. Lo más probable es que el directorio lo haya dejado \`next dev\`: su manifest apunta a chunks de desarrollo —sin minificar ni partir, ~10× más grandes— y a archivos que el servidor ya evictó, así que las cifras no son comparables con la línea base. Corre \`npm run build\` y reintenta.`,
    };
  }

  return { production: true, reason: 'production', message: null };
}

/**
 * Compara lo medido contra la línea base y devuelve los motivos del rojo.
 *
 * @param {{ computed: Record<string, number>, sharedKb: number, baseline: { sharedFirstLoadKb: number, pages?: Record<string, number>, toleranceKb?: number }, tolerance?: number }} input
 * @returns {{ ok: boolean, violations: string[] }}
 */
export function evaluateBudget({ computed, sharedKb, baseline, tolerance }) {
  const limit = tolerance ?? baseline.toleranceKb ?? DEFAULT_TOLERANCE_KB;
  const violations = [];

  if (sharedKb > baseline.sharedFirstLoadKb + limit) {
    violations.push(
      `compartido: ${sharedKb} kB > ${baseline.sharedFirstLoadKb} kB +${limit} de tolerancia`
    );
  }

  for (const page of Object.keys(computed).sort()) {
    const allowed = baseline.pages?.[page];
    if (allowed === undefined) {
      violations.push(`nueva ruta sin línea base: ${page} (${computed[page]} kB)`);
      continue;
    }
    if (computed[page] > allowed + limit) {
      violations.push(`${page}: ${computed[page]} kB > ${allowed} kB +${limit} de tolerancia`);
    }
  }

  return { ok: violations.length === 0, violations };
}

// ═════════════════════════════════════════════════════════════════════════════
// CLI
// ═════════════════════════════════════════════════════════════════════════════

function main() {
  // El mismo distDir que resuelven el dev server y el build: `--dir` gana,
  // después `NEXT_DIST_DIR`, después `.next`. Un solo criterio para las tres
  // puntas evita medir un directorio y construir en otro.
  const distDir = ARGS.dist
    ? resolveDistDir({ root: ROOT, env: { NEXT_DIST_DIR: ARGS.dist } })
    : resolveDistDir({ root: ROOT });

  // Primero el entorno, después los números: medir un `.next` de desarrollo
  // produce un rojo enorme y engañoso, y con `--update` grabaría una línea base
  // inservible.
  const build = inspectBuild({ root: ROOT, distDir });
  if (!build.production) fail(build.message);

  if (!isDefaultDistDir(distDir, { root: ROOT })) {
    console.log(`  midiendo ${distDir}`);
  }

  const manifest = JSON.parse(readFileSync(join(distDir, 'app-build-manifest.json'), 'utf8'));
  const pages = manifest.pages ?? {};
  const pageNames = Object.keys(pages).sort();
  if (pageNames.length === 0) {
    fail('El manifest no tiene páginas: la build está rota o vacía.');
  }

  /** Tamaño gzip de un chunk (cachéado: las rutas comparten archivos). */
  const gzipCache = new Map();
  function gzipKb(file) {
    const absolute = resolve(distDir, file.replace(/^\//, ''));
    if (!gzipCache.has(file)) {
      if (!existsSync(absolute)) {
        fail(
          `El chunk ${file} del manifest no existe en disco. La build está incompleta: corre \`npm run build\` de nuevo.`
        );
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
    return;
  }

  if (!existsSync(BASELINE)) {
    fail(
      `No existe ${BASELINE}. Genéralo una vez con: npm run check:bundle -- --update (y comitea el archivo).`
    );
  }

  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
  const tolerance = baseline.toleranceKb ?? DEFAULT_TOLERANCE_KB;
  const { ok, violations } = evaluateBudget({ computed, sharedKb, baseline, tolerance });

  if (!ok) {
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
}

// Solo corre al ejecutarse: así los tests pueden importar el núcleo.
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  main();
}
