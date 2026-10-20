import { NextRequest, NextResponse } from 'next/server';
import { createShareEvent } from '@/lib/data/shareEventsStore';
import { normalizeShareEvent } from '@/lib/data/shareEvents';
import { clientIpFrom, createRateLimiter } from '@/lib/utils/rateLimit';
import { shareEventPostSchema } from '@/lib/api/schemas';
import { validateInput } from '@/lib/api/validate';

/**
 * `POST /api/share/event` — un compartido de una propiedad, con identidad.
 *
 * Es la contraparte de los botones de WhatsApp / copiar / compartir de la ficha
 * y de la landing. La acción del visitante no espera esta respuesta: el cliente
 * la manda con `keepalive` y sigue con lo que estaba haciendo. Pero el registro
 * **sí importa** (es lo que permite saber qué enlace movió cada corredora y con
 * qué resultado), así que si la base no lo guardó la ruta lo dice y el cliente
 * lo reporta al monitoreo.
 *
 * Es pública porque el registro del visitante vive en su dispositivo, no en una
 * sesión de Auth. La política RLS de `share_events` vuelve a validar la forma
 * del dato; el rate limit frena las ráfagas.
 */

/**
 * Una persona puede compartir varias propiedades seguidas sin abusar. La ventana
 * es la misma de `/api/share/view` para que el límite sea uno solo de memoria.
 */
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

const rateLimiter = createRateLimiter({ max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS });

export async function POST(request: NextRequest) {
  if (rateLimiter.isLimited(clientIpFrom(request.headers))) {
    return NextResponse.json(
      { success: false, error: 'Demasiados compartidos seguidos.' },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Cuerpo inválido.' }, { status: 400 });
  }

  // Primero la forma (Zod): debe ser un objeto con campos conocidos.
  const shape = validateInput(shareEventPostSchema, body);
  if (!shape.ok) {
    return NextResponse.json({ success: false, error: shape.error }, { status: 400 });
  }

  // Después la semántica de dominio: identidad, canal, origen y largos.
  const validation = normalizeShareEvent(body);
  if (!validation.ok) {
    return NextResponse.json({ success: false, error: validation.error }, { status: 400 });
  }

  const result = await createShareEvent(validation.event);

  if (!result.ok) {
    // Perder un compartido no rompe la página, pero no puede quedar en silencio:
    // el equipo usa este registro para atribuir los enlaces.
    return NextResponse.json(
      { success: false, error: 'No se pudo registrar el compartido', persisted: result.persisted },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, persisted: result.persisted }, { status: 201 });
}
