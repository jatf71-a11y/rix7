import { NextRequest, NextResponse } from 'next/server';
import { Property, PropertyType } from '@/lib/types/property';
import { ALL_PROPERTIES } from '@/lib/data/propertyCatalog';
import { stripDiacritics } from '@/lib/utils/text';

// ═══ Base filter: operation + location + search + price + bedrooms + bathrooms ═══
// Used for both the main result set AND category counts (without propertyType)
function baseFilter(
  p: Property,
  params: {
    operation: string;
    searchQuery: string;
    region: string;
    commune: string;
    minPrice: number | null;
    maxPrice: number | null;
    minBedrooms: number | null;
    minBathrooms: number | null;
    minPrivates: number | null;
  }
): boolean {
  const { operation, searchQuery, region, commune, minPrice, maxPrice, minBedrooms, minBathrooms, minPrivates } = params;

  // Operación
  if (operation !== 'all' && p.status !== operation) return false;

  // Precio
  if (minPrice && p.price < minPrice) return false;
  if (maxPrice && p.price > maxPrice) return false;

  // Dormitorios (exacto, excepto 5+)
  if (minBedrooms !== null) {
    if (minBedrooms === 5) {
      if (p.bedrooms < 5) return false;
    } else {
      if (p.bedrooms !== minBedrooms) return false;
    }
  }

  // Baños (exacto, excepto 4+)
  if (minBathrooms !== null) {
    if (minBathrooms === 4) {
      if (p.bathrooms < 4) return false;
    } else {
      if (p.bathrooms !== minBathrooms) return false;
    }
  }

  // Privados
  if (minPrivates !== null) {
    if (minPrivates === 5) {
      if ((p.privates ?? 0) < 5) return false;
    } else {
      if ((p.privates ?? 0) !== minPrivates) return false;
    }
  }

  // Comuna
  if (commune && p.city?.toLowerCase() !== commune) return false;

  // Región (solo si no hay comuna seleccionada)
  if (!commune && region && p.state) {
    if (!p.state.toLowerCase().includes(region) && !region.includes(p.state.toLowerCase())) return false;
  }

  // Búsqueda por texto
  if (searchQuery) {
    const q = searchQuery;
    const match =
      stripDiacritics(p.title.toLowerCase()).includes(q) ||
      stripDiacritics((p.city ?? '').toLowerCase()).includes(q) ||
      stripDiacritics((p.address ?? '').toLowerCase()).includes(q) ||
      stripDiacritics((p.state ?? '').toLowerCase()).includes(q);
    if (!match) return false;
  }

  return true;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const operation = searchParams.get('operation') || 'all';
  const propertyType = searchParams.get('propertyType') || 'all';
  const searchQuery = searchParams.get('search')
    ? stripDiacritics(searchParams.get('search')!.trim().toLowerCase())
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

  const baseParams = { operation, searchQuery, region, commune, minPrice, maxPrice, minBedrooms, minBathrooms, minPrivates };

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
        for (const p of filtered) {
          categoryCounts[p.property_type] = (categoryCounts[p.property_type] || 0) + 1;
        }

        return NextResponse.json({
          success: true,
          data: filtered.slice(start, start + limit),
          total: filtered.length,
          page,
          totalPages: Math.ceil(filtered.length / limit),
          categoryCounts,
          operationCounts: {
            for_sale: filtered.filter((p: any) => p.status === 'for_sale').length,
            for_rent: filtered.filter((p: any) => p.status === 'for_rent').length,
          },
          source: 'supabase',
        });
      }
    }
  } catch {
    // Supabase no disponible — usar catálogo en memoria
  }

  // ═══ Filtro local del catálogo nacional ═══

  // 1. Base set: operation + location + search + price + bedrooms + bathrooms
  const base = ALL_PROPERTIES.filter((p) => baseFilter(p, baseParams));

  // 2. Category counts: derive from base set (ignore propertyType for counts)
  const categoryCounts: Record<string, number> = { all: base.length };
  const typeKeys: PropertyType[] = ['apartment', 'house', 'premium', 'parcel', 'office', 'land', 'parking', 'local', 'warehouse'];
  for (const key of typeKeys) {
    categoryCounts[key] = 0;
  }
  for (const p of base) {
    if (categoryCounts[p.property_type] !== undefined) {
      categoryCounts[p.property_type]++;
    }
  }

  // 3. Operation counts: derive from base set (ignore operation for counts)
  const operationCounts = {
    for_sale: ALL_PROPERTIES.filter((p) => {
      const { operation: _op, ...rest } = baseParams;
      return baseFilter(p, { ...rest, operation: 'for_sale' });
    }).length,
    for_rent: ALL_PROPERTIES.filter((p) => {
      const { operation: _op, ...rest } = baseParams;
      return baseFilter(p, { ...rest, operation: 'for_rent' });
    }).length,
  };

  // 4. Final result: base + propertyType + newPropertyType + partnerId filters
  const currentYear = new Date().getFullYear();
  let filtered = propertyType === 'all'
    ? base
    : base.filter((p) => p.property_type === propertyType);

  // Partner filter (for /empresas/[slug] page)
  if (partnerId) {
    filtered = filtered.filter((p) => p.partner_id === partnerId);
  }

  // newPropertyType filter: proyectos = year_built > currentYear, entrega_inmediata = year_built <= currentYear
  if (newPropertyType === 'proyectos') {
    filtered = filtered.filter((p) => p.year_built && p.year_built > currentYear);
  } else if (newPropertyType === 'entrega_inmediata') {
    filtered = filtered.filter((p) => !p.year_built || p.year_built <= currentYear);
  }

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
  });
}
