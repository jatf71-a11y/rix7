import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verificación de la firma de los webhooks de Sentry (plan fase 3, 1.4).
 *
 * Sentry firma cada webhook con HMAC-SHA256 sobre `<timestamp>.<body>` usando
 * el secreto del cliente (Developer Settings → Custom Webhooks) y lo manda en
 * la cabecera `Sentry-Hook-Signature`. Sin esta verificación, cualquiera que
 * descubra la URL podría inventar alertas — y un correo de "producción en
 * llamas" a deshoras es una broma que se agradece poco.
 *
 * Módulo puro a propósito: la lógica se prueba en `sentrySignature.test.ts`
 * y la ruta (`app/api/webhooks/sentry/route.ts`) solo la consume.
 */

/** Edad máxima de un webhook: fuera de esta ventana se rechaza por replay. */
export const SENTRY_WEBHOOK_MAX_AGE_S = 10 * 60; // 10 minutos

/** Formas válidas de la cabecera: `t=<unix>, v1=<hex>`. */
function parseSignatureHeader(header: string): { timestamp: number; signature: string } | null {
  const parts = new Map<string, string>();
  for (const piece of header.split(',')) {
    const [key, value] = piece.split('=');
    if (key && value) parts.set(key.trim(), value.trim());
  }
  const timestamp = Number(parts.get('t'));
  const signature = parts.get('v1');
  if (!Number.isFinite(timestamp) || !signature) return null;
  return { timestamp, signature };
}

function timingSafeHexEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export interface SentrySignatureInput {
  /** Cuerpo crudo de la petición, tal como llegó (no el JSON re-serializado). */
  body: string;
  /** Cabecera `Sentry-Hook-Signature`. */
  signatureHeader: string | null;
  /** Secreto del webhook (env `SENTRY_WEBHOOK_SECRET` en producción). */
  secret: string | null;
  /** Reloj inyectable para los tests. */
  now?: () => number;
}

export type SentrySignatureResult =
  | { ok: true }
  | { ok: false; reason: 'missing-secret' | 'missing-header' | 'malformed' | 'expired' | 'bad-signature' };

/**
 * ¿Es este webhook genuino y reciente? Falla cerrado: ante cualquier duda
 * (cabecera ausente, formato raro, reloj corriendo) se rechaza.
 */
export function verifySentryWebhook(input: SentrySignatureInput): SentrySignatureResult {
  if (!input.secret) return { ok: false, reason: 'missing-secret' };
  if (!input.signatureHeader) return { ok: false, reason: 'missing-header' };

  const parsed = parseSignatureHeader(input.signatureHeader);
  if (!parsed) return { ok: false, reason: 'malformed' };

  const now = Math.floor((input.now ?? Date.now)() / 1000);
  if (now - parsed.timestamp > SENTRY_WEBHOOK_MAX_AGE_S || parsed.timestamp - now > SENTRY_WEBHOOK_MAX_AGE_S) {
    return { ok: false, reason: 'expired' };
  }

  const expected = createHmac('sha256', input.secret).update(`${parsed.timestamp}.${input.body}`).digest('hex');
  return timingSafeHexEqual(expected, parsed.signature)
    ? { ok: true }
    : { ok: false, reason: 'bad-signature' };
}
