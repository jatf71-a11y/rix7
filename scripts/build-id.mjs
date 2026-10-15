#!/usr/bin/env node
/**
 * Identificador de la build: **el hash del árbol que se publica**.
 *
 * Nació de un problema que este repositorio ya sufrió dos veces: producción y el
 * repositorio no coincidían, y nada lo decía. La primera vez el panel de socios
 * existía en el código y no en producción; la segunda, producción tenía código
 * —publicado desde el árbol de trabajo— que en git todavía no estaba commiteado.
 * En los dos casos la pregunta «¿lo que está en vivo es este código?» solo se
 * podía contestar a mano, mirando el panel de Vercel y adivinando.
 *
 * Este módulo la contesta con un número:
 *
 *   id = sha256( path + sha256(contenido) de cada archivo que git ve )
 *
 * - **Qué entra**: los archivos versionados y los no versionados **no
 *   ignorados** —exactamente lo que `git ls-files --cached --others
 *   --exclude-standard` enumera—, que es también lo que viaja al deployment
 *   (`deploy-prod.mjs` copia el árbol de trabajo, no el commit). Un archivo
 *   nuevo sin commitear cambia el identificador: eso es deliberado, porque ese
 *   archivo **sí** se publica.
 * - **Qué no entra**: lo ignorado (`.next`, `node_modules`, `.freebuff`,
   *   `.env*`, registros): no es código y no viaja al deployment.
 * - **Fin de línea**: el contenido se normaliza (CRLF → LF) antes de hashear. Sin
 *   eso, el mismo árbol daría un hash distinto en Windows y en el checkout de
 *   Linux del CI, que es justo lo que hay que poder comparar.
 *
 * El identificador se publica como variable de entorno del deployment
 * (`RIX7_BUILD`, ver `deploy-prod.mjs`), `/api/health` lo expone ya parseado y la
 * verificación —del release y de `check:health`, que corre solo cada 6 horas—
 * compara en vivo con el árbol de acá.
 *
 * ## El formato, y por qué es tan aburrido
 *
 *   `1.<id>.<commit|->.<0|1>.<segundos-epoch>`
 *
 * Por ejemplo `1.4f2a3c4b5d6e7f80.9d1c3ab77e5f1234567890abcdef1234567890ab.1.1760361600`.
 *
 * Viaja como argumento de línea de comandos hacia el CLI de Vercel, y en Windows
 * ese camino pasa por `cmd.exe` (ver `deploy-prod.mjs`): por eso el valor solo
 * usa `[0-9a-f.-]`. Nada de llaves, comillas, `|`, espacios ni `;` — un solo
 * carácter de esos y el deploy recibiría otra cosa, o nada.
 *
 * El `id` va recortado a 16 hex de los 64: para comparar igualdad alcanza de
 * sobra (no es una frontera de seguridad) y así el valor se puede leer de un
 * vistazo. El `commit`, en cambio, va entero: con él se responde «¿producción
 * está atrás?» contando commits.
 *
 * `lib/utils/buildId.ts` es la otra mitad de este formato: lo **parsea** para
 * `/api/health`. Si cambia acá, cambia allá — y hay un test que lo comprueba
 * (`lib/utils/buildId.test.ts`), porque dos implementaciones del mismo formato
 * sin nada que las ate es exactamente cómo aparecen estos bugs.
 *
 * El núcleo es puro (salvo las funciones de lectura, que reciben el `run` de
 * git inyectado) y se prueba en `build-id.test.ts`.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** La raíz del repositorio: el árbol que se identifica por defecto. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** La variable con la que el deployment publica su identificador. */
export const BUILD_ID_ENV = 'RIX7_BUILD';

/** Versión del formato. Si algún día cambia la forma del valor, cambia acá. */
export const FORMAT_VERSION = '1';

/** Cuántos hex del sha256 del árbol se publican. */
export const ID_LENGTH = 16;

/** Un identificador válido: `ID_LENGTH` caracteres hex en minúscula. */
const ID_PATTERN = new RegExp(`^[0-9a-f]{${ID_LENGTH}}$`);

/**
 * ¿Es un identificador con la forma que publicamos?
 *
 * @param {string | null | undefined} value
 */
