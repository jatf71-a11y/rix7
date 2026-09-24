/**
 * Proyección y trazado del mapa del sector que dibuja la landing compartible.
 *
 * El mapa de la landing no es una imagen de un servicio en línea: se dibuja en
 * SVG con la geometría que ya bajamos al snapshot (`mapSnapshot.generated.json`),
 * así la página no le pide nada a nadie al abrirse, no depende de que un
 * servidor externo esté arriba, y pesa unos KB en vez de decenas de imágenes.
 *
 * Módulo puro, sin React: la proyección es la parte que se equivoca sin que se
 * note (un eje invertido, un metro que no es un metro, un anillo que se sale
 * del lienzo), así que se prueba aparte.
 *
 * La proyección es **local y equirectangular con corrección por latitud**, que
 * es exacta a esta escala: un mapa de ~2,9 km de ancho alrededor de un punto no
 * tiene distorsión apreciable, y evita traer Web Mercator para cuatro líneas.
 */

/** Geometría de una vía o superficie: lista de [lat, lng]. */
export type MapRing = number[][];

export interface Road {
  /** Clase `highway` de OSM. */
  c: string;
  n: MapRing;
  /** Nombre de la calle (tag `name` de OSM); ausente si no tiene. */
  name?: string;
}

export interface Area {
  /** `water` | `park`. */
  k: string;
  n: MapRing;
}

export interface MapSnapshotCell {
  lat: number;
  lng: number;
  roads: Road[];
  areas: Area[];
  /** `true` cuando la celda se guardó con nombres de calle (snapshot v2). */
  named?: boolean;
}

export interface MapSnapshot {
  generated_at: string | null;
  cells: Record<string, MapSnapshotCell>;
}

/** Metros por grado de latitud. */
const M_PER_DEG_LAT = 111_320;

export interface ProjectionOptions {
  centerLat: number;
  centerLng: number;
  /** Ancho y alto del `viewBox`. */
  width: number;
  height: number;
  /** Radio que se quiere dibujar (15 minutos a pie, ~1.200 m). */
  radiusM: number;
  /** Separación en unidades entre el anillo y el borde del lienzo. */
  ringMargin?: number;
}

export interface SectorProjection {
  width: number;
  height: number;
  radiusM: number;
  /** Unidades por metro: es la escala que hace que el anillo entre justo. */
  unitsPerMeter: number;
  /** Círculo del radio caminable, ya en unidades del lienzo. */
  ring: { cx: number; cy: number; r: number };
  toXY(lat: number, lng: number): [number, number];
}

/**
 * Proyección centrada en el punto de la propiedad, con el anillo de 15 minutos
 * ajustado al lado corto del lienzo (siempre cabe, y el excedente de ancho da
 * contexto del barrio alrededor).
 *
 * El eje Y va hacia abajo en SVG, así que el norte se resta: sin eso, las calles
 * quedarían espejadas y ninguna ciudad reconocible sería reconocible.
 */
export function createSectorProjection(options: ProjectionOptions): SectorProjection {
  const { centerLat, centerLng, width, height } = options;
  const ringMargin = options.ringMargin ?? 40;

  // Un radio vacío o negativo no puede ser la escala del mapa: con 0 se dividiría
  // entre cero y toda la geometría saldría en Inf, que en SVG es "no dibuja nada".
  const radiusM = Number.isFinite(options.radiusM) && options.radiusM > 1 ? options.radiusM : 1200;

  const halfShort = Math.min(width, height) / 2;
  const ringRadius = Math.max(1, Math.max(halfShort - ringMargin, halfShort * 0.2));
  const unitsPerMeter = ringRadius / radiusM;

  const mPerDegLng = M_PER_DEG_LAT * Math.max(Math.cos((centerLat * Math.PI) / 180), 0.01);
  const kx = unitsPerMeter * mPerDegLng;
  const ky = unitsPerMeter * M_PER_DEG_LAT;
  const cx = width / 2;
  const cy = height / 2;

  return {
    width,
    height,
    radiusM,
    unitsPerMeter,
    ring: { cx, cy, r: ringRadius },
    toXY(lat, lng) {
      return [cx + (lng - centerLng) * kx, cy - (lat - centerLat) * ky];
    },
  };
}

