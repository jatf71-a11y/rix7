/**
 * Versión y tag de la release, tal como llegan al despliegue.
 *
 * El identificador de la build (`buildId.ts`) responde «¿lo publicado es este
 * árbol?», pero no dice **qué versión** es ni con qué tag se etiquetó. Eso fue
 * justo lo que quedó a la vista el 2026-10-20: producción servía un commit 38
 * commits después del último tag `v10.0.0`, el `package.json` seguía en 10.0.0
 * y nada en el release lo advertía.
 *
 * El release lee ambos datos del repositorio y los publica como variables del
 * deployment (`RIX7_VERSION`, `RIX7_TAG`). Este módulo es la mitad de lectura:
 * traduce esas variables al objeto que `/api/health` expone, con la misma
 * desconfianza que `parseBuildIdValue` —un valor raro es `null`, no un dato a
 * medias—.
 *
 * La comparación con el repositorio no vive acá: es de los scripts
 * (`scripts/release-identity.mjs`), porque necesita git. Este archivo se importa
 * desde una ruta de servidor y no debe arrastrar Node.
 */

/** La variable con la versión de `package.json` publicada por el deployment. */
export const RELEASE_VERSION_ENV = 'RIX7_VERSION';

/** La variable con el tag exacto del commit publicado (vacío si no tiene). */
export const RELEASE_TAG_ENV = 'RIX7_TAG';

/** Versión semver simple, la que usa `package.json`. */
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/** Tag de release: `v` opcional y semver. Un tag con otra forma no se publica. */
const TAG_PATTERN = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export interface ReleaseIdentity {
  /** Versión del `package.json` que se publicó, o `null` si no vino. */
  version: string | null;
  /** Tag exacto del commit publicado, o `null` si el commit no estaba taggeado. */
  tag: string | null;
}

/**
 * Traduce las dos variables del deployment.
 *
 * Devuelve `null` cuando **ninguna** de las dos es válida: así el llamador
 * distingue «este deployment no publica identidad de release» de «publica una».
 * Un objeto con dos `null` haría que la comparación dijera «coincide» sin haber
 * comparado nada, que es el fallo silencioso que este módulo existe para evitar.
 *
 * @param rawVersion valor de `RIX7_VERSION`
 * @param rawTag valor de `RIX7_TAG`
 */
export function parseReleaseIdentity(
  rawVersion: string | null | undefined,
  rawTag: string | null | undefined
): ReleaseIdentity | null {
  const version =
    typeof rawVersion === 'string' && VERSION_PATTERN.test(rawVersion.trim())
      ? rawVersion.trim()
      : null;
  const tag =
    typeof rawTag === 'string' && TAG_PATTERN.test(rawTag.trim()) ? rawTag.trim() : null;

  if (!version && !tag) return null;
  return { version, tag };
}
