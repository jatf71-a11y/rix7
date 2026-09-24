import { NextRequest, NextResponse } from 'next/server';
import { Property, PropertyType } from '@/lib/types/property';
import { ALL_PROPERTIES } from '@/lib/data/propertyCatalog';
import { normalizeForSearch } from '@/lib/utils/text';
import {
  countByCategory,
  countOperations,
  filterProperties,
  type PropertyFilterParams,
} from '@/lib/data/propertyFilters';

// ═══ Caché de borde ═══
// El catálogo nacional solo cambia con un deploy, pero las propiedades también
// pueden publicarse en caliente (Supabase), así que la respuesta se sirve desde
// el CDN con un TTL corto y deliberado. Se usa `s-maxage` (no `max-age`) para que
// el navegador revalide siempre y un filtro nuevo no quede pegado a una versión
// vieja; `stale-while-revalidate` hace que nadie espere la revalidación: el
// primer visitante tras expirar recibe la copia al instante y el borde se
// actualiza por detrás. Lo que se elimina es el costo de escanear las 4.000
// propiedades del catálogo en cada búsqueda.
const CATALOG_CACHE = {
  headers: {
    'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=86400',
  },
};

// ═══ Parámetros de filtrado (sin la operación, que se evalúa aparte) ═══
// Las reglas de filtrado viven en `lib/data/propertyFilters` para que las
// compartan el buscador y las alertas de búsquedas guardadas.
type BaseFilterParams = PropertyFilterParams;

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

  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const limit = Math.min(2000, Math.max(1, Number(searchParams.get('limit')) || 50));

  const baseParams: BaseFilterParams = {
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
        const filtered = operation === 'all' ? data : data.filter((p: any) => p.status === operation);
        const start = (page - 1) * limit;

        // Category counts from Supabase data (base filter without propertyType)
        const categoryCounts: Record<string, number> = { all: filtered.length };
        let forSale = 0;
        let forRent = 0;
        for (const p of filtered) {
          categoryCounts[p.property_type] = (categoryCounts[p.property_type] || 0) + 1;
          if (p.status === 'for_sale') forSale++;
          else if (p.status === 'for_rent') forRent++;
        }

        return NextResponse.json({
          success: true,
          data: filtered.slice(start, start + limit),
          total: filtered.length,
          page,
          totalPages: Math.ceil(filtered.length / limit),
          categoryCounts,
          operationCounts: { for_sale: forSale, for_rent: forRent },
          source: 'supabase',
        }, CATALOG_CACHE);
      }
    }
  } catch {
    // Supabase no disponible — usar catálogo en memoria
  }

  // ═══ Filtro local del catálogo nacional ═══

  // 1. Set base: operación + ubicación + texto + precio + dormitorios + baños
  const base = filterProperties(ALL_PROPERTIES, { ...baseParams, operation });

  // 2. Contadores por categoría del set base (ignora el tipo, que es el filtro)
  const categoryCounts = countByCategory(base);

  // 3. Contadores por operación del set base (ignora la operación, que es el filtro)
  const operationCounts = countOperations(baseParams);

  // 4. Resultado final: sobre el set base, tipo + proyecto/entrega + corredora
  const filtered = filterProperties(base, { propertyType, newPropertyType, partnerId });

  const start = (page - 1) * limit;
  const paged = filtered.slice(start, start + limit);

  return NextResponse.json({
    success: true,
    data: paged,
    total: filtered.length,
    totalCatalog: ALL_PROPERTIES.length,
    page,
    totalPages: Math.ceil(filtered.length / limit),
    categoryCounts,
    operationCounts,
    source: 'national_catalog',
  }, CATALOG_CACHE);
}
