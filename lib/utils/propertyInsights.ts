/**
 * Velocímetros de la ficha en arriendo: **precio frente al mercado** y **demanda**
 * (visitas). Módulo puro: recibe la propiedad, los comparables y el contador de
 * visitas ya leídos, y devuelve los números que pinta la UI. Así las reglas
 * (qué es un comparable, cuándo se considera «en el mercado», cómo se llena un
 * arco) se prueban sin tocar Supabase ni el navegador.
 *
 * No hay ningún campo de «precio de mercado» en el modelo, y no lo va a haber:
 * el mercado no es un dato de la propiedad, es lo que hacen las otras. Por eso
 * el precio de mercado se **deriva de comparables** (mismo tipo de propiedad y
 * misma ciudad, con la comuna/región como respaldo) y, si no hay muestra
 * suficiente, el velocímetro lo dice en vez de inventar un número.
 */

import type { Property } from '@/lib/types/property';

export type MarketPosition = 'below' | 'at' | 'above' | 'unknown';

/** Muestra mínima de comparables para atreverse a hablar de «mercado». */
export const MIN_COMPARABLES = 3;

/** Banda alrededor de la mediana que se considera «en el mercado» (±5 %). */
export const AT_MARKET_BAND = 0.05;

/** Desvío (±30 %) que llena el velocímetro de punta a punta. */
export const MAX_DEVIATION = 0.3;

/** Visitas que se toman como «interés máximo» en el velocímetro de demanda. */
export const DEMAND_REFERENCE_VIEWS = 150;

/** Campos que hacen falta para comparar contra el mercado. */
type ComparableProperty = Pick<
  Property,
  'id' | 'price' | 'property_type' | 'status' | 'city' | 'state' | 'area_sqm'
>;

export interface MarketComparison {
  /** `unknown` = no hay comparables suficientes; la UI no muestra un número. */
  position: MarketPosition;
  /** Mediana del precio por m² de los comparables (CLP), o `0` si no hay datos. */
  medianPerSqm: number;
  /** Precio por m² de la propiedad comparada (CLP), o `0` si no hay datos. */
  propertyPerSqm: number;
  /** Desvío con signo frente a la mediana. Negativo = más barato que el mercado. */
  deviationPct: number;
  /** Cuántos comparables entraron en la mediana. */
  sampleSize: number;
  /** De dónde salieron los comparables; `none` = sin muestra. */
  scope: 'city' | 'state' | 'none';
}

export type DemandLevel = 'low' | 'medium' | 'high';

export interface DemandMeter {
  /** Visitas contadas, normalizadas a entero ≥ 0. */
  views: number;
  level: DemandLevel;
  /** Relleno del arco, entre 0 y 1. */
  gauge: number;
}

/** Lo que el servidor resuelve y le baja a la ficha en arriendo. */
export interface RentInsights {
  market: MarketComparison;
  /** Visitas acumuladas al momento del render. */
  views: number;
  /**
   * `false` = el conteo salió del respaldo en memoria (sin Supabase) y se
   * perderá al reiniciar: la UI lo rotula como conteo de prueba.
   */
  viewsPersisted: boolean;
}

export const MARKET_LABELS: Record<MarketPosition, string> = {
  below: 'Bajo el mercado',
  at: 'En el mercado',
  above: 'Sobre el mercado',
  unknown: 'Sin datos de mercado',
};

