import { NextRequest, NextResponse } from 'next/server';
import { getPropertyById } from '@/lib/data/propertyDetail';

// El detalle de una ficha cambia poco entre visitas: se sirve desde el CDN y el
// navegador revalida siempre (`max-age=0`). TTL corto por si la propiedad se
// edita o publica en caliente (Supabase); con `stale-while-revalidate` la
// revalidación nunca la espera el visitante.
const PROPERTY_CACHE = {
  headers: {
    'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=86400',
  },
};

// ═══ GET /api/properties/[id] — Detalle de una propiedad ═══
// 1. Intenta Supabase (RPC get_property_by_id) si está configurado.
// 2. Fallback: catálogo nacional en memoria.
// 3. 404 si no existe en ninguna fuente.
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  if (!id) {
    return NextResponse.json(
      { success: false, error: 'Falta el ID de la propiedad' },
      { status: 400 }
    );
  }

  const result = await getPropertyById(id);
  if (!result) {
    return NextResponse.json(
      { success: false, error: 'Propiedad no encontrada' },
      { status: 404 }
    );
  }

  return NextResponse.json(
    {
      success: true,
      data: result.property,
      source: result.source,
    },
    PROPERTY_CACHE
  );
}
