#!/usr/bin/env node
/**
 * Instala los hooks de git del proyecto (hoy, solo `pre-commit`).
 *
 * `.git/hooks` no se versiona, así que el hook vive acá y se escribe cuando
 * alguien corre `npm run hooks:install`. Es a propósito que no cuelgue de
 * `postinstall`: en el CI no hace falta —la guardia de secretos ya corre como
 * job propio— y en local, en cambio, bloquea el commit antes de que un secreto
 * salga del checkout. Correrlo de nuevo reescribe el hook sin tocar nada más.
 *
 * El hook es un envoltorio fino sobre `scripts/check-secrets.mjs`: la lógica
 * (patrones, qué archivos se revisan) queda en un solo lugar, y el CI y el
 * commit revisan exactamente lo mismo.
 *
 * Uso:
 *   npm run hooks:install
 *   node scripts/install-git-hooks.mjs --uninstall
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Marca que distingue un hook nuestro de uno ajeno al reinstalar. */
export const MARKER = 'Rix7 pre-commit hook';

export const PRE_COMMIT = `#!/bin/sh
# ${MARKER} — instalado por scripts/install-git-hooks.mjs (npm run hooks:install).
# No lo edites a mano: cambiá la guardia en scripts/check-secrets.mjs y volvé a
# correr el instalador.
#
# Corre la guardia de secretos sobre el árbol de git (rastreados + no ignorados)
# y corta el commit si encuentra algo. Así un \`.env.local\` ignorado no molesta,
# pero un secreto forzado con \`git add -f\` sí.
#
# Para saltarlo a sabiendas: \`git commit --no-verify\`.

cd "$(git rev-parse --show-toplevel)" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "pre-commit: no encuentro node; salto la guardia de secretos." >&2
  exit 0
fi

if ! node scripts/check-secrets.mjs; then
  echo "" >&2
  echo "pre-commit: commit bloqueado por la guardia de secretos (arriba)." >&2
  echo "            Rotá el secreto y pasalo por variable de entorno; no lo subas." >&2
  exit 1
fi
`;

/** El directorio de hooks que usaría git (respeta `core.hooksPath`). */
export function gitHooksDir() {
  const out = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], { encoding: 'utf8' });
  return path.resolve(out.trim());
}

export const HOOK_NAME = 'pre-commit';

/**
 * Escribe el hook. Si ya había uno que no es nuestro, lo respalda a
 * `pre-commit.bak` en vez de pisarlo a ciegas.
 *
 * @param {string} dir
 * @returns {{ target: string, backedUp: string | null }}
 */
export function installHook(dir) {
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, HOOK_NAME);
  let backedUp = null;

  if (existsSync(target)) {
    const current = readFileSync(target, 'utf8');
    if (!current.includes(MARKER)) {
      const backup = path.join(dir, `${HOOK_NAME}.bak`);
      if (existsSync(backup)) {
        throw new Error(
          `${target} existe y no lo instaló Rix7, y ya hay un respaldo en ${backup}. Revisalo a mano.`
        );
      }
      writeFileSync(backup, current);
      backedUp = backup;
    }
  }

  writeFileSync(target, PRE_COMMIT, { mode: 0o755 });
  chmodSync(target, 0o755); // en Windows es casi simbólico, pero git lo agradece
  return { target, backedUp };
}

function main() {
  const dir = gitHooksDir();
  const uninstall = process.argv.includes('--uninstall');
  const target = path.join(dir, HOOK_NAME);

  if (uninstall) {
    if (existsSync(target) && readFileSync(target, 'utf8').includes(MARKER)) {
      rmSync(target);
      console.log(`✓ Hook ${HOOK_NAME} quitado de ${target}`);
    } else {
      console.log('· No hay un hook de Rix7 que quitar.');
    }
    return;
  }

  const { backedUp } = installHook(dir);
  if (backedUp) console.log(`· Respaldé el hook anterior en ${backedUp}`);
  console.log(`✓ Hook ${HOOK_NAME} instalado en ${target}`);
  console.log('  Corre la guardia de secretos y corta el commit; `--no-verify` lo salta.');
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  try {
    main();
  } catch (error) {
    console.error('✗ No se pudo instalar el hook:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
