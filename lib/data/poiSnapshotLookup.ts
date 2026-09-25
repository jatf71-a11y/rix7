/**
 * POIs del snapshot estático del build, para un punto concreto.
 *
 * Es la vía **sin red** de obtener el entorno de una propiedad: el snapshot se
 * regenera con `npm run snapshot:pois` y el job diario de GitHub Actions, y
 * cubre las celdas de ~11 m de las propiedades del catálogo.
 *
 * Se usa desde el servidor (la landing compartible y su metadata). El cliente
 * sigue usando `/api/pois`, que consulta Overpass en vivo y cae al mismo
 * snapshot solo como último recurso.
 *
 * El import del JSON es **dinámico** a propósito, igual que en la API route:
 * pesa varios MB y quien no necesita el entorno no debe pagar su lectura. La
 * primera llamada de cada proceso lo carga; las siguientes reutilizan el
 * módulo ya importado.
 */
import type { SectorPOIInput } from '@/lib/utils/sectorSummary';

/**
 * Radio del **pool** de POIs que guarda cada celda del snapshot.
 *
 * Debe coincidir con el `around:1500` de `app/api/pois/route.ts` y de
 * `scripts/generate-poi-snapshot.mjs`: es lo que garantiza que el pool alcance
 * para medir el radio caminable desde un punto desplazado.
 *
 * La invariante que sostiene todo esto: **pool ≥ caminable + desplazamiento
 * máximo** (1500 ≥ 1200 + 230). Si se amplía el difuminado o se encoge el pool,
 * la landing pierde lugares cercanos sin dar ningún error. Hay un test que lo
 * vigila.
 */
export const SNAPSHOT_POOL_RADIUS_M = 1500;

/** Un POI tal como viene en el snapshot (más compacto que el de la API). */
export interface SnapshotPoi {
  id: number;
  lat: number;
  lng: number;
  name?: string;
  type: string;
  category: string;
}

interface PoiSnapshotCell {
  lat: number;
  lng: number;
  pois: SnapshotPoi[];
}

interface PoiSnapshot {
  generated_at: string;
  cells: Record<string, PoiSnapshotCell>;
}

export interface SnapshotLookup {
  pois: SectorPOIInput[];
  /** Fecha de generación del snapshot, tal como quedó en el build. */
  generatedAt: string;
}

/**
 * Clave de celda del snapshot: coordenadas redondeadas a 4 decimales (~11 m).
 *
 * Tiene que coincidir **exactamente** con la que usan la API route y
 * `scripts/generate-poi-snapshot.mjs`; si una de las tres cambia, el snapshot
 * deja de encontrarse y el fallback pasa a ser silenciosamente inútil.
 * De ahí que sea una función exportada y no un `toFixed(4)` repetido.
 */
export function snapshotCellKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)}_${lng.toFixed(4)}`;
}

/**
 * POIs precacheados para la celda del punto, o `null` si esa celda no está en
 * el snapshot (propiedad nueva, o fuera del catálogo que se generó).
 *
 * Nunca lanza: un snapshot ausente o corrupto solo significa "sin datos", que
 * la landing sabe manejar ocultando la sección de entorno.
 */
export async function poisFromSnapshot(lat: number, lng: number): Promise<SnapshotLookup | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  try {
    const { default: snapshot } = (await import('@/lib/data/poiSnapshot.generated.json')) as {
      default: PoiSnapshot;
    };
    const cell = snapshot.cells[snapshotCellKey(lat, lng)];
    if (!cell || cell.pois.length === 0) return null;

    return {
      pois: cell.pois.map((p) => ({
        category: p.category,
        type: p.type,
        name: p.name || '',
        lat: p.lat,
        lng: p.lng,
      })),
      generatedAt: snapshot.generated_at,
    };
  } catch {
    return null;
  }
}
