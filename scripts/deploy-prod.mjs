#!/usr/bin/env node
/**
 * Publica el proyecto a producción en Vercel.
 *
 * ¿Por qué un script y no solo `git push`?
 *
 * Un push a `main` **sí publica** en este proyecto: la integración de Git crea el
 * deployment de producción y **se lleva el alias** de `rix7.cl` y `www.rix7.cl`.
 * Lo que no hace es publicar la identidad —ese deployment no lleva `RIX7_BUILD`,
 * así que `/api/health` responde `build: null` y no se puede afirmar qué está en
 * vivo (pasó el 2026-10-23 con el commit `6f6951c`)—, ni publicar el árbol de
 * trabajo con sus cambios sin commitear, ni correr la guardia de secretos antes
 * de subir nada.
 *
 * Este script publica **con identidad y desde el árbol de trabajo**: copia el
 * árbol a un directorio temporal del sistema (sin `.git`, `node_modules` ni
 * `.next`), bloquea el descubrimiento del repositorio con
 * `GIT_CEILING_DIRECTORIES` y despliega desde ahí. Al quedar **sin metadata de
 * git**, el deployment se atribuye a la cuenta dueña —la única que crea
 * deployments en el plan Hobby— y Vercel lo promueve a producción
 * automáticamente.
 *
 * Antes de copiar nada corre la guardia de secretos (`check-secrets.mjs`). Los
 * `.env*` ya quedan fuera de la copia, pero un secreto suelto en un archivo
 * normal viajaría igual: mejor cortarlo antes de subir un deployment.
 *
 * ## El identificador de la build
 *
 * Publica, además, **qué árbol se está publicando**: calcula el hash del árbol
 * de trabajo (`scripts/build-id.mjs`) y lo pasa al deployment como variable de
 * entorno (`-e RIX7_BUILD=…`), que `/api/health` devuelve traducida. Sin eso,
 * «¿lo que está en vivo es este código?» no tiene respuesta posible desde
 * afuera, y ya nos costó dos veces creer que sí sin comprobarlo.
 *
 * Cuando corre dentro del release, el valor ya viene calculado en
 * `RIX7_BUILD` y se respeta tal cual: lo que se verifica tiene que ser
 * exactamente lo que se publicó, no un segundo cálculo que podría no coincidir.
 * El argumento solo usa `[0-9a-f.-]` porque en Windows este camino pasa por
 * `cmd.exe` (ver abajo): un espacio, una comilla o un `|` y el valor llegaría
 * cortado o no llegaría.
 *
 * ## Si el CLI se corta
 *
 * El CLI sale con error cuando pierde el stream del build remoto —un `fetch
 * failed`— aunque Vercel haya terminado y promovido ese deployment: pasó dos
 * veces el 2026-10-27, y en las dos el release informó «no se publicó nada
 * nuevo» sobre algo que sí estaba sirviendo, salteándose además su propia
 * verificación contra el árbol. Por eso el código de salida no decide solo: si no
 * es cero, se le pregunta a Vercel por ese deployment —el de la línea `Production`
 * de su propia salida, o el último de producción de `vercel ls` cuando el corte
 * ocurrió durante la subida— y si está `READY` la corrida continúa, con la
 * verificación en vivo como árbitro de si `rix7.cl` sirve este árbol. Un
 * deployment en `ERROR` —o que no termina de construirse— sigue siendo un fallo.
 *
 * Uso: npm run deploy:prod
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUILD_ID_ENV, describeBuild, readTreeBuildId } from './build-id.mjs';
import { assertNoSecrets } from './check-secrets.mjs';
import {
  RELEASE_TAG_ENV,
  RELEASE_VERSION_ENV,
  describeReleaseIdentity,
  readReleaseIdentity,
  sanitizeTag,
  sanitizeVersion,
} from './release-identity.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Donde armaban la copia las versiones del script anteriores a `stagingPathFor`. */
const LEGACY_STAGING = path.join(root, '.deploy-staging');

/** Prefijo de los stagings del temporal: es lo que permite reconocer y barrer los propios. */
const STAGING_PREFIX = 'rix7-deploy-';

