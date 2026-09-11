import { NextRequest, NextResponse } from 'next/server';
import { Property, PropertyType } from '@/lib/types/property';
import { ALL_PROPERTIES } from '@/lib/data/propertyCatalog';
import { normalizeForSearch } from '@/lib/utils/text';
import { matchesBaseFilter, toPropertyMarker, MarkerFilterParams } from '@/lib/utils/markers';

/**
 * GET /api/markers — proyección compacta de propiedades para el mapa.
 *
 * Antes el mapa recibía la lista completa de /api/properties (1.5 MB de JSON
 * con descripciones, features, imágenes y datos de agente por cambio de
 * filtro). Esta ruta devuelve solo los ~13 campos que pines y popups usan
 * (~150 KB), lo que la hace ideal para cachear en CDN.
 *
 * Cabeceras de caché: los precios cambian poco, así que 5 minutos de
 * s-maxage más 10 de stale-while-revalidate mantienen el mapa fresco
 * sirviendo la gran mayoría de los request desde el borde.
 */
export const dynamic = 'force-dynamic';

const CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
};

/** Índice de texto precalculado (id → campos normalizados), una vez por proceso. */
let searchIndex: Map<string, string> | null = null;

function getSearchIndex(): Map<string, string> {
  if (!searchIndex) {
    searchIndex = new Map(
      ALL_PROPERTIES.map((p) => [
        p.id,
        normalizeForSearch([p.title, p.city, p.address, p.state].filter(Boolean).join(' \u0001 ')),
      ])
    );
  }
  return searchIndex;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const operation = searchParams.get('operation') || 'all';
  const propertyType = searchParams.get('propertyType') || 'all';
  const searchQuery = searchParams.get('search')
    ? normalizeForSearch(searchParams.get('search')!.trim())
    : '';
  const region = searchParams.get('region')
    ? searchParams.get('region')!.trim().toLowerCase()
    : '';
  const commune = searchParams.get('commune')
    ? searchParams.get('commune')!.trim().toLowerCase()
    : '';
  const minPrice = searchParams.get('minPrice') ? Number(searchParams.get('minPrice')) : null;
  const maxPrice = searchParams.get('maxPrice') ? Number(searchParams.get('maxPrice')) : null;
  const minBedrooms = searchParams.get('minBedrooms') ? Number(searchParams.get('minBedrooms')) : null;
  const minBathrooms = searchParams.get('minBathrooms') ? Number(searchParams.get('minBathrooms')) : null;
  const minPrivates = searchParams.get('minPrivates') ? Number(searchParams.get('minPrivates')) : null;
  const newPropertyType = (searchParams.get('newPropertyType') as 'proyectos' | 'entrega_inmediata' | null) || null;
  const partnerId = searchParams.get('partnerId') || null;

  const baseParams: MarkerFilterParams = {
    searchQuery,
    region,
    commune,
    minPrice,
    maxPrice,
    minBedrooms,
    minBathrooms,
    minPrivates,
  };

  // ═══ Intentar Supabase primero ═══
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (supabaseUrl && !supabaseUrl.includes('placeholder')) {
      const { createClient } = await import('@/lib/supabase/server');
      const supabase = createClient();
      const { data, error } = await supabase.rpc('get_properties_filtered', {
        min_lng: -76.0, min_lat: -56.0, max_lng: -66.0, max_lat: -17.0,
        min_price: minPrice, max_price: maxPrice, min_bedrooms: minBedrooms,
        prop_type: propertyType === 'all' ? null : propertyType,
        search_query: searchQuery || null,
      });

      if (!error && data && data.length > 0) {
        // Re-aplicar el filtro base completo (la RPC no cubre comuna,
        // privados ni operación) y proyectar a marcadores.
        const filtered = (data as Property[]).filter((p) =>
          matchesBaseFilter(p, operation, baseParams, getSearchIndex())
        );
        const markers = filtered.map(toPropertyMarker);
        return NextResponse.json(
          { success: true, count: markers.length, data: markers, source: 'supabase' },
          { headers: CACHE_HEADERS }
        );
      }
    }
  } catch {
    // Supabase no disponible — usar catálogo en memoria
  }

  // ═══ Filtro local del catálogo nacional ═══
  let filtered = ALL_PROPERTIES.filter((p) => matchesBaseFilter(p, operation, baseParams, getSearchIndex()));

  if (propertyType !== 'all') {
    filtered = filtered.filter((p) => p.property_type === propertyType);
  }
  if (partnerId) {
    filtered = filtered.filter((p) => p.partner_id === partnerId);
  }

  const currentYear = new Date().getFullYear();
  if (newPropertyType === 'proyectos') {
    filtered = filtered.filter((p) => p.year_built && p.year_built > currentYear);
  } else if (newPropertyType === 'entrega_inmediata') {
    filtered = filtered.filter((p) => !p.year_built || p.year_built <= currentYear);
  }

  const markers = filtered.map(toPropertyMarker);

  return NextResponse.json(
    {
      success: true,
      count: markers.length,
      data: markers,
      source: 'national_catalog',
    },
    { headers: CACHE_HEADERS }
  );
}
