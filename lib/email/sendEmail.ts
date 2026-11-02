/**
 * Envío de correo.
 *
 * Se usa **Resend** por su API HTTP: no hace falta un cliente ni una librería,
 * un `fetch` alcanza. Supabase solo envía correos de autenticación, no correos
 * de producto como estos avisos.
 *
 * Sin `RESEND_API_KEY` configurada **no se finge que se envió**: se devuelve
 * `skipped`, y el job lo reporta. Es la misma regla que en el resto del
 * proyecto: si algo no se guardó o no se envió, se dice.
 *
 * En local, además, cada mensaje que pasa por acá queda en el buzón de salida
 * (`lib/email/outbox`, con `DEV_EMAIL_OUTBOX=1`) para poder abrirlo en el
 * navegador y probar el registro de punta a punta sin una clave real. El
 * buzón guarda el resultado tal cual —también el `skipped`—, así que nunca
 * convierte un envío que no ocurrió en uno que sí.
 */

import { captureOutbox } from './outbox';

export interface EmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailResult {
  sent: boolean;
  /** true cuando falta configuración: no es un error, pero tampoco un envío. */
  skipped: boolean;
  error?: string;
  /** id en el buzón local cuando `DEV_EMAIL_OUTBOX=1`; en producción, ausente. */
  outboxId?: string;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * Reintentos ante un fallo transitorio.
 *
 * Un correo de trámite —el enlace de la propuesta, las preguntas de una
 * evaluación— es la única forma que tiene la persona de seguir. Un 500 de
 * Resend o un corte de red de dos segundos no puede dejarla sin enlace cuando
 * el estado ya avanzó: se reintenta con espera creciente. Un 4xx (clave
 * inválida, dominio no verificado, destinatario rechazado) no se reintenta: el
 * problema no se arregla repitiendo.
 */
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [400, 1200];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Remitente. Debe pertenecer a un dominio verificado en Resend. */
function fromAddress(): string {
  return process.env.ALERTS_FROM_EMAIL || 'Rix7 <avisos@rix7.cl>';
}

export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export async function sendEmail(input: EmailInput): Promise<EmailResult> {
  const { to, subject, html, text } = input;
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    return withOutbox(input, { sent: false, skipped: true, error: 'Falta RESEND_API_KEY' });
  }

  let lastError = 'Error inesperado al enviar el correo.';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: fromAddress(), to: [to], subject, html, text }),
      });

      if (response.ok) return withOutbox(input, { sent: true, skipped: false });

      const detail = await response.text().catch(() => '');
      lastError = `Resend respondió ${response.status}: ${detail.slice(0, 200)}`;
      if (!isRetryable(response.status)) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Error inesperado al enviar el correo.';
    }

    const delay = RETRY_DELAYS_MS[attempt - 1];
    if (attempt < MAX_ATTEMPTS && delay) await sleep(delay);
  }

  return withOutbox(input, { sent: false, skipped: false, error: lastError });
}

/**
 * Anota en el buzón local el mensaje **y** cómo terminó el envío. Con el
 * buzón apagado (producción) es un no-op y el resultado vuelve intacto.
 */
function withOutbox(email: EmailInput, result: EmailResult): EmailResult {
  const outboxId = captureOutbox(email, result);
  return outboxId ? { ...result, outboxId } : result;
}
