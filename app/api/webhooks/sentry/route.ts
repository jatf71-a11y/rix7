import { NextRequest, NextResponse } from 'next/server';
import { verifySentryWebhook } from '@/lib/email/sentrySignature';
import { buildSentryAlertEmail, isAlertWorthy, type SentryAlertPayload } from '@/lib/email/sentryAlertEmail';
import { sendEmail } from '@/lib/email/sendEmail';

/**
 * `/api/webhooks/sentry` — receptor de las alertas de Sentry → correo (1.4).
 *
 * La regla de alerta vive en el dashboard de Sentry; este endpoint es la mitad
 * que sí depende del código. La guía para conectarla queda en
 * `docs/activar-monitoreo-vercel.md` (Parte 4), lista para el día que exista
 * la cuenta de Sentry.
 *
 * Contrato de seguridad:
 * - Firma HMAC `t=<unix>, v1=<hex>` verificada en tiempo constante sobre el
 *   cuerpo **crudo**, con ventana de 10 minutos contra replays.
 * - Severidad re-chequeada acá (defensa en profundidad): aunque la regla del
 *   dashboard se relaje, solo `error`/`fatal` generan correo.
 * - Sin `SENTRY_WEBHOOK_SECRET` el endpoint responde 503: no se procesa nada
 *   sin verificación posible. Y sin destinatario (`SENTRY_ALERT_EMAIL`), no
 *   se finge que se avisó: se registra `skipped` en la respuesta.
 */

export const dynamic = 'force-dynamic';

/** Estado de configuración (para saber qué falta sin abrir logs). */
export async function GET() {
  return NextResponse.json({
    success: true,
    configured: {
      webhookSecret: !!process.env.SENTRY_WEBHOOK_SECRET,
      alertEmail: !!process.env.SENTRY_ALERT_EMAIL,
      emailProvider: !!process.env.RESEND_API_KEY,
    },
  });
}

export async function POST(request: NextRequest) {
  const secret = process.env.SENTRY_WEBHOOK_SECRET || null;
  if (!secret) {
    return NextResponse.json(
      { success: false, error: 'Falta SENTRY_WEBHOOK_SECRET: no se puede verificar el webhook.' },
      { status: 503 }
    );
  }

  const body = await request.text(); // crudo: la firma es sobre el texto exacto
  const signatureHeader = request.headers.get('Sentry-Hook-Signature');

  const verification = verifySentryWebhook({ body, signatureHeader, secret });
  if (!verification.ok) {
    return NextResponse.json(
      { success: false, error: `Webhook rechazado: ${verification.reason}.` },
      { status: 401 }
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return NextResponse.json({ success: false, error: 'Cuerpo no es JSON válido.' }, { status: 400 });
  }

  const envelope = raw as {
    action?: string;
    data?: { project?: number; project_name?: string; issue?: Record<string, unknown>; event?: Record<string, unknown> };
  };
  const data = envelope.data ?? {};
  const event = (data.event ?? {}) as Record<string, unknown>;
  const issue = (data.issue ?? {}) as Record<string, unknown>;
  const eventMetadata = (event.metadata ?? {}) as Record<string, string>;

  const payload: SentryAlertPayload = {
    action: String(envelope.action || 'issue'),
    project: data.project_name || String(data.project ?? 'rix7'),
    environment:
      (Array.isArray(event.environment) ? event.environment[0] : (event.environment as string)) ||
      'production',
    level: String(issue.level || event.level || 'error'),
    title: String(issue.title || eventMetadata.title || 'Error sin título'),
    culprit: (issue.culprit as string) ?? undefined,
    eventId: typeof event.event_id === 'string' ? event.event_id : undefined,
    datetime: typeof event.datetime === 'string' ? event.datetime : undefined,
    issueUrl: typeof issue.permalink === 'string' ? issue.permalink : undefined,
    firstStackFrame:
      Array.isArray(event.stacktrace) && typeof event.stacktrace[0]?.filename === 'string'
        ? event.stacktrace[0].filename
        : undefined,
  };

  if (!isAlertWorthy(payload)) {
    return NextResponse.json({ success: true, emailed: false, reason: 'level-below-threshold' });
  }

  const to = process.env.SENTRY_ALERT_EMAIL;
  if (!to) {
    // No se finge que se avisó (misma regla que el resto del correo del sitio).
    return NextResponse.json({ success: true, emailed: false, reason: 'recipient-missing', skipped: true });
  }

  const email = buildSentryAlertEmail(payload);
  const result = await sendEmail({ to, subject: email.subject, html: email.html, text: email.text });

  return NextResponse.json({
    success: true,
    emailed: result.sent,
    skipped: result.skipped,
    error: result.error,
    subject: email.subject,
  });
}
