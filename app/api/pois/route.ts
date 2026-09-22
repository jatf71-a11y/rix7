import { NextRequest, NextResponse } from 'next/server';
import { POI_CATEGORIES, categorizePOI, derivePoiType, poiImportance, poiSvgMarkup, poiTypeLabel } from '@/lib/data/poiCategories';

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
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.osm.jp/api/interpreter',
];

/**
 * Overpass responde 406 (Apache) a clientes sin User-Agent identificable; su
 * política de uso exige identificar la aplicación con un contacto.
 */
const OVERPASS_USER_AGENT =
  'Rix7Inmobiliaria/1.0 (portal inmobiliario; contacto: dev@rix7.cl)';

/**
 * Presupuesto total para el failover: prueba espejos mientras quede tiempo.
 * Así se aprovechan espejos extra cuando los primeros fallan rápido (429,
 * conexión rechazada) sin pasarnos del maxDuration de 30 s en Vercel.
 */
const FAILOVER_BUDGET_MS = 24_000;

/** Radio de búsqueda de POIs en metros (cubre el radio caminable de 15 min con margen). */
const SEARCH_RADIUS_M = 1500;

/**
 * Techo de ejecución en Vercel: el peor caso del failover (3 espejos × 10 s)
 * queda cubierto y la función responde con nuestro 502 limpio + fallback a
 * caché stale, en vez de ser asesinada por el timeout por defecto (504 edge).
 */
export const maxDuration = 30;

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

/** Forma del JSON generado por scripts/generate-poi-snapshot.mjs */
interface PoiSnapshot {
  generated_at: string | null;
  cells: Record<string, { lat: number; lng: number; pois: Array<{ id: number; lat: number; lng: number; name: string; type: string; category: string }> }>;
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
  const deadline = Date.now() + FAILOVER_BUDGET_MS;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    if (Date.now() >= deadline) break;
    try {
      // Cap duro de 10s por espejo: si está colgado, cortamos y probamos el
      // siguiente. El deadline global acota el peor caso total a ~24s.
      const res = await fetch(endpoint, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        // Overpass rechaza con 406 a los clientes sin User-Agent identificable
        // (política de uso de OSM). Sin este header todas las consultas fallan
        // y el mapa queda sin POIs; el identificador debe ser real y con contacto.
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': OVERPASS_USER_AGENT,
        },
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

  // ═══ Fallback de última instancia: snapshot estático del build ═══
  // Si Overpass está caído y no hay nada en caché, servimos los POIs
  // precacheados para esta celda (pueden tener días, pero es mejor que un
  // mapa vacío). El cliente NO los cachea en localStorage.
  //
  // El import es dinámico a propósito: el snapshot pesa varios MB y solo se
  // necesita en este último nivel de degradación, así que el caso normal
  // (Overpass responde o hay caché) no paga su lectura en cada cold start.
  const snapshotPois = async (): Promise<PoiResponse[] | null> => {
    const { default: poiSnapshot } = (await import('@/lib/data/poiSnapshot.generated.json')) as {
      default: PoiSnapshot;
    };
    const cell = poiSnapshot.cells[cacheKey];
    if (!cell) return null;
    return cell.pois.map((p) => ({
      id: p.id,
      lat: p.lat,
      lng: p.lng,
      name: p.name || POI_CATEGORIES[p.category]?.label || 'POI',
      type: p.type,
      typeLabel: poiTypeLabel(p.type),
      category: p.category,
      color: POI_CATEGORIES[p.category]?.color || '#64748b',
      svg: poiSvgMarkup(p.category, POI_CATEGORIES[p.category]?.color || '#64748b', 13),
    }));
  };

  // ═══ Miss — consultar Overpass ═══
  // Cada categoría aporta varios selectores; todos se unen en una sola
  // consulta para minimizar el uso de Overpass.
  // `nwr` = nodos + ways + relations: comisarías, cuarteles, colegios,
  // malls y hospitales suelen estar mapeados como polígono del edificio, y
  // con `node` quedaban fuera (Seguridad daba 0 aunque hubiera cuarteles).
  // `out center` entrega el centroide de esos polígonos.
  const queries = Object.entries(POI_CATEGORIES).flatMap(([, cat]) =>
    cat.queries.map((q) => `nwr${q}(around:${SEARCH_RADIUS_M},${lat},${lng});`)
  );
  const query = `[out:json][timeout:25];(${queries.join('\n')});out center;`;

  try {
    const data = await fetchFromOverpass(query);
    const parsed: PoiResponse[] = [];

    for (const element of data.elements || []) {
      if (!element.tags) continue;
      const category = categorizePOI(element.tags);
      if (!category) continue;

      // Los ways/relations no traen lat/lon: `out center` da el centroide
      const center = element.center || element;
      if (typeof center.lat !== 'number' || typeof center.lon !== 'number') continue;

      const catConfig = POI_CATEGORIES[category];
      const name = element.tags.name || catConfig.label;

      // Un mismo lugar puede venir como nodo y como polígono del edificio
      // (o duplicado); sin esto el contador lo sumaría dos veces.
      const duplicate = parsed.some(
        (p) =>
          p.category === category &&
          p.name === name &&
          Math.abs(p.lat - center.lat) < 0.0004 &&
          Math.abs(p.lng - center.lon) < 0.0004
      );
      if (duplicate) continue;

      // Subtipo derivado: tag de tipo de OSM o, si no hay, el de seguridad
      const type = derivePoiType(element.tags);
      parsed.push({
        id: element.id,
        lat: center.lat,
        lng: center.lon,
        name,
        type,
        typeLabel: poiTypeLabel(type),
        category,
        color: catConfig.color,
        // SVG con trazo del color de la categoría — el cliente lo envuelve
        // en el mismo formato de chip que la ficha (caja blanca + borde).
        svg: poiSvgMarkup(category, catConfig.color, 13),
      });
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
    // Degradación elegante en 3 niveles: caché vencida → snapshot estático →
    // error 502. Mejor POIs desactualizados que un mapa vacío.
    if (staleCopy && staleCopy.length > 0) {
      return NextResponse.json({ success: true, data: staleCopy, cached: true, stale: true });
    }
    const desdeSnapshot = await snapshotPois();
    if (desdeSnapshot && desdeSnapshot.length > 0) {
      return NextResponse.json(
        { success: true, data: desdeSnapshot, cached: true, stale: true, snapshot: true },
        { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800' } }
      );
    }
    return NextResponse.json({ success: false, error: 'Servicio de POIs no disponible' }, { status: 502 });
  }
}
