import { NextResponse } from 'next/server';

import { resetPartnerMfa } from '@/lib/data/partnerMfa';
import { requireAdmin } from '@/lib/supabase/auth-guard';

/**
 * `POST /api/admin/partners/mfa-reset` — quitar la verificación en dos pasos de
 * una cuenta de socio que perdió su aplicación de códigos.
 *
 * Es **del equipo** y deja a la persona sin segundo factor: la próxima vez que
 * entre, el panel le vuelve a ofrecer activarlo. El correo tiene que pertenecer
 * al socio indicado; si no, se rechaza.
 */

const PARTNER_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const partnerId = typeof body?.partnerId === 'string' ? body.partnerId.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim() : '';

  if (!partnerId || partnerId.length > 120 || !PARTNER_ID_PATTERN.test(partnerId)) {
    return NextResponse.json(
      { success: false, error: 'El socio indicado no es válido.' },
      { status: 400 }
    );
  }

  // El actor sale de la sesión, nunca del cuerpo: es lo que queda en el registro.
  const result = await resetPartnerMfa({
    partnerId,
    email,
    actor: { id: guard.userId, email: guard.email },
  });

  if (!result.ok) {
    const status =
      result.code === 'not_found'
        ? 404
        : result.code === 'invalid' || result.code === 'forbidden'
          ? 400
          : result.code === 'not_configured'
            ? 503
            : 500;
    return NextResponse.json(
      { success: false, error: result.error ?? 'No se pudo quitar el segundo factor.' },
      { status }
    );
  }

  return NextResponse.json(
    {
      success: true,
      removed: result.removed ?? 0,
      email: result.email,
      notified: result.notified ?? null,
      audit: result.audit ?? null,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