/**
 * Dónde se arma la copia del árbol que se le pasa al CLI.
 *
 * Antes vivía en `.deploy-staging`, dentro del proyecto, y ese era el problema:
 * el CLI se lanza con `cwd` en ese directorio, así que en Windows el proceso —o
 * su hijo, o el antivirus— todavía tiene el handle abierto cuando `spawnSync`
 * retorna. El `rmSync` de la limpieza fallaba con EBUSY/EPERM y dejaba dentro del
 * repositorio un directorio que nadie borraba: `.gitignore` tapando el rastro y
 * un aviso amarillo que se leía como ruido. En el temporal del sistema el mismo
 * fallo no ensucia el árbol.
 *
 * El nombre lleva marca de tiempo y pid para que dos deploys simultáneos no se
 * pisen la copia: la versión anterior borraba `.deploy-staging` al empezar, así
 * que un segundo deploy podía vaciarle el staging al primero en pleno vuelo.
 *
 * @param {{ tmpdir?: string, now?: number, pid?: number }} [options]
 * @returns {string}
 */
export function stagingPathFor({ tmpdir = os.tmpdir(), now = Date.now(), pid = process.pid } = {}) {
  return path.join(tmpdir, `${STAGING_PREFIX}${now.toString(36)}-${pid}`);
}

/**
 * Códigos que en Windows significan «todavía no» y no «no se puede»: el handle
 * del CLI se cierra unos milisegundos después de que el proceso termina.
 */
const RETRYABLE_REMOVE_ERRORS = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY', 'EMFILE', 'ENFILE']);

/** Espera sincrónica: `main` es sincrónico de punta a punta (`spawnSync`). */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Borra un árbol de directorios, reintentando con una espera creciente.
 *
 * Devuelve si lo logró y **nunca lanza**: un fallo al limpiar no puede tumbar el
 * deploy, porque lo único que importa cuando algo sale mal es el error del
 * deploy. Pero tampoco se ignora en silencio: quien llama decide qué decir.
 *
 * @param {string} dir
 * @param {{
 *   retries?: number,
 *   baseDelayMs?: number,
 *   rm?: (dir: string) => void,
 *   sleep?: (ms: number) => void,
 * }} [options]
 * @returns {boolean}
 */
export function removeTreeWithRetry(
  dir,
  {
    retries = 6,
    baseDelayMs = 120,
    rm = (target) => fs.rmSync(target, { recursive: true, force: true }),
    sleep = sleepSync,
  } = {}
) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      rm(dir);
      return true;
    } catch (err) {
      if (!RETRYABLE_REMOVE_ERRORS.has(err?.code) || attempt === retries) return false;
      sleep(baseDelayMs * 2 ** attempt);
    }
  }

  return false;
}

/**
 * Barre los stagings que dejaron deploys anteriores (interrumpidos o con el
 * handle todavía tomado) y devuelve cuántos borró.
 *
 * Solo toca directorios con este prefijo **y** más viejos que `maxAgeMs`: uno
 * reciente puede ser un deploy corriendo ahora mismo en otra terminal, y borrarle
 * la copia en pleno vuelo es peor que dejar basura en el temporal.
 *
 * @param {{ tmpdir?: string, maxAgeMs?: number, now?: number }} [options]
 * @returns {number}
 */
export function sweepStaleStaging({
  tmpdir = os.tmpdir(),
  maxAgeMs = 12 * 60 * 60 * 1000,
  now = Date.now(),
} = {}) {
  let entries;
  try {
    entries = fs.readdirSync(tmpdir, { withFileTypes: true });
  } catch {
    return 0;
  }

  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(STAGING_PREFIX)) continue;
    const target = path.join(tmpdir, entry.name);
    try {
      if (now - fs.statSync(target).mtimeMs < maxAgeMs) continue;
    } catch {
      continue;
    }
    if (removeTreeWithRetry(target)) removed += 1;
  }

  return removed;
}

/**
 * Los argumentos del CLI de Vercel, con el identificador de la build si lo hay.
 *
 * Es una función —y no tres líneas sueltas— porque es lo único de este script
 * que se puede probar sin desplegar nada: que el `-e` esté armado bien, y que no
 * aparezca cuando no hay identificador, es la diferencia entre un deployment
 * identificable y uno que responde `build: null` para siempre.
 *
 * @param {{ buildValue?: string | null, version?: string | null, tag?: string | null }} [options]
 * @returns {string[]}
 */