/**
 * Convierte una polilínea geográfica en el atributo `d` de SVG.
 *
 * Las coordenadas se redondean a una decimal: a esta escala (una unidad ≈ 4 m)
 * una decimal es imperceptible y ahorra ~6 caracteres por nodo en un HTML que
 * se sirve cacheado y llega completo al navegador.
 *
 * No se recorta nada por fuera del lienzo: SVG ya corta lo que se sale del
 * `viewBox`, y dejar las vías completas hace que el borde se vea continuo en
 * lugar de cortado a media cuadra.
 */
export function polylinePath(
  coords: MapRing,
  projection: SectorProjection,
  precision = 1
): string {
  if (!coords || coords.length < 2) return '';

  const factor = 10 ** precision;
  const round = (v: number) => Math.round(v * factor) / factor;

  let d = '';
  for (const point of coords) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const [x, y] = projection.toXY(point[0], point[1]);
    d += `${d ? 'L' : 'M'}${round(x)} ${round(y)} `;
  }

  return d.trim();
}

/** Fondo y estilo de cada clase de vía, agrupados por clase para el dibujo. */
export interface RoadStyle {
  /** Grosor en unidades del lienzo. */
  width: number;
  /** Color del relleno (el trazo visible). */
  fill: string;
  /** Color del contorno, si lo hay. */
  casing?: string;
  /** Trazo discontinuo, para senderos. */
  dash?: string;
}

const ROAD_STYLES: Record<string, RoadStyle> = {
  motorway: { width: 9, fill: '#f59e0b', casing: '#d97706' },
  trunk: { width: 9, fill: '#f59e0b', casing: '#d97706' },
  primary: { width: 7, fill: '#fbbf24', casing: '#d97706' },
  secondary: { width: 6, fill: '#fcd34d', casing: '#d97706' },
  tertiary: { width: 5, fill: '#fde68a', casing: '#d97706' },
  residential: { width: 4, fill: '#ffffff', casing: '#cbd5e1' },
  unclassified: { width: 4, fill: '#ffffff', casing: '#cbd5e1' },
  living_street: { width: 4, fill: '#ffffff', casing: '#cbd5e1' },
  service: { width: 2.5, fill: '#ffffff', casing: '#d4d4d8' },
  pedestrian: { width: 3.5, fill: '#fafaf9', casing: '#d4d4d8' },
  footway: { width: 1.5, fill: '#a1a1aa', dash: '4 4' },
  path: { width: 1.5, fill: '#a1a1aa', dash: '4 4' },
  cycleway: { width: 1.5, fill: '#86efac', dash: '6 4' },
};

/** Estilo de una clase de vía; los enlaces (`_link`) heredan su clase base. */
export function roadStyle(highwayClass: string): RoadStyle {
  if (ROAD_STYLES[highwayClass]) return ROAD_STYLES[highwayClass];

  const base = highwayClass.endsWith('_link')
    ? highwayClass.replace(/_link$/, '')
    : highwayClass;
  if (ROAD_STYLES[base]) return ROAD_STYLES[base];

  // Sin estilo conocido se dibuja como calle menor: mejor que no aparezca que
  // romper el mapa con un trazo gigante por una clase que nadie anticipó.
  return ROAD_STYLES.residential;
}

/** Estilo de las superficies (parques y agua). */
export const AREA_STYLES: Record<string, { fill: string; stroke: string }> = {
  park: { fill: '#dcfce7', stroke: '#86efac' },
  water: { fill: '#bfdbfe', stroke: '#93c5fd' },
};

/**
 * Agrupa las vías por clase de trazo y arma un solo `d` por estilo.
 *
 * Un mapa con miles de vías daría miles de elementos `<path>`; acá hay dos por
 * estilo (contorno y relleno), porque SVG admite varias subtrazas en un mismo
 * `d`. El HTML de la landing baja a decenas de nodos en vez de miles.
 */
