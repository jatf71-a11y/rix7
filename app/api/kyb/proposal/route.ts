import { NextRequest, NextResponse } from 'next/server';

import { decideKybProposal } from '@/lib/kyb/onboarding';
import { clientIpFrom, createRateLimiter } from '@/lib/utils/rateLimit';

/**
 * `/api/kyb/proposal` — el candidato acepta o rechaza la propuesta.
 *
 * Público con el token del correo, como el resto del alta: el enlace es la
 * credencial. El límite por IP es el mismo criterio que en `/api/kyb/answers`
 * —un token inventado no cuesta nada, pero adivinarlo tiene que costar—.
 *
 * La decisión no habilita nada por sí sola: aceptar deja la solicitud en `Alta` y
 * emite el token para elegir plan; el panel y el estado `Operando` siguen
 * dependiendo de la activación y del pago.
 *
 * El cuerpo lleva, además del `decision`, lo que el candidato definió al aceptar:
 * `ccaAccepted` (está de acuerdo con el costo del CCA), `ccaUf` (su CCA estimado)
 * y `captacion` (si contrata el plan de captación de leads).
 */
const rateLimiter = createRateLimiter({ max: 30, windowMs: 10 * 60 * 1000 });

export async function POST(request: NextRequest) {
  if (rateLimiter.isLimited(clientIpFrom(request.headers))) {
    return NextResponse.json(
      { success: false, error: 'Demasiadas solicitudes' },
      { status: 429, headers: { 'Retry-After': '600' } }
    );
  }

  let body: {
    token?: unknown;
    decision?: unknown;
    ccaAccepted?: unknown;
    ccaUf?: unknown;
    captacion?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ success: false, error: 'Cuerpo inválido' }, { status: 400 });
  }

  const result = await decideKybProposal({
    token: body.token,
    decision: body.decision,
    // Las dos decisiones que acompañan al «de acuerdo»: CCA estimado y captación.
    ccaAccepted: body.ccaAccepted,
    ccaUf: body.ccaUf,
    captacion: body.captacion,
  });

  if (!result.ok) {
    return NextResponse.json(
      { success: false, error: result.error ?? 'No se pudo registrar la respuesta.' },
      { status: 403 }
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      status: result.status ?? null,
      decision: result.decision ?? null,
      already: result.already === true,
    },
    email: result.email ?? null,
  });
}