export function vercelArgs({ buildValue = null, version = null, tag = null } = {}) {
  const args = ['--yes', 'vercel', '--prod', '--yes'];
  if (buildValue) args.push('-e', `${BUILD_ID_ENV}=${buildValue}`);
  // La versión y el tag viajan como variables de entorno del deployment para
  // que `/api/health` pueda responder «¿es esta release?» y no solo «¿es este
  // árbol?». Son semver y un tag semver: no traen espacios ni caracteres que
  // rompan el paso por `cmd.exe` en Windows.
  const safeVersion = sanitizeVersion(version);
  const safeTag = sanitizeTag(tag);
  if (safeVersion) args.push('-e', `${RELEASE_VERSION_ENV}=${safeVersion}`);
  if (safeTag) args.push('-e', `${RELEASE_TAG_ENV}=${safeTag}`);
  return args;
}

/**
 * Qué dice del deployment el estado que informa Vercel.
 *
 * `pending` no es un veredicto: es «todavía no», y por eso se puede esperar.
 * `unknown` tampoco lo es, pero no se espera: si Vercel no informa un estado que
 * sepamos leer, insistir no lo va a aclarar.
 *
 * @param {unknown} readyState
 * @returns {'ready' | 'failed' | 'pending' | 'unknown'}
 */
export function deploymentVerdict(readyState) {
  const state = String(readyState ?? '').toUpperCase();
  if (state === 'READY') return 'ready';
  if (state === 'ERROR' || state === 'CANCELED') return 'failed';
  if (state === 'QUEUED' || state === 'BUILDING' || state === 'INITIALIZING') return 'pending';
  return 'unknown';
}

/**
 * La URL del deployment que publicó el CLI, sacada de su propia salida.
 *
 * El CLI imprime `Production  https://rix7-<hash>-<team>.vercel.app` apenas
 * termina de subir los archivos, **antes** del build remoto. Por eso, cuando el
 * stream se corta a mitad del build, la URL ya está: es lo que permite preguntarle
 * a Vercel cómo terminó en vez de creerle al código de salida.
 *
 * @param {string | null | undefined} output
 * @returns {string | null}
 */
export function deploymentUrlFrom(output) {
  const text = String(output ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\r/g, '');

  // `Production` y no `Inspect`: el segundo es la página del panel, que no sirve
  // para preguntarle nada a la API.
  const production = /^\s*Production\s*:?\s+(https?:\/\/\S+)/im.exec(text);
  if (production) return production[1].replace(/[,)]+$/, '');

  const any = /https:\/\/[a-z0-9-]+\.vercel\.app/i.exec(text);
  return any ? any[0] : null;
}

/**
 * La URL de producción más reciente de un `vercel ls --json`.
 *
 * Es el respaldo para el corte que ocurre **antes** de que el CLI imprima la
 * línea `Production` (por ejemplo durante la subida): si el deployment se creó
 * igual, está en la lista. Se acota por `since` para no confundirlo con uno viejo,
 * y solo mira `target: production`.
 *
 * @param {unknown} payload
 * @param {{ since?: number, slackMs?: number }} [options]
 * @returns {string | null}
 */
export function latestProductionUrl(payload, { since = 0, slackMs = 60_000 } = {}) {
  const deployments = Array.isArray(/** @type {any} */ (payload)?.deployments)
    ? /** @type {any[]} */ (/** @type {any} */ (payload).deployments)
    : [];

  const candidates = deployments
    .filter((deployment) => deployment && deployment.target === 'production' && deployment.url)
    .filter((deployment) => Number(deployment.createdAt) >= since - slackMs)
    .sort((a, b) => Number(b.createdAt) - Number(a.createdAt));

  return candidates.length ? `https://${candidates[0].url}` : null;
}

/**
 * Lanza el CLI capturando su salida **y** repitiéndola a la terminal.
 *
 * Antes era `spawnSync(..., { stdio: 'inherit' })`: nada que capturar y nada que
 * leer cuando el stream se corta. Ahora la salida se acumula —de ahí sale la URL
 * del deployment y el diagnóstico— y se reemite al instante para no perder el
 * progreso del build, que dura minutos.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, out?: NodeJS.WritableStream, err?: NodeJS.WritableStream }} [options]
 * @returns {Promise<{ status: number | null, output: string, error: Error | null }>}
 */
