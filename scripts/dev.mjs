#!/usr/bin/env node
/**
 * Arranca `next dev` con su propio directorio de artefactos.
 *
 * Dos hilos de trabajo con puertos distintos seguían pisándose porque el puerto
 * no aísla nada: `next dev -p 3939` escribe en el mismo `.next` que el del 3111.
 * Este wrapper ata el puerto a un `distDir` propio (`NEXT_DIST_DIR`, que
 * `next.config.js` lee), así que «mi puerto» y «mis artefactos» no se pueden
 * desincronizar:
 *
 *   npm run dev                      → :3000, artefactos en un slot propio
 *   npm run dev -- --port 3939       → :3939, otro slot
 *   npm run dev -- --dist .next      → vuelve al directorio compartido, a propósito
 *
 * Los slots viven en `.freebuff/rix7-next-<puerto>`, dentro del proyecto: Next une
 * el `distDir` a la raíz, así que no admite rutas absolutas (el porqué del sitio
 * elegido está en `next-paths.mjs`). El wrapper rechaza una ruta absoluta con un
 * mensaje explícito en vez de dejar que Next muera con un ENOENT ilegible.
 *
 * Además escribe un `tsconfig` propio del slot: sin él, Next reescribiría el
 * `tsconfig.json` versionado en cada arranque (ver `slotTsconfigSource`).
 *
 * El proceso se lanza con `node <next/dist/bin/next>` en vez de `npx`: en
 * Windows `npx` es un shim `.cmd` y Node se niega a lanzarlo sin pasar por un
 * intérprete (el mismo motivo que documenta `deploy-prod.mjs`).
 *
 * Al arrancar y al salir da de alta y de baja la sesión en el registro local
 * (`slots.mjs`), para que el siguiente hilo vea qué puerto está ocupado antes de
 * elegir el suyo. Es best-effort: un fallo al escribir estado local nunca impide
 * levantar el servidor.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_DEV_PORT,
  DEFAULT_DIST_DIR,
  isRejectedDistDir,
  slotDistDir,
  slotTsconfigPath,
  slotTsconfigSource,
} from './next-paths.mjs';
import { checkNodeVersion, expectedMajor } from './node-version.mjs';
import { listSlots, registerSlot, unregisterSlot } from './slots.mjs';

// Reexportado por compatibilidad: la fuente única ahora es `next-paths.mjs`,
// pero los tests (y cualquier importador) lo siguen encontrando acá.
export { slotTsconfigSource };

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Interpreta los argumentos del wrapper.
 *
 * `--port`/`-p` y `--dist` los consume el wrapper; todo lo demás se reenvía
 * intacto a `next dev` para no perder ninguna opción de la herramienta.
 *
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ port: string, dist: string | undefined, passthrough: string[], help: boolean }}
 */
export function parseDevArgs(argv, env = process.env) {
  const args = {
    port: env.PORT ? String(env.PORT) : String(DEFAULT_DEV_PORT),
    dist: undefined,
    passthrough: [],
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--port' || arg === '-p') args.port = String(argv[++i] ?? args.port);
    else if (arg.startsWith('--port=')) args.port = arg.slice('--port='.length);
    else if (arg === '--dist') args.dist = argv[++i] ?? args.dist;
    else if (arg.startsWith('--dist=')) args.dist = arg.slice('--dist='.length);
    else args.passthrough.push(arg);
  }

  return args;
}

/**
 * Decide qué se va a ejecutar: puerto, distDir y opciones reenviadas.
 *
 * Prioridad del distDir: `--dist` > `NEXT_DIST_DIR` > slot derivado del puerto.
 * El valor se devuelve **relativo** cuando lo es: es lo que Next necesita.
 *
 * @param {{ argv?: string[], env?: Record<string, string | undefined>, root?: string }} [options]
 * @returns {{ port: string, distDir: string, tsconfigPath: string | null, passthrough: string[], help: boolean, error: string | null }}
 */
