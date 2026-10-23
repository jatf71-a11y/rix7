#!/usr/bin/env node
/**
 * Publica a producción de punta a punta con **un solo comando**: construye,
 * aplica las migraciones pendientes, **comprueba el esquema** de la base,
 * despliega y verifica la URL viva. Aborta en el primer paso que falle, así que
 * el resultado es una sola cosa: o queda publicado y verificado, o no se tocó
 * producción más allá de lo que dice el informe.
 *
 *   npm run release:prod
 *   npm run release:prod -- --dry-run
 *   npm run release:prod -- --with-tests      # tipos + suite antes del build
 *   npm run release:prod -- --no-db
 *   npm run release:prod -- --no-build --no-db --no-deploy --url https://rix7.cl
 *
 * ## Por qué existe
 *
 * El runbook ([`DEPLOY.md`](../DEPLOY.md)) eran cuatro comandos que había que
 * correr en orden y **decidir** en el medio: construir, aplicar migraciones,
 * desplegar y verificar. Eso se presta a tres errores concretos, y este script
 * los convierte en imposibles:
 *
 * 1. **Desplegar código que la base no soporta.** Es el que ya pasó: el panel
 *    de corredoras quedó en vivo mientras `properties.rol`, `properties.rented`
 *    y `socio_publicaciones` no existían en producción, y nada lo advirtió. Por
 *    eso las migraciones van **antes** del deploy, no después: la base primero
 *    soporta, el código después usa.
 * 2. **Publicar sin verificar.** `vercel --prod` saliendo 0 solo dice que subió
 *    una build. Que la portada responda, que el panel exista y que no falte
 *    nada crítico se comprueba acá, contra la URL publicada.
 * 3. **Contar el resultado de memoria.** El informe final es lo que pasó, paso
 *    por paso, con lo que **no** se probó dicho explícitamente.
 *
 * ## El orden, y por qué no es negociable
 *
 *   build → migraciones → esquema → deploy → verificación
 *
 * (con `--with-tests`, tipos y suite van **delante** de todo: ver el final de
 * esta cabecera.)
 *
 * - **build**: Vercel compila el suyo, pero un error de tipos que solo aparece
 *   acá se descubre **después** del deploy (~2 min por intento). Es el mismo
 *   `npm run build` de CI (`scripts/build.mjs`), sin atajos.
 * - **migraciones**: `npm run db:push` aplica lo que falte y sale 0 si no había
 *   nada pendiente. Es **aditivo por diseño** (ver `supabase/migrations/LEEME.md`),
 *   así que repetirlo no rompe nada. Necesita `SUPABASE_ACCESS_TOKEN`; sin él
 *   sale 1 y este script se detiene **antes** de desplegar, que es justo lo que
 *   se quiere. Si el esquema ya está al día y no tenés el token a mano,
 *   `--no-db` saltea el paso (y el informe lo dice).
 * - **esquema**: `scripts/check-schema.mjs` lee la base **real** y comprueba que
 *   existan los objetos que el código desplegado usa (columnas de `properties`,
 *   la función `rix7_partner_id()`). No es un duplicado del paso anterior: uno
 *   **aplica**, el otro **comprueba que quedó aplicado** — y este último solo
 *   necesita la clave pública, así que funciona aunque no haya token a mano,
 *   que era justo el caso en que antes nadie podía saber si la base estaba
 *   lista. Un `--no-db` no lo saltea: es la red que evita publicar código contra
 *   columnas que no existen (el incidente que documenta `0015`).
 * - **deploy**: `scripts/deploy-prod.mjs`, que publica el árbol de trabajo sin
 *   metadata de git —así el deployment se atribuye a la cuenta dueña, la única
 *   que crea deployments en el plan Hobby— y corre la guardia de secretos antes
 *   de copiar nada. Un `git push` a `main` **sí** publica y se lleva el alias,
 *   pero sin el **identificador de la build**, la versión ni el tag: deja
 *   `/api/health` respondiendo `build: null` (pasó el 2026-10-23 con `6f6951c`).
 *   Por eso este paso publica además el identificador (el hash de este árbol, ver
 *   `scripts/build-id.mjs`), que es lo que hace comprobable la última pregunta.
 * - **verificación**: `runSmoke` (portada, panel, alta), `runCheck` (críticos
 *   de `/api/health`) y la **comparación del identificador** contra
 *   **`https://rix7.cl`**, que es la única URL pública de producción: si el
 *   alias no quedó apuntando a lo recién publicado, la comparación del hash lo
 *   detecta y el release falla en vez de aprobar una build que nadie ve. La URL
 *   del deployment se imprime como referencia. Se reintenta unas veces porque un
 *   deploy recién promovido puede tardar unos segundos en propagarse por el
 *   borde, y un rojo por eso no es información. Un fallo del deploy por un
 *   rechazo transitorio del CLI (`Not authorized`, 429, timeout) también se
 *   reintenta una vez: ver `isTransientDeployFailure`.
 *
 * ## El identificador de la build
 *
 * El hueco que quedó después del release de punta a punta era el original: nada
 * comprobaba que **lo publicado sea el árbol del repositorio**. El paso de
 * deploy publica el hash de este árbol como variable del deployment y la
 * verificación lo compara con lo que responde `/api/health`:
 *
 * - **coincide** → lo que está en vivo es este código, y el informe lo dice con
 *   el identificador.
 * - **no coincide**, porque en vivo hay algo distinto de lo recién publicado →
 *   el alias todavía sirve el deployment anterior (se reintenta) o alguien
 *   publicó otra cosa; falla.
 * - **no coincide**, porque el árbol cambió mientras corría el release → lo
 *   publicado existe, pero ya no es «este árbol»; falla y dice que hay que
 *   volver a correrlo.
 * - **no se pudo calcular** (sin git a mano) → se publica igual, se dice, y
 *   **no** se afirma nada: un release verde no puede dar por comprobado lo que no
 *   comparó.
 *
 * La guardia de secretos corre **primero**, como paso previo: si hay un token
 * suelto en el árbol, no tiene sentido aplicar migraciones ni nada.
 *
 * ## Qué NO hace
 *
 * - **No escribe nada en la base que no sean migraciones.** En particular, no
 *   da de alta la visita de prueba: la persistencia (`persisted: true`) se
 *   comprueba aparte, con `npm run smoke:prod -- --write --email tu@correo.cl`,
 *   que manda un correo real y deja una fila en `public.signups`. El informe
 *   final lo dice en vez de dar por probado lo que no se probó.
 * - **No hace `git push`.** El deploy publica el árbol de trabajo, no el
 *   commit; el informe avisa si quedaron cambios sin commitear o commits sin
 *   empujar, pero no toca git.
 * - **No revierte nada.** Si el deploy salió bien y la verificación falla, el
 *   camino es el rollback (sección 8 del runbook), y el informe lo dice.
 *
 * ## Salida del proceso
 *
 * `0` = los pasos que corrieron salieron bien · `1` = un paso falló (el release
 * se detuvo ahí) · `2` = el comando se usó mal o el script mismo falló, y
 * **nada se ejecutó**.
 *
 * ## Uso
 *
 *   npm run release:prod                 # los cinco pasos (--with-tests agrega tipos y suite)
 *   npm run release:prod -- --dry-run    # muestra el plan y no ejecuta nada *   npm run release:prod -- --no-db       # sin migraciones (esquema ya al día)
 *   npm run release:prod -- --no-schema   # sin comprobar la base (no recomendado)
 *   npm run release:prod -- --attempts 1 # sin reintentos de verificación
 *   npm run release:prod -- --url http://localhost:3111 --no-build --no-db --no-deploy
 *
 * El núcleo —el plan, el parseo de la salida de Vercel y la decisión de a qué
 * URL verificar— es puro y se prueba sin red ni procesos (`release-prod.test.ts`).
 *
 * ## El paso opcional `--with-tests`
 *
 * El build de Next ya typechequea, pero **no** corre la suite: un test rojo llega
 * a producción sin que nadie se entere hasta que el CI de otro commit lo dice.
 * `--with-tests` agrega, como **primer** paso, `tsc --noEmit` y la suite completa
 * (`vitest run`). Va primero porque es la señal más barata y la que más rápido
 * falla: aborta en segundos en vez de gastar un build y un deploy para llegar a
 * la misma conclusión. Es opt-in a propósito —el release no debería tardar dos
 * minutos más por defecto— y el plan lo anuncia como disponible cuando no se pidió.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUILD_ID_ENV, describeBuild, readTreeBuildId } from './build-id.mjs';
import { assertNoSecrets } from './check-secrets.mjs';
import { formatReport as formatHealthReport, runCheck } from './check-health.mjs';
import {
  RELEASE_TAG_ENV,
  RELEASE_VERSION_ENV,
  describeReleaseIdentity,
  readReleaseIdentity,
} from './release-identity.mjs';
import { formatReport as formatSmokeReport, runSmoke } from './smoke-prod.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** El dominio público: a dónde se verifica cuando el deploy no dice cuál es. */
export const DEFAULT_SITE_URL = 'https://rix7.cl';

