/**
 * Tests de `partnerProperties` — propiedades de una corredora (fase 3, 2.1).
 *
 * Las dos reglas que no se pueden romper en silencio:
 *
 * 1. **El filtro por corredora viaja a la base** (`.eq('partner_id', …)`). Si
 *    alguien lo suelta, la consulta devolvería el portal completo y el feed/la
 *    página de la corredora se llenaría de propiedades ajenas — exactamente el
 *    defecto que tenía el fallback anterior, que traía `select('*')` sin marca.
 * 2. **La base manda.** Si contestó con filas, el catálogo del build no aporta
 *    nada: se usa solo cuando la base no pudo contestar o esa corredora todavía
 *    no tiene ninguna fila (su contenido de arranque).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const isSupabaseConfigured = vi.fn();
const createPublicClient = vi.fn();

vi.mock('@/lib/supabase/config', () => ({
  isSupabaseConfigured: () => isSupabaseConfigured(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createPublicClient: () => createPublicClient(),
}));

import { listPartnerProperties } from './partnerProperties';
import { ALL_PROPERTIES } from './propertyCatalog';

/** Cliente falso thenable que registra la cadena de llamadas (convención del proyecto). */
function fakeClient(handler: () => { data: unknown; error: unknown }) {
  const calls: string[] = [];
  const builder: Record<string, unknown> = {};

  for (const name of ['select', 'eq', 'order', 'limit']) {
    builder[name] = vi.fn((...args: unknown[]) => {
      calls.push(`${name}:${JSON.stringify(args)}`);
      return builder;
    });
  }
  builder.then = (resolve: (value: unknown) => unknown) => resolve(handler());

  return { calls, client: { from: vi.fn(() => builder) } };
}

const PROPIEDAD_DB = {
  id: 'db-1',
  title: 'Publicada en caliente',
  partner_id: 'test-partner',
};

/**
 * Fila tal como la devuelve PostgREST: la ubicación viene como GeoJSON, no como
 * `lat`/`lng` planos, y los arreglos y números puede traerlos como texto.
 */
const FILA_CON_UBICACION = {
  id: 'db-geo',
  title: 'Con coordenadas',
  partner_id: 'test-partner',
  price: '150000000',
  bathrooms: '2.5',
  area_sqm: '90',
  images: null,
  features: null,
  location: { type: 'Point', coordinates: [-70.587, -33.419] },
};

beforeEach(() => {
  isSupabaseConfigured.mockReset().mockReturnValue(false);
  createPublicClient.mockReset();
});