export function planDevRun({ argv = process.argv.slice(2), env = process.env, root = ROOT } = {}) {
  const args = parseDevArgs(argv, env);

  let distDir;
  if (args.dist) distDir = args.dist;
  else if (env.NEXT_DIST_DIR && env.NEXT_DIST_DIR.trim() !== '') distDir = env.NEXT_DIST_DIR.trim();
  else distDir = slotDistDir(args.port);

  const slot = {
    port: args.port,
    distDir,
    tsconfigPath: distDir === DEFAULT_DIST_DIR ? null : slotTsconfigPath(args.port),
    passthrough: args.passthrough,
    help: args.help,
    error: null,
  };

  if (isRejectedDistDir(distDir)) {
    const origen = args.dist ? '--dist' : 'NEXT_DIST_DIR';
    return {
      ...slot,
      error:
        `${origen} recibió una ruta absoluta (${distDir}), y Next solo acepta un distDir relativo al proyecto ` +
        `(lo une a ${root}). Usa una ruta relativa, o no pases nada para que el wrapper elija el slot del puerto.`,
    };
  }

  return slot;
}

function usage() {
  console.log(
    [
      '',
      'Arranca el servidor de desarrollo con artefactos propios del hilo.',
      '',
      '  npm run dev                     :3000, distDir en un slot propio',
      '  npm run dev -- --port 3939      otro puerto, otro distDir',
      '  npm run dev -- --dist .next     el directorio compartido, a propósito',
      '',
      'Opciones:',
      '  -p, --port <puerto>   puerto del servidor (por defecto 3000, o PORT)',
      '  --dist <directorio>   distDir relativo al repo (Next no acepta absolutos)',
      '  --help                esto',
      '',
      'Cualquier otra opción se reenvía a `next dev`.',
      '',
    ].join('\n')
  );
}

function main() {
  const plan = planDevRun();
  if (plan.help) return usage();
  if (plan.error) {
    console.error(`✖ ${plan.error}`);
    process.exit(1);
  }

  // Aviso, no candado: CI y Vercel fijan Node 24 (`.nvmrc`) y esta máquina
  // puede traer otra major. Un desalineamiento así se manifiesta como rarezas de
  // plataforma —los workers internos de `next dev` cayéndose— que cuesta
  // atribuir a la causa real. Ver `node-version.mjs`.
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

  console.log(`→ distDir: ${plan.distDir}`);
  console.log(`→ http://localhost:${plan.port}`);

  // Aviso, no candado: si otra sesión viva ya tiene ese puerto, Next fallará al
  // escuchar de todas formas, pero aquí el motivo se lee de una (y `npm run
  // slots` muestra el resto de los puertos en uso). La lectura limpia antes las
  // entradas con PID muerto, así que un cierre sucio no genera un falso aviso.
  try {
    const ocupado = listSlots().live.find((slot) => slot.port === Number(plan.port));
    if (ocupado) {
      console.warn(
        `⚠ Ya hay una sesión viva en el puerto ${plan.port} (${ocupado.mode}, PID ${ocupado.pid}). ` +
          'Si no es tuya, elige otro --port.'
      );
    }
  } catch {
    // El registro es una ayuda: si no se puede leer, se arranca igual.
  }

  // El tsconfig del slot protege al de la raíz de la reescritura de Next; con el
  // distDir compartido no hace falta (su `include` ya está declarado). Va al
  // lado del distDir, no dentro: `next dev` vacía el distDir al arrancar.
  if (plan.tsconfigPath) {
    const target = resolve(ROOT, plan.tsconfigPath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, slotTsconfigSource(plan.tsconfigPath, { root: ROOT }));
  }

  const child = spawn(process.execPath, [nextBin, 'dev', '-p', plan.port, ...plan.passthrough], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      NEXT_DIST_DIR: plan.distDir,
      ...(plan.tsconfigPath ? { NEXT_SLOT_TSCONFIG: plan.tsconfigPath } : {}),
    },
  });

  // La sesión queda registrada en cuanto Next tiene PID: puerto, modo, distDir
  // y desde cuándo. Se da de baja al salir por cualquiera de los dos caminos.
  try {
    registerSlot({
      port: Number(plan.port),
      pid: child.pid,
      mode: 'dev',
      distDir: plan.distDir,
      startedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('⚠ No se pudo registrar la sesión en .freebuff/slots.json:', error.message);
  }

  child.on('error', (error) => {
    try {
      unregisterSlot(child.pid ?? -1);
    } catch {}
    console.error('✖ No se pudo lanzar `next dev`:', error.message);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    try {
      unregisterSlot(child.pid ?? -1);
    } catch {}
    process.exit(code ?? (signal ? 1 : 0));
  });
}

// Solo corre al ejecutarse: así los tests pueden importar el planificador.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
