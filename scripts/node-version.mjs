#!/usr/bin/env node
/**
 * La versión de Node a la que se alinea el entorno local, en un solo lugar.
 *
 * El repo corría con la Node que hubiera en la máquina mientras CI y Vercel
 * fijaban la línea LTS 20. Esa diferencia no da la cara en un test: aparece como
 * rarezas de plataforma —los workers internos de `next dev` muriendo con «Jest
 * worker encountered 2 child process exceptions», builds que se comportan
 * distinto— y cuesta atribuirla a la causa real. Por eso la major esperada vive
 * en un archivo versionado (`.nvmrc`, que entienden nvm/fnm) y los wrappers
 * avisan, en vez de fallar, cuando la Node en uso no coincide.
 *
 * La línea es **24**: Vercel discontinuó 20.x y su build falla con «Node.js
 * Version "20.x" is discontinued and must be upgraded», así que la máquina local,
 * CI y Vercel corren todos la misma major. (El `WebSocket` global que usa la
 * auditoría a11y también es estable desde 22.)
 *
 * El aviso es **aviso**: hay una sola copia del repo y a veces conviene correr
 * con otra versión (probar que el proyecto sigue vivo en la siguiente LTS, por
 * ejemplo). Fallar impediría eso; callar dejaba el desalineamiento invisible.
 *
 * `DEFAULT_EXPECTED_MAJOR` es el respaldo de `.nvmrc`: si el archivo desaparece
 * o trae algo que no se entiende, el wrapper sigue avisando con la major de CI
 * en vez de quedarse mudo.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** El archivo que leen nvm/fnm y que este módulo trata como fuente de verdad. */
export const VERSION_RECORD_FILE = '.nvmrc';

/** La major que corren CI y Vercel; respaldo si `.nvmrc` falta o no se entiende. */
export const DEFAULT_EXPECTED_MAJOR = 24;

/**
 * Extrae la major de una versión de Node.
 *
 * `process.version` viene como `v24.19.0`; una cadena sin dígitos al principio
 * (p. ej. `lts/*`) devuelve `null` en vez de inventar un número.
 *
 * @param {string} version
 * @returns {number | null}
 */
export function nodeMajor(version) {
  const match = String(version ?? '')
    .trim()
    .match(/^v?(\d+)/);
  return match ? Number(match[1]) : null;
}

/**
 * Lee la major de un contenido de `.nvmrc`.
 *
 * Acepta las formas que la gente escribe de verdad: `24`, `v24`, `24.x`,
 * `24.19`, `24.19.0`. La primera línea no vacía manda; cualquier otra cosa (un
 * alias `lts/*`, una ruta) devuelve `null` para que decida el respaldo.
 *
 * @param {string} text
 * @returns {number | null}
 */
export function parseVersionRecord(text) {
  const first = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== '');
  const match = first?.match(/^v?(\d+)(?:\.(?:\d+|x|\*)){0,2}$/i);
  return match ? Number(match[1]) : null;
}

/**
 * La major esperada del proyecto, leída de `.nvmrc` con respaldo en la de CI.
 *
 * Nunca lanza: un `.nvmrc` ausente o ilegible no debe impedir arrancar el
 * servidor por una comprobación que solo informa.
 *
 * @param {{ root?: string }} [options]
 * @returns {number}
 */
export function expectedMajor({ root = process.cwd() } = {}) {
  try {
    const text = readFileSync(resolve(root, VERSION_RECORD_FILE), 'utf8');
    return parseVersionRecord(text) ?? DEFAULT_EXPECTED_MAJOR;
  } catch {
    return DEFAULT_EXPECTED_MAJOR;
  }
}

/**
 * Compara la versión en uso con la esperada.
 *
 * Devuelve el veredicto y, cuando no coincide, el texto del aviso ya listo para
 * imprimir: quién corre, quién debería correr y por qué importa. La decisión de
 * imprimir o no vive en el wrapper; acá solo se calcula.
 *
 * @param {string} version normalmente `process.version`
 * @param {number} expectedMajor
 * @returns {{ ok: boolean, actualMajor: number | null, expectedMajor: number, message: string | null }}
 */
export function checkNodeVersion(version, expectedMajor) {
  const actualMajor = nodeMajor(version);
  const ok = actualMajor !== null && actualMajor === expectedMajor;

  if (ok) return { ok, actualMajor, expectedMajor, message: null };

  const actual = actualMajor === null ? `desconocida (${version})` : `v${actualMajor}`;
  const message = [
    `⚠ Node en uso: ${actual}; el proyecto fija Node ${expectedMajor} (.nvmrc), la misma línea de CI y Vercel.`,
    `  Otra major puede cambiar el comportamiento de los workers de \`next dev\` y del build.`,
    `  Alinea con \`nvm use\` o \`fnm use\` (lee .nvmrc) antes de seguir.`,
  ].join('\n');

  return { ok, actualMajor, expectedMajor, message };
}