/**
 * Espera entre reintentos de verificación, en milisegundos.
 *
 * No es un `sleep` decorativo: cuando `vercel --prod` promueve un deployment, el
 * alias puede seguir sirviendo el anterior unos segundos. Sin la espera, un
 * release sano saldría rojo por llegar un instante temprano.
 */
export const RETRY_DELAY_MS = 10_000;

/** Intentos de verificación por defecto (el primero más los reintentos). */
export const DEFAULT_ATTEMPTS = 3;

/**
 * Intentos del paso de deploy. Dos: el original más un reintento.
 *
 * No es un «por si acaso»: Vercel contestó `Error: Not authorized` con la sesión
 * perfectamente válida (el CLI respondía `whoami` y el proyecto estaba
 * linkeado), y el mismo comando, sin tocar nada, pasó al segundo intento. Un
 * deploy fallido no deja nada a medio publicar —Vercel conserva el anterior— y
 * reintentarlo crea otro deployment, así que el reintento es seguro.
 */
export const DEPLOY_ATTEMPTS = 2;

/**
 * ¿El deploy falló por algo que se arregla reintentando?
 *
 * Se mira la salida porque es lo único que hay: el CLI no distingue un 403
 * transitorio de uno real con un código propio. Deliberadamente angosto —un
 * fallo de compilación o un `--prod` rechazado por configuración no entran acá—
 * para que el reintento no tape un error de verdad.
 *
 * @param {string | null | undefined} output
 * @returns {boolean}
 */
export function isTransientDeployFailure(output) {
  return /not authorized|unauthorized|rate limit|too many requests|\b429\b|ECONNRESET|ETIMEDOUT|socket hang up|ENOTFOUND/i.test(
    String(output ?? '')
  );
}

/**
 * Los pasos del release, en orden. `flag` es el `--no-…` que lo saltea y
 * `optIn` el flag que lo **agrega** (sin él, el paso no está en el plan).
 *
 * Un paso corre un `script` de `scripts/` (el caso normal, que es reusar lo que
 * ya existe) o una lista de `commands`, que son binarios de `node_modules`
 * resueltos con `require.resolve` y lanzados con `node` — el mismo camino que usa
 * `scripts/build.mjs` para Next, y el que evita el problema de los shims `.cmd`
 * de Windows.
 *
 * `why` y `hint` viajan con el paso para que el informe pueda explicar por qué
 * está ahí y qué hacer si falla, sin repetir el texto por todo el archivo.
 *
 * @typedef {{ bin: string, args: string[] }} ReleaseCommand
 * @typedef {{ id: string, title: string, script?: string | null, commands?: ReleaseCommand[], flag?: string, optIn?: string, why: string, hint: string }} ReleaseStep
 * @type {ReleaseStep[]}
 */
