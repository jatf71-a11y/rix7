/**
 * El identificador de la build, tal como llega al despliegue.
 *
 * Es la mitad de lectura de lo que escribe `scripts/build-id.mjs`: el release
 * calcula un hash del árbol de trabajo, lo publica como variable de entorno del
 * deployment (`RIX7_BUILD`) y desde acá se convierte en un objeto que
 * `/api/health` puede devolver. Con eso, «¿lo que está en vivo es este código?»
 * pasa a ser una comparación de dos valores en vez de una inspección a ojo del
 * panel de Vercel.
 *
 * El formato —y el porqué de cada decisión— está documentado en la cabecera de
 * [`scripts/build-id.mjs`](../scripts/build-id.mjs):
 *
 *   `1.<id>.<commit|->.<0|1>.<segundos-epoch>`
 *
 * Este módulo es puro y no importa nada de Node a propósito: lo usa una ruta de
 * servidor y se prueba sin levantar nada. No valida el identificador contra la
 * base de datos ni contra git —eso es de los scripts—, solo traduce el valor.
 */
export interface BuildId {
  /** Los 16 hex del hash del árbol publicado. */
  id: string;
  /** El commit del árbol publicado, si el release pudo leerlo. */
  commit: string | null;
  /** ¿Se publicó un árbol con cambios sin commitear? */
  dirty: boolean;
  /** ISO de cuándo se publicó, o `null` si el deployment no lo selló. */
  builtAt: string | null;
}

/** La variable con la que el deployment publica su identificador. */
export const BUILD_ID_ENV = 'RIX7_BUILD';

/** La única versión del formato que existe hoy. */
const FORMAT_VERSION = '1';

/** Un identificador es 16 hex en minúscula (ver `ID_LENGTH` en el script). */
const ID_PATTERN = /^[0-9a-f]{16}$/;

/** Un commit de git, corto o entero. */
const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/;

/**
 * Traduce el valor publicado a un objeto, o `null` si no se puede.
 *
 * Devuelve `null` —y no un objeto a medias— ante cualquier cosa que no sea el
 * formato: una variable ausente, un valor de una versión más nueva, basura. El
 * llamador tiene que poder distinguir «este despliegue no publica identificador»
 * de «publica uno», porque de eso depende que una comparación diga «coincide» o
 * «no se pudo comprobar». Un objeto con `id: ''` haría lo segundo pareciendo lo
 * primero.
 *
 * @param raw el valor de `RIX7_BUILD` en este despliegue
 */
export function parseBuildIdValue(raw: string | null | undefined): BuildId | null {
  if (typeof raw !== 'string') return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  const parts = trimmed.split('.');
  if (parts.length !== 5) return null;

  const [version, id, commit, dirty, stamp] = parts;
  if (version !== FORMAT_VERSION || !ID_PATTERN.test(id)) return null;

  const seconds = Number.parseInt(stamp, 10);
  const builtAt = Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null;

  return {
    id,
    commit: COMMIT_PATTERN.test(commit) ? commit : null,
    dirty: dirty === '1',
    builtAt: builtAt && !Number.isNaN(builtAt.getTime()) ? builtAt.toISOString() : null,
  };
}
