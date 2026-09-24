import { Property, PropertyType } from '@/lib/types/property';
import { ALL_PROPERTIES } from './propertyCatalog';
import { normalizeForSearch } from '@/lib/utils/text';

/**
 * Reglas de búsqueda del catálogo, en un solo lugar.
 *
 * Estaban dentro de `/api/properties`. Se extrajeron cuando aparecieron las
 * **alertas de búsquedas guardadas**, que tienen que decidir exactamente lo
 * mismo que el buscador: si el aviso usara otras reglas, el usuario recibiría
 * correos sobre propiedades que al abrirlos no aparecen en su búsqueda.
 *
 * Es un módulo puro (sin Supabase ni React) para poder probarlo y para que lo
 * comparta tanto la ruta como el job de alertas.
 */

export interface PropertyFilterParams {
  /** `for_sale` | `for_rent` | `all` */
  operation?: string;
  /** Tipo de propiedad o `all`. */
  propertyType?: PropertyType | 'all' | string;
  /** `proyectos` (año mayor al actual) o `entrega_inmediata`. */
  newPropertyType?: 'proyectos' | 'entrega_inmediata' | null;
  /** Propiedad de una corredora concreta (página /empresas/<slug>). */
  partnerId?: string | null;
  /** Región (solo se aplica si no hay comuna). */
  region?: string;
  /** Comuna exacta, en minúsculas. */
  commune?: string;
  /** Texto ya normalizado con `normalizeForSearch`. */
  searchQuery?: string;
  minPrice?: number | null;
  maxPrice?: number | null;
  minBedrooms?: number | null;
  minBathrooms?: number | null;
  minPrivates?: number | null;
}

/** Tipos de propiedad que aparecen en los contadores. */
const TYPE_KEYS: PropertyType[] = [
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

/**
 * Índice de texto por propiedad.
 *
 * Antes se construía de una vez para todo el catálogo (una sola pasada por
 * proceso, en lugar de normalizar en cada request) y ahora se llena por
 * propiedad: así una propiedad que venga de Supabase también participa de la
 * búsqueda por texto, en vez de quedar fuera por no estar en el catálogo.
 */
const searchCache = new Map<string, string>();

export function searchHaystack(property: Property): string {
  const cached = searchCache.get(property.id);
  if (cached !== undefined) return cached;

  const haystack = normalizeForSearch(
    [property.title, property.city, property.address, property.state]
      .filter(Boolean)
      .join(' \u0001 ')
  );
  searchCache.set(property.id, haystack);
  return haystack;
}

/**
 * Filtro base: operación + ubicación + texto + precio + dormitorios + baños.
 *
 * Es el que define los contadores, así que se evalúa sin el tipo de propiedad.
 */
export function matchesBase(
  property: Property,
  operation: string,
  params: PropertyFilterParams
): boolean {
  const { searchQuery, region, commune, minPrice, maxPrice } = params;
  const minBedrooms = params.minBedrooms ?? null;
  const minBathrooms = params.minBathrooms ?? null;
  const minPrivates = params.minPrivates ?? null;

  // Operación
  if (operation !== 'all' && property.status !== operation) return false;

  // Precio
  if (minPrice && property.price < minPrice) return false;
  if (maxPrice && property.price > maxPrice) return false;

  // Dormitorios (valor exacto, excepto 5+)
  if (minBedrooms !== null) {
    if (minBedrooms === 5) {
      if (property.bedrooms < 5) return false;
    } else if (property.bedrooms !== minBedrooms) {
      return false;
    }
  }

  // Baños (valor exacto, excepto 4+)
  if (minBathrooms !== null) {
    if (minBathrooms === 4) {
      if (property.bathrooms < 4) return false;
    } else if (property.bathrooms !== minBathrooms) {
      return false;
    }
  }

  // Privados (la UI ofrece "4+", igual que baños)
  if (minPrivates !== null) {
    if (minPrivates >= 4) {
      if ((property.privates ?? 0) < 4) return false;
    } else if ((property.privates ?? 0) !== minPrivates) {
      return false;
    }
  }

  // Comuna
  if (commune && property.city?.toLowerCase() !== commune) return false;

  // Región (solo si no hay comuna seleccionada)
  if (!commune && region && property.state) {
    const state = property.state.toLowerCase();
    if (!state.includes(region) && !region.includes(state)) return false;
  }

  // Búsqueda por texto
  if (searchQuery && !searchHaystack(property).includes(searchQuery)) return false;

  return true;
}

/**
 * Aplica las reglas completas: base + tipo + corredora + proyecto/entrega.
 * Mismo orden que usaba la ruta, para que los totales coincidan.
 */
export function filterProperties(
  properties: Property[],
  params: PropertyFilterParams = {}
): Property[] {
  const operation = params.operation ?? 'all';
  const propertyType = params.propertyType ?? 'all';
  const newPropertyType = params.newPropertyType ?? null;
  const partnerId = params.partnerId ?? null;

  let filtered = properties.filter((p) => matchesBase(p, operation, params));

  if (propertyType && propertyType !== 'all') {
    filtered = filtered.filter((p) => p.property_type === propertyType);
  }

  if (partnerId) {
    filtered = filtered.filter((p) => p.partner_id === partnerId);
  }

  if (newPropertyType) {
    const currentYear = new Date().getFullYear();
    if (newPropertyType === 'proyectos') {
      filtered = filtered.filter((p) => !!p.year_built && p.year_built > currentYear);
    } else {
      filtered = filtered.filter((p) => !p.year_built || p.year_built <= currentYear);
    }
  }

  return filtered;
}

/** Contadores por categoría del set recibido (incluye `all`). */
export function countByCategory(properties: Property[]): Record<string, number> {
  const counts: Record<string, number> = { all: properties.length };
  for (const key of TYPE_KEYS) counts[key] = 0;

  for (const p of properties) {
    if (counts[p.property_type] !== undefined) counts[p.property_type]++;
  }

  return counts;
}

/** Contadores de venta y arriendo del set base, en una sola pasada. */
export function countOperations(
  params: PropertyFilterParams,
  properties: Property[] = ALL_PROPERTIES
): { for_sale: number; for_rent: number } {
  let for_sale = 0;
  let for_rent = 0;

  for (const p of properties) {
    if (matchesBase(p, 'for_sale', params)) for_sale++;
    else if (matchesBase(p, 'for_rent', params)) for_rent++;
  }

  return { for_sale, for_rent };
}
