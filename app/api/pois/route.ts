import { NextRequest, NextResponse } from 'next/server';
import { POI_CATEGORIES, categorizePOI, poiSvgMarkup, poiTypeLabel } from '@/lib/data/poiCategories';

/**
 * API route `/api/pois` — proxy server-side de Overpass API.
 *
 * Ventajas sobre consultar Overpass directo desde el cliente:
 * - Los espejos están ocultos; se pueden rotar sin tocar el frontend.
 * - Un solo consumidor del rate limit de Overpass (el servidor), no cada
 *   visitante del portal.
 * - Caché compartida entre todos los usuarios: propiedades del mismo
 *   sector (misma celda de ~11 m) disparan UNA consulta a Overpass.
 * - Rate limit por IP para abusos.
 *
 * Espejos públicos de Overpass en cascada — si uno falla (504/429/rate
 * limit), se prueba el siguiente.
 */
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

/** Radio de búsqueda de POIs en metros (cubre el radio caminable de 15 min con margen). */
const SEARCH_RADIUS_M = 1500;

/** TTL de la caché de servidor. Los POIs de OSM cambian muy raramente. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

/** Máximo de entradas en memoria (evict FIFO simple, anti-fuga). */
const MAX_CACHE_ENTRIES = 200;

/** Rate limit por IP: máximo de solicitudes en la ventana. */
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minuto

const cache = new Map<string, { pois: PoiResponse[]; ts: number }>();
const rateBuckets = new Map<string, { count: number; windowStart: number }>();

interface PoiResponse {
  id: number;
  lat: number;
  lng: number;
  name: string;
  type: string;
  /** Etiqueta humana del subtipo ("Paradero", "Farmacia"...) para popups */
  typeLabel: string;
  category: string;
  /** Color de la categoría (hex) para pintar marcador en el cliente */
  color: string;
  /** SVG inline del ícono (paths Lucide) para el marcador */
  svg: string;
}

/** Limpieza perezosa de buckets de rate limit expirados. */
function sweepRateBuckets(now: number): void {
  if (rateBuckets.size < 1000) return;
  for (const ip of Array.from(rateBuckets.keys())) {
    const bucket = rateBuckets.get(ip);
    if (bucket && now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) rateBuckets.delete(ip);
  }
}

/** Rate limit por IP. Retorna true si la solicitud debe rechazarse. */
function isRateLimited(ip: string): boolean {
  const now = Date.now();
  sweepRateBuckets(now);

  const bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateBuckets.set(ip, { count: 1, windowStart: now });
    return false;
  }

  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX;
}

/** Consulta Overpass probando los espejos en orden. Lanza si todos fallan. */
async function fetchFromOverpass(query: string): Promise<any> {
  let lastError: unknown = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      // Cap duro de 10s por espejo: si está colgado, cortamos y probamos el
      // siguiente. Peor caso total ~35s; con espejos sanos responde en <10s.
      const res = await fetch(endpoint, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });

      if (res.ok) {
        return await res.json();
      }
      lastError = new Error(`Overpass API error: ${res.status} en ${endpoint}`);
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError ?? new Error('Overpass no disponible');
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const lat = parseFloat(searchParams.get('lat') || '');
  const lng = parseFloat(searchParams.get('lng') || '');

  // Validación de coordenadas
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ success: false, error: 'Coordenadas inválidas' }, { status: 400 });
  }

  // ═══ Rate limit por IP ═══
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { success: false, error: 'Demasiadas solicitudes' },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  }

  // ═══ Caché de servidor (celda de ~11 m, igual granularidad que el cliente) ═══
  const cacheKey = `${lat.toFixed(4)}_${lng.toFixed(4)}`;
  const cached = cache.get(cacheKey);
  const now = Date.now();

  if (cached && now - cached.ts < CACHE_TTL_MS) {
    return NextResponse.json(
      { success: true, data: cached.pois, cached: true },
      { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800' } }
    );
  }

  // Conservar copia vencida: si Overpass falla por completo, servimos esta
  // copia (stale) en vez de un error — POIs de 25h siguen siendo válidos.
  const staleCopy = cached ? cached.pois : null;
  if (cached) cache.delete(cacheKey);

  // ═══ Miss — consultar Overpass ═══
  // Cada categoría aporta varios selectores; todos se unen en una sola
  // consulta para minimizar el uso de Overpass.
  const queries = Object.entries(POI_CATEGORIES).flatMap(([key, cat]) =>
    cat.queries.map((q) => `node${q}(around:${SEARCH_RADIUS_M},${lat},${lng});`)
  );
  const query = `[out:json][timeout:10];(${queries.join('\n')});out body;`;

  try {
    const data = await fetchFromOverpass(query);
    const parsed: PoiResponse[] = [];

    for (const element of data.elements || []) {
      if (!element.tags) continue;
      const category = categorizePOI(element.tags);
      if (category) {
        const catConfig = POI_CATEGORIES[category];
        // Subtipo OSM específico del elemento (school, bus_stop, atm...)
        const rawType = element.tags.amenity || element.tags.shop || element.tags.leisure || element.tags.railway || element.tags.highway || element.tags.office || '';
        parsed.push({
          id: element.id,
          lat: element.lat,
          lng: element.lon,
          name: element.tags.name || catConfig.label,
          type: rawType,
          typeLabel: poiTypeLabel(rawType),
          category,
          color: catConfig.color,
          // SVG con trazo del color de la categoría — el cliente lo envuelve
          // en el mismo formato de chip que la ficha (caja blanca + borde).
          svg: poiSvgMarkup(category, catConfig.color, 13),
        });
      }
    }

    // Guardar en caché solo si hay resultados (evita cachear respuestas vacías
    // por un espejo degradado; el cliente reintentará en la próxima visita).
    if (parsed.length > 0) {
      if (cache.size >= MAX_CACHE_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest) cache.delete(oldest);
      }
      cache.set(cacheKey, { pois: parsed, ts: Date.now() });
    }

    return NextResponse.json(
      { success: true, data: parsed, cached: false },
      { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800' } }
    );
  } catch (err) {
    console.error('Error consultando Overpass:', err);
    // Degradación elegante: mejor POIs vencidos que ninguno.
    if (staleCopy && staleCopy.length > 0) {
      return NextResponse.json({ success: true, data: staleCopy, cached: true, stale: true });
    }
    return NextResponse.json({ success: false, error: 'Servicio de POIs no disponible' }, { status: 502 });
  }
}
