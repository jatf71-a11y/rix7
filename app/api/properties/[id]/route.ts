import { NextRequest, NextResponse } from 'next/server';
import { getCatalogPropertyById } from '@/lib/data/propertyCatalog';

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

  // ═══ Intentar Supabase primero ═══
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (supabaseUrl && !supabaseUrl.includes('placeholder')) {
      const { createClient } = await import('@/lib/supabase/server');
      const supabase = createClient();
      const { data, error } = await supabase.rpc('get_property_by_id', {
        property_id: id,
      });

      if (!error && data && data.length > 0) {
        return NextResponse.json({
          success: true,
          data: data[0],
          source: 'supabase',
        }, PROPERTY_CACHE);
      }
    }
  } catch {
    // Supabase no disponible — usar catálogo en memoria
  }

  // ═══ Fallback: catálogo nacional en memoria ═══
  const local = getCatalogPropertyById(id);
  if (local) {
    return NextResponse.json({
      success: true,
      data: local,
      source: 'national_catalog',
    }, PROPERTY_CACHE);
  }

  return NextResponse.json(
    { success: false, error: 'Propiedad no encontrada' },
    { status: 404 }
  );
}
