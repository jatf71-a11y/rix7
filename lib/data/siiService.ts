/**
 * Sobre común de los servicios JSON del SII.
 *
 * Las aplicaciones públicas del SII (contribuciones y mapas) no documentan una
 * API, pero todas hablan el mismo dialecto: un `POST` a
 * `/<aplicación>/services/data/<servicio>/<operación>` con un cuerpo
 * `{ metaData: { namespace, conversationId, transactionId, page }, data }`.
 * Los dos módulos que consultan al SII comparten esta pieza para no tener dos
 * copias del mismo sobre que se desincronicen cuando el SII cambie algo.
 *
 * Es de servidor: lo usan `siiContribuciones` y `siiRol`, nunca el navegador.
 */

/**
 * Identificador de conversación que usan las propias aplicaciones del SIIen
 * cada llamada. No es una credencial: viaja en su JavaScript público.
 */
const CONVERSATION_ID = 'NC8SBU1K04Z76';

/** Tope de espera: el SII a veces tarda y el panel no puede quedarse colgado. */
const TIMEOUT_MS = 12_000;

/**
 * POST al servicio con el sobre que espera.
 *
 * Devuelve `null` cuando el servicio no responde algo JSON: el llamador decide
 * el mensaje, porque «el SII no reconoce este dato» y «no se pudo consultar»
 * son problemas distintos para quien está cargando la ficha.
 */
export async function postSiiService(
  fetchImpl: typeof fetch,
  url: string,
  namespace: string,
  data: unknown
): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        metaData: {
          namespace,
          conversationId: CONVERSATION_ID,
          transactionId: crypto.randomUUID(),
          page: null,
        },
        data,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) return null;
    const json = (await response.json()) as unknown;
    return json && typeof json === 'object' ? (json as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** El `data` de la respuesta, solo si es un arreglo. */
export function dataArray(payload: Record<string, unknown> | null): unknown[] | null {
  const data = payload?.data;
  return Array.isArray(data) ? data : null;
}
