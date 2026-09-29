import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/supabase/auth-guard';
import { getPartnerFeedState, setPartnerFeedEnabled } from '@/lib/feeds/feedStore';
import { partnerFeedPostSchema, partnerFeedQuerySchema } from '@/lib/api/schemas';
import { searchParamsToObject, validateInput } from '@/lib/api/validate';
import { SITE_URL } from '@/lib/site';

/**
 * `/api/admin/partners/feed` — feed XML de una corredora (hallazgo #14).
 *
 * El estado y la activación viven acá, detrás de `requireAdmin`. La URL
 * pública que consume el agregador es `/feeds/<slug>.xml?token=…` y no pasa
 * por esta ruta.
 *
 * El token en claro **solo** se devuelve en el POST que lo genera: la base
 * guarda el hash SHA-256, así que después de cerrar este diálogo nadie —ni el
 * panel— puede volver a leerlo. Regenerarlo emite uno nuevo e invalida el
 * anterior (la URL antigua deja de responder).
 */

export const dynamic = 'force-dynamic';

/** POST: habilitar/deshabilitar, opcionalmente rotando el token. */
export async function POST(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Cuerpo inválido.' }, { status: 400 });
  }

  const validation = validateInput(partnerFeedPostSchema, body);
  if (!validation.ok) {
    return NextResponse.json({ success: false, error: validation.error }, { status: 400 });
  }

  const { id, enabled, rotate } = validation.data;
  const result = await setPartnerFeedEnabled(id, enabled, { rotate, siteUrl: SITE_URL });

  if (!result.ok) {
    return NextResponse.json(
      { success: false, error: result.error, persisted: result.persisted },
      { status: result.reason === 'not_found' ? 404 : 500 }
    );
  }

  return NextResponse.json({
    success: true,
    persisted: result.persisted,
    feedEnabled: result.feedEnabled,
    // Única vez que el token viaja. Si enabled=false, no hay token.
    token: result.token,
    feedUrl: result.feedUrl,
  });
}

/** GET: estado del feed de una corredora (sin secretos). */
export async function GET(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const validation = validateInput(
    partnerFeedQuerySchema,
    searchParamsToObject(request.nextUrl.searchParams)
  );
  if (!validation.ok) {
    return NextResponse.json({ success: false, error: validation.error }, { status: 400 });
  }

  const state = await getPartnerFeedState(validation.data.id);
  if (!state) {
    return NextResponse.json(
      { success: false, error: 'Corredora no encontrada o sin Supabase configurado.' },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    feed: {
      ...state,
      feedUrl: `${SITE_URL}/feeds/${state.slug}.xml`,
      // Solo dice si hay token, nunca su valor.
      hasToken: state.hasToken,
    },
  });
}
