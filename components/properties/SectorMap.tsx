import { Footprints, MapPin } from 'lucide-react';
import { POI_CATEGORIES } from '@/lib/data/poiCategories';
import {
  createSectorProjection,
  groupAreaPaths,
  groupRoadPaths,
  streetLabels,
  type Area,
  type Road,
} from '@/lib/utils/sectorMap';

/**
 * Mapa del sector de una propiedad, dibujado en el servidor.
 *
 * No es una imagen de un servicio en línea ni un mapa interactivo: es un SVG
 * armado con la geometría que ya bajamos al snapshot. Eso se eligió a propósito,
 * por tres razones que se refuerzan entre sí:
 *
 * 1. **La landing no le pide nada a nadie.** El enlace llega desde WhatsApp; si
 *    dependiera de un proveedor de mapas, un servicio caído (o bloqueado por la
 *    región de quien abre el enlace) dejaría un hueco en la ficha.
 * 2. **No se le paga a nadie por renderizar.** El proyecto es 100 % capas
 *    gratuitas; una imagen de mapa estática con proveedor lo cambiaría.
 * 3. **Es lo que define el barrio**: el anillo de 15 minutos a pie dibujado
 *    sobre la red real de calles, que es exactamente la regla que usan los
 *    contadores de arriba.
 *
 * Es un componente de servidor (sin `'use client'`): la página padre lo pasa
 * como `children`, así el navegador recibe el SVG ya pintado y no tiene que
 * construir miles de nodos al hidratar.
 */

interface SectorMapProps {
  /** Punto aproximado (el mismo que se publica en el HTML y el mapa). */
  lat: number;
  lng: number;
  /** Geometría de la celda, ya simplificada en el snapshot. */
  roads: Road[];
  areas: Area[];
  /** POIs dentro del radio, para pintarlos por categoría. */
  pois?: { lat: number; lng: number; category: string }[];
  /** Radio que se dibuja, en metros. */
  radiusM?: number;
  /** Texto del anillo y del texto accesible. */
  radiusLabel?: string;
}

/**
 * Tamaño del lienzo. El anillo (lado corto) fija la escala, así que reducir el
 * ancho no achica el barrio: recorta el contexto muerto a los lados y hace que
 * calles y rótulos se dibujen ~1,5× más grandes en pantalla. 800×750 es lo que
 * el recorte del snapshot llena de borde a borde.
 */
const VIEW_WIDTH = 800;
const VIEW_HEIGHT = 750;

/** Tamaño del marcador de POI, en unidades del lienzo (~6 px en pantalla). */
const MARKER_SIZE = 8;

/**
 * Si dos lugares caen encima uno del otro, el segundo no se dibuja.
 *
 * En zonas densas (una cuadra con tres farmacias) los marcadores se taparían y
 * el mapa se leería como un manchón: así se ve densidad sin amontonar. Lo que
 * no se dibuja igualmente sigue contado en los números de arriba.
 */
function placeMarkers(
  points: { x: number; y: number; category: string }[],
  placed: { x: number; y: number }[]
): { x: number; y: number; category: string }[] {
  const kept: { x: number; y: number; category: string }[] = [];
  const MIN_DISTANCE = MARKER_SIZE * 1.35;

  for (const point of points) {
    let overlaps = false;
    for (const other of placed) {
      if (Math.abs(other.x - point.x) < MIN_DISTANCE && Math.abs(other.y - point.y) < MIN_DISTANCE) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) continue;
    placed.push(point);
    kept.push(point);
  }

  return kept;
}

