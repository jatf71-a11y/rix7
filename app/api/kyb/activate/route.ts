import { NextRequest, NextResponse } from 'next/server';
import { kybActivatePostSchema } from '@/lib/api/schemas';
import { validateInput } from '@/lib/api/validate';
import { activateKybPlan } from '@/lib/kyb/onboarding';
import { clientIpFrom, createRateLimiter } from '@/lib/utils/rateLimit';

/**
 * `/api/kyb/activate` — elige plan y habilita el panel de publicaciones.
 *
 * Es público (token del correo, sin sesión) e idempotente: repetir la petición
 * no duplica la ficha ni la cuenta. Solo funciona en `En_Alta` con el token de
 * activación vigente; el token se consume en la primera activación.
 *
 * Un fallo al crear la cuenta o la ficha responde 502: la solicitud sigue en
 * `En_Alta` y se puede reintentar, pero no se dice «listo» si no lo está.
 */
const rateLimiter = createRateLimiter({ max: 20, windowMs: 10 * 60 * 1000 });

function statusFor(error: string | undefined): number {
  if (!error) return 400;
  if (/enlace|token|expir/i.test(error)) return 403;
  if (/plan/i.test(error)) return 400;
  return 502;
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

  const shape = validateInput(kybActivatePostSchema, body);
  if (!shape.ok) {
    return NextResponse.json({ success: false, error: shape.error }, { status: 400 });
  }

  const result = await activateKybPlan(shape.data);
  if (!result.ok) {
    return NextResponse.json(
      { success: false, error: result.error ?? 'No se pudo habilitar el panel.' },
      { status: statusFor(result.error) }
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      status: result.status,
      plan: result.plan,
      already: result.already ?? false,
      panel: result.panel ?? { enabled: true },
    },
    email: result.email ?? null,
  });
}