export function groupRoadPaths(
  roads: Road[],
  projection: SectorProjection
): { key: string; style: RoadStyle; d: string }[] {
  const groups = new Map<string, { style: RoadStyle; d: string }>();

  for (const road of roads) {
    const d = polylinePath(road.n, projection);
    if (!d) continue;
    const key = `${road.c}`;
    const existing = groups.get(key);
    if (existing) existing.d += ` ${d}`;
    else groups.set(key, { style: roadStyle(road.c), d });
  }

  return Array.from(groups.entries()).map(([key, value]) => ({ key, style: value.style, d: value.d }));
}

/** Igual que `groupRoadPaths`, para las superficies. */
export function groupAreaPaths(
  areas: Area[],
  projection: SectorProjection
): { key: string; fill: string; stroke: string; d: string }[] {
  const groups = new Map<string, { fill: string; stroke: string; d: string }>();

  for (const area of areas) {
    const d = polylinePath(area.n, projection);
    if (!d) continue;
    const style = AREA_STYLES[area.k];
    if (!style) continue;
    const existing = groups.get(area.k);
    // Se cierra el polígono para que el relleno tenga forma.
    const closed = d.length > 0 ? `${d} Z` : '';
    if (existing) existing.d += ` ${closed}`;
    else groups.set(area.k, { fill: style.fill, stroke: style.stroke, d: closed });
  }

  return Array.from(groups.entries()).map(([key, value]) => ({ key, ...value }));
}

/** Puntos de POI proyectados, para dibujarlos sobre el mapa. */
export function projectPoints(
  points: { lat: number; lng: number }[],
  projection: SectorProjection,
  precision = 1
): [number, number][] {
  const factor = 10 ** precision;
  const out: [number, number][] = [];
  for (const point of points) {
    const [x, y] = projection.toXY(point.lat, point.lng);
    out.push([Math.round(x * factor) / factor, Math.round(y * factor) / factor]);
  }
  return out;
}

// ═══ Rótulos de calle ═══

/** Nombres que se rotulan, de mayor a menor importancia (0 = fuente grande). */
const LABEL_RANK: Record<string, number> = {
  motorway: 0,
  trunk: 0,
  primary: 0,
  secondary: 0,
  tertiary: 1,
  pedestrian: 1,
  living_street: 1,
  residential: 1,
  unclassified: 1,
};

/** Rango de una clase; los enlaces (`_link`) heredan su clase base. */
function labelRank(highwayClass: string): number | undefined {
  if (LABEL_RANK[highwayClass] !== undefined) return LABEL_RANK[highwayClass];
  const base = highwayClass.endsWith('_link')
    ? highwayClass.replace(/_link$/, '')
    : highwayClass;
  return LABEL_RANK[base];
}

/** Nombres más largos que esto sobresalirían del mapa y se descartan. */
const LABEL_MAX_CHARS = 34;

export interface StreetLabel {
  /** Nombre de la calle: único por construcción (un rótulo por nombre). */
  key: string;
  text: string;
  x: number;
  y: number;
  /** Grados en [-90, 90): el texto nunca queda boca abajo. */
  angle: number;
  fontSize: number;
}

interface LabelCandidate extends StreetLabel {
  rank: number;
  segLen: number;
}

/**
 * Rótulos de las calles, para dibujarlos sobre el mapa del sector.
 *
 * Un mapa sin nombres no dice nada («¿dónde queda esto?»), pero rotular cada
 * fragmento dejaría el lienzo ilegible: una cuadra es una vía de OSM y la calle
 * entera puede ser veinte. Por eso:
 *
 * - **Un rótulo por nombre**, anclado al segmento más largo de esa calle: es el
 *   tramo más recto, el que mejor sostiene el texto.
 * - **Solo clases rotulables** (nada de senderos ni accesos de estacionamiento)
 *   y con un mínimo de largo, para que el texto no pise una esquina.
 * - **Colisión por caja**: si el rótulo siguiente cae encima de uno ya puesto se
 *   descarta — la calle sigue existiendo, solo no se nombra dos veces junto.
 * - **Orden por importancia**: primero avenidas, después calles; el tope `max`
 *   corta por la cola, no por la azar.
 *
 * Módulo puro: la proyección hace todo el trabajo, acá solo se decide dónde va
 * cada nombre, que es la parte que se equivoca sin que se note (rótulos patas
 * arriba, apilados o faltantes).
 */
