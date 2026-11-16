/**
 * Libro de correos salientes (`email_log`).
 *
 * Se escribe desde `sendEmail` —el único lugar por el que pasa un correo del
 * proyecto— y se lee desde el panel del equipo. La razón es concreta: cuando un
 * socio dice «no me llegó», sin esto hay que adivinar entre Resend, los logs del
 * despliegue y el azar.
 *
 * La fila se arma en una función pura (`emailLogRow`) para poder probarla sin
 * base: el mapeo entre el resultado de `sendEmail` y el estado guardado es
 * justamente lo que no puede estar mal —un `skipped` anotado como enviado
 * convierte un problema en un misterio—.
 */

import { createServiceRoleClient, isServiceRoleConfigured } from '@/lib/supabase/admin';
import type { EmailInput, EmailResult } from '@/lib/email/sendEmail';

/** Tope del texto de error: es un diagnóstico, no un volcado de la API. */
export const ERROR_LIMIT = 500;

export type EmailStatus = 'sent' | 'failed' | 'skipped';

export interface EmailLogRow {
  to_email: string;
  subject: string;
  template: string | null;
  status: EmailStatus;
  error: string | null;
  outbox_id: string | null;
}

export interface EmailLogEntry extends EmailLogRow {
  id: string;
  created_at: string;
}

/** Traduce el resultado del envío al estado que se guarda. */
export function emailStatus(result: EmailResult): EmailStatus {
  if (result.sent) return 'sent';
  return result.skipped ? 'skipped' : 'failed';
}

/**
 * La fila de `email_log` para un envío.
 *
 * El asunto se guarda sin recortar (es corto y sirve para reconocerlo); el error
 * sí se recorta.
 */
export function emailLogRow(input: EmailInput, result: EmailResult): EmailLogRow {
  const status = emailStatus(result);
  const error = status === 'sent' ? null : (result.error ?? null);

  return {
    to_email: input.to,
    subject: input.subject,
    template: input.template ?? null,
    status,
    error: error ? error.slice(0, ERROR_LIMIT) : null,
    outbox_id: result.outboxId ?? null,
  };
}

/**
 * Anota el envío. **Nunca rompe el correo**: si la tabla no existe todavía o la
 * base no responde, se pierde el registro y el mensaje sigue su camino. Un
 * correo de trámite no puede fallar porque falló su bitácora.
 */
export async function recordEmailLog(input: EmailInput, result: EmailResult): Promise<void> {
  if (!isServiceRoleConfigured()) return;

  try {
    const supabase = createServiceRoleClient();
    const { error } = await supabase.from('email_log').insert(emailLogRow(input, result));
    if (error) throw new Error(error.message);
  } catch {
    // Best-effort a propósito: la bitácora no es el producto.
  }
}

/** Los últimos envíos, para la pantalla del equipo. */
export async function listRecentEmails(limit = 50): Promise<EmailLogEntry[]> {
  if (!isServiceRoleConfigured()) return [];

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('email_log')
    .select('id,created_at,to_email,subject,template,status,error,outbox_id')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []) as EmailLogEntry[];
}
