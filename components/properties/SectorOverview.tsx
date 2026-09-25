import { Footprints, Info } from 'lucide-react';
import {
  POI_CATEGORIES,
  poiSvgMarkup,
  poiTypeLabelPlural,
  poiTypeLabelSingular,
} from '@/lib/data/poiCategories';
import type { SectorCategoryInsight } from '@/lib/utils/sectorSummary';

/**
 * Lo que la tarjeta necesita de un `SectorCategoryInsight`, y nada más.
 *
 * El texto redactado (`text`) y los lugares cercanos (`highlights`) no se
 * muestran acá, así que no se pasan: menos datos en el HTML de una página
 * pública, y una sola definición de qué es "público" para esta sección.
 */
export type SectorCard = Pick<SectorCategoryInsight, 'category' | 'count' | 'byType'>;

interface SectorOverviewProps {
  /** Una entrada por categoría con contenido; vacío = no se muestra nada. */
  insights: SectorCard[];
  /** Título de la sección. */
  title?: string;
  className?: string;
}

/** Ícono de la categoría, en el mismo formato chip que la ficha y el mapa. */
function CategoryIcon({ category, count }: { category: string; count: number }) {
  const color = POI_CATEGORIES[category]?.color || '#64748b';
  const svg = poiSvgMarkup(category, color, 18);

  return (
    <div className="relative shrink-0">
      <div
        className="w-10 h-10 rounded-xl bg-white border-2 flex items-center justify-center shadow-sm"
        style={{ borderColor: color }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {/* Contador como superíndice: la misma lectura que los chips del mapa */}
      <span
        className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 text-white text-[10px] font-bold leading-[18px] text-center rounded-full border-2 border-white"
        style={{ backgroundColor: color }}
      >
        {count}
      </span>
    </div>
  );
}

/**
 * Resumen del entorno de una propiedad por categoría de POIs.
 *
 * Se arma con datos **ya calculados** (`SectorCard`), no vuelve a contar nada:
 * la landing se renderiza en el servidor y el conteo no debe repetirse en el
 * navegador. Vive aparte de la landing porque es la pieza reutilizable — el
 * mismo bloque sirve para la ficha si se quiere.
 *
 * Muestra la categoría, cuántos lugares hay y de qué tipos, sin nombrar
 * lugares ni distancias: con una tarjeta por categoría el bloque se lee de un
 * vistazo y no compite en altura con el resto de la landing.
 *
 * Si `insights` viene vacío **no renderiza nada**: sin datos de entorno, un
 * bloque con el título y el pie de atribución pero sin contenido se lee como
 * un error de la página.
 */
export function SectorOverview({ insights, title = 'A 15 minutos caminando', className = '' }: SectorOverviewProps) {
  if (insights.length === 0) return null;

  const total = insights.reduce((sum, i) => sum + i.count, 0);

  return (
    <section className={`bg-white rounded-2xl border border-slate-200 p-6 shadow-sm ${className}`}>
      <div className="flex items-start gap-3 mb-1">
        <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
          <Footprints className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-900 leading-tight">{title}</h2>
          <p className="text-xs text-slate-500">
            {total} lugares en {insights.length} categorías, a distancia caminable de la propiedad.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-5">
        {insights.map((insight) => {
          const config = POI_CATEGORIES[insight.category];
          return (
            <div key={insight.category} className="rounded-xl border border-slate-200 p-4 bg-slate-50/50">
              <div className="flex items-start gap-3">
                <CategoryIcon category={insight.category} count={insight.count} />

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    {/* `title` con la descripción completa de la categoría: en
                        pantalla chica las píldoras se cortan */}
                    <h3 className="text-sm font-bold text-slate-900" title={config?.description}>
                      {config?.label || insight.category}
                    </h3>
                    <span className="text-[11px] font-semibold text-slate-500">
                      {insight.count} {insight.count === 1 ? 'lugar' : 'lugares'}
                    </span>
                  </div>

                  {/* Subtipos más frecuentes: es el "de qué está hecho el barrio" */}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {insight.byType.slice(0, 5).map(({ type, count }) => (
                      <span
                        key={type}
                        className="px-2 py-0.5 text-[11px] font-medium text-slate-700 bg-white border border-slate-200 rounded-full"
                      >
                        {count} {count === 1 ? poiTypeLabelSingular(type) : poiTypeLabelPlural(type)}
                      </span>
                    ))}
                    {insight.byType.length > 5 && (
                      <span className="px-2 py-0.5 text-[11px] font-medium text-slate-500">
                        +{insight.byType.length - 5} tipos más
                      </span>
                    )}
                  </div>

                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="flex items-start gap-1.5 mt-5 pt-4 border-t border-slate-100 text-[11px] text-slate-400">
        <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
        <span>
          Conteo de lugares a 15 minutos a pie (~1,2 km), sobre datos abiertos de OpenStreetMap.
        </span>
      </p>
    </section>
  );
}

export default SectorOverview;
