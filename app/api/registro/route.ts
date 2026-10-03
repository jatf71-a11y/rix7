import { NextRequest, NextResponse } from 'next/server';
import { normalizeSignup } from '@/lib/utils/consents';
import { createSignup, listSignups } from '@/lib/data/signupsStore';
import { buildWelcomeEmail } from '@/lib/email/welcomeEmail';
import { isEmailConfigured, sendEmail } from '@/lib/email/sendEmail';
import { signupPostSchema } from '@/lib/api/schemas';
import { validateInput } from '@/lib/api/validate';
import { requireAdmin } from '@/lib/supabase/auth-guard';
import { clientIpFrom, createRateLimiter } from '@/lib/utils/rateLimit';
import { SITE_URL } from '@/lib/site';

/**
 * `/api/registro` — alta de una visita en el portal.
 *
 * POST es **público**: quien se registra todavía no tiene cuenta, es justamente
 * él quien deja sus datos. Se protege con rate limit por IP y validando el cuerpo,
 * y la identidad que habilita el formulario de contacto se guarda **en el
 * dispositivo** (localStorage), no acá: este endpoint existe para dos cosas que
 * sí tienen que pasar en el servidor —dejar constancia del consentimiento y
 * mandar el correo de bienvenida—, no para devolver una sesión.
 *
 * GET es **del equipo**: los registros guardan quién autorizó qué, así que son
 * datos personales y nunca públicos.
 *
 * Ninguna de las dos cosas del servidor finge haber ocurrido: si falta
 * `RESEND_API_KEY`, la respuesta lo dice (`email.skipped`); si el alta no se pudo
 * guardar, también (`stored.saved`). El modal no promete lo que no pasó.
 */

/**
 * Una persona se registra una vez. El cupo es holgado para quien se equivoca en
 * un dato y reintenta, pero corta un script que llene la bandeja.
 */
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutos

const rateLimiter = createRateLimiter({ max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS });

// GET /api/registro — listado para el panel (solo admin)
export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { signups, source, persistent } = await listSignups();

  return NextResponse.json({ success: true, data: signups, source, persistent });
}

export async function POST(request: NextRequest) {
  if (rateLimiter.isLimited(clientIpFrom(request.headers))) {
    return NextResponse.json(
      { success: false, error: 'Demasiadas solicitudes' },
      { status: 429, headers: { 'Retry-After': '600' } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Cuerpo inválido' }, { status: 400 });
  }

  // Primero la forma (Zod): debe ser un objeto con los campos esperados.
  const shape = validateInput(signupPostSchema, body);
  if (!shape.ok) {
    return NextResponse.json({ success: false, error: shape.error }, { status: 400 });
  }

  // Después la semántica de dominio: largos, correo y autorizaciones obligatorias.
  const validation = normalizeSignup(body);
  if (!validation.ok) {
    return NextResponse.json({ success: false, error: validation.error }, { status: 400 });
  }

  const { signup } = validation;

  /**
   * La constancia de consentimiento va a `public.signups` **antes** que el
   * correo: es lo único que no se puede recuperar después (el correo se puede
   * reenviar; una autorización que nadie guardó, no).
   */
  const stored = await createSignup(signup);

  /**
   * Rastro en el log, además de la fila: deja el «qué pasó» en el mismo lugar
   * donde se leen los fallos, con los cuatro valores —no solo los que quedaron
   * en true— y con el resultado del guardado.
   */
  console.info(
    '[registro] alta',
    JSON.stringify({
      email: signup.email,
      at: new Date().toISOString(),
      consents: signup.consents,
      stored: stored.ok,
      persistent: stored.persisted,
      emailConfigured: isEmailConfigured(),
    })
  );

  if (!stored.ok) {
    // Perder una constancia de consentimiento es peor que no mandar un correo:
    // se dice en el log y viaja en la respuesta para que el modal lo avise.
    console.error('[registro] no se pudo guardar el alta:', stored.error);
  }

  const welcome = buildWelcomeEmail({
    name: signup.name,
    siteUrl: SITE_URL,
    marketing: signup.consents.marketing,
  });

  const result = await sendEmail({
    to: signup.email,
    subject: welcome.subject,
    html: welcome.html,
    text: welcome.text,
  });

  if (!result.sent && !result.skipped) {
    console.error('[registro] no se pudo enviar la bienvenida:', result.error);
  }

  return NextResponse.json(
    {
      success: true,
      // `outboxId` solo aparece en local con DEV_EMAIL_OUTBOX=1: es la llave
      // para abrir el correo en /api/dev/outbox?...&format=html.
      email: { sent: result.sent, skipped: result.skipped, outboxId: result.outboxId ?? null },
      // `persistent:false` = desarrollo sin Supabase, el alta se pierde al
      // reiniciar; `saved:false` = no se guardó, aunque el correo haya salido.
      stored: { saved: stored.ok, persistent: stored.persisted },
    },
    { status: 201 }
  );
}
