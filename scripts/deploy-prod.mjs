#!/usr/bin/env node
/**
 * Publica el proyecto a producción en Vercel.
 *
 * ¿Por qué no basta con `git push`?
 * El proyecto vive en un equipo Hobby y, en ese plan, **solo el dueño de la
 * cuenta puede crear deployments**. Los commits de este repositorio van
 * firmados por un autor que no es miembro del equipo, así que Vercel acepta el
 * push, compila y después descarta el deployment con:
 *
 *   "The deployment was blocked because the commit author doesn't have
 *    permission to create deployments for this project."
 *
 * Este script publica **sin metadata de git**: copia el árbol de trabajo a un
 * directorio temporal (sin `.git`, `node_modules` ni `.next`), bloquea el
 * descubrimiento del repositorio con `GIT_CEILING_DIRECTORIES` y despliega
 * desde ahí. El deployment queda atribuido a la cuenta dueña —que sí tiene
 * permiso— y Vercel lo promueve a producción automáticamente.
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
 * Uso: npm run deploy:prod
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
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
const staging = path.join(root, '.deploy-staging');

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
function main() {
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

  console.log('→ Preparando copia sin metadata de git…');
  fs.rmSync(staging, { recursive: true, force: true });
  // El staging se crea acá y no dentro de `copyTree`: esa función solo hace
  // `mkdirSync` cuando copia un directorio, así que si el primer elemento del
  // árbol es un archivo (`.env.example` va primero en orden alfabético) el
  // `copyFileSync` apunta a una carpeta que todavía no existe y falla con ENOENT.
  fs.mkdirSync(staging, { recursive: true });
  copyTree(root, staging);
  fs.mkdirSync(path.join(staging, '.vercel'), { recursive: true });
  fs.copyFileSync(projectFile, path.join(staging, '.vercel', 'project.json'));

  // `GIT_CEILING_DIRECTORIES` impide que git ascienda hasta el repositorio real:
  // sin esa metadata, el deployment lo crea la cuenta dueña y no queda bloqueado.
  // En Windows `npx` es un shim `.cmd`, y desde el parche de CVE-2024-27980 Node no
  // lanza `.cmd`/`.bat` directamente: `spawnSync` falla con EINVAL y deja `status`
  // en `null`. Se pasa por `cmd.exe /c` en vez de `shell: true`, que es la forma
  // explícita de invocar el shim sin que los argumentos pasen por un intérprete.
  const isWindows = process.platform === 'win32';
  const vercel = vercelArgs({ buildValue, version, tag });
  const [command, args] = isWindows ? ['cmd.exe', ['/c', 'npx', ...vercel]] : ['npx', vercel];

  const result = spawnSync(command, args, {
    cwd: staging,
    stdio: 'inherit',
    env: { ...process.env, GIT_CEILING_DIRECTORIES: root },
  });

  // La limpieza no puede tumbar el script: en Windows el CLI puede seguir
  // reteniendo archivos un instante (EPERM) y un fallo acá taparía el error real
  // del deploy, que es lo único que importa cuando algo sale mal.
  try {
    fs.rmSync(staging, { recursive: true, force: true });
  } catch (err) {
    console.warn('⚠ No se pudo borrar el staging (queda para revisar):', err.code);
  }

  // Un fallo al **lanzar** (no un fallo del deploy) deja `status` en `null`. Sin
  // esto el script salía con 1 y sin imprimir nada, que es lo que lo hacía
  // imposible de diagnosticar.
  if (result.error) {
    console.error('✖ No se pudo lanzar el CLI de Vercel:', result.error.message);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

// Solo corre al ejecutarse: así los tests pueden importar `vercelArgs`.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main();
}
