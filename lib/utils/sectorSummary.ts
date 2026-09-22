/**
 * Descripción del sector (barrio) de una propiedad, por categoría de POIs.
 *
 * Genera un texto breve a partir de los POIs ya obtenidos: cuenta los subtipos
 * dentro del radio caminable (15 min a pie) e indica el lugar con nombre más
 * cercano a la dirección de la propiedad.
 *
 * La misma función alimenta el popup del pin (perfil educativo) y el resumen
 * que aparece al pasar el mouse por cada botón de categoría.
 *
 * Módulo neutral (sin Leaflet ni React) para poder testearlo y reutilizarlo.
 */
import {
  poiTypeLabel,
  poiTypeLabelPlural,
  poiTypeLabelSingular,
  WALKABLE_RADIUS_M,
} from '@/lib/data/poiCategories';

export interface SectorPOIInput {
  category: string;
  type: string;
  name: string;
  lat: number;
  lng: number;
}

/** Distancia en línea recta (haversine), en metros. */
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Une ítems en español: "a, b y c". */
function joinWithY(parts: string[]): string {
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`;
}

/**
 * Descripción del sector para una categoría, o `null` si no hay POIs de esa
 * categoría dentro del radio caminable.
 *
 * Ej.: "A menos de 15 min caminando: 3 colegios, 4 jardines infantiles, 1
 * universidad y 1 instituto. Más cerca: Escuela de Contadores (Instituto, 400 m)."
 */
export function buildCategorySummary(
  pois: SectorPOIInput[],
  category: string,
  lat: number,
  lng: number,
  radiusM: number = WALKABLE_RADIUS_M
): string | null {
  // Solo lo caminable a 15 min: así el texto coincide con el superíndice del
  // botón (el fetch trae un radio mayor, 1500 m).
  const near = pois
    .filter((p) => p.category === category)
    .map((p) => ({ ...p, dist: haversineMeters(lat, lng, p.lat, p.lng) }))
    .filter((p) => p.dist <= radiusM);
  if (near.length === 0) return null;

  const counts = new Map<string, number>();
  for (const p of near) counts.set(p.type, (counts.get(p.type) || 0) + 1);

  // Lo más abundante primero; empates por orden alfabético (estable)
  const label = (type: string, n: number) =>
    n === 1 ? poiTypeLabelSingular(type) : poiTypeLabelPlural(type);

  const sorted = Array.from(counts.entries()).sort(
    (a, b) => b[1] - a[1] || label(a[0], 2).localeCompare(label(b[0], 2), 'es')
  );

  // Con muchos subtipos (Comercio tiene 8) el texto se vuelve un muro: se
  // detallan los más frecuentes y se resume el resto.
  const MAX_DETAIL = 5;
  const detallados = sorted.slice(0, MAX_DETAIL).map(([type, n]) => `${n} ${label(type, n)}`);
  const resumen =
    sorted.length > MAX_DETAIL
      ? `${near.length} lugares en ${sorted.length} tipos — ${joinWithY(detallados)}`
      : joinWithY(detallados);

  // "Más cerca" (neutro): el hablante sería "la más cercana" para una escuela
  // pero "el más cercano" para un banco — con 9 categorías no hay un género fijo.
  const named = near.filter((p) => p.name).sort((a, b) => a.dist - b.dist)[0];
  const cercania = named
    ? ` Más cerca: ${named.name} (${poiTypeLabel(named.type)}, ${Math.round(named.dist)} m).`
    : '';

  return `A menos de 15 min caminando: ${resumen}.${cercania}`;
}

/**
 * Perfil educativo del sector — atajo de `buildCategorySummary` para el popup
 * del pin de la propiedad.
 */
export function buildEducationSummary(
  pois: SectorPOIInput[],
  lat: number,
  lng: number,
  radiusM: number = WALKABLE_RADIUS_M
): string | null {
  return buildCategorySummary(pois, 'education', lat, lng, radiusM);
}

/** Resumen de todas las categorías, indexado por clave de categoría. */
export function buildSectorSummaries(
  pois: SectorPOIInput[],
  categories: string[],
  lat: number,
  lng: number,
  radiusM: number = WALKABLE_RADIUS_M
): Record<string, string | null> {
  return Object.fromEntries(
    categories.map((key) => [key, buildCategorySummary(pois, key, lat, lng, radiusM)])
  );
}