export const DEMAND_LABELS: Record<DemandLevel, string> = {
  low: 'Interés bajo',
  medium: 'Interés medio',
  high: 'Interés alto',
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function normalize(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase();
}

/** Precio por m², o `0` si la superficie no sirve para dividir. */
export function pricePerSqm(property: Pick<Property, 'price' | 'area_sqm'>): number {
  return property.area_sqm > 0 ? property.price / property.area_sqm : 0;
}

/**
 * Comparables directos: mismo arriendo, mismo tipo y **misma ciudad**. La
 * propiedad comparada se excluye de su propia muestra.
 */
export function findComparables(
  property: ComparableProperty,
  pool: readonly ComparableProperty[]
): ComparableProperty[] {
  const city = normalize(property.city);
  if (!city) return [];

  return pool.filter(
    (candidate) =>
      candidate.id !== property.id &&
      candidate.status === 'for_rent' &&
      candidate.property_type === property.property_type &&
      normalize(candidate.city) === city &&
      pricePerSqm(candidate) > 0
  );
}

/** Comparables más laxos: mismo tipo y misma región, para cuando la ciudad no da. */
function findStateComparables(
  property: ComparableProperty,
  pool: readonly ComparableProperty[]
): ComparableProperty[] {
  const state = normalize(property.state);
  if (!state) return [];

  return pool.filter(
    (candidate) =>
      candidate.id !== property.id &&
      candidate.status === 'for_rent' &&
      candidate.property_type === property.property_type &&
      normalize(candidate.state) === state &&
      pricePerSqm(candidate) > 0
  );
}

/** Mediana de una lista de números (promedio de los dos centrales si es par). */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * Posición del precio frente al mercado, comparando **precio por m²** (no el
 * precio total: dos arriendos del mismo tipo y comuna se diferencian sobre todo
 * por superficie, y comparar totales premiaría a las propiedades más grandes).
 *
 * Orden: ciudad primero, región como respaldo; si ninguna junta la muestra
 * mínima, `unknown` en vez de un juicio con dos datos.
 */
export function compareToMarket(
  property: ComparableProperty,
  pool: readonly ComparableProperty[]
): MarketComparison {
  const propertyPerSqm = pricePerSqm(property);

  const empty: MarketComparison = {
    position: 'unknown',
    medianPerSqm: 0,
    propertyPerSqm,
    deviationPct: 0,
    sampleSize: 0,
    scope: 'none',
  };

  if (propertyPerSqm <= 0) return empty;

  const byCity = findComparables(property, pool);
  const byState = byCity.length >= MIN_COMPARABLES ? [] : findStateComparables(property, pool);

  const scope: 'city' | 'state' | 'none' =
    byCity.length >= MIN_COMPARABLES ? 'city' : byState.length >= MIN_COMPARABLES ? 'state' : 'none';

  if (scope === 'none') return empty;

  const comparables = scope === 'city' ? byCity : byState;
  const medianPerSqm = median(comparables.map(pricePerSqm));
  if (medianPerSqm <= 0) return empty;

  const deviationPct = (propertyPerSqm - medianPerSqm) / medianPerSqm;

  return {
    position: marketPositionFromDeviation(deviationPct),
    medianPerSqm,
    propertyPerSqm,
    deviationPct,
    sampleSize: comparables.length,
    scope,
  };
}

/** Traduce un desvío con signo a la etiqueta de mercado (banda muerta ±5 %). */
export function marketPositionFromDeviation(deviationPct: number): MarketPosition {
  if (!Number.isFinite(deviationPct)) return 'unknown';
  if (Math.abs(deviationPct) <= AT_MARKET_BAND) return 'at';
  return deviationPct < 0 ? 'below' : 'above';
}

/**
 * Relleno del arco de precio: `0.5` = en el mercado, `1` = muy por debajo,
 * `0` = muy por encima. Se satura en `MAX_DEVIATION`.
 */
export function marketGaugeValue(deviationPct: number): number {
  return clamp01(0.5 - deviationPct / (2 * MAX_DEVIATION));
}

/**
 * Nivel de demanda a partir de las visitas.
 *
 * El tope de escala es una referencia fija y honesta: con pocos datos todavía no
 * hay una distribución real de visitas por propiedad que permita un percentil.
 * Cuando la haya, este módulo es el único lugar que hay que cambiar.
 */
export function demandMeter(
  views: number,
  reference: number = DEMAND_REFERENCE_VIEWS
): DemandMeter {
  const normalized = Math.max(0, Math.floor(Number(views) || 0));
  const gauge = reference > 0 ? clamp01(normalized / reference) : 0;
  const level: DemandLevel = gauge < 0.34 ? 'low' : gauge < 0.67 ? 'medium' : 'high';
  return { views: normalized, level, gauge };
}

/** Porcentaje con signo y una decimal, para mostrar el desvío. */
export function formatDeviation(deviationPct: number): string {
  const pct = deviationPct * 100;
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : '';
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}