export function streetLabels(
  roads: Road[],
  projection: SectorProjection,
  options: { max?: number; minSegmentUnits?: number } = {}
): StreetLabel[] {
  const max = options.max ?? 48;
  const minSegment = options.minSegmentUnits ?? 50;

  const bestByName = new Map<string, LabelCandidate>();

  for (const road of roads) {
    const raw = road.name?.split(';')[0].trim();
    if (!raw || raw.length > LABEL_MAX_CHARS) continue;
    const rank = labelRank(road.c);
    if (rank === undefined) continue;
    const pts = road.n;
    if (!Array.isArray(pts) || pts.length < 2) continue;

    // Segmento más largo (en unidades del lienzo) de esta vía.
    let best: { x: number; y: number; angle: number; len: number } | null = null;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) continue;
      const [x1, y1] = projection.toXY(a[0], a[1]);
      const [x2, y2] = projection.toXY(b[0], b[1]);
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (best && len <= best.len) continue;
      let angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
      // El texto se lee de izquierda a derecha: un rumbo oeste queda en 0°, no
      // en 180° (boca abajo), y el sur se normaliza a -90°.
      if (angle >= 90) angle -= 180;
      if (angle < -90) angle += 180;
      best = { x: (x1 + x2) / 2, y: (y1 + y2) / 2, angle, len };
    }
    if (!best || best.len < minSegment) continue;

    // Un punto medio fuera del lienzo no se dibuja (SVG corta en el viewBox),
    // pero aun así consumiría cupo del tope: con el desplazamiento del punto
    // difuminado el recorte del snapshot alcanza ~230 m más allá del encuadre,
    // y esos rótulos invisibles desplazaban a los que sí se ven.
    if (
      best.x < 0 ||
      best.x > projection.width ||
      best.y < 0 ||
      best.y > projection.height
    ) {
      continue;
    }

    const key = raw.toLowerCase();
    const prev = bestByName.get(key);
    // Misma calle en varias vías: manda la más larga; si empata, la de clase
    // más importante (un nombre no debe perder contra un empate sin más).
    if (!prev || best.len > prev.segLen || (best.len === prev.segLen && rank < prev.rank)) {
      bestByName.set(key, {
        key: raw,
        text: raw,
        x: Math.round(best.x * 10) / 10,
        y: Math.round(best.y * 10) / 10,
        angle: Math.round(best.angle),
        fontSize: rank === 0 ? 16 : 14,
        rank,
        segLen: best.len,
      });
    }
  }

  const ordered = Array.from(bestByName.values()).sort(
    (a, b) => a.rank - b.rank || b.segLen - a.segLen || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0)
  );

  const placed: LabelCandidate[] = [];
  for (const candidate of ordered) {
    if (placed.length >= max) break;
    // Caja aproximada del texto; si el rótulo va casi vertical, gira con él.
    const w = (candidate.text.length * candidate.fontSize * 58) / 100;
    const h = candidate.fontSize * 1.35;
    const [bw, bh] = Math.abs(candidate.angle) > 45 ? [h, w] : [w, h];

    const collides = placed.some((other) => {
      const ow = (other.text.length * other.fontSize * 58) / 100;
      const oh = other.fontSize * 1.35;
      const [obw, obh] = Math.abs(other.angle) > 45 ? [oh, ow] : [ow, oh];
      // Las calles paralelas del cuadrículado quedan ~15-30 u una sobre otra:
      // un tope estricto borraría la mitad del cuadrado, así que se tolera algo
      // de cercanía vertical (×1.2) y solo se evita el texto encabalgado.
      return (
        Math.abs(candidate.x - other.x) < (bw + obw) / 2 &&
        Math.abs(candidate.y - other.y) < ((bh + obh) / 2) * 1.2
      );
    });
    if (collides) continue;
    placed.push(candidate);
  }

  return placed.map(({ rank: _rank, segLen: _segLen, ...label }) => label);
}
