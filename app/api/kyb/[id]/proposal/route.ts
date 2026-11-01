import { NextRequest, NextResponse } from 'next/server';

import { sendKybProposal } from '@/lib/kyb/onboarding';
import { requireAdmin } from '@/lib/supabase/auth-guard';

/**
 * `/api/kyb/[id]/proposal` — enviar la propuesta comercial.
 *
 * Solo para una solicitud `Calificado`: es el paso que convierte «pasó la
 * verificación» en «tiene números en la mano». Manda el correo con el enlace de
 * un solo uso y deja la solicitud en `Propuesta_Comercial`.
 *
 * Los montos llegan del panel porque el equipo puede negociarlos; si no vienen,
 * se usan los del perfil que definió Planes. Quién envía sale de la sesión, nunca
 * del cuerpo.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: 'Cuerpo inválido' }, { status: 400 });
  }

  const result = await sendKybProposal({
    id: params.id,
    plan: body.plan,
    altaClp: body.altaClp,
    monthlyClp: body.monthlyClp,
    note: body.note,
  });

  if (!result.ok) {
    const status =
      result.code === 'not_found'
        ? 404
        : result.code === 'conflict'
          ? 409
          : result.code === 'invalid'
            ? 400
            : 500;

    return NextResponse.json({ success: false, error: result.error }, { status });
  }

  return NextResponse.json({
    success: true,
    data: { status: result.status, proposal: result.proposal ?? null },
    email: result.email ?? null,
  });
}
