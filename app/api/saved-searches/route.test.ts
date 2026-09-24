/**
 * @vitest-environment node
 *
 * Tests de `/api/saved-searches`.
 *
 * Lo que más importa acá es la **pertenencia**: que la ruta siempre opere con el
 * id de la sesión y nunca con uno que venga del navegador. Por eso los casos
 * centrales verifican con qué `userId` se llama al store, no solo el código de
 * estado.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getUser = vi.fn();
const listSavedSearches = vi.fn();
const createSavedSearch = vi.fn();
const deleteSavedSearch = vi.fn();
const isSupabaseConfigured = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: () => getUser() } }),
}));

vi.mock('@/lib/supabase/config', () => ({
  isSupabaseConfigured: () => isSupabaseConfigured(),
}));

vi.mock('@/lib/data/savedSearchesStore', () => ({
  listSavedSearches: (...args: unknown[]) => listSavedSearches(...args),
  createSavedSearch: (...args: unknown[]) => createSavedSearch(...args),
  deleteSavedSearch: (...args: unknown[]) => deleteSavedSearch(...args),
}));

import { GET, POST, DELETE } from './route';

function requestOf(method: string, body?: unknown, query = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/saved-searches${query}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const VALID_FILTERS = {
  operation: 'for_rent',
  propertyType: 'apartment',
  commune: 'Providencia',
  minBedrooms: 2,
};

beforeEach(() => {
  getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1' } } });
  listSavedSearches.mockReset().mockResolvedValue([]);
  createSavedSearch.mockReset().mockResolvedValue({
    ok: true,
    search: { id: 's1', label: 'Arriendo' },
  });
  deleteSavedSearch.mockReset().mockResolvedValue({ ok: true });
  isSupabaseConfigured.mockReset().mockReturnValue(true);
});

describe('sin sesión', () => {
  it('GET responde 401 y no toca el store', async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    const res = await GET();

    expect(res.status).toBe(401);
    expect(listSavedSearches).not.toHaveBeenCalled();
  });

  it('POST responde 401 aunque los filtros sean válidos', async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    const res = await POST(requestOf('POST', VALID_FILTERS));

    expect(res.status).toBe(401);
    expect(createSavedSearch).not.toHaveBeenCalled();
  });

  it('DELETE responde 401 aunque tenga id', async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    const res = await DELETE(requestOf('DELETE', undefined, '?id=s1'));

    expect(res.status).toBe(401);
    expect(deleteSavedSearch).not.toHaveBeenCalled();
  });

  it('sin Supabase configurado tampoco hay sesión, y se dice', async () => {
    isSupabaseConfigured.mockReturnValue(false);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/sesión/i);
  });

  it('si la lectura de la sesión revienta, no se propaga el error', async () => {
    getUser.mockRejectedValue(new Error('boom'));

    const res = await GET();

    expect(res.status).toBe(401);
  });
});

describe('con sesión', () => {
  it('GET lista solo con el id de la sesión', async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    expect(listSavedSearches).toHaveBeenCalledWith('u1');
    expect(res.headers.get('cache-control')).toBeDefined();
  });

  it('POST guarda con el id de la sesión y no con el del cuerpo', async () => {
    const res = await POST(requestOf('POST', { ...VALID_FILTERS, user_id: 'otro-usuario' }));

    expect(res.status).toBe(201);
    // El primero argumento es la identidad: nunca la del navegador.
    expect(createSavedSearch.mock.calls[0][0]).toBe('u1');
    expect(JSON.stringify(createSavedSearch.mock.calls[0][1])).not.toContain('otro-usuario');
  });

  it('POST normaliza los filtros antes de guardarlos', async () => {
    await POST(
      requestOf('POST', {
        ...VALID_FILTERS,
        // Como lo escribiría una persona: con espacios de sobra y el número de
        // dormitorios como texto, que es lo que manda un formulario.
        commune: '  Providencia  ',
        minBedrooms: '2',
      })
    );

    const [, filters] = createSavedSearch.mock.calls[0];
    expect(filters).toMatchObject({ commune: 'Providencia', minBedrooms: 2 });
  });

  it('POST rechaza una búsqueda sin filtros con un mensaje útil', async () => {
    const res = await POST(requestOf('POST', { operation: 'all' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/al menos un filtro/i);
    expect(createSavedSearch).not.toHaveBeenCalled();
  });

  it('POST rechaza un rango de precios invertido', async () => {
    const res = await POST(requestOf('POST', { minPrice: 900, maxPrice: 100 }));

    expect(res.status).toBe(400);
    expect(createSavedSearch).not.toHaveBeenCalled();
  });

  it('POST responde 400 si el cuerpo no es JSON', async () => {
    const bad = new NextRequest('http://localhost:3000/api/saved-searches', {
      method: 'POST',
      body: 'no-json',
    });

    const res = await POST(bad);

    expect(res.status).toBe(400);
  });

  it('POST responde 503 si falta Supabase, no 500', async () => {
    createSavedSearch.mockResolvedValue({
      ok: false,
      unconfigured: true,
      error: 'Guardar búsquedas necesita Supabase configurado.',
    });

    const res = await POST(requestOf('POST', VALID_FILTERS));

    expect(res.status).toBe(503);
  });

  it('DELETE exige el id', async () => {
    const res = await DELETE(requestOf('DELETE'));

    expect(res.status).toBe(400);
    expect(deleteSavedSearch).not.toHaveBeenCalled();
  });

  it('DELETE filtra por id y por dueño', async () => {
    const res = await DELETE(requestOf('DELETE', undefined, '?id=s1'));

    expect(res.status).toBe(200);
    expect(deleteSavedSearch).toHaveBeenCalledWith('s1', 'u1');
  });

  it('DELETE responde 404 cuando la búsqueda no es de esa persona', async () => {
    deleteSavedSearch.mockResolvedValue({ ok: false, error: 'Búsqueda no encontrada.' });

    const res = await DELETE(requestOf('DELETE', undefined, '?id=ajena'));

    expect(res.status).toBe(404);
  });
});