export const RELEASE_STEPS = [
  {
    id: 'tests',
    title: 'Tipos y tests',
    script: null,
    commands: [
      { bin: 'typescript/bin/tsc', args: ['--noEmit'] },
      { bin: 'vitest/vitest.mjs', args: ['run'] },
    ],
    optIn: '--with-tests',
    why: 'el build typechequea pero no corre la suite: un test rojo llegaría a producción sin que nadie lo vea.',
    hint: 'es un test o un tipo roto, no el release: arréglalo (o quita `--with-tests`, que es opt-in) y vuelve a correr.',
  },
  {
    id: 'build',
    title: 'Build de producción',
    script: 'scripts/build.mjs',
    flag: '--no-build',
    why: 'un error de tipos descubierto acá se arregla en un minuto; descubierto por Vercel, en un deploy fallido.',
    hint: 'mira el error de `next build` de arriba y corre `npx tsc --noEmit` para verlo completo. Con `--no-build` se saltea el paso (no recomendado: Vercel compilaría igual, sin la red de seguridad).',
  },
  {
    id: 'db',
    title: 'Migraciones pendientes',
    script: 'scripts/db-push.mjs',
    flag: '--no-db',
    why: 'la base tiene que soportar el código que se va a publicar; es el error que dejó el panel de corredoras en vivo contra columnas inexistentes.',
    hint: 'si el mensaje dice «Falta SUPABASE_ACCESS_TOKEN»: genera uno en https://supabase.com/dashboard/account/tokens y déjalo en `.env.local` (no en Vercel). Si el problema es la referencia del proyecto, pasa `--ref <ref>` — o usa `--no-db` si el esquema ya está al día.',
  },
  {
    id: 'schema',
    title: 'Esquema de la base',
    script: 'scripts/check-schema.mjs',
    flag: '--no-schema',
    why: 'aplicar la migración no es lo mismo que comprobar que quedó aplicada: esto lee la base real y dice qué falta antes de publicar. Solo usa la clave pública, así que no depende del token.',
    hint: 'si dice que falta una migración, aplicala con `npm run db:push` (necesita SUPABASE_ACCESS_TOKEN en .env.local). Si dice «no se pudo decidir», revisá NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local. Con `--no-schema` se publica sin esta comprobación — y el código puede quedar en vivo contra columnas que no existen.',
  },
  {
    id: 'deploy',
    title: 'Deploy a producción',
    script: 'scripts/deploy-prod.mjs',
    flag: '--no-deploy',
    why: 'publica el árbol de trabajo sin metadata de git —así el deployment se atribuye a la cuenta dueña, la única que crea deployments en el plan Hobby— tras correr la guardia de secretos, y publica el identificador de la build junto con la versión y el tag para que lo publicado se pueda comparar con el repo.',
    hint: 'si falló por `.vercel/project.json`, corre `npx vercel link`; si falló por la guardia de secretos, mira los hallazgos de arriba. Un deploy fallido **no** deja nada a medio publicar: Vercel conserva el anterior.',
  },
  {
    id: 'verify',
    title: 'Verificación en vivo',
    script: null,
    flag: '--no-verify',
    why: 'un deploy que salió 0 solo dice que subió una build; que responda, que no falte nada crítico y que **lo que está en vivo sea este árbol y esta release** se comprueba acá.',
    hint: 'mira el informe de arriba: `smoke` dice qué ruta falló, `health` qué subsistema crítico falta y el identificador de la build dice si lo publicado es este árbol. Si el deploy quedó mal, el camino es el rollback (sección 8 de DEPLOY.md).',
  },
];

/**
 * Los binarios del plan resueltos a un archivo real, con `node` como ejecutable.
 *
 * Se sigue la convención de `scripts/build.mjs` (`next/dist/bin/next`): se lanza
 * el binario con `node` en vez de pasar por `npx`, que en Windows es un shim
 * `.cmd` que Node no ejecuta directo (el problema que documenta `deploy-prod.mjs`).
 *
 * @param {ReleaseCommand[]} commands
 * @param {(specifier: string) => string} resolveBin
 * @returns {{ executable: string, args: string[], bin: string }[]}
 */
export function resolveCommands(commands, resolveBin = defaultResolveBin) {
  return commands.map((command) => ({
    executable: process.execPath,
    args: [resolveBin(command.bin), ...command.args],
    bin: command.bin,
  }));
}

/** `require.resolve` desde este archivo: encuentra los binarios de node_modules. */
function defaultResolveBin(specifier) {
  return createRequire(import.meta.url).resolve(specifier);
}

/** De dónde salió la URL que se verificó, para poder decirlo en el informe. */
const URL_SOURCE_LABEL = {
  flag: '--url',
  alias: 'alias de producción del deploy',
  deployment: 'URL del deployment recién creado',
  site: 'dominio público de producción (rix7.cl)',
  default: `dominio por defecto (${DEFAULT_SITE_URL})`,
};

// ═════════════════════════════════════════════════════════════════════════════
// Núcleo puro (probado en release-prod.test.ts)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Interpreta los argumentos. Los `--no-…` se acumulan en un `Set` para que el
 * plan los pueda cruzar con los pasos reales: un `--no-dbpush` mal escrito no
 * se ignora en silencio, cae en `unknown`.
 *
 * @param {string[]} argv
 * @returns {{ dryRun: boolean, help: boolean, withTests: boolean, url: string | null, attempts: string | null, skip: Set<string>, unknown: string[] }}
 */
export function parseReleaseArgs(argv) {
  const args = {
    dryRun: false,
    help: false,
    withTests: false,
    url: null,
    attempts: null,
    skip: new Set(),
    unknown: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--with-tests') args.withTests = true;
    else if (arg === '--url') {
      args.url = argv[i + 1] ?? null;
      i += 1; // el valor se consume: si no, se leería como argumento suelto.
    } else if (arg.startsWith('--url=')) args.url = arg.slice('--url='.length);
    else if (arg === '--attempts') {
      args.attempts = argv[i + 1] ?? null;
      i += 1;
    } else if (arg.startsWith('--attempts=')) args.attempts = arg.slice('--attempts='.length);
    else if (arg.startsWith('--no-')) args.skip.add(arg);
    else args.unknown.push(arg);
  }

  return args;
}

/**
 * Decide qué va a correr, con qué URL y cuántos intentos de verificación.
 *
 * Falla **antes** de tocar nada (error → exit 2) cuando el comando se usó mal:
 * argumento desconocido, `--attempts` que no es un entero ≥ 1, un `--no-…` que
 * no corresponde a ningún paso, o todos los pasos salteados. Es a propósito: un
 * release que «corre igual» con una bandera mal escrita es un release que hace
 * algo distinto de lo que quien lo pidió cree.
 *
 * @param {{ argv?: string[] }} [options]
 * @returns {{ steps: ReleaseStep[], skipped: ReleaseStep[], available: ReleaseStep[], dryRun: boolean, url: string | null, attempts: number, help: boolean, error: string | null }}
 */
