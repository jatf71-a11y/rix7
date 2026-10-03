import { NextRequest, NextResponse } from 'next/server';
import { getPropertyViews, recordPropertyView } from '@/lib/data/propertyViewsStore';
import { propertyIdParamsSchema, propertyViewSchema } from '@/lib/api/schemas';
import { validateInput } from '@/lib/api/validate';
import { clientIpFrom, createRateLimiter } from '@/lib/utils/rateLimit';

/**
 * `POST /api/properties/[id]/view` — visitas de una ficha.
 *
 * La ficha se sirve cacheada (ISR) y no podría contar nada sin volverse
 * dinámica, así que el navegador avisa en segundo plano al montar. El mismo
 * endpoint devuelve el total, para que el velocímetro muestre el número al día
 * sin una segunda consulta.
 *
 * Cuenta **aperturas**, no personas: no se guarda IP, ni user agent, ni ningún
 * identificador. El rate limit por IP frena a un script que quiera inflar una
 * propiedad; a la vista no la bloquea nunca.
 *
 * Las dos ramas responden `persisted`: `false` significa que el total salió del
 * respaldo en memoria (desarrollo sin Supabase) y se perderá al reiniciar. Quien
 * pinta el número necesita saberlo para no presentar un conteo de prueba como si
 * fuera real; el velocímetro de la ficha (`PropertyGauges`) lo advierte en
 * pequeño cuando llega en `false`.
 */

const RATE_LIMIT_MAX = 120;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

const rateLimiter = createRateLimiter({ max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS });

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const paramsValidation = validateInput(propertyIdParamsSchema, params);
  if (!paramsValidation.ok) {
    return NextResponse.json({ success: false, error: 'Falta el ID de la propiedad' }, { status: 400 });
  }
  const propertyId = paramsValidation.data.id;

  // El cuerpo es opcional: sin `counted` se asume que es una visita nueva.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const validation = validateInput(propertyViewSchema, body ?? {});
  if (!validation.ok) {
    return NextResponse.json({ success: false, error: validation.error }, { status: 400 });
  }

  // Si la IP se pasó del cupo, se deja de contar pero se responde el total: el
  // velocímetro sigue mostrando un número en vez de un error.
  const limited = rateLimiter.isLimited(clientIpFrom(request.headers));
  const counted = validation.data.counted && !limited;

  if (!counted) {
    const { views, persisted } = await getPropertyViews(propertyId);
    return NextResponse.json({ success: true, views, counted: false, persisted }, { status: 200 });
  }

  const result = await recordPropertyView(propertyId);
  return NextResponse.json(
    { success: true, views: result.views, counted: true, persisted: result.persisted },
    { status: 202 }
  );
}
