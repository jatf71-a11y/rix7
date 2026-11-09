import { NextRequest, NextResponse } from 'next/server';
import type { Property } from '@/lib/types/property';
import { ALL_PROPERTIES } from '@/lib/data/propertyCatalog';
import { normalizeForSearch } from '@/lib/utils/text';
import { normalizeProperties } from '@/lib/data/propertyNormalize';
import {
  countByCategory,
  countOperations,
  filterProperties,
  type PropertyFilterParams,
} from '@/lib/data/propertyFilters';
import { OPERATION_ALIASES, propertiesQuerySchema } from '@/lib/api/schemas';
import { searchParamsToObject, validateInput } from '@/lib/api/validate';

// ═══ Caché de borde ═══
// El catálogo nacional solo cambia con un deploy, pero las propiedades también
// pueden publicarse en caliente (Supabase), así que la respuesta se sirve desde
// el CDN con un TTL corto y deliberado. Se usa `s-maxage` (no `max-age`) para que
// el navegador revalide siempre y un filtro nuevo no quede pegado a una versión
// vieja; `stale-while-revalidate` hace que nadie espere la revalidación. Lo que
// se elimina es el costo de escanear el catálogo en cada búsqueda.
const CATALOG_CACHE = {
  headers: {
    'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=86400',
  },
};

// ═══ Límites del RPC: Chile continental completo ═══
// El recuadro vive dentro de `search_properties_catalog`; acá queda para el
// camino anterior, que sigue pidiendo las filas y filtrándolas en JavaScript.
const CHILE_BOUNDS = {
  min_lng: -76.0,
  min_lat: -56.0,
  max_lng: -66.0,
  max_lat: -17.0,
};

type BaseFilterParams = PropertyFilterParams;
type NewPropertyType = PropertyFilterParams['newPropertyType'];

/**
 * Lo que devuelve `search_properties_catalog` (migración 0037): la página ya
 * filtrada y los contadores que la UI muestra, calculados en la base.
 */
interface CatalogPage {
  data: Record<string, unknown>[];
  total: number;
  /** Filas del recuadro chileno sin filtros: distingue «base vacía» de «sin resultados». */
  catalog_size: number;
  category_counts: Record<string, number>;
  operation_counts: { for_sale: number; for_rent: number };
  commune_counts: Record<string, number>;
}

/**
 * Valida la forma del JSON del RPC.
 *
 * La base puede tener la función vieja (o no tenerla): en ese caso llega un
 * error de PostgREST o un arreglo de filas, y esta comprobación manda la
 * petición al camino anterior en vez de romper. `catalog_size` es obligatorio
 * porque sin él no se puede distinguir una base vacía de una búsqueda sin
 * resultados.
 */
function asCatalogPage(value: unknown): CatalogPage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const page = value as Partial<CatalogPage>;
  if (
    !Array.isArray(page.data) ||
    typeof page.total !== 'number' ||
    typeof page.catalog_size !== 'number'
  ) {
    return null;
  }
  return {
    data: page.data,
    total: page.total,
    catalog_size: page.catalog_size,
    category_counts: page.category_counts ?? {},
    operation_counts: page.operation_counts ?? { for_sale: 0, for_rent: 0 },
    commune_counts: page.commune_counts ?? {},
  };
}

/**
 * Camino rápido: filtrado, contadores y paginación en la base.
 *
 * Devuelve `null` cuando el RPC no existe todavía o responde algo inesperado;
 * el llamador cae entonces al camino anterior. Ese fallback es deliberado: el
 * código puede desplegarse antes que la migración y el buscador sigue andando.
 */
