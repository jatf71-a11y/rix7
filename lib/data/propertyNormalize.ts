import type { Property, PropertyType } from '@/lib/types/property';

/**
 * Vocabulario de tipos de propiedad.
 *
 * La base usa `vip` (migración 0003 y seed) para lo que la UI y el catálogo
 * del código llaman `premium` (el chip con ícono de destellos del buscador).
 * Sin este puente, las propiedades vip no caían en ningún chip —Premium
 * mostraba 0 aunque existieran— y el filtro `propertyType=premium` volvía
 * vacío, lo que además hacía que la ruta cayera al catálogo demo y el
 * usuario viera propiedades que no existen.
 */
const TYPE_ALIASES: Record<string, PropertyType> = {
  vip: 'premium',
};

/**
 * Traduce un `property_type` de la base al vocabulario de la UI.
 * Los tipos desconocidos se devuelven tal cual: si la base agrega un tipo
 * nuevo, el contador lo muestra como categoría propia en vez de perderlo.
 */
export function normalizePropertyType(
  raw: string | null | undefined
): PropertyType | string {
  if (!raw) return 'apartment';
  return TYPE_ALIASES[raw] ?? raw;
}

/**
 * Normaliza una fila devuelta por el RPC de Supabase al contrato `Property`.
 *
 * El RPC entrega `price`, `bathrooms` y `area_sqm` como NUMERIC, que
 * PostgREST puede serializar como número o como string; los filtros de
 * precio y los contadores comparan con `<`/`>`, así que un string rompería
 * el orden lexicográfico ("90000000" > "100000000"). Aquí se fijan como
 * números antes de que el set entre al pipeline de filtrado.
 */
export function normalizeProperty(row: Record<string, unknown>): Property {
  return {
    ...row,
    property_type: normalizePropertyType(row.property_type as string),
    price: Number(row.price ?? 0),
    bathrooms: Number(row.bathrooms ?? 0),
    area_sqm: row.area_sqm == null ? row.area_sqm : Number(row.area_sqm),
    lat: Number(row.lat ?? 0),
    lng: Number(row.lng ?? 0),
  } as Property;
}

/** Normaliza un lote de filas del RPC. */
export function normalizeProperties(rows: Record<string, unknown>[]): Property[] {
  return rows.map(normalizeProperty);
}
