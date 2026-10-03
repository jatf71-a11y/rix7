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

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: fromAddress(), to: [to], subject, html, text }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return withOutbox(input, {
        sent: false,
        skipped: false,
        error: `Resend respondió ${response.status}: ${detail.slice(0, 200)}`,
      });
    }

    return withOutbox(input, { sent: true, skipped: false });
  } catch (error) {
    return withOutbox(input, {
      sent: false,
      skipped: false,
      error: error instanceof Error ? error.message : 'Error inesperado al enviar el correo.',
    });
  }
}

/**
 * Anota en el buzón local el mensaje **y** cómo terminó el envío. Con el
 * buzón apagado (producción) es un no-op y el resultado vuelve intacto.
 */
function withOutbox(email: EmailInput, result: EmailResult): EmailResult {
  const outboxId = captureOutbox(email, result);
  return outboxId ? { ...result, outboxId } : result;
}
