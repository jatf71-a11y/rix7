import { NextResponse } from 'next/server';

import { resetTeamMfa } from '@/lib/data/adminMfa';
import { requireAdmin } from '@/lib/supabase/auth-guard';

/**
 * `POST /api/admin/team/mfa-reset` — otro admin le quita el segundo factor a una
 * cuenta del equipo.
 *
 * Es el camino acompañado, para cuando la persona ya no tiene ninguno de sus
 * códigos. Exige una sesión de admin **verificada** (`aal2`): no se puede usar
 * para saltarse el segundo factor desde una sesión que no lo pasó.
 *
 * Deja el registro en `admin_events` (`team_mfa.reset`) y avisa a la cuenta
 * afectada por correo, para que se entere de que alguien tocó su seguridad.
 */

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim() : '';

  const result = await resetTeamMfa({ email, actor: { id: guard.userId, email: guard.email } });

  if (!result.ok) {
    const status =
      result.code === 'not_found'
        ? 404
        : result.code === 'invalid' || result.code === 'no_factors'
          ? 400
          : result.code === 'not_configured'
            ? 503
            : 500;
    return NextResponse.json(
      { success: false, error: result.error ?? 'No se pudo quitar el segundo factor.', audit: result.audit },
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
