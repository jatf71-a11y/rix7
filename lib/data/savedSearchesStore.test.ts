/**
 * @vitest-environment node
 *
 * Tests del store de búsquedas guardadas.
 *
 * Es la capa que une la ruta con la base, y donde viven dos reglas que no se
 * pueden romper en silencio:
 *
 * 1. **Sin Supabase no se finge que se guardó**: se devuelve `unconfigured`, que
 *    la ruta traduce a 503. Un `ok: true` inventado dejaría al usuario creyendo
 *    que recibirá avisos que nunca van a salir.
 * 2. **La pertenencia se filtra siempre por `user_id`**, además de lo que exige
 *    RLS. Si algún día se relajara una política, el filtro sigue ahí.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const isSupabaseConfigured = vi.fn();
const isServiceRoleConfigured = vi.fn();
const createClient = vi.fn();
const createServiceRoleClient = vi.fn();

vi.mock('@/lib/supabase/config', () => ({
  isSupabaseConfigured: () => isSupabaseConfigured(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => createClient(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  isServiceRoleConfigured: () => isServiceRoleConfigured(),
  createServiceRoleClient: () => createServiceRoleClient(),
}));

import {
  createSavedSearch,
  deleteSavedSearch,
  getUserEmail,
  listSavedSearches,
  listSearchesToNotify,
  markSearchNotified,
} from './savedSearchesStore';
import type { SavedSearchFilters } from './savedSearches';

const FILTROS: SavedSearchFilters = {
  operation: 'for_rent',
  propertyType: 'apartment',
  newPropertyType: null,
  commune: 'Providencia',
  region: null,
  searchQuery: '',
  minPrice: null,
  maxPrice: null,
  minBedrooms: 2,
  minBathrooms: null,
  minPrivates: null,
};

const FILA = {
  id: 's1',
  user_id: 'u1',
  filters: FILTROS,
  label: 'Arriendo · Departamento · en Providencia · 2 dormitorios',
  notify: true,
  created_at: '2026-09-20T10:00:00.000Z',
  last_notified_at: null,
};

/**
 * Cliente falso: registra la cadena de llamadas para poder afirmar **con qué
 * filtros** se consultó, no solo qué devolvió.
 */
function fakeClient(handler: (name: string) => { data: unknown; error: unknown }) {
  const calls: string[] = [];
  const builder: Record<string, unknown> = {};

  for (const name of ['select', 'eq', 'order', 'insert', 'update', 'delete']) {
    builder[name] = vi.fn((...args: unknown[]) => {
      // JSON para poder afirmar también argumentos como `{ ascending: false }`.
      calls.push(`${name}:${JSON.stringify(args)}`);
      return builder;
    });
  }

  builder.single = vi.fn(() => {
    calls.push('single');
    return Promise.resolve(handler('single'));
  });
  builder.maybeSingle = vi.fn(() => {
    calls.push('maybeSingle');
    return Promise.resolve(handler('maybeSingle'));
  });
  // `from()` devuelve el builder, y el builder es "thenable" para que
  // `await supabase.from(...).select(...).eq(...)` resuelva como en Supabase.
  builder.then = (resolve: (value: unknown) => unknown) => resolve(handler('await'));

  return {
    calls,
    client: {
      from: vi.fn(() => builder),
      auth: { admin: { getUserById: vi.fn() } },
    },
  };
}

beforeEach(() => {
  isSupabaseConfigured.mockReset().mockReturnValue(true);
  isServiceRoleConfigured.mockReset().mockReturnValue(true);
  createClient.mockReset();
  createServiceRoleClient.mockReset();
});

describe('listSavedSearches', () => {
  it('sin Supabase devuelve vacío y no consulta nada', async () => {
    isSupabaseConfigured.mockReturnValue(false);

    expect(await listSavedSearches('u1')).toEqual([]);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('sin usuario no consulta', async () => {
    expect(await listSavedSearches('')).toEqual([]);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('filtra por el dueño y ordena de la más nueva a la más vieja', async () => {
    const { calls, client } = fakeClient(() => ({ data: [FILA], error: null }));
    createClient.mockReturnValue(client);

    const result = await listSavedSearches('u1');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 's1', userId: 'u1', notify: true });
    expect(calls).toContain('eq:["user_id","u1"]');
    expect(calls).toContain('order:["created_at",{"ascending":false}]');
  });

  it('si la base falla devuelve vacío en vez de romper la página', async () => {
    const { client } = fakeClient(() => ({ data: null, error: { message: 'boom' } }));
    createClient.mockReturnValue(client);

    expect(await listSavedSearches('u1')).toEqual([]);
  });
});

describe('createSavedSearch', () => {
  it('sin Supabase no finge que guardó', async () => {
    isSupabaseConfigured.mockReturnValue(false);

    const result = await createSavedSearch('u1', FILTROS);

    expect(result.ok).toBe(false);
    expect(result.unconfigured).toBe(true);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('guarda el dueño de la sesión y una etiqueta legible calculada una vez', async () => {
    const { client, calls } = fakeClient(() => ({ data: FILA, error: null }));
    createClient.mockReturnValue(client);

    const result = await createSavedSearch('u1', FILTROS);

    expect(result.ok).toBe(true);
    expect(client.from).toHaveBeenCalledWith('saved_searches');

    const insert = calls.find((c) => c.startsWith('insert:')) || '';
    // El dueño lo pone el servidor, nunca el navegador.
    expect(insert).toContain('"user_id":"u1"');
    // La etiqueta se calcula al guardar: el correo sigue diciendo lo mismo
    // aunque después cambien las etiquetas de la UI.
    expect(insert).toContain('Providencia');
  });

  it('propaga el mensaje de error de la base', async () => {
    const { client } = fakeClient(() => ({
      data: null,
      error: { message: 'duplicate key value violates unique constraint' },
    }));
    createClient.mockReturnValue(client);

    const result = await createSavedSearch('u1', FILTROS);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('duplicate key');
  });
});

describe('deleteSavedSearch', () => {
  it('filtra por id y por dueño', async () => {
    const { client, calls } = fakeClient(() => ({ data: { id: 's1' }, error: null }));
    createClient.mockReturnValue(client);

    const result = await deleteSavedSearch('s1', 'u1');

    expect(result.ok).toBe(true);
    expect(calls).toContain('eq:["id","s1"]');
    expect(calls).toContain('eq:["user_id","u1"]');
  });

  it('si no había fila propia responde "no encontrada" en vez de éxito', async () => {
    const { client } = fakeClient(() => ({ data: null, error: null }));
    createClient.mockReturnValue(client);

    const result = await deleteSavedSearch('ajena', 'u1');

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no encontrada/i);
  });
});

describe('el job de alertas, sin clave de servicio', () => {
  beforeEach(() => {
    isServiceRoleConfigured.mockReturnValue(false);
  });

  it('no lista búsquedas de otras personas', async () => {
    expect(await listSearchesToNotify()).toEqual([]);
    expect(createServiceRoleClient).not.toHaveBeenCalled();
  });

  it('no marca fechas ni resuelve correos', async () => {
    expect(await markSearchNotified('s1', new Date())).toBe(false);
    expect(await getUserEmail('u1')).toBeNull();
    expect(createServiceRoleClient).not.toHaveBeenCalled();
  });
});