export function planRelease({ argv = process.argv.slice(2) } = {}) {
  const args = parseReleaseArgs(argv);
  const base = {
    steps: [],
    skipped: [],
    available: [],
    dryRun: args.dryRun,
    url: args.url && args.url.trim() ? args.url.trim() : null,
    attempts: DEFAULT_ATTEMPTS,
    help: args.help,
    error: null,
  };

  if (args.help) return base;

  if (args.unknown.length) {
    return {
      ...base,
      error: `Argumento${args.unknown.length === 1 ? '' : 's'} no reconocido${args.unknown.length === 1 ? '' : 's'}: ${args.unknown.join(', ')}. Mira \`npm run release:prod -- --help\`.`,
    };
  }

  // Solo los pasos de siempre tienen `--no-…`: el opt-in se agrega con su
  // propio flag, así que `--no-tests` es un error de uso (y se dice).
  const known = RELEASE_STEPS.map((step) => step.flag).filter(Boolean);
  const knownSet = new Set(known);
  const stray = Array.from(args.skip).filter((flag) => !knownSet.has(flag));
  if (stray.length) {
    return {
      ...base,
      error: `${stray.join(', ')} no corresponde a ningún paso. Los válidos: ${known.join(', ')}.`,
    };
  }

  const attempts = args.attempts === null ? DEFAULT_ATTEMPTS : Number(args.attempts);
  if (!Number.isInteger(attempts) || attempts < 1) {
    return {
      ...base,
      error: `--attempts espera un entero ≥ 1 (recibió «${args.attempts}»).`,
    };
  }

  const available = RELEASE_STEPS.filter((step) => step.optIn && !args.withTests);
  const steps = RELEASE_STEPS.filter((step) =>
    step.optIn ? args.withTests : !args.skip.has(step.flag)
  );
  const skipped = RELEASE_STEPS.filter((step) => step.flag && args.skip.has(step.flag));

  if (!steps.length) {
    return { ...base, available, error: 'Todos los pasos quedaron salteados: no hay nada que ejecutar.' };
  }

  return { ...base, steps, skipped, available, attempts };
}

/**
 * Qué le falta al plan para poder correr: scripts que no existen en disco y
 * binarios de `node_modules` que no resuelven (un paquete renombrado o una
 * instalación incompleta). Las dos cosas dejan el release roto de una forma que
 * solo se ve al correrlo, así que se comprueban antes de empezar.
 *
 * @param {ReleaseStep[]} steps
 * @param {{ root?: string, exists?: (filePath: string) => boolean, resolveBin?: (specifier: string) => string | null }} [options]
 * @returns {string[]}
 */
export function missingTargets(
  steps,
  { root = ROOT, exists = existsSync, resolveBin = resolvableBin } = {}
) {
  const missing = [];

  for (const step of steps) {
    if (step.script && !exists(path.join(root, step.script))) missing.push(step.script);
    for (const command of step.commands ?? []) {
      if (!resolveBin(command.bin)) missing.push(command.bin);
    }
  }

  return missing;
}

/** ¿Resuelve este binario? Devuelve la ruta o `null`, sin lanzar. */
function resolvableBin(specifier) {
  try {
    return defaultResolveBin(specifier);
  } catch {
    return null;
  }
}

/**
 * Lee la salida de `vercel --prod` (la imprime `deploy-prod.mjs`) y saca las
 * dos URLs que publica Vercel:
 *
 *   Production   https://rix7-18uue86fb-ctd5.vercel.app
 *   Aliased      https://rix7.cl
 *
 * El formato se parsea tolerante a propósito: los colores ANSI se limpian
 * primero (el CLI los emite según la terminal) y el separador puede venir con
 * o sin dos puntos. Devuelve `null` en cada campo que no aparezca en vez de
 * inventar una URL: si no se pudo leer, el que decide qué hacer es
 * `resolveVerifyUrl`, no esto.
 *
 * @param {string | null | undefined} output
 * @returns {{ deployment: string | null, alias: string | null }}
 */
export function parseDeployUrls(output) {
  const text = String(output ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\r/g, '');

  const pick = (label) => {
    const match = new RegExp(`^\\s*${label}\\s*:?\\s+(https?://\\S+)`, 'im').exec(text);
    return match ? match[1].replace(/[,)]+$/, '') : null;
  };

  return { deployment: pick('Production'), alias: pick('Aliased') };
}

/** Quita la barra final para no armar `//api/health`. */
export function normalizeBaseUrl(url) {
  return String(url ?? '').trim().replace(/\/+$/, '');
}

/**
 * A qué URL verificar, en orden de preferencia.
 *
 * `--url` manda (sirve para verificar un `localhost` o un deployment aparte);
 * después el **alias de producción** que acaba de imprimir el deploy, que es la
 * URL que ve la gente; después la URL del deployment recién creado (inmutable,
 * útil cuando el alias todavía no aparece en la salida); y si no hay ninguna,
 * el dominio por defecto.
 *
 * @param {{ override?: string | null, alias?: string | null, deployment?: string | null, fallback?: string }} [options]
 * @returns {{ url: string, source: 'flag' | 'alias' | 'deployment' | 'default', label: string }}
 */
export function resolveVerifyUrl({
  override = null,
  alias = null,
  deployment = null,
  fallback = DEFAULT_SITE_URL,
} = {}) {
  const pick = (url, source) => ({
    url: normalizeBaseUrl(url),
    source,
    label: URL_SOURCE_LABEL[source],
  });

  if (override && String(override).trim()) return pick(override, 'flag');
  if (alias) return pick(alias, 'alias');
  if (deployment) return pick(deployment, 'deployment');
  return pick(fallback, 'default');
}

/**
 * El informe final: qué se hizo, qué se verificó y qué **no**.
 *
 * Es una función pura y no unas líneas sueltas en `main` porque cada frase de
 * acá afirma algo sobre el estado de producción: «se verificó lo que ya estaba
 * publicado» solo puede decirse si la verificación corrió, y «todo salió bien»
 * solo si había algo que salir bien.
 *
 * @param {{ durationMs: number, deployment?: string | null, verified?: { attempt: number } | null, attempts?: number, skipped?: ReleaseStep[], tree?: string | null, ranDeploy?: boolean, ranVerify?: boolean, buildLabel?: string | null, buildCompared?: boolean, releaseLabel?: string | null, releaseCompared?: boolean, releaseConfirmed?: boolean }} report
 * @returns {string}
 */
