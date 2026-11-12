import { NextResponse } from 'next/server';

import { activateKybByTeam } from '@/lib/kyb/onboarding';
import { SOLICITUD_ID_MAX_LENGTH } from '@/lib/data/solicitudes';
import { requireAdmin } from '@/lib/supabase/auth-guard';

/**
 * `POST /api/admin/solicitudes/[id]/activate` — cerrar el alta desde la ficha.
 *
 * El caso real: la propuesta está aceptada y el plan elegido, pero la empresa
 * nunca terminó de abrir su enlace. El equipo decide cerrarla; queda en
 * `Operando`, con su plan, su ficha de socio y su cuenta de acceso, y recién ahí
 * el panel puede configurar usuarios.
 *
 * La autorización del CCA viaja como una afirmación explícita del equipo: sin
 * `ccaAuthorized: true` el alta se cierra igual, pero el cobro mensual queda sin
 * respaldo registrado y la ficha lo dice.
 *
 * Es **del equipo**: con la sesión del admin, como el resto de las acciones.
 */
const ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const id = params.id?.trim() ?? '';
  if (!id || id.length > SOLICITUD_ID_MAX_LENGTH || !ID_PATTERN.test(id)) {
    return NextResponse.json(
      { success: false, error: 'La solicitud indicada no es válida.' },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => null);

  const result = await activateKybByTeam({
    id,
    plan: body?.plan,
    ccaAuthorized: body?.ccaAuthorized,
  });

  if (!result.ok) {
    const status =
      result.code === 'not_found'
        ? 404
        : result.code === 'conflict' || result.code === 'invalid'
          ? 409
          : 500;
    return NextResponse.json(
      { success: false, error: result.error ?? 'No se pudo cerrar el alta.' },
      { status }
    );
  }

  return NextResponse.json(
    {
      success: true,
      already: result.already ?? false,
      status: result.status,
      plan: result.plan,
      partnerId: result.partnerId ?? null,
      account: result.account ?? null,
      accessLink: result.accessLink ?? null,
      ccaAuthorized: result.ccaAuthorized ?? false,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
