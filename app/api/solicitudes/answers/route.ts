import { NextRequest, NextResponse } from 'next/server';
import { kybAnswersPostSchema } from '@/lib/api/schemas';
import { validateInput } from '@/lib/api/validate';
import { submitSolicitudAnswers } from '@/lib/data/solicitudAutopilot';
import { clientIpFrom, createRateLimiter } from '@/lib/utils/rateLimit';

/**
 * `/api/solicitudes/answers` — respuestas de un registro de socio.
 *
 * Es público porque quien se registró todavía no tiene cuenta: se identifica con
 * el token del correo, que vale siete días y muere al cambiar de estado. El
 * contrato es el mismo de `/api/kyb/answers` (`token` + `answers`), así que se
 * reusa el esquema en vez de mantener dos formas iguales.
 *
 * Responder no deja la solicitud en un limbo: `submitSolicitudAnswers` vuelve a
 * correr el motor con lo aclarado, mueve el estado y manda el resultado. Si aún
 * falta algo, queda otra ronda con preguntas nuevas y un token fresco.
 */
const rateLimiter = createRateLimiter({ max: 30, windowMs: 10 * 60 * 1000 });

/** El código del autómata se traduce acá: la UI solo necesita el mensaje. */
function statusFor(code: 'invalid' | 'not_found' | 'conflict' | 'store' | undefined): number {
  if (code === 'not_found') return 403;
  if (code === 'conflict') return 409;
  if (code === 'store') return 500;
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

  const result = await submitSolicitudAnswers(shape.data.token, shape.data.answers);
  if (!result.ok) {
    return NextResponse.json(
      { success: false, error: result.error ?? 'No se pudieron registrar las respuestas.' },
      { status: statusFor(result.code) }
    );
  }

  return NextResponse.json(
    {
      success: true,
      data: {
        status: result.status,
        decision: result.evaluation?.decision ?? null,
        score: result.evaluation?.score ?? null,
        questions: result.questions ?? [],
      },
      email: result.email ?? null,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
