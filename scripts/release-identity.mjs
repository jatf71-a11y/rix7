#!/usr/bin/env node
/**
 * Versión y tag de la release: la mitad que necesita git.
 *
 * `build-id.mjs` identifica **el árbol** publicado con un hash. Eso responde «¿lo
 * que está en vivo es este código?», pero no «¿qué versión es?». El 2026-10-20
 * esa diferencia se cobró una confusión real: producción servía un commit 38
 * commits después del último tag `v10.0.0`, el `package.json` seguía diciendo
 * 10.0.0 y el release verde no lo mencionaba en ningún lado.
 *
 * Este módulo lee del repositorio los dos datos que faltaban:
 *
 *   - la **versión** de `package.json` (`RIX7_VERSION` en el deployment);
 *   - el **tag exacto** del commit (`RIX7_TAG`), vacío si el commit no está
 *     taggeado;
 *   - y, para poder explicar el caso «sin tag», el tag más cercano, su commit y
 *     a cuántos commits de HEAD quedó.
 *
 * `compareReleaseIdentity` decide después si lo publicado coincide con eso. Los
 * veredictos separan dos cosas que se arreglan distinto:
 *
 *   - **contradicción** (`ok: false`): la versión o el tag en vivo no son los del
 *     repositorio. El release falla, porque publicó una build que no es la que
 *     dice ser.
 *   - **sin etiqueta** (`ok: true`, aviso): el árbol no está taggeado. No invalida
 *     la build —el hash ya dice que es este árbol— pero deja la release sin
 *     número identificable. El informe lo muestra como advertencia.
 *
 * El formato de la versión y del tag es el mismo que valida
 * `lib/utils/releaseIdentity.ts` (la mitad que lee `/api/health`). Si cambia acá,
 * cambia allá; los tests de los dos lados usan los mismos casos.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { ROOT, defaultRun } from './build-id.mjs';

/** La variable con la versión de `package.json` publicada por el deployment. */
export const RELEASE_VERSION_ENV = 'RIX7_VERSION';

/** La variable con el tag exacto del commit publicado. */
export const RELEASE_TAG_ENV = 'RIX7_TAG';

/** Versión semver simple, la que usa `package.json`. */
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/** Tag de release: `v` opcional y semver. */
const TAG_PATTERN = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/** Un tag con la forma publicable, o `null` si no la tiene. */
export function sanitizeTag(value) {
  if (typeof value !== 'string') return null;
  const tag = value.trim();
  return TAG_PATTERN.test(tag) ? tag : null;
}

/** Una versión con la forma publicable, o `null` si no la tiene. */
export function sanitizeVersion(value) {
  if (typeof value !== 'string') return null;
  const version = value.trim();
  return VERSION_PATTERN.test(version) ? version : null;
}

/**
 * Lee la identidad de release del repositorio.
 *
 * Nunca lanza: cuando falta `package.json` o git no puede contestar, devuelve lo
 * que sí pudo leer y `error` con el motivo. El release sigue publicando, pero el
 * informe dice que no pudo afirmar nada sobre la versión.
 *
 * @param {{ root?: string, run?: typeof defaultRun, read?: (filePath: string) => string }} [options]
 * @returns {{ version: string | null, tag: string | null, nearestTag: string | null, nearestCommit: string | null, distance: number | null, error: string | null }}
 */
export function readReleaseIdentity({
  root = ROOT,
  run = defaultRun,
  read = (filePath) => readFileSync(filePath, 'utf8'),
} = {}) {
  let version = null;
  let error = null;

  try {
    const manifest = JSON.parse(read(path.join(root, 'package.json')));
    version = sanitizeVersion(manifest?.version);
    if (!version) error = '`package.json` no declara una versión semver';
  } catch {
    error = 'no se pudo leer `package.json`';
  }

  // El tag exacto es el que corresponde a la build: `git describe --exact-match`
  // falla cuando HEAD no está taggeado, y ese «no» es un dato, no un error.
  const exact = run('git', ['describe', '--tags', '--exact-match', 'HEAD'], { root });
  const tag = exact && exact.code === 0 ? sanitizeTag(exact.stdout) : null;

  // El más cercano sirve para explicar cuánto se alejó HEAD del último tag.
  const nearest = run('git', ['describe', '--tags', '--abbrev=0'], { root });
  const nearestTag = nearest && nearest.code === 0 ? sanitizeTag(nearest.stdout) : null;

  let nearestCommit = null;
  let distance = null;
  if (nearestTag) {
    const commit = run('git', ['rev-list', '-n', '1', `refs/tags/${nearestTag}`], { root });
    if (commit && commit.code === 0) nearestCommit = commit.stdout.trim() || null;

    const count = run('git', ['rev-list', '--count', `${nearestTag}..HEAD`], { root });
    if (count && count.code === 0) {
      const value = Number.parseInt(count.stdout.trim(), 10);
      distance = Number.isFinite(value) ? value : null;
    }
  }

  return { version, tag, nearestTag, nearestCommit, distance, error };
}

/** El nivel de una comparación, para el mismo formato de marcas que la build. */
export const RELEASE_LEVEL = {
  match: 'ok',
  noLive: 'info',
  noLocal: 'info',
  untagged: 'warn',
  tagDiffers: 'warn',
  versionDiffers: 'warn',
  versionTagMismatch: 'warn',
};

