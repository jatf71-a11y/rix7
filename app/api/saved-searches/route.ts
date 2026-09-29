import { NextRequest, NextResponse } from 'next/server';
import { currentUserId } from '@/lib/supabase/currentUser';
import { normalizeSavedSearchFilters } from '@/lib/data/savedSearches';
import { savedSearchDeleteSchema } from '@/lib/api/schemas';
import { searchParamsToObject, validateInput } from '@/lib/api/validate';
import { clientIpFrom, createRateLimiter } from '@/lib/utils/rateLimit';
import {
  createSavedSearch,
  deleteSavedSearch,
  listSavedSearches,
} from '@/lib/data/savedSearchesStore';

/**
 * `/api/saved-searches` — búsquedas guardadas de la persona que está usando el
 * portal.
 *
 * Es distinto de `/api/admin/*`: acá **no** hace falta ser admin, solo estar
 * identificado, y cada quien ve únicamente las suyas. La pertenencia la impone
 * RLS (`auth.uid() = user_id`) y, además, se filtra por `user_id` en la consulta.
 */

const NO_SESSION = {
  success: false,
  error: 'Inicia sesión para guardar búsquedas y recibir avisos.',
};

/**
 * Rate limit por IP. Como en favoritos: la sesión se resuelve contra Supabase
 * antes de tocar datos, así que frenar la ráfaga primero también protege la
 * verificación de sesión. El cupo da de sobra para el uso real del portal.
 */
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

const rateLimiter = createRateLimiter({ max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS });

/** Respuesta 429 compartida por los tres métodos. */
const TOO_MANY_REQUESTS = {
  body: { success: false, error: 'Demasiadas solicitudes. Intenta de nuevo en un minuto.' },
  init: { status: 429, headers: { 'Retry-After': '60' } },
} as const;

// GET /api/saved-searches — las búsquedas propias
export async function GET(request: NextRequest) {
  if (rateLimiter.isLimited(clientIpFrom(request.headers))) {
    return NextResponse.json(TOO_MANY_REQUESTS.body, TOO_MANY_REQUESTS.init);
  }

  const userId = await currentUserId();
  if (!userId) return NextResponse.json(NO_SESSION, { status: 401 });

  const searches = await listSavedSearches(userId);
  return NextResponse.json({ success: true, data: searches });
}

// POST /api/saved-searches — guardar la búsqueda actual
export async function POST(request: NextRequest) {
  if (rateLimiter.isLimited(clientIpFrom(request.headers))) {
    return NextResponse.json(TOO_MANY_REQUESTS.body, TOO_MANY_REQUESTS.init);
  }

  const userId = await currentUserId();
  if (!userId) return NextResponse.json(NO_SESSION, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Cuerpo inválido' }, { status: 400 });
  }

  const validation = normalizeSavedSearchFilters(body);
  if (!validation.ok) {
    return NextResponse.json({ success: false, error: validation.error }, { status: 400 });
  }

  const result = await createSavedSearch(userId, validation.filters);

  if (!result.ok) {
    return NextResponse.json(
      { success: false, error: result.error },
      { status: result.unconfigured ? 503 : 500 }
    );
  }

  return NextResponse.json({ success: true, data: result.search }, { status: 201 });
}

// DELETE /api/saved-searches?id=xxx — borrar una propia
export async function DELETE(request: NextRequest) {
  if (rateLimiter.isLimited(clientIpFrom(request.headers))) {
    return NextResponse.json(TOO_MANY_REQUESTS.body, TOO_MANY_REQUESTS.init);
  }

  const userId = await currentUserId();
  if (!userId) return NextResponse.json(NO_SESSION, { status: 401 });

  const validation = validateInput(
    savedSearchDeleteSchema,
    searchParamsToObject(new URL(request.url).searchParams)
  );
  if (!validation.ok) {
    return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });
  }

  const id = validation.data.id;

  const result = await deleteSavedSearch(id, userId);

  if (!result.ok) {
    const notFound = result.error === 'Búsqueda no encontrada.';
    return NextResponse.json(
      { success: false, error: result.error },
      { status: result.unconfigured ? 503 : notFound ? 404 : 500 }
    );
  }

  return NextResponse.json({ success: true });
}
