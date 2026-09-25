import { NextRequest, NextResponse } from 'next/server';
import { currentUserId } from '@/lib/supabase/currentUser';
import { normalizePropertyId, normalizePropertyIds } from '@/lib/data/favorites';
import { addFavorites, listFavoriteIds, removeFavorite } from '@/lib/data/favoritesStore';

/**
 * `/api/favorites` — favoritos de la persona que está usando el portal.
 *
 * Los favoritos vivían en `localStorage`, así que se quedaban en el dispositivo.
 * Acá viven en la cuenta y siguen a la persona entre dispositivos.
 *
 * Cada quien ve solo los suyos: la pertenencia la impone RLS
 * (`auth.uid() = user_id`) y, además, se filtra por el id de la sesión — el
 * `userId` que venga en el cuerpo se ignora.
 *
 * Todas las respuestas devuelven la **lista completa resultante** para que el
 * cliente no tenga que adivinar el estado: si la base rechazó algo, la UI lo
 * refleja igual.
 */

const NO_SESSION = {
  success: false,
  error: 'Inicia sesión para guardar tus favoritos en tu cuenta.',
};

/** Sin cachear: es por usuario y cambia con cada corazón. */
const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };

// GET /api/favorites — mis favoritos (ids)
export async function GET() {
  const userId = await currentUserId();
  if (!userId) {
    // 200 con lista vacía sería mentir: no es "no tiene favoritos", es "no hay
    // sesión". El cliente necesita distinguirlos para saber si migrar lo local.
    return NextResponse.json(NO_SESSION, { status: 401, headers: NO_STORE });
  }

  const ids = await listFavoriteIds(userId);
  return NextResponse.json({ success: true, data: ids }, { headers: NO_STORE });
}

/**
 * POST /api/favorites — guarda un favorito o importa varios.
 *
 * `{ propertyId: "scl-depto-marco-polo" }` para el corazón de una ficha.
 * `{ propertyIds: [...] }` para subir los que había en el dispositivo.
 */
export async function POST(request: NextRequest) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json(NO_SESSION, { status: 401, headers: NO_STORE });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Cuerpo inválido' },
      { status: 400, headers: NO_STORE }
    );
  }

  const raw = body as { propertyId?: unknown; propertyIds?: unknown };
  const ids = normalizePropertyIds(
    raw?.propertyIds ?? (raw?.propertyId === undefined ? [] : [raw.propertyId])
  );

  if (ids.length === 0) {
    return NextResponse.json(
      { success: false, error: 'Falta el id de la propiedad.' },
      { status: 400, headers: NO_STORE }
    );
  }

  const result = await addFavorites(userId, ids);

  if (!result.ok) {
    return NextResponse.json(
      { success: false, error: result.error },
      { status: result.unconfigured ? 503 : 500, headers: NO_STORE }
    );
  }

  return NextResponse.json(
    { success: true, data: result.ids ?? [], added: ids.length },
    { status: 201, headers: NO_STORE }
  );
}

// DELETE /api/favorites?propertyId=xxx — quita uno
export async function DELETE(request: NextRequest) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json(NO_SESSION, { status: 401, headers: NO_STORE });

  const propertyId = normalizePropertyId(request.nextUrl.searchParams.get('propertyId'));
  if (!propertyId) {
    return NextResponse.json(
      { success: false, error: 'Falta el id de la propiedad.' },
      { status: 400, headers: NO_STORE }
    );
  }

  const result = await removeFavorite(userId, propertyId);

  if (!result.ok) {
    return NextResponse.json(
      { success: false, error: result.error },
      { status: result.unconfigured ? 503 : 500, headers: NO_STORE }
    );
  }

  return NextResponse.json({ success: true, data: result.ids ?? [] }, { headers: NO_STORE });
}
