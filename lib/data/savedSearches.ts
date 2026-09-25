import { PropertyType } from '@/lib/types/property';
import type { PropertyFilterParams } from './propertyFilters';
import { normalizeForSearch } from '@/lib/utils/text';
import { getPropertyTypeLabel } from '@/lib/utils/formatters';

/**
 * Búsquedas guardadas: le dan un propósito a la cuenta.
 *
 * La persona guarda lo que estaba buscando y recibe un correo cuando aparece una
 * propiedad que encaja. Para que el aviso sea creíble, los filtros guardados se
 * traducen a los **mismos parámetros** que usa el buscador
 * (`lib/data/propertyFilters`), así el correo nunca anuncia algo que al abrirlo
 * no está en la búsqueda.
 *
 * Módulo puro y compartido: lo usan el cliente (para guardar), el servidor (para
 * validar y para el job de alertas) y los tests.
 */

export type SavedSearchOperation = 'for_sale' | 'for_rent' | 'all';
export type SavedSearchNewType = 'proyectos' | 'entrega_inmediata' | null;

export interface SavedSearchFilters {
  operation: SavedSearchOperation;
  propertyType: PropertyType | 'all';
  newPropertyType: SavedSearchNewType;
  /** Comuna tal como la escribió la persona (se normaliza al filtrar). */
  commune: string | null;
  /** Región tal como la escribió la persona (se normaliza al filtrar). */
  region: string | null;
  searchQuery: string;
  minPrice: number | null;
  maxPrice: number | null;
  minBedrooms: number | null;
  minBathrooms: number | null;
  minPrivates: number | null;
}

export interface SavedSearch {
  id: string;
  userId: string;
  filters: SavedSearchFilters;
  label: string;
  notify: boolean;
  createdAt: string;
  lastNotifiedAt: string | null;
}

/** Fila de `public.saved_searches`. */
export interface SavedSearchRow {
  id: string;
  user_id: string;
  filters: unknown;
  label: string | null;
  notify: boolean | null;
  created_at: string;
  last_notified_at: string | null;
}

export const SAVED_SEARCH_COLUMNS =
  'id, user_id, filters, label, notify, created_at, last_notified_at';

const OPERATIONS: SavedSearchOperation[] = ['for_sale', 'for_rent', 'all'];

const PROPERTY_TYPES: Array<PropertyType | 'all'> = [
  'all',
  'apartment',
  'house',
  'premium',
  'parcel',
  'office',
  'land',
  'parking',
  'local',
  'warehouse',
];

/** Límites de longitud para no guardar textos abusivos. */
const MAX_TEXT = 120;
const MAX_PLACE = 80;

export type FiltersValidation =
  | { ok: true; filters: SavedSearchFilters }
  | { ok: false; error: string };

function readText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, max);
}

function readPlace(value: unknown): string | null {
  const text = readText(value, MAX_PLACE);
  return text.length > 0 ? text : null;
}

/** Número opcional: acepta cadenas numéricas (vienen de un formulario) y descarta el resto. */
function readNumber(value: unknown, { integer = false } = {}): number | null {
  if (value === null || value === undefined || value === '') return null;

  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(parsed) || parsed < 0) return null;

  return integer ? Math.floor(parsed) : parsed;
}

/**
 * Valida y normaliza los filtros que llegan del navegador.
 *
 * Se es estricto con lo que no se reconoce: un filtro raro guardado en la base
 * haría que el job de alertas comparara contra algo sin sentido y mandara
 * correos equivocados.
 */
export function normalizeSavedSearchFilters(input: unknown): FiltersValidation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Filtros inválidos.' };
  }

  const raw = input as Record<string, unknown>;

  const operation = (OPERATIONS.includes(raw.operation as SavedSearchOperation)
    ? raw.operation
    : 'all') as SavedSearchOperation;

  const propertyType = (PROPERTY_TYPES.includes(raw.propertyType as PropertyType | 'all')
    ? raw.propertyType
    : 'all') as PropertyType | 'all';

  const newPropertyType = (
    raw.newPropertyType === 'proyectos' || raw.newPropertyType === 'entrega_inmediata'
      ? raw.newPropertyType
      : null
  ) as SavedSearchNewType;

  const filters: SavedSearchFilters = {
    operation,
    propertyType,
    newPropertyType,
    commune: readPlace(raw.commune),
    region: readPlace(raw.region),
    searchQuery: readText(raw.searchQuery, MAX_TEXT),
    minPrice: readNumber(raw.minPrice),
    maxPrice: readNumber(raw.maxPrice),
    minBedrooms: readNumber(raw.minBedrooms, { integer: true }),
    minBathrooms: readNumber(raw.minBathrooms),
    minPrivates: readNumber(raw.minPrivates, { integer: true }),
  };

  // Un rango invertido nunca devolvería nada: mejor rechazarlo que guardar una
  // búsqueda que jamás va a avisar.
  if (filters.minPrice !== null && filters.maxPrice !== null && filters.minPrice > filters.maxPrice) {
    return { ok: false, error: 'El precio mínimo no puede ser mayor que el máximo.' };
  }

  // Si no hay ningún filtro, el aviso sería "todo el catálogo".
  if (!hasAnyFilter(filters)) {
    return { ok: false, error: 'Elige al menos un filtro para guardar la búsqueda.' };
  }

  return { ok: true, filters };
}

/** Filtros sin acotar nada. Se usa como respaldo cuando unos filtros guardados
 *  quedaran inservibles (por ejemplo, guardados por una versión anterior). */
