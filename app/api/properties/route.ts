import { NextRequest, NextResponse } from 'next/server';
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
// vieja; `stale-while-revalidate` hace que nadie espere la revalidación: el
// primer visitante tras expirar recibe la copia al instante y el borde se
// actualiza por detrás. Lo que se elimina es el costo de escanear las 4.000
// propiedades del catálogo en cada búsqueda.
const CATALOG_CACHE = {
  headers: {
    'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=86400',
  },
};

// ═══ Límites del RPC: Chile continental completo ═══
// El bbox es el único filtro geográfico que entiende el RPC. Región y comuna
// se aplican después, en el pipeline compartido de `propertyFilters`.
const CHILE_BOUNDS = {
  min_lng: -76.0,
  min_lat: -56.0,
  max_lng: -66.0,
  max_lat: -17.0,
};

// ═══ Parámetros de filtrado (sin la operación, que se evalúa aparte) ═══
// Las reglas de filtrado viven en `lib/data/propertyFilters` para que las
// compartan el buscador y las alertas de búsquedas guardadas.
type BaseFilterParams = PropertyFilterParams;

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

  // ═══ Intentar Supabase primero ═══
  // Al RPC solo se le pide el bbox de Chile continental: ningún criterio de
  // negocio. Todos —ubicación, operación, precio, dormitorios (valor exacto,
  // no `>=`), baños, privados, tipo y texto— se evalúan en `propertyFilters`,
  // de modo que la fuente real y el catálogo del build responden con las
  // MISMAS reglas. Antes el RPC ignoraba región y comuna, y la ruta tampoco
  // las aplicaba después: el selector de ubicación movía el mapa pero no
  // filtraba nada.
  //
  // Empujar precios al RPC además rompía la distinción entre "el filtro no
  // matcheó nada" (respuesta vacía honesta) y "la base no tiene propiedades"
  // (caer al catálogo del build): ambos devolvían 0 filas y cualquier búsqueda
  // sin resultados mostraba miles de propiedades inventadas del catálogo demo.
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (supabaseUrl && !supabaseUrl.includes('placeholder')) {
      const { createClient } = await import('@/lib/supabase/server');
      const supabase = createClient();
      const { data, error } = await supabase.rpc('get_properties_filtered', CHILE_BOUNDS);

      if (!error && data) {
        // vip → premium y NUMERIC → number: sin esto las propiedades vip no
        // caían en ningún chip y los precios string rompían el orden de los
        // filtros de rango.
        const rows = normalizeProperties(data as Record<string, unknown>[]);

        // Filas = la base tiene propiedades en Chile (con o sin filtros).
        // Una tabla vacía sí cae al catálogo del build: un portal sin
        // propiedades es peor que uno con el catálogo del build.
        if (rows.length > 0) {
          // Contadores por operación: mismo set que el base (con ubicación,
          // precio, dormitorios…) pero SIN la operación, que es el filtro que
          // está activo. Antes se contaba sobre el set ya filtrado por
          // operación, así que el chip que no estaba activo mostraba siempre 0.
          const operationCounts = countOperations(baseParams, rows);

          // Conteo por comuna SIN la ubicación seleccionada: el dropdown debe
          // mostrar el stock real de cada comuna aunque ya haya una elegida
          // (antes se contaba sobre el set ya filtrado, y al elegir una comuna
          // todas las demás quedaban en 0).
          const { region: _r, commune: _c, ...withoutLocation } = baseParams;
          const unlocated = filterProperties(rows, {
            ...withoutLocation,
            operation,
            newPropertyType,
            partnerId,
          });
          const communeCounts: Record<string, number> = {};
          for (const p of unlocated) {
            if (p.city) communeCounts[p.city] = (communeCounts[p.city] || 0) + 1;
          }

          // Set base: los mismos criterios que aplica el catálogo local,
          // incluida la operación (los chips de categoría se cuentan dentro de
          // la operación activa).
          const base = filterProperties(rows, { ...baseParams, operation });

          // Contadores por categoría del set base (ignora el tipo, que es el
          // filtro): `countByCategory` solo reconoce los tipos de la UI, así
          // que un tipo nuevo de la base no rompe los superíndices.
          const categoryCounts = countByCategory(base);

          // Resultado final: sobre el set base, tipo + proyecto/entrega +
          // corredora (los dos últimos ya aplicados en `unlocated` para los
          // contadores; acá se aplican sobre el set ubicado).
          const filtered = filterProperties(base, { propertyType, newPropertyType, partnerId });

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

  // 3. Contadores por operación: mismo set base (con ubicación) pero sin la
  // operación, que es el filtro activo; así el chip inactivo muestra su real
  // stock en vez de 0.
  const operationCounts = countOperations(baseParams);

  // 3b. Conteo por comuna sin la ubicación seleccionada, para que el dropdown
  // del selector muestre el stock real de cada comuna aunque ya haya una
  // elegida (mismo criterio que la rama de Supabase).
  const { region: _region, commune: _commune, ...withoutLocationLocal } = baseParams;
  const unlocatedLocal = filterProperties(ALL_PROPERTIES, {
    ...withoutLocationLocal,
    operation,
    newPropertyType,
    partnerId,
  });
  const communeCounts: Record<string, number> = {};
  for (const p of unlocatedLocal) {
    if (p.city) communeCounts[p.city] = (communeCounts[p.city] || 0) + 1;
  }

  // 4. Resultado final: sobre el set base, tipo + proyecto/entrega + corredora
  const filtered = filterProperties(base, { propertyType, newPropertyType, partnerId });

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
