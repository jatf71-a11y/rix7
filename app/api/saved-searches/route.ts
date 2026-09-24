import { NextRequest, NextResponse } from 'next/server';
import { currentUserId } from '@/lib/supabase/currentUser';
import { normalizeSavedSearchFilters } from '@/lib/data/savedSearches';
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

// GET /api/saved-searches — las búsquedas propias
export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json(NO_SESSION, { status: 401 });

  const searches = await listSavedSearches(userId);
  return NextResponse.json({ success: true, data: searches });
}

// POST /api/saved-searches — guardar la búsqueda actual
export async function POST(request: NextRequest) {
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
  const userId = await currentUserId();
  if (!userId) return NextResponse.json(NO_SESSION, { status: 401 });

  const id = request.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });
  }

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
