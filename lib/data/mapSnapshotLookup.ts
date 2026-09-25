/**
 * Geometría del sector (calles, parques y agua) del snapshot estático.
 *
 * Es la contraparte del mapa de la landing: mientras `poiSnapshotLookup` trae
 * *qué* hay en el barrio, este trae *cómo se ve*. Misma idea, mismo formato de
 * clave de celda (~11 m) y las mismas razones para existir:
 *
 * - **Sin red al abrir la página.** El enlace llega desde WhatsApp y no puede
 *   depender de Overpass ni de un proveedor de mapas.
 * - **Muy pocas veces.** El JSON pesa varios MB, así que el import es dinámico
 *   y solo se carga cuando se va a dibujar el mapa (por eso la landing necesita
 *   un solo archivo, no los dos).
 *
 * Nunca lanza: una celda ausente o un archivo corrupto solo significan «sin
 * geometría», y la landing sabe dibujar el anillo y los lugares igualmente.
 */
import { snapshotCellKey } from './poiSnapshotLookup';
import type { Area, MapSnapshot, Road } from '@/lib/utils/sectorMap';

export interface SectorGeometry {
  roads: Road[];
  areas: Area[];
}

/**
 * Geometría para la celda del punto, o `null` si esa celda no existe todavía
 * (propiedad nueva, o snapshot generado antes de ampliarlo con calles).
 */
export async function sectorGeometry(lat: number, lng: number): Promise<SectorGeometry | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  try {
    const { default: snapshot } = (await import('@/lib/data/mapSnapshot.generated.json')) as {
      default: MapSnapshot;
    };
    const cell = snapshot.cells[snapshotCellKey(lat, lng)];
    if (!cell || !cell.roads?.length) return null;

    return {
      roads: cell.roads,
      areas: Array.isArray(cell.areas) ? cell.areas : [],
    };
  } catch {
    return null;
  }
}
