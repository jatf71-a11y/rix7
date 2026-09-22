/**
 * Caché de dos capas para respuestas de Overpass API.
 *
 * - Capa 1 (memoria): Map en módulo — instantánea durante la sesión,
 *   útil al navegar entre fichas de propiedades del mismo sector.
 * - Capa 2 (localStorage): persiste entre visitas con TTL de 24h.
 *   Los POIs de OSM cambian muy raramente, 24h es seguro.
 *
 * La clave redondea las coordenadas a 4 decimales (~11 m de precisión):
 * propiedades en el mismo edificio/sector comparten la misma entrada.
 */

import type { POI } from '@/components/map/PropertyMapLeaflet';

// v4: marcadores con el formato chip de la ficha (SVG color sobre caja
// blanca) — invalida caches con el formato anterior (círculo + SVG blanco).
const CACHE_PREFIX = 'rix7_overpass_v4_';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas
const MAX_MEMORY_ENTRIES = 30; // límite simple anti-fuga de memoria

// ═══ Capa 1: memoria ═══
const memoryCache = new Map<string, { pois: POI[]; ts: number }>();

/** Clave de caché para una consulta Overpass por coordenadas. */
export function getCacheKey(lat: number, lng: number, radius: number): string {
  const rLat = lat.toFixed(4);
  const rLng = lng.toFixed(4);
  return `${CACHE_PREFIX}${rLat}_${rLng}_${radius}`;
}

/** Lee la entrada cruda (memoria o disco) sin aplicar TTL. Uso interno. */
function readEntryRaw(key: string): { pois: POI[]; ts: number } | null {
  const mem = memoryCache.get(key);
  if (mem) return mem;

  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as { pois: POI[]; ts: number };
    if (!entry?.pois || !entry?.ts) return null;
    return entry;
  } catch {
    return null;
  }
}

/**
 * Obtiene POIs cacheados si existen y no han expirado.
 * Las entradas expiradas NO se borran: `getStalePOIs` las recupera como
 * respaldo cuando el fetch falla.
 */
export function getCachedPOIs(key: string): POI[] | null {
  const entry = readEntryRaw(key);
  if (!entry) return null;

  if (Date.now() - entry.ts >= CACHE_TTL_MS) {
    // Expirada pero conservada en disco: el mapa puede usarla si Overpass
    // falla (ver getStalePOIs). La limpieza por cuota ya la recicla.
    return null;
  }

  return entry.pois;
}

/**
 * Respaldo de último recurso en el cliente: devuelve POIs vencidos (TTL
 * superado) con su antigüedad, para mostrarlos marcados como "posiblemente
 * desactualizados" cuando Overpass falla. Nunca lanza ni borra.
 */
export function getStalePOIs(key: string): { pois: POI[]; ageHours: number } | null {
  const entry = readEntryRaw(key);
  if (!entry || entry.pois.length === 0) return null;
  const ageHours = Math.max(0, Math.round((Date.now() - entry.ts) / (60 * 60 * 1000)));
  return { pois: entry.pois, ageHours };
}

/** Guarda POIs en ambas capas de caché. Nunca lanza. */
export function setCachedPOIs(key: string, pois: POI[]): void {
  const entry = { pois, ts: Date.now() };

  // Memoria con límite de entradas (evict FIFO simple)
  if (memoryCache.size >= MAX_MEMORY_ENTRIES) {
    const oldest = memoryCache.keys().next().value;
    if (oldest) memoryCache.delete(oldest);
  }
  memoryCache.set(key, entry);

  // localStorage (puede fallar por cuota — ignorar silenciosamente)
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Cuota llena: limpiar entradas viejas de overpass e intentar una vez más
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(CACHE_PREFIX)) keysToRemove.push(k);
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));
      localStorage.setItem(key, JSON.stringify(entry));
    } catch {
      // Sin espacio — seguir sin caché de disco
    }
  }
}

/** Limpia toda la caché de Overpass (útil para debugging). */
export function clearOverpassCache(): void {
  memoryCache.clear();
  if (typeof window === 'undefined') return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(CACHE_PREFIX)) keysToRemove.push(k);
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch {}
}
