import { NextResponse } from 'next/server';

import { readPartnerAccount } from '@/lib/data/partnerAccount';
import { requireMember } from '@/lib/supabase/auth-guard';

/**
 * `/api/partner/account` — la suscripción del socio que tiene la sesión.
 *
 * El `partnerId` lo resuelve el guard desde la sesión, no la URL: una cuenta no
 * puede leer la suscripción de otra cambiando un id. Es solo lectura; el plan no
 * se cambia desde acá, porque cambiarlo mueve la facturación.
 */

/** Datos de una cuenta: ningún caché intermedio debe guardarlos. */
const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

// GET /api/partner/account — plan, montos, usuarios y fechas del alta
export async function GET() {
  const guard = await requireMember();
  if (!guard.ok) return guard.response;

  const account = await readPartnerAccount(guard.partnerId);

  if (!account) {
    return NextResponse.json(
      {
        success: false,
        error: 'Todavía no hay una suscripción asociada a tu cuenta. Escríbenos si ya pagaste el alta.',
      },
      { status: 404, ...NO_STORE }
    );
  }

  return NextResponse.json({ success: true, data: account }, NO_STORE);
}