export async function runVercelCli(command, args, { cwd, env, out = process.stdout, err = process.stderr } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';

    child.stdout?.on('data', (chunk) => {
      output += chunk;
      out.write(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      output += chunk;
      err.write(chunk);
    });

    child.on('error', (error) => resolve({ status: null, output, error }));
    child.on('close', (status) => resolve({ status, output, error: null }));
  });
}

/** `npx vercel <args>` por el mismo camino que el deploy (`cmd.exe` en Windows). */
function vercelSync(args) {
  const isWindows = process.platform === 'win32';
  const [command, argv] = isWindows ? ['cmd.exe', ['/c', 'npx', ...args]] : ['npx', args];
  return spawnSync(command, argv, {
    cwd: root,
    encoding: 'utf8',
    timeout: 90_000,
    maxBuffer: 10 * 1024 * 1024,
  });
}

/** El `--json` de `vercel inspect`, o `null` si no se pudo leer. */
function inspectDeployment(url, { run = vercelSync } = {}) {
  const result = run(['--yes', 'vercel', 'inspect', url, '--json']);
  if (result?.status !== 0 || !result?.stdout) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

/** El `--json` de `vercel ls`, o `null`. */
function listDeployments({ run = vercelSync } = {}) {
  const result = run(['--yes', 'vercel', 'ls', '--json']);
  if (result?.status !== 0 || !result?.stdout) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

/**
 * Pregunta cómo terminó el deployment, esperando mientras siga construyendo.
 *
 * El corte del stream puede ocurrir con el build a mitad de camino, así que un
 * `BUILDING` no es un fallo: se espera. Lo que no se hace nunca es **deducir** el
 * resultado del código de salida del CLI, que es justo el dato que el corte
 * rompe.
 *
 * @param {{
 *   url: string,
 *   attempts?: number,
 *   delayMs?: number,
 *   inspect?: (url: string) => any,
 *   sleep?: (ms: number) => Promise<unknown>,
 *   log?: (...args: unknown[]) => void,
 * }} options
 * @returns {Promise<{ verdict: ReturnType<typeof deploymentVerdict>, readyState: string | null, info: any, attempts: number }>}
 */
export async function confirmDeployment({
  url,
  attempts = 8,
  delayMs = 15_000,
  inspect = inspectDeployment,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = console.log,
} = /** @type {any} */ ({})) {
  let readyState = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const info = await inspect(url);
    readyState = typeof info?.readyState === 'string' ? info.readyState : null;
    const verdict = deploymentVerdict(readyState);
    if (verdict !== 'pending') return { verdict, readyState, info, attempts: attempt };

    if (attempt < attempts) {
      log(
        `  · ${url} sigue en ${readyState}; espero ${Math.round(delayMs / 1000)} s` +
          ` (${attempt}/${attempts})…`
      );
      await sleep(delayMs);
    }
  }

  return { verdict: deploymentVerdict(readyState), readyState, info: null, attempts };
}

/** Rutas que no deben viajar al deployment. */
const EXCLUDED = new Set([
  '.git',
  '.next',
  '.vercel',
  '.deploy-staging',
  '.deploy-tmp',
  '.freebuff',
  'node_modules',
  'out',
  'build',
]);

function copyTree(from, to) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (EXCLUDED.has(entry.name) || entry.name.startsWith(".env")) continue; // los .env* llevan secretos: no viajan al deployment.
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(target, { recursive: true });
      copyTree(source, target);
    } else {
      fs.copyFileSync(source, target);
    }
  }
}

/**
 * Lo que hace `npm run deploy:prod`, de punta a punta.
 *
 * Está en una función —y el archivo solo la llama al ejecutarse, igual que el
 * resto de los scripts— porque así los tests pueden importar `vercelArgs` sin
 * que importar el módulo intente desplegar nada.
 */
