#!/usr/bin/env node
/**
 * Construye con `next build` —y, si se pide, mide el resultado en el mismo paso.
 *
 * `npm run build` escribe un recurso de **un solo escritor**: `.next`, o el slot
 * que indique `NEXT_DIST_DIR`. Dos builds a la vez —o una build mientras otro
 * hilo mide con `check:bundle`— se pisan y producen resultados que no significan
 * nada. Este wrapper registra el proceso en `.freebuff/slots.json` (modo `build`,
 * con su PID y su distDir) y lo da de baja al terminar, así el siguiente hilo ve
 * que hay una build en curso antes de lanzar la suya.
 *
 * El paso de medir también vive acá, para que construir y verificar en un slot
 * sea **un solo comando**, con el puerto como única cosa que recordar:
 *
 *   npm run build                     # el .next de CI/Vercel, sin medir
 *   npm run build:slot -- --port 3999 # slot del 3999: construye y mide ahí
 *   npm run build:slot -- --port 3999 --no-measure
 *
 * `--port` deriva el distDir (`.freebuff/rix7-next-<puerto>`) y el tsconfig del
 * slot —los mismos del `npm run dev` de ese puerto—, así que no hay que repetir
 * a mano ni `NEXT_DIST_DIR` ni el `--dir` del gate: era justo la duplicación que
 * se prestaba a medir un directorio y construir en otro. Al terminar la build,
 * corre el gate (`check-bundle-budget.mjs --dir <slot>`) en un proceso aparte y
 * propaga su código de salida.
 *
 * Es transparente a propósito: sin `--port` no cambia el `distDir`, ni las
 * variables, ni el código de salida. CI y Vercel, que invocan `npm run build` sin
 * argumentos, obtienen exactamente la misma build; solo se les suma un archivo de
 * estado local en `.freebuff/` (ignorado por git y excluido de la copia del
 * deploy). Si la escritura falla, el build sigue igual.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_DIST_DIR,
  isRejectedDistDir,
  slotDistDir,
  slotTsconfigPath,
  slotTsconfigSource,
} from './next-paths.mjs';
import { checkNodeVersion, expectedMajor } from './node-version.mjs';
import { listSlots, registerSlot, unregisterSlot } from './slots.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_SCRIPT = resolve(ROOT, 'scripts', 'check-bundle-budget.mjs');

/**
 * Interpreta los argumentos del wrapper.
 *
 * `--port`/`-p`, `--measure` y `--no-measure` los consume el wrapper; todo lo
 * demás se reenvía intacto a `next build` para no perder ninguna opción.
 *
 * @param {string[]} argv
 * @returns {{ port: string | null, measure: boolean, noMeasure: boolean, passthrough: string[] }}
 */
export function parseBuildArgs(argv) {
  const args = { port: null, measure: false, noMeasure: false, passthrough: [] };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--port' || arg === '-p') {
      args.port = String(argv[++i] ?? '');
    } else if (arg.startsWith('--port=')) {
      args.port = arg.slice('--port='.length);
    } else if (arg === '--measure') {
      args.measure = true;
    } else if (arg === '--no-measure') {
      args.noMeasure = true;
    } else {
      args.passthrough.push(arg);
    }
  }

  if (args.port !== null && args.port.trim() === '') args.port = null;
  return args;
}

/**
 * Decide dónde va esta build, qué tsconfig usa y si se mide al terminar.
 *
 * Con `--port` el comando queda completo: distDir y tsconfig salen del slot de
 * ese puerto (los mismos de `npm run dev`) y, salvo `--no-measure`, se mide ahí.
 * Sin `--port` todo se comporta como antes (`NEXT_DIST_DIR` o `.next`), y medir
 * es opt-in con `--measure`.
 *
 * @param {{ argv?: string[], env?: Record<string, string | undefined> }} [options]
 * @returns {{ port: string | null, distDir: string, tsconfigPath: string | null, measure: boolean, passthrough: string[], error: string | null }}
 */
