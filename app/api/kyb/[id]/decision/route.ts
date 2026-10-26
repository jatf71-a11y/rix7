import { NextRequest, NextResponse } from 'next/server';
import { kybDecisionPostSchema } from '@/lib/api/schemas';
import { validateInput } from '@/lib/api/validate';
import { decideApplication } from '@/lib/kyb/onboarding';
import { requireAdmin } from '@/lib/supabase/auth-guard';

/**
 * `/api/kyb/[id]/decision` — la decisión del equipo sobre una solicitud.
 *
 * Aprobar, pedir información o rechazar. Es la puerta que faltaba: hasta ahora
 * el panel solo podía pedirle otra corrida al motor, así que un caso que el
 * motor no resolvía bien no tenía salida humana.
 *
 * Quién decide sale de la sesión (`requireAdmin`), nunca del cuerpo: si el
 * cliente pudiera mandar el autor, el registro de la decisión no valdría nada.
 * Sin Supabase configurado el autor es `dev`, que es el mismo bypass con el que
 * se prueba el panel en local.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Cuerpo inválido' }, { status: 400 });
  }

  const shape = validateInput(kybDecisionPostSchema, body);
  if (!shape.ok) {
    return NextResponse.json({ success: false, error: shape.error }, { status: 400 });
  }

  const result = await decideApplication({
    id: params.id,
    decision: shape.data.decision,
    note: shape.data.note,
    questions: shape.data.questions,
    decidedBy: guard.email ?? guard.userId ?? (guard.devBypass ? 'dev' : 'equipo'),
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
    data: {
      id: result.application?.id ?? params.id,
      status: result.status ?? result.application?.status ?? null,
      questions: result.questions ?? [],
      decidedBy: guard.email ?? guard.userId ?? 'dev',
    },
    email: result.email ?? null,
    // El historial puede fallar sin deshacer la decisión; si pasó, se dice.
    ...(result.error ? { warning: result.error } : {}),
  });
}
