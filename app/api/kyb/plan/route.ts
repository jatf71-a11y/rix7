import { NextRequest, NextResponse } from 'next/server';

import { chooseKybPlan } from '@/lib/kyb/onboarding';
import { clientIpFrom, createRateLimiter } from '@/lib/utils/rateLimit';

/**
 * `/api/kyb/plan` — la empresa elige plan desde el correo de calificación.
 *
 * Público con el token del enlace, como el resto del alta: el token es la
 * credencial. Elegir arma la propuesta comercial con el precio de ese plan en
 * **Planes** y responde con el token de la propuesta, para que la pantalla abra
 * directamente la aceptación.
 *
 * El límite por IP es el mismo criterio que en `/api/kyb/proposal`: adivinar un
 * token tiene que costar algo.
 */
const rateLimiter = createRateLimiter({ max: 30, windowMs: 10 * 60 * 1000 });

export async function POST(request: NextRequest) {
  if (rateLimiter.isLimited(clientIpFrom(request.headers))) {
    return NextResponse.json(
      { success: false, error: 'Demasiadas solicitudes' },
      { status: 429, headers: { 'Retry-After': '600' } }
    );
  }

  let body: { token?: unknown; plan?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ success: false, error: 'Cuerpo inválido' }, { status: 400 });
  }

  const result = await chooseKybPlan({ token: body.token, plan: body.plan });

  if (!result.ok || !result.proposalToken) {
    return NextResponse.json(
      { success: false, error: result.error ?? 'No se pudo guardar la elección.' },
      { status: 403 }
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      plan: result.plan ?? null,
      status: result.status ?? null,
      proposal: result.proposal ?? null,
      redirect: `/empresas/propuesta?token=${encodeURIComponent(result.proposalToken)}`,
    },
    email: result.email ?? null,
  });
}
