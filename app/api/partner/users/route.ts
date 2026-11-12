import { NextResponse, type NextRequest } from 'next/server';

import {
  invitePartnerUser,
  readPartnerUsers,
  updatePartnerUser,
} from '@/lib/data/partnerUsers';
import { requireMember } from '@/lib/supabase/auth-guard';

/**
 * `/api/partner/users` — los usuarios de la cuenta del socio.
 *
 * El `partnerId` lo resuelve el guard desde la sesión: acá no se acepta un id
 * por URL, porque una empresa no puede invitar gente a la cuenta de otra. El
 * tope lo aplica `invitePartnerUser` contra el plan vigente, no la pantalla: la
 * pantalla deshabilita el botón cuando no hay lugar, pero la regla vive en el
 * servidor.
 *
 * Es una cuenta con datos personales de terceros (correos del equipo del socio),
 * así que ninguna respuesta se cachea.
 */

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

// GET /api/partner/users — lista, cupo del plan y titular
export async function GET() {
  const guard = await requireMember();
  if (!guard.ok) return guard.response;

  const data = await readPartnerUsers(guard.partnerId);
  return NextResponse.json({ success: true, data }, NO_STORE);
}

// POST /api/partner/users — invitar a una persona (fila + cuenta + correo)
export async function POST(request: NextRequest) {
  const guard = await requireMember();
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => null)) as
    | { email?: unknown; role?: unknown }
    | null;

  const result = await invitePartnerUser({
    partnerId: guard.partnerId,
    email: body?.email,
    role: body?.role,
    invitedBy: guard.userId,
  });

  if (!result.ok) {
    return NextResponse.json(
      { success: false, error: result.error },
      { status: result.status, ...NO_STORE }
    );
  }

  return NextResponse.json({ success: true, data: result.user, email: result.email }, NO_STORE);
}

// PATCH /api/partner/users — cambiar rol, revocar o reactivar
export async function PATCH(request: NextRequest) {
  const guard = await requireMember();
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => null)) as
    | { id?: unknown; action?: unknown; role?: unknown }
    | null;

  const result = await updatePartnerUser({
    partnerId: guard.partnerId,
    id: body?.id,
    action: body?.action,
    role: body?.role,
  });

  if (!result.ok) {
    return NextResponse.json(
      { success: false, error: result.error },
      { status: result.status, ...NO_STORE }
    );
  }

  return NextResponse.json({ success: true, data: result.user }, NO_STORE);
}