async function main() {
  // La copia mantiene el vínculo con el proyecto de Vercel.
  const projectFile = path.join(root, '.vercel', 'project.json');
  if (!fs.existsSync(projectFile)) {
    console.error('✖ No se encontró .vercel/project.json — ejecuta `npx vercel link` primero.');
    process.exit(1);
  }

  // Paso previo: la guardia de secretos. Corre sobre el árbol de trabajo, que es
  // justo lo que se va a copiar al staging.
  if (!assertNoSecrets({ action: 'despliego a producción' })) {
    process.exit(1);
  }

  // El identificador: el que ya calculó el release si viene por entorno, o uno
  // propio cuando este comando se corre solo. Si no se puede calcular (sin git),
  // el deploy sigue igual —pero lo dice, porque a partir de ahí nadie puede
  // afirmar que producción sea este árbol.
  const inherited = process.env[BUILD_ID_ENV] || null;
  const treeBuild = inherited ? null : readTreeBuildId({ root });
  const buildValue = inherited ?? treeBuild?.value ?? null;

  // La identidad de release sigue el mismo criterio: si el release ya la
  // calculó, se respeta; si no, se lee acá. Sin ella el deployment responde
  // `release: null` y la verificación no puede afirmar qué versión publicó.
  const inheritedVersion = process.env[RELEASE_VERSION_ENV] || null;
  const inheritedTag = process.env[RELEASE_TAG_ENV] || null;
  const releaseIdentity =
    inheritedVersion || inheritedTag
      ? { version: sanitizeVersion(inheritedVersion), tag: sanitizeTag(inheritedTag) }
      : readReleaseIdentity({ root });
  const version = releaseIdentity?.version ?? null;
  const tag = releaseIdentity?.tag ?? null;

  if (inherited) {
    console.log(`→ Identificador de la build: ${inherited} (lo aporta el release)`);
  } else if (buildValue) {
    console.log(`→ Identificador de la build: ${describeBuild(treeBuild)}`);
  } else {
    console.warn(`⚠ No se pudo calcular el identificador de la build: ${treeBuild?.error ?? 'sin datos'}.`);
    console.warn('  El despliegue va a responder `build: null` en /api/health: no se podrá comprobar que sea este árbol.');
  }

  if (treeBuild?.skipped?.length) {
    console.warn(`⚠ No se pudieron leer ${treeBuild.skipped.length} archivo(s) del árbol: el identificador se calculó sin ellos.`);
  }

  if (version || tag) {
    console.log(`→ Versión y tag: ${describeReleaseIdentity({ version, tag })}`);
    if (!tag) {
      console.warn('  El commit no está taggeado: la build se publica, pero queda sin tag identificable.');
    }
  } else {
    console.warn(
      `⚠ No se pudo leer la versión/tag (${releaseIdentity?.error ?? 'sin datos'}): /api/health responderá \`release: null\`.`
    );
  }

  // Los stagings que dejaron deploys anteriores se van solos: nadie tiene que
  // acordarse de borrarlos a mano.
  const swept = sweepStaleStaging();
  if (swept) console.log(`→ Limpié ${swept} staging(s) viejo(s) del temporal.`);

  // El que armaba la versión anterior del script vivía dentro del árbol; si quedó
  // tirado, se va acá. Que no se pueda borrar todavía no afecta a este deploy:
  // la copia nueva va al temporal.
  if (fs.existsSync(LEGACY_STAGING) && !removeTreeWithRetry(LEGACY_STAGING)) {
    console.warn('⚠ Quedó un `.deploy-staging` de un deploy anterior y Windows no lo suelta todavía.');
    console.warn('  Este deploy no depende de él (`npm run clean` lo borra).');
  }

  const staging = stagingPathFor();
  console.log(`→ Preparando copia sin metadata de git en ${staging}…`);
  // El staging se crea acá y no dentro de `copyTree`: esa función solo hace
  // `mkdirSync` cuando copia un directorio, así que si el primer elemento del
  // árbol es un archivo (`.env.example` va primero en orden alfabético) el
  // `copyFileSync` apunta a una carpeta que todavía no existe y falla con ENOENT.
  fs.mkdirSync(staging, { recursive: true });
  copyTree(root, staging);
  fs.mkdirSync(path.join(staging, '.vercel'), { recursive: true });
  fs.copyFileSync(projectFile, path.join(staging, '.vercel', 'project.json'));

  // `GIT_CEILING_DIRECTORIES` impide que git ascienda hasta el repositorio real:
  // sin esa metadata, el deployment se atribuye a la cuenta dueña, que es la única
  // que crea deployments en el plan Hobby.
  // En Windows `npx` es un shim `.cmd`, y desde el parche de CVE-2024-27980 Node no
  // lanza `.cmd`/`.bat` directamente: `spawnSync` falla con EINVAL y deja `status`
  // en `null`. Se pasa por `cmd.exe /c` en vez de `shell: true`, que es la forma
  // explícita de invocar el shim sin que los argumentos pasen por un intérprete.
  const isWindows = process.platform === 'win32';
  const vercel = vercelArgs({ buildValue, version, tag });
  const [command, args] = isWindows ? ['cmd.exe', ['/c', 'npx', ...vercel]] : ['npx', vercel];

  // Desde acá se sabe cuándo empezó esta publicación: es lo que permite reconocer
  // el deployment propio en `vercel ls` si el CLI se corta antes de imprimir su URL.
  const startedAt = Date.now();
  const result = await runVercelCli(command, args, {
    cwd: staging,
    env: { ...process.env, GIT_CEILING_DIRECTORIES: root },
  });

  // La limpieza no puede tumbar el script: en Windows el CLI puede seguir
  // reteniendo archivos un instante y un fallo acá taparía el error real del
  // deploy, que es lo único que importa cuando algo sale mal. Por eso se reintenta
  // con espera creciente, y si aun así queda algo se dice **dónde**: en el
  // temporal, nunca en el árbol, y el próximo deploy lo barre.
  if (!removeTreeWithRetry(staging)) {
    console.warn(`⚠ No se pudo borrar el staging temporal; queda para revisar: ${staging}`);
  }

  // Un fallo al **lanzar** (no un fallo del deploy) deja `status` en `null`. Sin
  // esto el script salía con 1 y sin imprimir nada, que es lo que lo hacía
  // imposible de diagnosticar.
  if (result.error) {
    console.error('✖ No se pudo lanzar el CLI de Vercel:', result.error.message);
    process.exit(1);
  }

  const status = result.status ?? 1;

  // Un `fetch failed` del CLI no dice nada del deployment: se corta el stream del
  // build remoto y el proceso sale con 1 **aunque Vercel haya terminado y
  // promovido lo publicado**. Pasó dos veces el 2026-10-27. Cuando el código de
  // salida no es cero, se le pregunta a Vercel cómo quedó ese deployment; si está
  // READY, la publicación ocurrió y la corrida sigue —la verificación en vivo es
  // la que decide si `rix7.cl` sirve este árbol, y es la que no se puede saltear.
  if (status !== 0) {
    const url =
      deploymentUrlFrom(result.output) ??
      latestProductionUrl(listDeployments(), { since: startedAt });

    if (url) {
      console.log(`\n  ↻ El CLI terminó con ${status}; pregunto cómo quedó ${url}…`);
      const outcome = await confirmDeployment({ url });

      if (outcome.verdict === 'ready') {
        console.warn(`\n⚠ El CLI de Vercel terminó con ${status}, pero el deployment sí quedó publicado:`);
        console.warn(`    ${url} (READY)${describeAliases(outcome.info)}`);
        console.warn('  La publicación se toma como hecha: la verificación en vivo comprueba si `rix7.cl` sirve este árbol.');
        process.exit(0);
      }

      console.error(
        `✖ El deployment ${url} no quedó sirviendo (estado: ${outcome.readyState ?? 'desconocido'}).`
      );
    } else {
      console.error('✖ El CLI terminó con error y no se pudo identificar un deployment para comprobar.');
    }
  }

  process.exit(status);
}

/** Los dominios que quedaron apuntando al deployment, si Vercel los informa. */
function describeAliases(info) {
  const aliases = Array.isArray(info?.aliases) ? info.aliases.filter((alias) => typeof alias === 'string') : [];
  return aliases.length ? ` · dominios: ${aliases.slice(0, 6).join(', ')}` : '';
}

// Solo corre al ejecutarse: así los tests pueden importar `vercelArgs`.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main().catch((error) => {
    console.error(`✖ El deploy falló de forma inesperada: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