describe('listPartnerProperties', () => {
  it('sin Supabase devuelve el catálogo filtrado y no consulta nada', async () => {
    const result = await listPartnerProperties('catedral');

    expect(result.source).toBe('catalog');
    expect(result.properties.length).toBeGreaterThan(0);
    expect(result.properties.every((property) => property.partner_id === 'catedral')).toBe(true);
    expect(createPublicClient).not.toHaveBeenCalled();
  });

  it('filtra por corredora EN LA BASE (eq partner_id), no en cliente', async () => {
    isSupabaseConfigured.mockReturnValue(true);
    const { calls, client } = fakeClient(() => ({ data: [PROPIEDAD_DB], error: null }));
    createPublicClient.mockReturnValue(client);

    const result = await listPartnerProperties('test-partner');

    expect(calls).toContain('eq:["partner_id","test-partner"]');
    expect(result.source).toBe('supabase');
    expect(result.properties).toHaveLength(1);
  });

  it('la base manda: con filas suyas, el catálogo del build no aporta nada', async () => {
    isSupabaseConfigured.mockReturnValue(true);
    // Catedral tiene 9 fichas en el catálogo del build; la base devuelve una.
    const { client } = fakeClient(() => ({ data: [PROPIEDAD_DB], error: null }));
    createPublicClient.mockReturnValue(client);

    const result = await listPartnerProperties('catedral');

    expect(result.source).toBe('supabase');
    expect(result.properties.map((property) => property.id)).toEqual(['db-1']);
    // Ninguna ficha del catálogo: ni la del id repetido ni las demás.
    const catalogIds = new Set(
      ALL_PROPERTIES.filter((p) => p.partner_id === 'catedral').map((p) => p.id)
    );
    expect(result.properties.some((p) => catalogIds.has(p.id))).toBe(false);
  });

  it('la fila de la base llega con coordenadas y números normalizados (lo que publica el feed)', async () => {
    // El feed escribe `property.lat`/`lng` en <latitude>/<longitude>: si la fila
    // no pasara por el conversor del panel, Trovit recibiría `undefined`.
    isSupabaseConfigured.mockReturnValue(true);
    const { client } = fakeClient(() => ({ data: [FILA_CON_UBICACION], error: null }));
    createPublicClient.mockReturnValue(client);

    const result = await listPartnerProperties('test-partner');
    const [property] = result.properties;

    expect(property.lat).toBeCloseTo(-33.419);
    expect(property.lng).toBeCloseTo(-70.587);
    expect(property.price).toBe(150000000);
    expect(property.area_sqm).toBe(90);
    expect(property.images).toEqual([]);
    expect(property.features).toEqual([]);
  });

  it('el orden es el de la corredora: lo más reciente primero', async () => {
    isSupabaseConfigured.mockReturnValue(true);
    const { calls, client } = fakeClient(() => ({ data: [PROPIEDAD_DB], error: null }));
    createPublicClient.mockReturnValue(client);

    await listPartnerProperties('test-partner');

    expect(calls).toContain('order:["created_at",{"ascending":false}]');
  });

  it('el ROL (0015) no sale hacia lo público: la fila lo trae, el resultado no', async () => {
    // Este listado alimenta /empresas y los feeds XML, que serializan la
    // propiedad entera: si el ROL sobreviviera al mapeo, terminaría en el
    // HTML público — que es justamente lo que la migración prohíbe.
    isSupabaseConfigured.mockReturnValue(true);
    const { client } = fakeClient(() => ({
      data: [{ ...PROPIEDAD_DB, rol: '15234-67' }],
      error: null,
    }));
    createPublicClient.mockReturnValue(client);

    const result = await listPartnerProperties('test-partner');

    expect(result.properties).toHaveLength(1);
    expect(result.properties[0]).not.toHaveProperty('rol');
    expect(JSON.stringify(result)).not.toContain('15234-67');
  });

  it('si la base falla cae al catálogo en vez de romper', async () => {
    isSupabaseConfigured.mockReturnValue(true);
    const { client } = fakeClient(() => ({ data: null, error: { message: 'boom' } }));
    createPublicClient.mockReturnValue(client);

    const result = await listPartnerProperties('catedral');

    expect(result.source).toBe('catalog');
    expect(result.properties.length).toBeGreaterThan(0);
  });

  it('una corredora sin filas en la base recibe su contenido de arranque', async () => {
    // Base creada hace un minuto (o recién copiada) sin las fichas cargadas: la
    // página no queda vacía, se ve como la veía el portal antes de la base.
    isSupabaseConfigured.mockReturnValue(true);
    const { client } = fakeClient(() => ({ data: [], error: null }));
    createPublicClient.mockReturnValue(client);

    const result = await listPartnerProperties('catedral');

    expect(result.source).toBe('catalog');
    expect(result.properties.length).toBeGreaterThan(0);
    expect(result.properties.every((p) => p.partner_id === 'catedral')).toBe(true);
  });

  it('una corredora sin filas ni catálogo devuelve vacío sin explotar', async () => {
    isSupabaseConfigured.mockReturnValue(true);
    const { client } = fakeClient(() => ({ data: [], error: null }));
    createPublicClient.mockReturnValue(client);

    const result = await listPartnerProperties('nadie-tiene-esto');

    expect(result.source).toBe('catalog');
    expect(result.properties).toEqual([]);
  });
});