async function fetchCatalogPage(params: {
  operation: string;
  propertyType: string;
  searchQuery: string;
  region: string;
  commune: string;
  minPrice: number | null;
  maxPrice: number | null;
  minBedrooms: number | null;
  minBathrooms: number | null;
  minPrivates: number | null;
  newPropertyType: string | null;
  partnerId: string | null;
  page: number;
  limit: number;
}): Promise<CatalogPage | null> {
  try {
    const { createClient } = await import('@/lib/supabase/server');
    const supabase = createClient();
    const { data, error } = await supabase.rpc('search_properties_catalog', {
      p_operation: params.operation,
      p_property_type: params.propertyType,
      p_search: params.searchQuery,
      p_region: params.region,
      p_commune: params.commune,
      p_min_price: params.minPrice,
      p_max_price: params.maxPrice,
      p_min_bedrooms: params.minBedrooms,
      p_min_bathrooms: params.minBathrooms,
      p_min_privates: params.minPrivates,
      p_new_property_type: params.newPropertyType,
      p_partner_id: params.partnerId,
      p_page: params.page,
      p_limit: params.limit,
    });
    if (error) return null;
    return asCatalogPage(data);
  } catch {
    // Función ausente, red caída o respuesta rara: camino anterior.
    return null;
  }
}

// ═══ Camino anterior (mientras la migración 0037 no esté aplicada) ═══
// Pide todas las filas del recuadro chileno y filtra en JavaScript. Se mantiene
// con su memo de 30 s para que un despliegue sin migración no pierda la mejora
// que ya tenía.
const LEGACY_CACHE_TTL_MS = 30_000;
let legacyCache: { at: number; rows: Property[] } | null = null;

function cachedLegacyRows(): Property[] | null {
  if (!legacyCache) return null;
  if (Date.now() - legacyCache.at > LEGACY_CACHE_TTL_MS) {
    legacyCache = null;
    return null;
  }
  return legacyCache.rows;
}

async function fetchLegacyRows(): Promise<Property[]> {
  const cached = cachedLegacyRows();
  if (cached) return cached;

  const { createClient } = await import('@/lib/supabase/server');
  const supabase = createClient();
  const { data, error } = await supabase.rpc('get_properties_filtered', CHILE_BOUNDS);
  if (error || !data) return [];

  // NUMERIC → number: sin esto los precios string rompían el orden de los
  // filtros de rango ("90000000" > "100000000").
  const rows = normalizeProperties(data as Record<string, unknown>[]);
  if (rows.length > 0) legacyCache = { at: Date.now(), rows };
  return rows;
}

/** Respuesta desde filas ya leídas: mismos contadores y misma paginación. */
function fromRows(
  rows: Property[],
  filters: {
    operation: string;
    propertyType: string;
    partnerId: string | null;
    page: number;
    limit: number;
    newPropertyType: NewPropertyType;
  } & BaseFilterParams
) {
  const { operation, propertyType, newPropertyType, partnerId, page, limit, ...baseParams } = filters;

  // Contadores por operación: mismo set base (con ubicación y corredora) pero
  // sin la operación, que es el filtro activo.
  const operationCounts = countOperations({ ...baseParams, partnerId }, rows);

  // Conteo por comuna SIN la ubicación seleccionada: el dropdown debe mostrar
  // el stock real de cada comuna aunque ya haya una elegida.
  const { region: _region, commune: _commune, ...withoutLocation } = baseParams;
  const unlocated = filterProperties(rows, {
    ...withoutLocation,
    operation,
    newPropertyType,
    partnerId,
  });
  const communeCounts: Record<string, number> = {};
  for (const property of unlocated) {
    if (property.city) communeCounts[property.city] = (communeCounts[property.city] || 0) + 1;
  }

  const base = filterProperties(rows, { ...baseParams, operation, partnerId });
  const categoryCounts = countByCategory(base);
  const filtered = filterProperties(base, { propertyType, newPropertyType });

  const start = (page - 1) * limit;

  return NextResponse.json(
    {
      success: true,
      data: filtered.slice(start, start + limit),
      total: filtered.length,
      page,
      totalPages: Math.ceil(filtered.length / limit),
      categoryCounts,
      operationCounts,
      communeCounts,
      source: 'supabase',
    },
    CATALOG_CACHE
  );
}