export function planBuildRun({ argv = process.argv.slice(2), env = process.env } = {}) {
  const args = parseBuildArgs(argv);
  const base = { port: args.port, measure: false, passthrough: args.passthrough, error: null };

  if (args.port !== null) {
    if (!/^\d+$/.test(args.port)) {
      return {
        ...base,
        distDir: slotDistDir(args.port),
        tsconfigPath: slotTsconfigPath(args.port),
        error: `--port recibió «${args.port}», que no es un número de puerto. Usa p. ej. --port 3999.`,
      };
    }
    return {
      ...base,
      distDir: slotDistDir(args.port),
      tsconfigPath: slotTsconfigPath(args.port),
      measure: !args.noMeasure,
    };
  }

  const configured = typeof env.NEXT_DIST_DIR === 'string' ? env.NEXT_DIST_DIR.trim() : '';
  const distDir = configured || DEFAULT_DIST_DIR;
  const tsconfigPath =
    distDir !== DEFAULT_DIST_DIR && !isRejectedDistDir(distDir) ? `${distDir}.tsconfig.json` : null;

  return { ...base, distDir, tsconfigPath, measure: args.measure && !args.noMeasure };
}

/** Espera a un proceso hijo y devuelve su resultado, sin lanzar por un `error`. */
function waitFor(child) {
  return new Promise((resolvePromise) => {
    child.on('error', (error) => resolvePromise({ code: 1, signal: null, error }));
    child.on('exit', (code, signal) => resolvePromise({ code: code ?? (signal ? 1 : 0), signal, error: null }));
  });
}

async function main() {
  const plan = planBuildRun();

  if (plan.error) {
    console.error(`✖ ${plan.error}`);
    process.exit(1);
  }

  // Aviso, no candado: CI y Vercel fijan Node 24 (`.nvmrc`) y esta máquina
  // puede traer otra major. Un build bajo otra versión no tiene por qué romper,
  // pero el resultado hay que leerlo sabiendo que no es el de producción. Ver
  // `node-version.mjs`.
  const node = checkNodeVersion(process.version, expectedMajor({ root: ROOT }));
  if (node.message) console.warn(node.message);

  const require = createRequire(import.meta.url);
  let nextBin;
  try {
    nextBin = require.resolve('next/dist/bin/next');
  } catch {
    console.error('✖ No se encontró Next instalado. Corre `npm install` primero.');
    process.exit(1);
  }

  // Aviso, no candado: dos builds a la vez se pisan, pero quien corre esto a
  // mano casi siempre sabe lo que hace. Sirve para que no lo haga por descuido.
  try {
    const otras = listSlots().live.filter((slot) => slot.mode === 'build');
    for (const otra of otras) {
      const mismo = otra.distDir === plan.distDir ? ' (y sobre el MISMO distDir)' : '';
      console.warn(`⚠ Ya hay una build en curso: PID ${otra.pid}, distDir ${otra.distDir}${mismo}.`);
    }
  } catch {
    // El registro es una ayuda: si no se puede leer, se construye igual.
  }

  console.log(`→ distDir: ${plan.distDir}`);

  // El tsconfig del slot protege al de la raíz de la reescritura de Next: sin
  // él, una build en un slot ensuciaría un archivo versionado. Es idempotente y
  // se regenera en cada build.
  if (plan.tsconfigPath) {
    try {
      const target = resolve(ROOT, plan.tsconfigPath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, slotTsconfigSource(plan.tsconfigPath, { root: ROOT }));
    } catch (error) {
      console.warn('⚠ No se pudo escribir el tsconfig del slot:', error.message);
    }
  }

  const child = spawn(process.execPath, [nextBin, 'build', ...plan.passthrough], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      ...(plan.tsconfigPath ? { NEXT_SLOT_TSCONFIG: plan.tsconfigPath } : {}),
      NEXT_DIST_DIR: plan.distDir,
    },
  });

  try {
    registerSlot({
      port: plan.port ? Number(plan.port) : null,
      pid: child.pid,
      mode: 'build',
      distDir: plan.distDir,
      startedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('⚠ No se pudo registrar la build en .freebuff/slots.json:', error.message);
  }

  const build = await waitFor(child);
  try {
    unregisterSlot(child.pid ?? -1);
  } catch {}

  if (build.error) {
    console.error('✖ No se pudo lanzar `next build`:', build.error.message);
    process.exit(1);
  }
  if (build.code !== 0) process.exit(build.code);

  if (!plan.measure) process.exit(0);

  // La medición va en su propio proceso: el gate ya sabe leer el distDir, el
  // manifest y la línea base, y así conserva su verificación de build-de-dev y
  // su código de salida sin duplicar nada.
  console.log(`→ midiendo con check:bundle --dir ${plan.distDir}`);
  const gate = spawn(process.execPath, [CHECK_SCRIPT, '--dir', plan.distDir], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  const result = await waitFor(gate);
  if (result.error) {
    console.error('✖ No se pudo lanzar el gate del bundle:', result.error.message);
    process.exit(1);
  }
  process.exit(result.code);
}

// Solo corre al ejecutarse: así los tests pueden importar el planificador.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