export function formatReleaseSummary({
  durationMs,
  deployment = null,
  verified = null,
  attempts = DEFAULT_ATTEMPTS,
  skipped = [],
  tree = null,
  ranDeploy = false,
  ranVerify = false,
  buildLabel = null,
  buildCompared = false,
  releaseLabel = null,
  releaseCompared = false,
  releaseConfirmed = false,
}) {
  const lines = ['', `✓ Release completo en ${formatDuration(durationMs)}.`];

  if (deployment) lines.push(`  · Deployment: ${deployment}`);
  if (!ranDeploy) {
    lines.push(
      ranVerify
        ? '  · Sin deploy en este release (--no-deploy): se verificó lo que ya estaba publicado.'
        : '  · Sin deploy en este release (--no-deploy).'
    );
  }
  if (verified) lines.push(`  · Verificado en el intento ${verified.attempt}/${attempts}.`);
  if (!ranVerify) lines.push('  · Sin verificación en vivo (--no-verify): lo publicado no se comprobó.');
  if (skipped.length) lines.push(`  · Salteados: ${skipped.map((step) => step.flag).join(', ')}`);
  if (tree) lines.push(`  · Árbol de trabajo: ${tree} — el repo no quedó igual a lo publicado.`);

  // El identificador, con lo que se puede afirmar y lo que no: «coincide» solo
  // se dice si se comparó, y si no se pudo calcular se dice eso.
  if (buildLabel && buildCompared) {
    lines.push(`  · Identificador de la build: ${buildLabel} — en vivo coincide con el árbol.`);
  } else if (buildLabel) {
    lines.push(`  · Identificador de la build: ${buildLabel} — publicado, pero no se comparó con lo vivo (--no-verify).`);
  } else if (ranDeploy || ranVerify) {
    lines.push('  · Sin identificador de la build: no se pudo calcular el hash del árbol (¿git disponible?), así que NO se comprobó que producción sea este árbol.');
  }
  // La release, además del árbol: el hash responde «¿este código?», esto
  // responde «¿esta versión?». Solo se afirma la coincidencia si se comparó.
  if (!releaseLabel) {
    if (ranDeploy || ranVerify) {
      lines.push('  · Sin versión ni tag: no se pudo leer el `package.json` o el tag, así que NO se comprobó qué release está publicada.');
    }
  } else if (!ranVerify) {
    lines.push(`  · Versión y tag: ${releaseLabel} — publicada, pero no se comparó con lo vivo (--no-verify).`);
  } else if (releaseConfirmed) {
    lines.push(`  · Versión y tag: ${releaseLabel} — en vivo coincide con el repositorio.`);
  } else {
    lines.push(`  · Versión y tag: ${releaseLabel} — NO coincide con lo publicado.`);
  }

  if (ranVerify) {
    lines.push('  · La persistencia de un alta NO se probó acá (eso escribe y manda correo):');
    lines.push('    `npm run smoke:prod -- --write --email tu@correo.cl`.');
  }

  lines.push('');
  return lines.join('\n');
}