export async function GET(request: NextRequest) {
  // ═══ Entrada validada con Zod ═══
  // La forma y los límites de cada parámetro viven en `propertiesQuerySchema`;
  // acá solo se traduce al idioma del filtro (`sale` → `for_sale`, nulls).
  const validation = validateInput(
    propertiesQuerySchema,
    searchParamsToObject(new URL(request.url).searchParams)
  );

  if (!validation.ok) {
    return NextResponse.json({ success: false, error: validation.error }, { status: 400 });
  }

  const q = validation.data;

  const operation = OPERATION_ALIASES[q.operation] ?? q.operation;
  const propertyType = q.propertyType;
  const searchQuery = q.search ? normalizeForSearch(q.search) : '';
  const region = q.region.toLowerCase();
  const commune = q.commune.toLowerCase();
  const minPrice = q.minPrice ?? null;
  const maxPrice = q.maxPrice ?? null;
  const minBedrooms = q.minBedrooms ?? null;
  const minBathrooms = q.minBathrooms ?? null;
  const minPrivates = q.minPrivates ?? null;
  const newPropertyType = q.newPropertyType ?? null;
  const partnerId = q.partnerId ?? null;

  const page = q.page;
  const limit = q.limit;

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

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (supabaseUrl && !supabaseUrl.includes('placeholder')) {
    // ═══ Camino rápido: la base filtra, cuenta y pagina ═══
    const catalogPage = await fetchCatalogPage({
      operation,
      propertyType,
      searchQuery,
      region,
      commune,
      minPrice,
      maxPrice,
      minBedrooms,
      minBathrooms,
      minPrivates,
      newPropertyType,
      partnerId,
      page,
      limit,
    });

    if (catalogPage && catalogPage.catalog_size > 0) {
      return NextResponse.json(
        {
          success: true,
          data: normalizeProperties(catalogPage.data),
          total: catalogPage.total,
          page,
          totalPages: Math.ceil(catalogPage.total / limit),
          categoryCounts: catalogPage.category_counts,
          operationCounts: catalogPage.operation_counts,
          communeCounts: catalogPage.commune_counts,
          source: 'supabase',
        },
        CATALOG_CACHE
      );
    }

    // Función sin aplicar o respuesta inválida: camino anterior. Una base
    // vacía (catalog_size 0) cae al catálogo del build, como antes: un portal
    // sin propiedades es peor que uno con el catálogo del build.
    if (!catalogPage) {
      const rows = await fetchLegacyRows();
      if (rows.length > 0) {
        return fromRows(rows, {
          ...baseParams,
          operation,
          propertyType,
          newPropertyType,
          partnerId,
          page,
          limit,
        });
      }
    }
  }

  // ═══ Filtro local del catálogo nacional ═══
  return fromCatalog(baseParams, {
    operation,
    propertyType,
    newPropertyType,
    partnerId,
    page,
    limit,
  });
}

/** Rama del catálogo del build: mismas reglas, sin base de datos. */
function fromCatalog(
  baseParams: BaseFilterParams,
  filters: {
    operation: string;
    propertyType: string;
    newPropertyType: NewPropertyType;
    partnerId: string | null;
    page: number;
    limit: number;
  }
) {
  const { operation, propertyType, newPropertyType, partnerId, page, limit } = filters;

  const base = filterProperties(ALL_PROPERTIES, { ...baseParams, operation, partnerId });
  const categoryCounts = countByCategory(base);
  const operationCounts = countOperations({ ...baseParams, partnerId });

  const { region: _region, commune: _commune, ...withoutLocationLocal } = baseParams;
  const unlocatedLocal = filterProperties(ALL_PROPERTIES, {
    ...withoutLocationLocal,
    operation,
    newPropertyType,
    partnerId,
  });
  const communeCounts: Record<string, number> = {};
  for (const property of unlocatedLocal) {
    if (property.city) communeCounts[property.city] = (communeCounts[property.city] || 0) + 1;
  }

  const filtered = filterProperties(base, { propertyType, newPropertyType });
  const start = (page - 1) * limit;
  const paged = filtered.slice(start, start + limit);

  return NextResponse.json(
    {
      success: true,
      data: paged,
      total: filtered.length,
      totalCatalog: ALL_PROPERTIES.length,
      page,
      totalPages: Math.ceil(filtered.length / limit),
      categoryCounts,
      operationCounts,
      communeCounts,
      source: 'national_catalog',
    },
    CATALOG_CACHE
  );
}
