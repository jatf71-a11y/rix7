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
 */

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
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** Remitente. Debe pertenecer a un dominio verificado en Resend. */
function fromAddress(): string {
  return process.env.ALERTS_FROM_EMAIL || 'Rix7 <avisos@rix7.cl>';
}

export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export async function sendEmail({ to, subject, html, text }: EmailInput): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { sent: false, skipped: true, error: 'Falta RESEND_API_KEY' };
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
      return {
        sent: false,
        skipped: false,
        error: `Resend respondió ${response.status}: ${detail.slice(0, 200)}`,
      };
    }

    return { sent: true, skipped: false };
  } catch (error) {
    return {
      sent: false,
      skipped: false,
      error: error instanceof Error ? error.message : 'Error inesperado al enviar el correo.',
    };
  }
}
