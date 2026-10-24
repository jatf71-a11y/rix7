import { NextRequest, NextResponse } from 'next/server';
import { kybAccessPostSchema } from '@/lib/api/schemas';
import { validateInput } from '@/lib/api/validate';
import { kybStatusByToken } from '@/lib/kyb/onboarding';
import { clientIpFrom, createRateLimiter } from '@/lib/utils/rateLimit';

/**
 * `/api/kyb/access` — estado de la solicitud con el token del correo.
 *
 * Devuelve solo lo que la empresa necesita ver: su estado, las preguntas
 * abiertas y, cuando corresponde, que ya puede elegir plan. Nada del puntaje ni
 * de las verificaciones internas: eso es del equipo.
 */
const rateLimiter = createRateLimiter({ max: 30, windowMs: 10 * 60 * 1000 });

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

  const shape = validateInput(kybAccessPostSchema, body);
  if (!shape.ok) {
    return NextResponse.json({ success: false, error: shape.error }, { status: 400 });
  }

  const result = await kybStatusByToken(shape.data.token);
  if (!result.ok) {
    return NextResponse.json(
      { success: false, error: result.error ?? 'El enlace no es válido.' },
      { status: 403 }
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      status: result.status,
      legalName: result.legalName,
      questions: result.questions ?? [],
      plan: result.plan ?? null,
      panelEnabled: result.panelEnabled ?? false,
      // Solo con la solicitud aceptada y el panel aún sin habilitar.
      canChoosePlan: result.status === 'En_Alta' && !result.panelEnabled,
    },
  });
}
