/**
 * @vitest-environment node
 *
 * Tests de `propertyNormalize`: el puente entre las filas del RPC de
 * Supabase y el contrato `Property` de la UI.
 *
 * Se prueban acá porque los dos defectos que previenen son silenciosos: un
 * tipo `vip` que no cae en ningún chip (Premium mostraba 0 con 4
 * propiedades reales en la base) y un `price` string que compara
 * lexicográficamente en los filtros de rango ("90000000" > "100000000"),
 * que nadie ve hasta que un usuario pregunta por qué una propiedad de
 * $890.000.000 no aparece con un tope de $1.000.000.000.
 */
import { describe, it, expect } from 'vitest';
import { normalizeProperty, normalizeProperties, normalizePropertyType } from './propertyNormalize';

describe('normalizePropertyType', () => {
  it('traduce vip a premium (el vocabulario de la UI)', () => {
    expect(normalizePropertyType('vip')).toBe('premium');
  });

  it('conserva los tipos que la UI ya conoce', () => {
    for (const type of ['apartment', 'house', 'parcel', 'office', 'land', 'parking', 'local', 'warehouse']) {
      expect(normalizePropertyType(type)).toBe(type);
    }
  });

  it('no pierde un tipo desconocido de la base', () => {
    // Si la base agrega un tipo nuevo, el contador lo muestra como categoría
    // propia en vez de desaparecer en el limbo de los tipos no reconocidos.
    expect(normalizePropertyType('agricultural_lot')).toBe('agricultural_lot');
  });

  it('usa apartment cuando el valor viene vacío', () => {
    expect(normalizePropertyType(null)).toBe('apartment');
    expect(normalizePropertyType(undefined)).toBe('apartment');
    expect(normalizePropertyType('')).toBe('apartment');
  });
});

/** Fila tal como la devuelve el RPC: NUMERIC serializados como string. */
function rpcRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'row-1',
    title: 'Depto Providencia',
    price: '890000000',
    property_type: 'vip',
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
  it('convierte el tipo vip en premium', () => {
    expect(normalizeProperty(rpcRow()).property_type).toBe('premium');
  });

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
    expect(rows[0].property_type).toBe('premium');
    expect(rows[1].property_type).toBe('parcel');
    expect(rows.every((r) => typeof r.price === 'number')).toBe(true);
  });
});
