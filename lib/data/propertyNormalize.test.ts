/**
 * @vitest-environment node
 *
 * Tests de `propertyNormalize`: el puente entre las filas del RPC de
 * Supabase y el contrato `Property` de la UI.
 *
 * Se prueban acá porque el defecto que previene es silencioso: un `price`
 * string compara lexicográficamente en los filtros de rango ("90000000" >
 * "100000000"), que nadie ve hasta que un usuario pregunta por qué una
 * propiedad de $890.000.000 no aparece con un tope de $1.000.000.000.
 *
 * El vocabulario de tipos ya no se traduce acá: la migración 0013 alineó la
 * base con la UI (vip → premium), así que un tipo que venga de Supabase ya
 * es el mismo que espera el chip del buscador.
 */
import { describe, it, expect } from 'vitest';
import { normalizeProperty, normalizeProperties } from './propertyNormalize';

/** Fila tal como la devuelve el RPC: NUMERIC serializados como string. */
function rpcRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'row-1',
    title: 'Depto Providencia',
    price: '890000000',
    property_type: 'premium',
    status: 'for_sale',
    bedrooms: 3,
    bathrooms: '2.5',
    area_sqm: '120.5',
    city: 'Providencia',
    state: 'Región Metropolitana de Santiago',
    lat: '-33.4250',
    lng: '-70.6100',
    ...overrides,
  };
}

describe('normalizeProperty', () => {
  it('convierte price, bathrooms, area y coordenadas en números', () => {
    const p = normalizeProperty(rpcRow());

    expect(typeof p.price).toBe('number');
    expect(p.price).toBe(890000000);
    expect(p.bathrooms).toBe(2.5);
    expect(p.area_sqm).toBe(120.5);
    expect(p.lat).toBe(-33.425);
    expect(p.lng).toBe(-70.61);
  });

  it('respeta los números que ya vienen como número', () => {
    const p = normalizeProperty(rpcRow({ price: 185000000, bathrooms: 3, lat: -33.2, lng: -70.9 }));

    expect(p.price).toBe(185000000);
    expect(p.bathrooms).toBe(3);
    expect(p.lat).toBe(-33.2);
    expect(p.lng).toBe(-70.9);
  });

  it('usa 0 como precio cuando la columna viene nula', () => {
    expect(normalizeProperty(rpcRow({ price: null })).price).toBe(0);
  });

  it('conserva el tipo de propiedad tal cual', () => {
    // La base ya habla el vocabulario de la UI desde la migración 0013.
    expect(normalizeProperty(rpcRow({ property_type: 'parcel' })).property_type).toBe('parcel');
  });

  it('conserva los campos de texto y arreglos tal cual', () => {
    const p = normalizeProperty(
      rpcRow({ images: ['/a.jpg', '/b.jpg'], features: ['Piscina'], agent_name: 'Ana' })
    );

    expect(p.title).toBe('Depto Providencia');
    expect(p.city).toBe('Providencia');
    expect(p.images).toEqual(['/a.jpg', '/b.jpg']);
    expect(p.features).toEqual(['Piscina']);
    expect(p.agent_name).toBe('Ana');
  });
});

describe('normalizeProperties', () => {
  it('normaliza un lote entero', () => {
    const rows = normalizeProperties([rpcRow(), rpcRow({ id: 'row-2', property_type: 'parcel' })]);

    expect(rows).toHaveLength(2);
    expect(rows[1].property_type).toBe('parcel');
    expect(rows.every((r) => typeof r.price === 'number')).toBe(true);
  });
});
