import { Property } from '@/lib/types/property';
import { normalizeForSearch } from '@/lib/utils/text';

/**
 * Proyección compacta de una propiedad para pintar el mapa.
 * Solo los campos que MapContainerInner usa en pines y popups
 * (id, título, precio, posición, tipo, comuna, dirección, área,
 * dormitorios, baños, año y estado de operación).
 */
export interface PropertyMarker {
  id: string;
  title: string;
  price: number;
  status: 'for_sale' | 'for_rent' | 'sold';
  lat: number;
  lng: number;
  property_type: Property['property_type'];
  city: string;
  address: string;
  area_sqm: number;
  bedrooms: number;
  bathrooms: number;
  year_built?: number;
}

/**
 * Misma forma que BaseFilterParams en /api/properties: operación + ubicación +
 * búsqueda + precio + dormitorios + baños + privados. Sin propertyType, que se
 * aplica aparte para que los contadores de categoría ignoren el tipo activo.
 */
export interface MarkerFilterParams {
  searchQuery: string;
  region: string;
  commune: string;
  minPrice: number | null;
  maxPrice: number | null;
  minBedrooms: number | null;
  minBathrooms: number | null;
  minPrivates: number | null;
}

/**
 * Filtro base compartido (antes duplicado entre /api/properties y
 * /api/markers): operación, precio, dormitorios, baños, privados,
 * comuna, región y búsqueda por texto contra un índice precalculado.
 */
export function matchesBaseFilter(
  p: Property,
  operation: string,
  params: MarkerFilterParams,
  searchIndex?: Map<string, string>
): boolean {
  // Operación
  if (operation !== 'all' && p.status !== operation) return false;

  // Precio
  if (params.minPrice && p.price < params.minPrice) return false;
  if (params.maxPrice && p.price > params.maxPrice) return false;

  // Dormitorios (exacto, excepto 5+)
  if (params.minBedrooms !== null) {
    if (params.minBedrooms === 5) {
      if (p.bedrooms < 5) return false;
    } else {
      if (p.bedrooms !== params.minBedrooms) return false;
    }
  }

  // Baños (exacto, excepto 4+)
  if (params.minBathrooms !== null) {
    if (params.minBathrooms === 4) {
      if (p.bathrooms < 4) return false;
    } else {
      if (p.bathrooms !== params.minBathrooms) return false;
    }
  }

  // Privados (el selector de la UI ofrece "4+", igual que baños)
  if (params.minPrivates !== null) {
    if (params.minPrivates >= 4) {
      if ((p.privates ?? 0) < 4) return false;
    } else {
      if ((p.privates ?? 0) !== params.minPrivates) return false;
    }
  }

  // Comuna
  if (params.commune && p.city?.toLowerCase() !== params.commune) return false;

  // Región (solo si no hay comuna seleccionada)
  if (!params.commune && params.region && p.state) {
    if (!p.state.toLowerCase().includes(params.region) && !params.region.includes(p.state.toLowerCase())) return false;
  }

  // Búsqueda por texto (contra el índice normalizado)
  if (params.searchQuery) {
    const haystack = searchIndex?.get(p.id);
    if (!haystack || !haystack.includes(params.searchQuery)) return false;
  }

  return true;
}

/** Proyecta una propiedad a su marcador compacto para el mapa. */
export function toPropertyMarker(p: Property): PropertyMarker {
  return {
    id: p.id,
    title: p.title,
    price: p.price,
    status: p.status,
    lat: p.lat,
    lng: p.lng,
    property_type: p.property_type,
    city: p.city,
    address: p.address,
    area_sqm: p.area_sqm,
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    year_built: p.year_built,
  };
}