/**
 * Compara lo publicado con lo que declara el repositorio.
 *
 * `publishedCommit` es el commit del deployment recién publicado (si se conoce);
 * con él el veredicto «sin tag» puede decir si el commit publicado es o no el
 * del tag más cercano, que es la diferencia entre «el tag está un poco atrás» y
 * «el tag no describe lo que acabo de publicar».
 *
 * @param {{ live?: { version: string | null, tag: string | null } | null, expected?: ReturnType<typeof readReleaseIdentity> | null, publishedCommit?: string | null }} [options]
 * @returns {{ status: 'match' | 'no-live' | 'no-local' | 'untagged' | 'tag-differs' | 'version-differs' | 'version-tag-mismatch', level: 'ok' | 'info' | 'warn', ok: boolean, detail: string, hint: string | null, live: object | null, expected: object | null }}
 */
export function compareReleaseIdentity({ live = null, expected = null, publishedCommit = null } = {}) {
  const base = { live, expected, detail: '', hint: null };

  if (!expected || (!expected.version && !expected.tag)) {
    return {
      ...base,
      status: 'no-local',
      level: RELEASE_LEVEL.noLocal,
      ok: true,
      detail: 'no se pudo leer la versión ni el tag del repositorio, así que no hay con qué comparar la release',
      hint: 'Corré esto dentro del repositorio, con `package.json` y git disponibles.',
    };
  }

  if (!live || (!live.version && !live.tag)) {
    return {
      ...base,
      status: 'no-live',
      level: RELEASE_LEVEL.noLive,
      ok: true,
      detail: `el despliegue no publica versión ni tag (${RELEASE_VERSION_ENV} / ${RELEASE_TAG_ENV})`,
      hint: 'Un deployment publicado con `npm run release:prod` (o `npm run deploy:prod`) sí los publica. Comparación sin hacer: no se puede afirmar qué versión está en vivo.',
    };
  }

  if (live.version !== expected.version) {
    return {
      ...base,
      status: 'version-differs',
      level: RELEASE_LEVEL.versionDiffers,
      ok: false,
      detail: `en vivo dice versión ${live.version ?? 'sin versión'} y el repositorio ${expected.version ?? 'sin versión'}`,
      hint: 'El deployment no salió de este `package.json` (o el borde sirve uno anterior). Publicá el árbol actual con `npm run release:prod`.',
    };
  }

  if (expected.tag && live.tag !== expected.tag) {
    return {
      ...base,
      status: 'tag-differs',
      level: RELEASE_LEVEL.tagDiffers,
      ok: false,
      detail: `en vivo está taggeado como ${live.tag ?? 'sin tag'} y el repositorio como ${expected.tag}`,
      hint: 'El deployment no es el del tag que el repositorio declara. Revisá qué se publicó y volvé a correr `npm run release:prod` desde el commit correcto.',
    };
  }

  if (expected.tag && expected.version && expected.tag !== `v${expected.version}`) {
    return {
      ...base,
      status: 'version-tag-mismatch',
      level: RELEASE_LEVEL.versionTagMismatch,
      ok: false,
      detail: `el tag ${expected.tag} no corresponde a la versión ${expected.version} de package.json`,
      hint: `Alineá los dos: el tag de release se escribe \`v${expected.version}\`.`,
    };
  }

  if (!expected.tag) {
    const parts = ['HEAD no tiene tag'];
    if (expected.nearestTag) {
      const distance =
        expected.distance === null
          ? ''
          : ` a ${expected.distance} commit${expected.distance === 1 ? '' : 's'}`;
      parts.push(`el más cercano es ${expected.nearestTag}${distance}`);
    } else {
      parts.push('no hay ningún tag de release');
    }

    if (publishedCommit && expected.nearestCommit) {
      parts.push(
        publishedCommit === expected.nearestCommit
          ? 'el commit publicado es el del tag'
          : 'el commit publicado no es el del tag'
      );
    }
    if (live.tag) parts.push(`en vivo está taggeado como ${live.tag}`);

    // Si el tag de la versión actual ya existe en un commit anterior, no se
    // puede volver a crear con el mismo nombre: hay que subir la versión.
    const tagAlreadyUsed = expected.version && expected.nearestTag === `v${expected.version}`;

    return {
      ...base,
      status: 'untagged',
      level: RELEASE_LEVEL.untagged,
      ok: true,
      detail: parts.join(' · '),
      hint: !expected.version
        ? 'Tagueá el commit que publicás para que la build tenga un número identificable.'
        : tagAlreadyUsed
          ? `El tag v${expected.version} ya existe en un commit anterior: subí el \`version\` de package.json y tagueá este commit con el número nuevo. La build se publica igual, pero queda sin número identificable.`
          : `Tagueá el commit que publicás: \`git tag v${expected.version}\`. La build se publica igual, pero queda sin número identificable.`,
    };
  }

  return {
    ...base,
    status: 'match',
    level: RELEASE_LEVEL.match,
    ok: true,
    detail: `en vivo versión ${live.version}${live.tag ? ` · tag ${live.tag}` : ''} coincide con el repositorio`,
    hint: null,
  };
}

/**
 * La comparación en líneas, para el release y para `check:health`.
 *
 * @param {ReturnType<typeof compareReleaseIdentity>} comparison
 * @returns {string[]}
 */
export function formatReleaseComparison(comparison) {
  const mark = { ok: '✓', info: '·', warn: '!' };
  const prefix = `  ${mark[comparison.level] ?? '·'}`;

  if (comparison.status === 'match') {
    return [`${prefix} Versión y tag: ${comparison.detail}.`];
  }

  const lines = [`${prefix} Versión y tag: ${comparison.detail}.`];
  if (comparison.hint) lines.push(`      ${comparison.hint}`);
  return lines;
}

/** Cómo se nombra la identidad en un informe: `10.0.0 · tag v10.0.0`. */
export function describeReleaseIdentity(identity) {
  if (!identity || (!identity.version && !identity.tag)) return 'sin versión ni tag';
  return [identity.version ?? 'sin versión', identity.tag ? `tag ${identity.tag}` : 'sin tag'].join(
    ' · '
  );
}
