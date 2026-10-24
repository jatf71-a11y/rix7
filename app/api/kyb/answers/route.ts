import { NextRequest, NextResponse } from 'next/server';
import { kybAnswersPostSchema } from '@/lib/api/schemas';
import { validateInput } from '@/lib/api/validate';
import { answerKybQuestions } from '@/lib/kyb/onboarding';
import { clientIpFrom, createRateLimiter } from '@/lib/utils/rateLimit';

/**
 * `/api/kyb/answers` — respuestas de la empresa a «Pendiente_Informacion».
 *
 * Es público porque la empresa no tiene sesión: se identifica con el token del
 * correo, que vale siete días y muere al cambiar de estado. El cupo es holgado:
 * una misma persona puede necesitar corregir una respuesta.
 */
const rateLimiter = createRateLimiter({ max: 30, windowMs: 10 * 60 * 1000 });

/** Token inválido o vencido → 403; respuestas incompletas → 400. */
function statusFor(error: string | undefined): number {
  if (!error) return 400;
  if (/enlace|token|expir/i.test(error)) return 403;
  return 400;
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

  const shape = validateInput(kybAnswersPostSchema, body);
  if (!shape.ok) {
    return NextResponse.json({ success: false, error: shape.error }, { status: 400 });
  }

  const result = await answerKybQuestions(shape.data);
  if (!result.ok) {
    return NextResponse.json(
      { success: false, error: result.error ?? 'No se pudieron registrar las respuestas.' },
      { status: statusFor(result.error) }
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      status: result.status,
      score: result.score ?? null,
      questions: result.questions ?? [],
    },
    email: result.email ?? null,
  });
}