export function SectorMap({
  lat,
  lng,
  roads,
  areas,
  pois = [],
  radiusM = 1200,
  radiusLabel = '15 min caminando',
}: SectorMapProps) {
  const projection = createSectorProjection({
    centerLat: lat,
    centerLng: lng,
    width: VIEW_WIDTH,
    height: VIEW_HEIGHT,
    radiusM,
  });

  const roadGroups = groupRoadPaths(roads, projection);
  const areaGroups = groupAreaPaths(areas, projection);
  // Un rótulo por nombre de calle, sobre su segmento más largo.
  const labels = streetLabels(roads, projection);

  const projected = pois.map((poi) => {
    const [x, y] = projection.toXY(poi.lat, poi.lng);
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, category: poi.category };
  });

  // Se colocan en el orden en que llegan y se agrupan por categoría al final,
  // para que cada color quede en un solo elemento `<path>`.
  const placed = placeMarkers(projected, []);

  const markerPaths = new Map<string, string>();
  for (const marker of placed) {
    const d =
      `M${marker.x} ${marker.y}h${MARKER_SIZE}v${MARKER_SIZE}h-${MARKER_SIZE}Z `;
    markerPaths.set(marker.category, (markerPaths.get(marker.category) || '') + d);
  }

  const { cx, cy, r } = projection.ring;
  const hasGeometry = roadGroups.length > 0 || areaGroups.length > 0;

  return (
    <div>
      {/* El texto accesible va en `aria-label`, no en un `<title>`: el App Router
          extrae los `<title>` del árbol hacia el head y, como la página ya tiene
          uno (generateMetadata), estos hijos se descartaban. El servidor entregaba
          `<title></title>` vacío y el cliente los hijos → mismatch de texto que
          abortaba la hidratación de toda la landing ("Hydration failed"). */}
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        className="w-full h-auto block rounded-xl"
        role="img"
        aria-label={`Mapa del sector: ${roads.length} calles, con un anillo de ${radiusLabel} alrededor de la zona aproximada.`}
      >
        {/* Fondo: papel del mapa, ni blanco puro ni gris de interfaz */}
        <rect x={0} y={0} width={VIEW_WIDTH} height={VIEW_HEIGHT} fill="#f5f2ee" />

        {/* Superficies: parques y agua, por debajo de todo lo demás */}
        {areaGroups.map((area) => (
          <path
            key={area.key}
            d={area.d}
            fill={area.fill}
            stroke={area.stroke}
            strokeWidth={1}
            fillOpacity={0.9}
          />
        ))}

        {/* Contornos de las calles, todos juntos por estilo */}
        {roadGroups.map((road) =>
          road.style.casing ? (
            <path
              key={`casing-${road.key}`}
              d={road.d}
              fill="none"
              stroke={road.style.casing}
              strokeWidth={road.style.width + 1.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null
        )}

        {/* Rellenos de las calles */}
        {roadGroups.map((road) => (
          <path
            key={`fill-${road.key}`}
            d={road.d}
            fill="none"
            stroke={road.style.fill}
            strokeWidth={road.style.width}
            strokeDasharray={road.style.dash}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {/* Zona caminable: un tinte suave y el contorno punteado encima de las calles */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="#2563eb"
          fillOpacity={0.05}
          stroke="#2563eb"
          strokeWidth={2.5}
          strokeDasharray="10 8"
          strokeOpacity={0.7}
        />

        {/* Nombres de calles: halo blanco (paint-order) para que el texto se
            lea encima de cualquier trazo, y rumbo de la calle en vez de
            horizontal — es como rotula un mapa. Van después del anillo para
            que el disco azul no tiña el texto. */}
        {labels.map((label) => (
          <text
            key={label.key}
            transform={`translate(${label.x} ${label.y}) rotate(${label.angle})`}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={label.fontSize}
            fontWeight={label.fontSize >= 16 ? 600 : 500}
            fill={label.fontSize >= 16 ? '#1f2937' : '#334155'}
            stroke="#ffffff"
            strokeWidth={3.2}
            strokeLinejoin="round"
            paintOrder="stroke"
            fontFamily="system-ui, sans-serif"
          >
            {label.text}
          </text>
        ))}

        {/* Etiqueta del anillo, sobre el borde superior */}
        <g transform={`translate(${cx}, ${cy - r})`}>
          <rect
            x={-64}
            y={-13}
            width={128}
            height={26}
            rx={13}
            fill="#ffffff"
            stroke="#2563eb"
            strokeOpacity={0.35}
          />
          <text
            x={0}
            y={5}
            textAnchor="middle"
            fontSize={14}
            fontWeight={700}
            fill="#1d4ed8"
            fontFamily="system-ui, sans-serif"
          >
            {radiusLabel}
          </text>
        </g>

        {/* Lugares, un solo trazo por categoría (color de la leyenda) */}
        {Array.from(markerPaths.entries()).map(([category, d]) => (
          <path
            key={category}
            d={d}
            fill={POI_CATEGORIES[category]?.color || '#94a3b8'}
            stroke="#ffffff"
            strokeWidth={1}
            strokeOpacity={0.9}
          />
        ))}

        {/* Punto aproximado: el marcador blanco/azul de las dos mitades */}
        <circle cx={cx} cy={cy} r={9} fill="#ffffff" stroke="#2563eb" strokeWidth={2.5} />
        <circle cx={cx} cy={cy} r={3.5} fill="#2563eb" />
      </svg>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 mt-2 text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <Footprints className="w-3.5 h-3.5 text-blue-600 shrink-0" />
          Anillo de {radiusLabel} alrededor de la zona aproximada
        </span>
        <span className="flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          {hasGeometry ? 'Datos © colaboradores de OpenStreetMap' : 'Sin geometría disponible'}
        </span>
      </div>
    </div>
  );
}
