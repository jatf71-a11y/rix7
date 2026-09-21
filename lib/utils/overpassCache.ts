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

/** Obtiene POIs cacheados si existen y no han expirado. */
export function getCachedPOIs(key: string): POI[] | null {
  // 1. Memoria
  const mem = memoryCache.get(key);
  if (mem && Date.now() - mem.ts < CACHE_TTL_MS) {
    return mem.pois;
  }
  if (mem) memoryCache.delete(key); // expirado

  // 2. localStorage (solo cliente)
  if (typeof window === 'undefined') return null;

  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;

    const entry = JSON.parse(raw) as { pois: POI[]; ts: number };
    if (!entry?.pois || !entry?.ts) {
      localStorage.removeItem(key);
      return null;
    }

    if (Date.now() - entry.ts >= CACHE_TTL_MS) {
      localStorage.removeItem(key);
      return null;
    }

    // Repoblar memoria desde disco
    memoryCache.set(key, entry);
    return entry.pois;
  } catch {
    // JSON corrupto o localStorage no disponible — limpiar y continuar
    try {
      localStorage.removeItem(key);
    } catch {}
    return null;
  }
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