export const EMPTY_SAVED_SEARCH_FILTERS: SavedSearchFilters = {
  operation: 'all',
  propertyType: 'all',
  newPropertyType: null,
  commune: null,
  region: null,
  searchQuery: '',
  minPrice: null,
  maxPrice: null,
  minBedrooms: null,
  minBathrooms: null,
  minPrivates: null,
};

/**
 * ¿Esta búsqueda debe generar avisos?
 *
 * Hace falta que la persona no la haya silenciado **y** que acote algo: avisar
 * "hay 4.000 propiedades nuevas" no le sirve a nadie.
 */
export function isNotifiable(search: SavedSearch): boolean {
  return search.notify && hasAnyFilter(search.filters);
}

/** ¿La búsqueda acota algo, o es "todo"? */
export function hasAnyFilter(filters: SavedSearchFilters): boolean {
  return (
    filters.operation !== 'all' ||
    filters.propertyType !== 'all' ||
    filters.newPropertyType !== null ||
    !!filters.commune ||
    !!filters.region ||
    !!filters.searchQuery ||
    filters.minPrice !== null ||
    filters.maxPrice !== null ||
    filters.minBedrooms !== null ||
    filters.minBathrooms !== null ||
    filters.minPrivates !== null
  );
}

/** Formato de pesos chilenos sin decimales, para etiquetas y correos. */
export function formatClp(value: number): string {
  return `$${new Intl.NumberFormat('es-CL').format(Math.round(value))}`;
}

function operationLabel(operation: SavedSearchOperation): string {
  switch (operation) {
    case 'for_sale':
      return 'Venta';
    case 'for_rent':
      return 'Arriendo';
    default:
      return 'Venta y arriendo';
  }
}

function typeLabel(propertyType: PropertyType | 'all'): string {
  if (propertyType === 'all') return 'Todas las categorías';
  return getPropertyTypeLabel(propertyType as PropertyType);
}

/**
 * Resumen legible de la búsqueda, para el correo y la lista del usuario.
 *
 * Se calcula al guardar y se almacena: el correo sigue diciendo lo que la
 * persona eligió aunque después cambien las etiquetas de la UI.
 */
export function describeSavedSearch(filters: SavedSearchFilters): string {
  const parts: string[] = [operationLabel(filters.operation), typeLabel(filters.propertyType)];

  if (filters.newPropertyType === 'proyectos') parts.push('Proyectos');
  if (filters.newPropertyType === 'entrega_inmediata') parts.push('Entrega inmediata');

  if (filters.commune) parts.push(`en ${filters.commune}`);
  else if (filters.region) parts.push(`en ${filters.region}`);

  if (filters.searchQuery) parts.push(`«${filters.searchQuery}»`);

  if (filters.minPrice !== null && filters.maxPrice !== null) {
    parts.push(`entre ${formatClp(filters.minPrice)} y ${formatClp(filters.maxPrice)}`);
  } else if (filters.minPrice !== null) {
    parts.push(`desde ${formatClp(filters.minPrice)}`);
  } else if (filters.maxPrice !== null) {
    parts.push(`hasta ${formatClp(filters.maxPrice)}`);
  }

  // El buscador usa valores exactos y solo abre el rango en el último (igual
  // que los selectores de la UI: 1, 2, 3, 4, 5+). Decir "2+" cuando filtra por
  // 2 exacto sería mentirle al usuario.
  if (filters.minBedrooms !== null) {
    parts.push(filters.minBedrooms === 5 ? '5+ dormitorios' : `${filters.minBedrooms} dormitorios`);
  }
  if (filters.minBathrooms !== null) {
    parts.push(filters.minBathrooms === 4 ? '4+ baños' : `${filters.minBathrooms} baños`);
  }
  if (filters.minPrivates !== null) {
    parts.push(filters.minPrivates >= 4 ? '4+ privados' : `${filters.minPrivates} privados`);
  }

  return parts.join(' · ');
}

/**
 * Filtros guardados → parámetros del buscador.
 *
 * Los lugares se normalizan acá (minúsculas, sin acentos) porque así los compara
 * `matchesBase`; en la etiqueta se conserva cómo lo escribió la persona.
 */
export function savedSearchToParams(filters: SavedSearchFilters): PropertyFilterParams {
  return {
    operation: filters.operation,
    propertyType: filters.propertyType,
    newPropertyType: filters.newPropertyType,
    commune: filters.commune ? normalizeForSearch(filters.commune) : '',
    region: filters.region ? normalizeForSearch(filters.region) : '',
    searchQuery: filters.searchQuery ? normalizeForSearch(filters.searchQuery) : '',
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
    minBedrooms: filters.minBedrooms,
    minBathrooms: filters.minBathrooms,
    minPrivates: filters.minPrivates,
  };
}

/** Fila de la base → objeto de la app. */
export function rowToSavedSearch(row: SavedSearchRow): SavedSearch {
  const validation = normalizeSavedSearchFilters(row.filters);

  return {
    id: row.id,
    userId: row.user_id,
    // Si los filtros guardados quedaran inservibles, se cae a un objeto vacío en
    // vez de romper: el job decide si la búsqueda acota algo.
    filters: validation.ok ? validation.filters : EMPTY_SAVED_SEARCH_FILTERS,
    label: row.label || '',
    notify: row.notify !== false,
    createdAt: row.created_at,
    lastNotifiedAt: row.last_notified_at,
  };
}
