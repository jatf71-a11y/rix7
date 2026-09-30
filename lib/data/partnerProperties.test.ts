/**
 * Tests de `partnerProperties` — propiedades de una corredora (fase 3, 2.1).
 *
 * La regla que no se puede romper en silencio: **el filtro por corredora viaja
 * a la base** (`.eq('partner_id', …)`). Si alguien lo suelta, la consulta
 * devolvería el portal completo y el feed/la página de la corredora se
 * llenaría de propiedades ajenas — exactamente el defecto que tenía el
 * fallback anterior, que traía `select('*')` sin marca.
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

/** Un id real del catálogo de Catedral, para probar la deduplicación. */
const ID_CATALOGO_CATEDRAL =
  ALL_PROPERTIES.find((property) => property.partner_id === 'catedral')?.id ?? '';

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

  it('mezcla tabla + catálogo deduplicado por id (source mixed)', async () => {
    isSupabaseConfigured.mockReturnValue(true);
    // La fila "db-2" es nueva; la otra repite un id del catálogo de Catedral.
    const { client } = fakeClient(() => ({
      data: [
        { ...PROPIEDAD_DB, id: ID_CATALOGO_CATEDRAL, title: 'migrada' },
        { ...PROPIEDAD_DB, id: 'db-2', title: 'nueva' },
      ],
      error: null,
    }));
    createPublicClient.mockReturnValue(client);

    const result = await listPartnerProperties('catedral');

    expect(result.source).toBe('mixed');
    const ids = result.properties.map((property) => property.id);
    expect(new Set(ids).size).toBe(ids.length); // sin duplicados
    expect(ids.filter((id) => id === ID_CATALOGO_CATEDRAL)).toHaveLength(1);
    expect(ids).toContain('db-2');
  });

  it('si la base falla cae al catálogo en vez de romper', async () => {
    isSupabaseConfigured.mockReturnValue(true);
    const { client } = fakeClient(() => ({ data: null, error: { message: 'boom' } }));
    createPublicClient.mockReturnValue(client);

    const result = await listPartnerProperties('catedral');

    expect(result.source).toBe('catalog');
    expect(result.properties.length).toBeGreaterThan(0);
  });

  it('una corredora sin propiedades en ninguna parte devuelve vacío sin explotar', async () => {
    isSupabaseConfigured.mockReturnValue(true);
    const { client } = fakeClient(() => ({ data: [], error: null }));
    createPublicClient.mockReturnValue(client);

    const result = await listPartnerProperties('nadie-tiene-esto');

    expect(result.source).toBe('catalog');
    expect(result.properties).toEqual([]);
  });
});
