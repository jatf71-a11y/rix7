/**
 * La release que está sirviendo este despliegue, lista para mostrar.
 *
 * `/api/health` ya expone la identidad de la build y la versión/tag para que un
 * script o un monitor puedan compararlas con el repositorio. Falta el otro
 * consumidor: una persona dentro del panel, que necesita saber qué está viendo
 * sin abrir una terminal ni entrar al panel de Vercel.
 *
 * Este módulo une las dos mitades que ya existen (`buildId.ts` y
 * `releaseIdentity.ts`) y agrega el único respaldo razonable: si el deployment
 * no publica `RIX7_VERSION`, la versión del `package.json` con la que se compiló
 * este código sigue siendo la versión de este código. El identificador de build
 * **no** tiene respaldo: un despliegue que no lo publica no se puede identificar,
 * y el panel debe decirlo así en vez de inventar uno.
 *
 * Es puro y no importa Node: lo usa el layout de servidor del panel y se prueba
 * sin levantar nada.
 */
import { BUILD_ID_ENV, parseBuildIdValue, type BuildId } from './buildId';
import { RELEASE_TAG_ENV, RELEASE_VERSION_ENV, parseReleaseIdentity } from './releaseIdentity';

export interface DeployedRelease {
  /** Versión publicada; si el deployment no la declara, la del manifiesto compilado. */
  version: string;
  /** Tag exacto del commit publicado, o `null` si ese commit no tiene tag. */
  tag: string | null;
  /** Árbol publicado, o `null` si el deployment no lo identifica. */
  build: BuildId | null;
}

/**
 * Traduce las variables del deployment.
 *
 * @param source entorno del proceso (`process.env` en el layout)
 * @param manifestVersion `version` del `package.json` compilado
 */
export function readDeployedRelease(
  source: Record<string, string | undefined>,
  manifestVersion: string
): DeployedRelease {
  const identity = parseReleaseIdentity(source[RELEASE_VERSION_ENV], source[RELEASE_TAG_ENV]);

  return {
    // La versión del manifiesto es la del código que se está ejecutando: sirve
    // de respaldo aunque el deployment no haya publicado la variable. El tag,
    // en cambio, solo puede venir del deployment: no se deduce del número.
    version: identity?.version ?? manifestVersion,
    tag: identity?.tag ?? null,
    build: parseBuildIdValue(source[BUILD_ID_ENV]),
  };
}