/** Duración legible: 9500 → `9s`, 65000 → `1m 5s`. */
export function formatDuration(ms) {
  const total = Math.max(0, Math.round(Number(ms) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/**
 * El plan, listo para imprimir. En `--dry-run` incluye el porqué de cada paso,
 * que es la parte que el runbook explicaba en prosa.
 *
 * @param {{ steps: ReleaseStep[], skipped: ReleaseStep[], available?: ReleaseStep[], dryRun: boolean, url: string | null, attempts: number }} plan
 * @returns {string}
 */
export function formatPlan(plan) {
  const lines = ['', '== Release a producción · Rix7 ==', ''];

  plan.steps.forEach((step, index) => {
    lines.push(`  ${index + 1}. ${step.title}${describeStepTarget(step)}`);
    if (plan.dryRun) lines.push(`     por qué: ${step.why}`);
  });

  if (plan.skipped.length) {
    lines.push('', `  Salteados: ${plan.skipped.map((step) => step.flag).join(', ')}`);
  }

  // Lo opcional se anuncia aunque no se haya pedido: un paso que solo existe si
  // alguien ya sabe que existe no lo descubre nadie.
  for (const step of plan.available ?? []) {
    lines.push('', `  Disponible con ${step.optIn}: ${step.title}`);
    if (plan.dryRun) lines.push(`     por qué: ${step.why}`);
  }

  const verify = plan.steps.some((step) => step.id === 'verify');
  if (verify) {
    lines.push('', `  Verificación: hasta ${plan.attempts} intento${plan.attempts === 1 ? '' : 's'} por URL, ${RETRY_DELAY_MS / 1000} s entre intentos.`);
    if (plan.url) lines.push(`  URL pedida con --url: ${normalizeBaseUrl(plan.url)}`);
    if (plan.steps.some((step) => step.id === 'deploy')) {
      lines.push('  Además compara el identificador de la build: si en vivo no quedó este árbol, el release falla.');
    }
    lines.push('  También compara la versión y el tag del repositorio: si lo publicado no es esa release, el release falla.');
  }

  lines.push('');
  return lines.join('\n');
}

// ═════════════════════════════════════════════════════════════════════════════
// La corrida (procesos e informe)
// ═════════════════════════════════════════════════════════════════════════════

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

/**
 * Corre un proceso y devuelve su salida **y** la muestra en vivo: el deploy
 * tarda minutos y bufferearlo dejaría la terminal muda justo cuando más se mira.
 *
 * Se lanza `node <script>` directo, no `npm run …`: en Windows `npm` es un shim
 * `.cmd` que Node no ejecuta sin pasar por `cmd.exe` (el problema que documenta
 * `deploy-prod.mjs`), y el script es el mismo que corre el `npm run`.
 *
 * `stdout`/`stderr` se piden cuando `stdio` es `pipe`: sin eso, en Windows el
 * pipe queda en modo binario y los acentos de los informes llegan rotos. Un
 * fallo al **lanzar** (no al correr) deja `code` en 1 y `error` con el motivo.
 *
 * @param {{ executable: string, args: string[], cwd?: string, stdout?: NodeJS.WriteStream | { write: (chunk: string) => unknown }, stderr?: NodeJS.WriteStream | { write: (chunk: string) => unknown } }} options
 * @returns {Promise<{ code: number, output: string, error: Error | null }>}
 */
export function runCaptured({ executable, args, cwd = ROOT, stdout = process.stdout, stderr = process.stderr }) {
  return new Promise((resolvePromise) => {
    const child = spawn(executable, args, {
      cwd,
      env: process.env,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    let output = '';
    const tee = (stream, target) => {
      // `stdout`/`stderr` son `Readable`; `setEncoding` evita cortar un carácter
      // multibyte al partirse entre dos chunks (los informes van en UTF-8).
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        output += chunk;
        target.write(chunk);
      });
    };
    tee(child.stdout, stdout);
    tee(child.stderr, stderr);

    child.on('error', (error) => resolvePromise({ code: 1, output, error }));
    child.on('exit', (code, signal) =>
      resolvePromise({ code: code ?? (signal ? 1 : 0), output, error: null })
    );
  });
}

/** Cómo nombrar el destino de un paso en el plan. */
function describeStepTarget(step) {
  if (step.script) return `  (${step.script})`;
  const bins = (step.commands ?? []).map((command) => command.bin).join(' + ');
  return bins ? `  (${bins})` : '';
}

/**
 * Corre un paso: sus comandos, en orden, con la salida en vivo. Se detiene en el
 * primero que falle, igual que el release entero.
 *
 * @param {ReleaseStep} step
 * @param {{ resolveBin?: (specifier: string) => string, stdout?: NodeJS.WriteStream | { write: (chunk: string) => unknown }, stderr?: NodeJS.WriteStream | { write: (chunk: string) => unknown } }} [options]
 * @returns {Promise<{ code: number, output: string, error: Error | null }>}
 */
export async function runStep(
  step,
  { resolveBin = defaultResolveBin, stdout = process.stdout, stderr = process.stderr } = {}
) {
  const commands = step.script
    ? [{ executable: process.execPath, args: [path.join(ROOT, step.script)], bin: step.script }]
    : resolveCommands(step.commands ?? [], resolveBin);

  if (!commands.length) {
    // Inalcanzable desde el plan (solo `verify` no tiene destino y se maneja
    // aparte), pero sin esto el paso saldría 0 sin haber corrido nada.
    return { code: 1, output: '', error: new Error(`El paso «${step.id}» no tiene nada que ejecutar.`) };
  }

  const result = { code: 0, output: '', error: null };
  for (const command of commands) {
    const partial = await runCaptured({
      executable: command.executable,
      args: command.args,
      stdout,
      stderr,
    });
    result.output += partial.output;
    result.code = partial.code;
    result.error = partial.error;
    // El paso se corta en el primer comando que falla: correr `vitest` después
    // de un `tsc` roto solo agrega ruido a un informe que ya tiene su veredicto.
    if (partial.error || partial.code !== 0) return result;
  }

  return result;
}

/**
 * Verifica la URL publicada: `smoke` (portada, panel y alta) más `health`
 * (subsistemas críticos). Reintenta ante un rojo, porque un alias recién
 * promovido puede tardar unos segundos en propagarse.
 *
 * Los informes son los mismos que imprimen `npm run smoke:prod` y
 * `npm run check:health`: acá no se reinterpreta nada, se suman las respuestas
 * que ya existen.
 *
 * Con `expected` (el hash del árbol local) se **exige** que lo que está en vivo
 * sea ese árbol: un release que publica algo distinto de lo que verifica no
 * publicó nada, y antes eso salía verde. `published` es lo que este release
 * acaba de publicar, y sirve para que el informe distinga «el borde todavía
 * sirve el anterior» de «el árbol cambió en el medio». Sin `expected` (no se
 * pudo calcular) no se exige nada — pero el informe final lo dice.
 *
 * @param {{ url: string, attempts: number, expected?: ReturnType<typeof readTreeBuildId> | null, releaseExpected?: ReturnType<typeof readReleaseIdentity> | null, published?: ReturnType<typeof readTreeBuildId> | null, smokeImpl?: typeof runSmoke, healthImpl?: typeof runCheck, sleepImpl?: (ms: number) => Promise<unknown>, log?: (...args: unknown[]) => void, delayMs?: number }} options
 * @returns {Promise<{ ok: boolean, attempt: number }>}
 */
export async function verifyLive({
  url,
  attempts,
  expected = null,
  releaseExpected = null,
  published = null,
  smokeImpl = runSmoke,
  healthImpl = runCheck,
  sleepImpl = sleep,
  log = console.log,
  delayMs = RETRY_DELAY_MS,
}) {
  // Solo se exige la comparación cuando hay un árbol que comparar: sin
  // identificador local (sin git) no hay nada que afirmar, y afirmar de más es
  // cómo un release verde deja pasar una build que no es la del repositorio.
  const requiresTree = Boolean(expected?.value);
  // La versión/tag se exige cuando el repositorio declara alguna: publicar una
  // release que no coincide con su `package.json` o su tag no es un release
  // válido, aunque el árbol sí coincida.
  const requiresRelease = Boolean(releaseExpected?.version || releaseExpected?.tag);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    log(`\n→ Verificando ${url} (intento ${attempt}/${attempts})…`);

    const smoke = await smokeImpl({ baseUrl: url });
    log(formatSmokeReport(smoke));

    const health = await healthImpl({ baseUrl: url, expected, releaseExpected, published });
    log(formatHealthReport(health));

    const treeMatches = !requiresTree || health.judgement?.build?.status === 'match';
    const releaseMatches =
      !requiresRelease || health.judgement?.release?.ok !== false;
    if (smoke.ok && health.ok && treeMatches && releaseMatches) return { ok: true, attempt };

    if (attempt < attempts) {
      log(
        `  ↻ Un deploy recién promovido puede tardar unos segundos en propagarse por el borde;` +
          ` vuelvo a probar en ${Math.round(delayMs / 1000)} s…`
      );
      await sleepImpl(delayMs);
    }
  }

  return { ok: false, attempt: attempts };
}

/**
 * Lo que el release puede decir del árbol sin tocar git: cuántos cambios hay
 * sin commitear y cuántos commits sin empujar. **No es fatal**: el deploy
 * publica el árbol de trabajo, no el commit, así que un árbol sucio igual se
 * publica — pero conviene que quien despliega sepa que lo que está en el repo
 * no es lo que quedó en producción.
 *
 * @returns {string | null}
 */
function describeWorkingTree() {
  const git = (args) => {
    try {
      const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', timeout: 15000 });
      return result.status === 0 ? String(result.stdout).trim() : null;
    } catch {
      return null;
    }
  };

  const status = git(['status', '--porcelain']);
  const ahead = git(['rev-list', '--count', '@{u}..HEAD']);
  const uncommitted = status === null ? null : status.split('\n').filter(Boolean).length;

  const parts = [];
  if (uncommitted) parts.push(`${uncommitted} archivo${uncommitted === 1 ? '' : 's'} sin commitear`);
  if (ahead && Number(ahead) > 0) parts.push(`${ahead} commit${Number(ahead) === 1 ? '' : 's'} sin empujar`);

  return parts.length ? parts.join(' · ') : null;
}

function usage() {
  console.log(
    [
      '',
      'Publica a producción de punta a punta: construye, aplica las migraciones',
      'pendientes, comprueba el esquema, despliega y verifica la URL viva. Aborta',
      'en el primer fallo.',
      '',
      '  npm run release:prod                  # build → migraciones → esquema → deploy → verificación',
      '  npm run release:prod -- --with-tests  # además tsc --noEmit y la suite completa, antes del build',
      '  npm run release:prod -- --dry-run     # muestra el plan y no ejecuta nada',
      '  npm run release:prod -- --no-db       # esquema ya al día, sin token a mano',
      '  npm run release:prod -- --attempts 1  # sin reintentos de verificación',
      '  npm run release:prod -- --url https://ejemplo.cl --no-build --no-db --no-deploy',
      '',
      'Opciones:',
      '  --url <url>      a qué URL verificar. Sin esta bandera, producción se',
      '                   verifica siempre en https://rix7.cl',
      '  --attempts <n>   intentos de verificación, entero ≥ 1 (por defecto 3)',
      '  --with-tests     agrega el primer paso: `tsc --noEmit` y `vitest run`',
      '                   (opt-in: el build typechequea, pero no corre la suite)',
      '  --no-build       saltea el build local',
      '  --no-db          saltea las migraciones',
      '  --no-schema      saltea la comprobación del esquema contra la base real',
      '  --no-deploy      saltea el deploy (verifica lo que ya está publicado)',
      '  --no-verify      saltea la verificación',
      '  --dry-run        imprime el plan y sale 0 sin ejecutar nada',
      '  --help           esto',
      '',
      'Salida: 0 = todo lo que corrió salió bien · 1 = un paso falló y el release',
      'se detuvo ahí · 2 = el comando se usó mal y no se ejecutó nada.',
      '',
      'Cada release publica el identificador de la build (el hash del árbol de',
      'trabajo) y la verificación comprueba que lo que quedó en vivo sea ese',
      'mismo árbol: si no coincide, falla en vez de dar por publicado algo que no',
      'es. Sin poder calcular el identificador (sin git) publica igual y lo dice:',
      'no afirma haber comprobado lo que no comparó.',
      '',
      'No da de alta la visita de prueba (eso es `npm run smoke:prod -- --write`,',
      'que manda un correo real) ni hace `git push`: el deploy publica el árbol',
      'de trabajo, no el commit.',
      '',
      'Con `--with-tests` el paso 1 (tipos y suite) también es un gate: si el CI no',
      'corrió todavía, el release no publica código con un test rojo.',
      '',
    ].join('\n')
  );
}

/**
 * Detiene el release e imprime qué pasó, qué NO pasó y qué hacer.
 *
 * La distinción entre «no se publicó nada nuevo» y «ya se publicó, pero la
 * verificación falló» es lo que hace utilizable el informe: en el primer caso
 * se arregla y se vuelve a correr; en el segundo hay algo publicado que quizá
 * haya que revertir (§7 del runbook).
 *
 * @param {ReleaseStep} step
 * @param {{ detail: string, deployed: boolean }} context
 */
function fail(step, { detail, deployed }) {
  console.error('');
  console.error(`✗ Paso «${step.title}» falló (${detail}).`);
  console.error(
    deployed
      ? '  El deploy YA se publicó: lo que quedó a medio camino es el release, no producción.'
      : '  El release se detuvo acá: los pasos siguientes no corrieron y no se publicó nada nuevo.'
  );
  console.error(`  → ${step.hint}`);
  process.exitCode = 1;
}

async function main() {
  const plan = planRelease();

  if (plan.help) return usage();

  if (plan.error) {
    console.error(`✖ ${plan.error}`);
    console.error('  Nada se ejecutó ni se desplegó.');
    process.exitCode = 2;
    return;
  }

  const missing = missingTargets(plan.steps);
  if (missing.length) {
    console.error(`✖ No existe${missing.length === 1 ? '' : 'n'} o no resuelve${missing.length === 1 ? '' : 'n'}: ${missing.join(', ')}.`);
    console.error('  ¿Se renombró un script o falta `npm install`? Nada se ejecutó ni se desplegó.');
    process.exitCode = 2;
    return;
  }

  console.log(formatPlan(plan));

  if (plan.dryRun) {
    console.log('  --dry-run: no se ejecutó nada.');
    console.log('');
    return;
  }

  // Paso previo: la guardia de secretos. Un token suelto en el árbol no tiene
  // por qué llegar ni al staging del deploy, así que se corta antes de aplicar
  // migraciones o publicar nada.
  if (!assertNoSecrets({ action: 'hago el release a producción' })) {
    console.error('  Nada se ejecutó ni se desplegó.');
    process.exitCode = 1;
    return;
  }

  const tree = describeWorkingTree();
  if (tree) {
    console.log(`  · Árbol de trabajo: ${tree} — el deploy publica el árbol, no el commit.`);
  }

  // El identificador del árbol se calcula **una sola vez antes de publicar**: es
  // lo que va a viajar en el deployment (el paso de deploy lo hereda por
  // entorno) y contra lo que después se compara la verificación.
  const willDeploy = plan.steps.some((step) => step.id === 'deploy');
  const publishedTree = willDeploy ? readTreeBuildId() : null;

  // La identidad de release se calcula antes del deploy y viaja por entorno al
  // paso de deploy; la verificación vuelve a leerla después, por si el árbol
  // cambió en el medio.
  const publishedRelease = readReleaseIdentity();
  if (publishedRelease.version || publishedRelease.tag) {
    console.log(`  · Versión y tag: ${describeReleaseIdentity(publishedRelease)}`);
    if (!publishedRelease.tag) {
      console.warn(
        `  ⚠ El commit no tiene tag${publishedRelease.nearestTag ? ` (el más cercano es ${publishedRelease.nearestTag}${publishedRelease.distance === null ? '' : `, a ${publishedRelease.distance} commit${publishedRelease.distance === 1 ? '' : 's'}`})` : ''}: la release queda sin tag identificable.`
      );
    }
    if (willDeploy) {
      process.env[RELEASE_VERSION_ENV] = publishedRelease.version ?? '';
      process.env[RELEASE_TAG_ENV] = publishedRelease.tag ?? '';
    }
  } else {
    console.warn(
      `  ⚠ No se pudo leer la versión/tag del repositorio (${publishedRelease.error ?? 'sin datos'}): no se podrá comprobar qué release quedó publicada.`
    );
  }

  if (publishedTree?.value) {
    process.env[BUILD_ID_ENV] = publishedTree.value;
    console.log(`  · Identificador de la build: ${describeBuild(publishedTree)}`);
  } else if (publishedTree) {
    console.warn(`  ⚠ No se pudo calcular el identificador de la build: ${publishedTree.error}`);
    console.warn('    El despliegue va a responder `build: null`: no se podrá comprobar que producción sea este árbol.');
  }
  if (publishedTree?.skipped?.length) {
    console.warn(`  ⚠ El identificador se calculó sin ${publishedTree.skipped.length} archivo(s) que no se pudieron leer.`);
  }

  const startedAt = Date.now();
  let deployed = false;
  let urls = { deployment: null, alias: null };
  let verified = null;
  let verifiedTree = null;
  let verifiedRelease = null;
  let releaseConfirmed = false;

  for (const [index, step] of plan.steps.entries()) {
    const position = `[${index + 1}/${plan.steps.length}]`;

    if (step.id === 'verify') {
      // El árbol se vuelve a leer acá, después del deploy: si algo lo cambió
      // mientras corría el release, lo publicado ya no es «este árbol» y hay que
      // decirlo en vez de comparar contra el estado de hace un minuto.
      verifiedTree = readTreeBuildId();
      verifiedRelease = readReleaseIdentity();

      // Producción se verifica en el **dominio público**, no en la URL del
      // deployment. `rix7.cl` es la única URL que ve la gente: si el alias quedó
      // apuntando a otro deployment, la comparación del identificador lo
      // detecta y el release falla, en vez de aprobar una build que nadie está
      // viendo. La URL del deployment se imprime como referencia, no aprueba.
      const target = plan.url
        ? resolveVerifyUrl({ override: plan.url })
        : { url: normalizeBaseUrl(DEFAULT_SITE_URL), source: 'site', label: URL_SOURCE_LABEL.site };
      console.log(`\n${position} ${step.title} · ${target.url}`);
      console.log(`  · URL: ${target.label}`);
      if (urls.deployment && urls.deployment !== target.url) {
        console.log(`  · Deployment publicado: ${urls.deployment}`);
      }

      verified = await verifyLive({
        url: target.url,
        attempts: plan.attempts,
        expected: verifiedTree?.value ? verifiedTree : null,
        releaseExpected: verifiedRelease,
        published: publishedTree?.value ? publishedTree : null,
      });
      if (!verified.ok) {
        fail(step, {
          detail: `las ${plan.attempts} verificación${plan.attempts === 1 ? '' : 'es'} de ${target.url} fallaron`,
          deployed,
        });
        return;
      }
      // La verificación ya exigió versión y tag si el repo los declara.
      releaseConfirmed = true;
      continue;
    }

    console.log(`\n${position} ${step.title}${describeStepTarget(step)}`);
    let result = await runStep(step);

    // Un rechazo transitorio de Vercel no dice nada del código: se reintenta una
    // vez antes de dar el release por fallido (ver `DEPLOY_ATTEMPTS`).
    if (
      step.id === 'deploy' &&
      result.code !== 0 &&
      !result.error &&
      DEPLOY_ATTEMPTS > 1 &&
      isTransientDeployFailure(result.output)
    ) {
      console.log(
        `  ↻ El deploy falló por un rechazo transitorio de Vercel;` +
          ` reintento (2/${DEPLOY_ATTEMPTS}) en ${Math.round(RETRY_DELAY_MS / 1000)} s…`
      );
      await sleep(RETRY_DELAY_MS);
      result = await runStep(step);
    }

    if (result.error) {
      fail(step, { detail: `no se pudo lanzar el script: ${result.error.message}`, deployed });
      return;
    }
    if (result.code !== 0) {
      fail(step, { detail: `exit ${result.code}`, deployed });
      return;
    }

    if (step.id === 'deploy') {
      deployed = true;
      urls = parseDeployUrls(result.output);
    }
  }

  console.log(
    formatReleaseSummary({
      durationMs: Date.now() - startedAt,
      deployment: urls.deployment,
      verified,
      attempts: plan.attempts,
      skipped: plan.skipped,
      tree,
      ranDeploy: willDeploy,
      ranVerify: plan.steps.some((step) => step.id === 'verify'),
      buildLabel: publishedTree?.value ? describeBuild(publishedTree) : null,
      buildCompared: Boolean(verifiedTree?.value),
      releaseLabel:
        verifiedRelease?.version || verifiedRelease?.tag
          ? describeReleaseIdentity(verifiedRelease)
          : null,
      releaseCompared: Boolean(verifiedRelease?.version || verifiedRelease?.tag),
      releaseConfirmed: releaseConfirmed,
    })
  );
}

// Solo corre al ejecutarse: así los tests pueden importar el núcleo.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main().catch((error) => {
    console.error(`✖ El release falló de forma inesperada: ${error instanceof Error ? error.message : error}`);
    console.error('  Nada más se ejecutó.');
    process.exit(2);
  });
}
