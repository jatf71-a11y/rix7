import type { Property } from '@/lib/types/property';

/**
 * Normaliza una fila devuelta por el RPC de Supabase al contrato `Property`.
 *
 * El RPC entrega `price`, `bathrooms` y `area_sqm` como NUMERIC, que
 * PostgREST puede serializar como número o como string; los filtros de
 * precio y los contadores comparan con `<`/`>`, así que un string rompería
 * el orden lexicográfico ("90000000" > "100000000"). Aquí se fijan como
 * números antes de que el set entre al pipeline de filtrado.
 *
 * El vocabulario de tipos ya no necesita traducción: la migración 0013
 * alineó la base con la UI (vip → premium), así que un tipo que venga de
 * Supabase ya es el mismo que espera el chip del buscador.
 */
export function normalizeProperty(row: Record<string, unknown>): Property {
  return {
    ...row,
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
