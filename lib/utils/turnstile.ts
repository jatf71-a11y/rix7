/**
 * Verificación anti-bot (Cloudflare Turnstile) para los formularios públicos.
 *
 * El rate limit por IP frena ráfagas, pero un script con IPs rotativas lo
 * esquiva. Turnstile agrega una prueba que el navegador resuelve y que el
 * servidor confirma contra la API de Cloudflare antes de guardar nada.
 *
 * Degradación explícita: si falta `TURNSTILE_SECRET_KEY`, la verificación no
 * bloquea (así no se corta el registro en un entorno sin configurar) pero
 * queda dicho en la respuesta (`skipped: true`) y en el log. Nunca se finge
 * una verificación que no ocurrió.
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const VERIFY_TIMEOUT_MS = 5000;
/** Un token de Turnstile es opaco y corto; cualquier cosa más larga es basura. */
const TOKEN_MAX_LENGTH = 2048;

export type TurnstileResult =
  | { ok: true; skipped: boolean }
  | { ok: false; error: string };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface VerifyTurnstileOptions {
  token: unknown;
  ip?: string;
  secret?: string | undefined;
  fetchImpl?: FetchLike;
}

/** Texto que ve la persona cuando la prueba falta o no pasa. */
export const TURNSTILE_FAILED_MESSAGE =
  'No pudimos verificar que eres una persona. Recarga la página e intenta de nuevo.';

export async function verifyTurnstile({
  token,
  ip,
  secret = process.env.TURNSTILE_SECRET_KEY,
  fetchImpl = fetch,
}: VerifyTurnstileOptions): Promise<TurnstileResult> {
  const key = secret?.trim();

  if (!key) {
    console.warn('[turnstile] TURNSTILE_SECRET_KEY no configurada: verificación omitida.');
    return { ok: true, skipped: true };
  }

  if (typeof token !== 'string' || token.trim() === '' || token.length > TOKEN_MAX_LENGTH) {
    return { ok: false, error: TURNSTILE_FAILED_MESSAGE };
  }

  const form = new URLSearchParams({ secret: key, response: token.trim() });
  if (ip && ip !== 'unknown') form.set('remoteip', ip);

  try {
    const response = await fetchImpl(SITEVERIFY_URL, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    const data = (await response.json()) as { success?: boolean; 'error-codes'?: string[] };

    if (data.success === true) return { ok: true, skipped: false };

    console.warn('[turnstile] verificación rechazada:', data['error-codes'] ?? 'sin detalle');
    return { ok: false, error: TURNSTILE_FAILED_MESSAGE };
  } catch (error) {
    // Si la API de Cloudflare no responde, no se acepta a ciegas: el formulario
    // pide reintentar en vez de guardar una solicitud sin verificar.
    console.error('[turnstile] no se pudo verificar:', error);
    return { ok: false, error: TURNSTILE_FAILED_MESSAGE };
  }
}