export function isBuildId(value) {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

// ═════════════════════════════════════════════════════════════════════════════
// Núcleo puro (probado en build-id.test.ts)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Normaliza el fin de línea a LF, **sin decodificar el archivo**.
 *
 * El viaje por latin1 es a propósito: es una ida y vuelta byte a byte, así que
 * sirve igual para un `.mp4` que para un `.ts`, y no reinterpreta nada. El
 * camino rápido —sin ningún byte `0x0d`— evita pagar el costo en los archivos
 * que ya están en LF o en los binarios.
 *
 * @param {Buffer | string} value
 * @returns {Buffer}
 */
export function normalizeEol(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  if (buffer.indexOf(13) === -1) return buffer;
  return Buffer.from(buffer.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
}

/**
 * El identificador del árbol: un sha256 sobre (camino, sha256 del contenido) de
 * cada archivo, ordenado por camino.
 *
 * El orden se impone acá y no se confía en el que llegue: dos listados del mismo
 * árbol —uno del sistema de archivos, otro de git— tienen que dar el mismo
 * número, y el hash de un conjunto no depende de cómo se lo recorrió.
 *
 * @param {{ path: string, content: Buffer | string }[]} entries
 * @returns {string} `ID_LENGTH` caracteres hex
 */
export function hashTree(entries) {
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const tree = createHash('sha256');

  for (const entry of sorted) {
    const content = createHash('sha256').update(normalizeEol(entry.content)).digest('hex');
    tree.update(`file\0${entry.path}\0${content}\0`);
  }

  return tree.digest('hex').slice(0, ID_LENGTH);
}

/**
 * El valor que se publica como `RIX7_BUILD` (ver el formato en la cabecera).
 *
 * Devuelve `null` si no hay identificador: es preferible un `null` explícito a un
 * valor con forma de identificador pero sin nada adentro, que es el que después
 * hace decir «coincide» a una comparación contra la nada.
 *
 * @param {{ id: string, commit?: string | null, dirty?: boolean, builtAt?: number | null }} build
 * @returns {string | null}
 */
export function formatBuildIdValue({ id, commit = null, dirty = false, builtAt = null }) {
  if (!isBuildId(id)) return null;
  const stamp = Number.isFinite(Number(builtAt)) && Number(builtAt) > 0 ? String(Math.floor(Number(builtAt))) : '0';
  return [FORMAT_VERSION, id, commit || '-', dirty ? '1' : '0', stamp].join('.');
}

/**
 * Los primeros caracteres del identificador, para leerlo en un informe.
 *
 * @param {string | null | undefined} id
 */
export function shortId(id) {
  return isBuildId(id) ? `${id.slice(0, 8)}…` : 'sin identificador';
}

/**
 * Cómo se nombra un identificador en un informe: `4f2a3c4b… · commit 9d1c3ab ·
 * con 17 archivos sin commitear`.
 *
 * El detalle de cuántos archivos hay sin commitear solo lo puede dar quien miró
 * el árbol con git (`changed`); el despliegue en vivo solo publica un booleano,
 * y en ese caso se dice «con cambios sin commitear».
 *
 * @param {{ id?: string | null, commit?: string | null, dirty?: boolean, changed?: number | null }} build
 * @returns {string}
 */
export function describeBuild(build) {
  const parts = [shortId(build?.id ?? null)];

  if (build?.commit) parts.push(`commit ${build.commit.slice(0, 7)}`);
  if (build?.dirty) {
    parts.push(build.changed ? `con ${build.changed} archivo${build.changed === 1 ? '' : 's'} sin commitear` : 'con cambios sin commitear');
  } else {
    parts.push('árbol limpio');
  }

  return parts.join(' · ');
}

/**
 * Los archivos que se identifican: los versionados y los no versionados no
 * ignorados. Es la misma lista que viaja al deployment, y por eso no se usa un
 * recorrido propio del directorio: `.gitignore` ya dice qué es código y qué es
 * basura local (`dev-server.log`, `.next`, `node_modules`).
 *
 * @param {{ root?: string, run?: typeof defaultRun }} [options]
 * @returns {string[] | null} `null` cuando no se pudo leer la lista (sin git, no es un repo)
 */
export function listTreeFiles({ root = ROOT, run = defaultRun } = {}) {
  const result = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { root });
  if (!result) return null;
  if (result.code !== 0) return null;

  return result.stdout.split('\0').filter(Boolean);
}

/**
 * Lee el contenido de cada archivo de la lista.
 *
 * Un archivo que no se puede leer (permisos, un nombre que git escribió distinto
 * al del sistema de archivos) **no** se saltea en silencio: se informa en
 * `skipped`, porque un identificador calculado sobre menos archivos dice
 * «coincide» con la misma seguridad que uno completo, y eso es peor que un error.
 *
 * @param {{ root?: string, files: string[], read?: (filePath: string) => Buffer }} options
 * @returns {{ entries: { path: string, content: Buffer }[], skipped: string[] }}
 */
export function readTreeEntries({ root = ROOT, files, read = defaultRead }) {
  const entries = [];
  const skipped = [];

  for (const file of files) {
    try {
      entries.push({ path: file, content: read(path.join(root, file)) });
    } catch {
      skipped.push(file);
    }
  }

  return { entries, skipped };
}

/**
 * El estado del árbol según git: el commit, si hay cambios sin commitear y
 * cuántos. Se usa para el contexto del informe («con 17 archivos sin
 * commitear», «commit 9d1c3ab»), **no** para el hash: el hash sale del contenido.
 *
 * @param {{ root?: string, run?: typeof defaultRun }} [options]
 * @returns {{ commit: string | null, dirty: boolean, changed: number | null }}
 */
export function readGitState({ root = ROOT, run = defaultRun } = {}) {
  const head = run('git', ['rev-parse', 'HEAD'], { root });
  const status = run('git', ['status', '--porcelain'], { root });

  const commit = head && head.code === 0 ? head.stdout.trim() || null : null;
  const changed = status && status.code === 0 ? status.stdout.split('\n').filter(Boolean).length : null;

  return { commit, dirty: Boolean(changed), changed };
}

/**
 * Junta todo: la lista de archivos, su contenido, el estado de git y el valor a
 * publicar. Es la única entrada que usan el release, el deploy y la sonda.
 *
 * Nunca lanza: cuando no se puede identificar el árbol devuelve `value: null` y
 * `error` con el motivo. Un release sin identificador sigue publicando (y lo
 * dice); lo que no puede es *afirmar* que producción sea este árbol.
 *
 * @param {{ root?: string, run?: typeof defaultRun, read?: (filePath: string) => Buffer, now?: () => number }} [options]
 * @returns {{ value: string | null, id: string | null, commit: string | null, dirty: boolean, changed: number | null, builtAt: number, files: number, skipped: string[], error: string | null }}
 */
export function readTreeBuildId({
  root = ROOT,
  run = defaultRun,
  read = defaultRead,
  now = Date.now,
} = {}) {
  const files = listTreeFiles({ root, run });
  if (files === null) {
    return {
      value: null,
      id: null,
      commit: null,
      dirty: false,
      changed: null,
      builtAt: 0,
      files: 0,
      skipped: [],
      error: 'no se pudo listar los archivos con git (¿está instalado? ¿es un repositorio?)',
    };
  }

  const { entries, skipped } = readTreeEntries({ root, files, read });
  if (!entries.length) {
    return {
      value: null,
      id: null,
      commit: null,
      dirty: false,
      changed: null,
      builtAt: 0,
      files: 0,
      skipped,
      // Un árbol vacío daría un identificador válido y «coincidiría» con otro
      // árbol vacío: es el peor fallo posible, porque es silencioso.
      error: 'no se pudo leer ningún archivo del árbol',
    };
  }

  const { commit, dirty, changed } = readGitState({ root, run });
  const id = hashTree(entries);
  const builtAt = Math.floor(now() / 1000);

  return {
    value: formatBuildIdValue({ id, commit, dirty, builtAt }),
    id,
    commit,
    dirty,
    changed,
    builtAt,
    files: entries.length,
    skipped,
    error: null,
  };
}

/**
 * Qué relación hay entre el commit que está en vivo y el del árbol.
 *
 * Existe para poder decir «producción está **3 commits atrás**» en vez de «los
 * commits difieren»: la primera frase se convierte en una tarea, la segunda en
 * una duda. Se calcula con git, así que se inyecta el `run` en los tests.
 *
 * @param {{ liveCommit?: string | null, localCommit?: string | null, root?: string, run?: typeof defaultRun }} [options]
 * @returns {{ relation: 'same' | 'behind' | 'ahead' | 'diverged' | 'unknown', count: number | null, detail: string } | null}
 */
export function gitRelation({ liveCommit = null, localCommit = null, root = ROOT, run = defaultRun } = {}) {
  if (!liveCommit || !localCommit) return null;
  if (liveCommit === localCommit) return { relation: 'same', count: 0, detail: 'mismo commit' };

  const short = (sha) => sha.slice(0, 7);
  const pair = `${short(liveCommit)} → ${short(localCommit)}`;

  // El commit de producción puede no estar en este clon (un clon superficial lo
  // corta). Sin esta comprobación, `merge-base` falla y el veredicto diría
  // «historias distintas» sobre algo que en realidad es «no sé».
  const known = run('git', ['cat-file', '-e', `${liveCommit}^{commit}`], { root });
  if (!known || known.code !== 0) {
    return { relation: 'unknown', count: null, detail: `el commit de producción (${short(liveCommit)}) no está en este clon` };
  }

  const isAncestor = (ancestor, descendant) => {
    const result = run('git', ['merge-base', '--is-ancestor', ancestor, descendant], { root });
    return result ? result.code === 0 : null;
  };

  const count = (from, to) => {
    const result = run('git', ['rev-list', '--count', `${from}..${to}`], { root });
    if (!result || result.code !== 0) return null;
    const value = Number.parseInt(result.stdout.trim(), 10);
    return Number.isFinite(value) ? value : null;
  };

  const productionBehind = isAncestor(liveCommit, localCommit);
  const productionAhead = isAncestor(localCommit, liveCommit);

  if (productionBehind) {
    const n = count(liveCommit, localCommit);
    return {
      relation: 'behind',
      count: n,
      detail: `producción está ${n === null ? 'por detrás de' : `${n} commit${n === 1 ? '' : 's'} atrás de`} el árbol (${pair})`,
    };
  }

  if (productionAhead) {
    const n = count(localCommit, liveCommit);
    return {
      relation: 'ahead',
      count: n,
      detail: `producción tiene ${n === null ? 'commits que' : `${n} commit${n === 1 ? '' : 's'} que`} el árbol no tiene (${pair})`,
    };
  }

  return { relation: 'diverged', count: null, detail: `las dos puntas no comparten historia (${pair})` };
}

/** El nivel de una comparación, para colorear el informe sin volver a decidirlo. */
export const BUILD_LEVEL = { match: 'ok', noLive: 'info', noTree: 'info', stale: 'warn', treeMoved: 'warn', differs: 'warn' };

/**
 * La comparación, que es el corazón de todo esto: **¿lo que está en vivo es este
 * árbol?**
 *
 * Los seis veredictos existen porque se arreglan distinto:
 *
 * - `match`: lo publicado es este árbol. El caso bueno.
 * - `no-live`: el despliegue no publica identificador. No es un error de nadie
 *   (un deploy anterior a esta función no lo tiene), pero significa que la
 *   pregunta quedó sin contestar.
 * - `no-tree`: no se pudo identificar el árbol local. También es un «no sé», y
 *   por eso no se cuenta como un «sí».
 * - `stale`: en vivo hay algo **distinto de lo que este release publicó**. Es el
 *   caso de un alias que todavía sirve el deployment anterior, o de otro deploy
 *   que pisó el nuestro. En el release es un fallo; en la sonda, un aviso.
 * - `tree-moved`: en vivo **sí** es lo que publicamos, pero el árbol cambió
 *   mientras corría el release. Lo publicado existe, solo que ya no es «este
 *   árbol»: hay que volver a correrlo.
 * - `differs`: en vivo hay otro árbol que el del repositorio. Es la respuesta a
 *   «producción quedó atrás» (o adelante: la `relation` lo dice).
 *
 * @param {{ live?: { id: string, commit?: string | null, dirty?: boolean, builtAt?: string | null } | null, expected?: { id?: string | null, commit?: string | null, dirty?: boolean, changed?: number | null } | null, published?: { id?: string | null } | null, relation?: { relation: string, count?: number | null, detail: string } | null }} [options]
 * @returns {{ status: 'match' | 'no-live' | 'no-tree' | 'stale' | 'tree-moved' | 'differs', level: 'ok' | 'info' | 'warn', detail: string, hint: string | null, live: object | null, expected: object | null, published: object | null, relation: object | null }}
 */
export function compareBuilds({ live = null, expected = null, published = null, relation = null } = {}) {
  const base = { live, expected, published, relation, detail: '', hint: null };

  if (!isBuildId(expected?.id)) {
    return {
      ...base,
      status: 'no-tree',
      level: BUILD_LEVEL.noTree,
      detail: 'no se pudo identificar el árbol de este repositorio, así que no hay con qué comparar lo publicado',
      hint: 'El identificador se calcula con git sobre el árbol de trabajo: corré esto dentro del repositorio.',
    };
  }

  if (!isBuildId(live?.id)) {
    return {
      ...base,
      status: 'no-live',
      level: BUILD_LEVEL.noLive,
      detail: `el despliegue no publica identificador de la build (${BUILD_ID_ENV})`,
      hint: `Un despliegue publicado con \`npm run release:prod\` (o \`npm run deploy:prod\`) sí lo publica. Comparación sin hacer: no se puede afirmar que producción sea este árbol.`,
    };
  }

  if (live.id === expected.id) {
    return {
      ...base,
      status: 'match',
      level: BUILD_LEVEL.match,
      detail: `en vivo coincide con el árbol (${describeBuild(expected)})`,
      hint: null,
    };
  }

  // El árbol cambió entre el deploy y la verificación: lo publicado es el
  // árbol de hace un momento, no el de ahora.
  if (isBuildId(published?.id) && published.id === live.id) {
    return {
      ...base,
      status: 'tree-moved',
      level: BUILD_LEVEL.treeMoved,
      detail: 'el árbol cambió mientras corría el release: lo publicado es el estado anterior al cambio',
      hint: 'Volvé a correr `npm run release:prod` para publicar el árbol actual.',
    };
  }

  // Hay algo en vivo que no es lo que se acaba de publicar: o el borde todavía
  // sirve el deployment anterior, o alguien publicó otra cosa en el medio.
  if (isBuildId(published?.id)) {
    return {
      ...base,
      status: 'stale',
      level: BUILD_LEVEL.stale,
      detail: `en vivo no es lo que este release publicó (en vivo ${shortId(live.id)}, publicado ${shortId(published.id)})`,
      hint: 'Un alias recién promovido tarda unos segundos en propagarse; si persiste, mirá los deployments en Vercel.',
    };
  }

  return {
    ...base,
    status: 'differs',
    level: BUILD_LEVEL.differs,
    detail: [
      `en vivo hay otro árbol que el del repositorio (en vivo ${shortId(live.id)}, árbol ${shortId(expected.id)})`,
      relation?.detail,
    ]
      .filter(Boolean)
      .join(' · '),
    hint: `Publicá el árbol actual con \`npm run release:prod\`. Si en vivo hay código que el repo no tiene, commiteá lo que está en producción.`,
  };
}

/**
 * La comparación en líneas, lista para imprimir. Es una sola implementación para
 * el release y para la sonda: si cada uno la redactara, el mismo hecho se leería
 * distinto en cada lado.
 *
 * @param {ReturnType<typeof compareBuilds>} comparison
 * @returns {string[]}
 */
export function formatBuildComparison(comparison) {
  const mark = { ok: '✓', info: '·', warn: '!' };
  const prefix = `  ${mark[comparison.level] ?? '·'}`;

  if (comparison.status === 'match') {
    return [`${prefix} Identificador de la build: ${comparison.detail}.`];
  }

  if (comparison.status === 'no-live' || comparison.status === 'no-tree') {
    return [`${prefix} Identificador de la build: ${comparison.detail}.`, `      ${comparison.hint}`];
  }

  const lines = [`${prefix} Producción no coincide con el árbol:`, `      · ${comparison.detail}`];

  if (comparison.live?.id) lines.push(`      · en vivo: ${describeBuild(comparison.live)}`);
  if (comparison.expected?.id) lines.push(`      · árbol:   ${describeBuild(comparison.expected)}`);
  if (comparison.relation?.detail && !comparison.detail.includes(comparison.relation.detail)) {
    lines.push(`      · ${comparison.relation.detail}`);
  }
  if (comparison.hint) lines.push(`    ${comparison.hint}`);

  return lines;
}

// ═════════════════════════════════════════════════════════════════════════════
// La corrida (git entra inyectado)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Corre un comando y devuelve `{ code, stdout }`, o `null` si no se pudo correr
 * (el binario no existe, no es un repositorio, se pasó el tiempo).
 *
 * La distinción importa: `null` es «no sé» y `code !== 0` es «git dijo que no».
 * Confundirlas es cómo una sonda termina dando por bueno un árbol vacío.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{ root?: string, timeout?: number }} [options]
 * @returns {{ code: number, stdout: string } | null}
 */
export function defaultRun(command, args, { root = ROOT, timeout = 20000 } = {}) {
  try {
    const result = spawnSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      timeout,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
    if (result.error || result.status === null) return null;
    return { code: result.status, stdout: result.stdout ?? '' };
  } catch {
    return null;
  }
}

/** La lectura por defecto: el archivo entero, como bytes. */
function defaultRead(filePath) {
  return readFileSync(filePath);
}
