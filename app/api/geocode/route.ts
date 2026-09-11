import { NextRequest, NextResponse } from 'next/server';
import { searchPOIs, POICategory } from '@/lib/data/chilePOIs';
import { CHILE_REGIONS } from '@/lib/data/chileLocations';
import { normalizeForSearch } from '@/lib/utils/text';

export const dynamic = 'force-dynamic';

/**
 * Índice plano de comunas con el nombre normalizado precalculado.
 * Evita recorrer y normalizar las ~346 comunas en cada búsqueda.
 */
interface CommuneIndexEntry {
  key: string;
  label: string;
  regionName: string;
  regionCode: string;
  shortRegionName: string;
  lat: number;
  lng: number;
  zoom: number;
}

let communeIndex: CommuneIndexEntry[] | null = null;

function getCommuneIndex(): CommuneIndexEntry[] {
  if (!communeIndex) {
    communeIndex = CHILE_REGIONS.flatMap((region) => {
      const shortRegionName = region.name
        .replace('Región de ', '')
        .replace('Región del ', '');
      return region.communes.map((commune) => ({
        key: normalizeForSearch(commune.name),
        label: commune.name,
        regionName: region.name,
        regionCode: region.code,
        shortRegionName,
        lat: commune.lat,
        lng: commune.lng,
        zoom: commune.zoom || 13,
      }));
    });
  }
  return communeIndex;
}

interface GeocodeResult {
  id: string;
  name: string;
  subtitle: string;
  category: POICategory | 'commune' | 'address';
  categoryLabel: string;
  commune?: string;
  region?: string;
  lat: number;
  lng: number;
  zoom: number;
  source: 'poi_catalog' | 'commune_catalog' | 'nominatim';
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q')?.trim() || '';

    if (!query || query.length < 2) {
      return NextResponse.json({ success: true, results: [] });
    }

    const results: GeocodeResult[] = [];
    const normQuery = normalizeForSearch(query);

    // 1. Buscar en Puntos de Interés chilenos (POIs) — respuesta inmediata 0ms
    const matchedPois = searchPOIs(query, 6);
    for (const poi of matchedPois) {
      results.push({
        id: `poi-${poi.id}`,
        name: poi.name,
        subtitle: `${poi.commune}, ${poi.region.replace('Región de ', '').replace('Región del ', '')}`,
        category: poi.category,
        categoryLabel: poi.categoryLabel,
        commune: poi.commune,
        region: poi.region,
        lat: poi.lat,
        lng: poi.lng,
        zoom: 15,
        source: 'poi_catalog',
      });
    }

    // 2. Buscar en Comunas de Chile (índice normalizado precalculado)
    const matchedNames = new Set(results.map((r) => r.name.toLowerCase()));
    for (const entry of getCommuneIndex()) {
      if (!entry.key.includes(normQuery) && !normQuery.includes(entry.key)) continue;
      const labelKey = entry.label.toLowerCase();
      if (matchedNames.has(labelKey)) continue;
      matchedNames.add(labelKey);
      results.push({
        id: `com-${entry.regionCode}-${entry.label}`,
        name: entry.label,
        subtitle: `Comuna · ${entry.shortRegionName}`,
        category: 'commune',
        categoryLabel: 'Comuna',
        commune: entry.label,
        region: entry.regionName,
        lat: entry.lat,
        lng: entry.lng,
        zoom: entry.zoom,
        source: 'commune_catalog',
      });
    }

    // 3. Si la búsqueda tiene más de 3 caracteres y no encontramos muchos resultados o parece una dirección (ej: "Av.", "Calle", "Providencia 1200", etc.)
    const looksLikeAddress = /\d/.test(query) || /^(av|avenida|calle|pasaje|camino|diagonal|alameda|costanera)/i.test(query) || results.length < 3;

    if (looksLikeAddress) {
      try {
        const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          query + ', Chile'
        )}&countrycodes=cl&limit=5&addressdetails=1`;

        const nomRes = await fetch(nominatimUrl, {
          headers: {
            'User-Agent': 'Rix7-Chile-RealEstate-Platform/1.0',
            'Accept-Language': 'es-CL,es;q=0.9',
          },
          next: { revalidate: 3600 },
        });

        if (nomRes.ok) {
          const data = await nomRes.json();
          if (Array.isArray(data)) {
            for (const item of data) {
              const lat = parseFloat(item.lat);
              const lng = parseFloat(item.lon);
              if (isNaN(lat) || isNaN(lng)) continue;

              // Extraer comuna y región si están disponibles
              const city =
                item.address?.city ||
                item.address?.town ||
                item.address?.suburb ||
                item.address?.municipality ||
                item.address?.county ||
                'Chile';
              const state = item.address?.state || '';

              results.push({
                id: `nom-${item.place_id}`,
                name: item.display_name.split(',')[0].trim(),
                subtitle: item.display_name.split(',').slice(1, 3).join(',').trim() || city,
                category: 'address',
                categoryLabel: 'Dirección',
                commune: city,
                region: state,
                lat,
                lng,
                zoom: 15,
                source: 'nominatim',
              });
            }
          }
        }
      } catch {
        // En caso de fallo de red de Nominatim, los resultados locales son suficientes
      }
    }

    return NextResponse.json({
      success: true,
      query,
      results: results.slice(0, 10),
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Error en búsqueda geoespacial',
        results: [],
      },
      { status: 500 }
    );
  }
}
