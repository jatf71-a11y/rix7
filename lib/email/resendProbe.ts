/**
 * ¿Resend acepta la clave de este despliegue?
 *
 * La salud del portal juzgaba el correo por **presencia** de `RESEND_API_KEY`,
 * y ese es el hueco que dejó pasar una clave vencida: la variable seguía puesta,
 * `/api/health` decía `email: ok` y los correos fallaban uno por uno. Preguntar
 * «¿está configurado?» no es lo mismo que preguntar «¿funciona?».
 *
 * Acá se hace la segunda pregunta, con dos cuidados que la vuelven barata y
 * honesta:
 *
 * - **Caché por isolate.** El resultado se guarda 10 minutos, así que un
 *   despliegue que recibe salud cada minuto consulta a Resend seis veces por
 *   hora, no sesenta por hora. Y si llegan dos requests a la vez, comparten la
 *   misma consulta en vuelo en vez de duplicarla.
 * - **Un fallo de red no es una clave mala.** Sin respuesta de Resend el estado
 *   es `unverified`: se dice «no se pudo comprobar», nunca «vencida». Acusar a
 *   la credencial por un timeout es la clase de rojo que enseña a ignorar el
 *   informe.
 *
 * El endpoint que se usa (`GET /domains`) no envía nada ni gasta cuota de
 * correo: solo responde si la clave vale. Resend contesta `400` a una clave
 * inválida o revocada (no `401`), y eso se traduce a `invalid`.
 */

/** Cuánto se recuerda una respuesta de Resend. */
export const RESEND_PROBE_TTL_MS = 10 * 60_000;

/** Tope de espera de la consulta: la salud no puede colgarse de Resend. */
export const RESEND_PROBE_TIMEOUT_MS = 5000;

const RESEND_DOMAINS_ENDPOINT = 'https://api.resend.com/domains';

/**
 * Lo que se supo de la clave:
 *
 * - `valid`: Resend la aceptó.
 * - `invalid`: Resend la rechazó — venció o la revocaron.
 * - `unverified`: no se pudo preguntar (red, 5xx, tiempo agotado).
 */
export type ResendKeyState = 'valid' | 'invalid' | 'unverified';

export interface ResendKeyObservation {
  state: ResendKeyState;
  /** HTTP con el que contestó Resend; `null` si no hubo respuesta. */
  status: number | null;
  /** Lo que dijo Resend (recortado) o por qué no se pudo comprobar. */
  detail: string | null;
  /** Cuándo se hizo esta comprobación (ISO). */
  checkedAt: string;
}

interface CacheEntry {
  key: string;
  observation: ResendKeyObservation;
  expiresAt: number;
}

/** Una entrada por isolate: la clave no cambia sin un despliegue nuevo. */
let cached: CacheEntry | null = null;
/** La consulta en curso, para que dos requests simultáneos no pregunten dos veces. */
let inFlight: { key: string; promise: Promise<ResendKeyObservation> } | null = null;

/** Solo para tests: deja el módulo como recién cargado. */
export function resetResendProbeCache(): void {
  cached = null;
  inFlight = null;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'error desconocido al consultar Resend';
}

async function askResend({
  key,
  fetchImpl,
  timeoutMs,
}: {
  key: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<ResendKeyObservation> {
  const checkedAt = new Date().toISOString();

  try {
    const response = await fetchImpl(RESEND_DOMAINS_ENDPOINT, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (response.ok) return { state: 'valid', status: response.status, detail: null, checkedAt };

    const body = await response.text().catch(() => '');
    // 400 es lo que devuelve Resend para una clave inválida; 401/403, para una
    // que no tiene permiso. Las tres significan «esta clave no sirve».
    if ([400, 401, 403].includes(response.status)) {
      return { state: 'invalid', status: response.status, detail: body.slice(0, 200) || null, checkedAt };
    }

    return { state: 'unverified', status: response.status, detail: `HTTP ${response.status}`, checkedAt };
  } catch (error) {
    return { state: 'unverified', status: null, detail: describeError(error), checkedAt };
  }
}

/**
 * Lo que se sabe de la clave, consultando a Resend solo cuando hace falta.
 *
 * Sin clave devuelve `null` sin tocar la red: no hay nada que preguntar, y la
 * falta de configuración ya la informa el subsistema `email` por su cuenta.
 *
 * `now` y `ttlMs` existen para poder probar el vencimiento de la caché sin
 * esperar diez minutos.
 */
export async function observeResendKey({
  key,
  fetchImpl = fetch,
  now = Date.now(),
  ttlMs = RESEND_PROBE_TTL_MS,
  timeoutMs = RESEND_PROBE_TIMEOUT_MS,
}: {
  key: string | null;
  fetchImpl?: typeof fetch;
  now?: number;
  ttlMs?: number;
  timeoutMs?: number;
}): Promise<ResendKeyObservation | null> {
  if (!key) return null;

  if (cached && cached.key === key && cached.expiresAt > now) return cached.observation;
  if (inFlight && inFlight.key === key) return inFlight.promise;

  const promise = askResend({ key, fetchImpl, timeoutMs }).then((observation) => {
    cached = { key, observation, expiresAt: now + ttlMs };
    return observation;
  });

  inFlight = { key, promise };
  try {
    return await promise;
  } finally {
    if (inFlight?.promise === promise) inFlight = null;
  }
}
