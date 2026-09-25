/**
 * @vitest-environment node
 *
 * Tests de `/api/favorites`.
 *
 * Lo que más importa: que la ruta **siempre** opere con el id de la sesión, que
 * valide el id de la propiedad (los ids vienen del navegador) y que no se pueda
 * cachear una respuesta que es de una persona.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getUser = vi.fn();
const listFavoriteIds = vi.fn();
const addFavorites = vi.fn();
const removeFavorite = vi.fn();
const isSupabaseConfigured = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: () => getUser() } }),
}));

vi.mock('@/lib/supabase/config', () => ({
  isSupabaseConfigured: () => isSupabaseConfigured(),
}));

vi.mock('@/lib/data/favoritesStore', () => ({
  listFavoriteIds: (...args: unknown[]) => listFavoriteIds(...args),
  addFavorites: (...args: unknown[]) => addFavorites(...args),
  removeFavorite: (...args: unknown[]) => removeFavorite(...args),
}));

import { GET, POST, DELETE } from './route';

function requestOf(method: string, body?: unknown, query = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/favorites${query}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1' } } });
  listFavoriteIds.mockReset().mockResolvedValue(['scl-depto-marco-polo']);
  addFavorites.mockReset().mockResolvedValue({ ok: true, ids: ['scl-depto-marco-polo'] });
  removeFavorite.mockReset().mockResolvedValue({ ok: true, ids: [] });
  isSupabaseConfigured.mockReset().mockReturnValue(true);
});

describe('sin sesión', () => {
  it('GET responde 401 y no consulta favoritos', async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    const res = await GET();

    expect(res.status).toBe(401);
    expect(listFavoriteIds).not.toHaveBeenCalled();
  });

  it('POST y DELETE responden 401 aunque el cuerpo sea válido', async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    expect((await POST(requestOf('POST', { propertyId: 'x' }))).status).toBe(401);
    expect((await DELETE(requestOf('DELETE', undefined, '?propertyId=x'))).status).toBe(401);
    expect(addFavorites).not.toHaveBeenCalled();
    expect(removeFavorite).not.toHaveBeenCalled();
  });

  it('sin Supabase configurado tampoco hay sesión', async () => {
    isSupabaseConfigured.mockReturnValue(false);

    const res = await GET();

    expect(res.status).toBe(401);
  });

  it('si la lectura de la sesión revienta no se propaga el error', async () => {
    getUser.mockRejectedValue(new Error('boom'));

    expect((await GET()).status).toBe(401);
  });
});

describe('con sesión', () => {
  it('GET devuelve los ids de la sesión y no se puede cachear', async () => {
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual(['scl-depto-marco-polo']);
    expect(listFavoriteIds).toHaveBeenCalledWith('u1');
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('POST guarda con el id de la sesión, no con el del cuerpo', async () => {
    const res = await POST(
      requestOf('POST', { propertyId: 'scl-depto-marco-polo', user_id: 'otro' })
    );

    expect(res.status).toBe(201);
    expect(addFavorites).toHaveBeenCalledWith('u1', ['scl-depto-marco-polo']);
  });

  it('POST importa una lista entera (los favoritos del dispositivo)', async () => {
    addFavorites.mockResolvedValue({ ok: true, ids: ['a', 'b', 'c'] });

    const res = await POST(requestOf('POST', { propertyIds: ['a', 'b', 'c'] }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(addFavorites).toHaveBeenCalledWith('u1', ['a', 'b', 'c']);
    expect(body.data).toEqual(['a', 'b', 'c']);
  });

  it('POST ignora los ids inválidos de una importación y sigue con los buenos', async () => {
    await POST(requestOf('POST', { propertyIds: ['ok', '../../etc/passwd', 42, 'ok'] }));

    expect(addFavorites).toHaveBeenCalledWith('u1', ['ok']);
  });

  it('POST rechaza una propiedad sin id válido', async () => {
    const res = await POST(requestOf('POST', { propertyId: 'a/b' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/id de la propiedad/i);
    expect(addFavorites).not.toHaveBeenCalled();
  });

  it('POST responde 400 si no viene ningún id', async () => {
    expect((await POST(requestOf('POST', {}))).status).toBe(400);
    expect((await POST(requestOf('POST', { propertyIds: [] }))).status).toBe(400);
  });

  it('POST responde 400 si el cuerpo no es JSON', async () => {
    const bad = new NextRequest('http://localhost:3000/api/favorites', {
      method: 'POST',
      body: 'no-json',
    });

    expect((await POST(bad)).status).toBe(400);
  });

  it('POST responde 503 si falta Supabase, no 500', async () => {
    addFavorites.mockResolvedValue({ ok: false, unconfigured: true, error: 'falta supabase' });

    expect((await POST(requestOf('POST', { propertyId: 'x' }))).status).toBe(503);
  });

  it('DELETE quita con el id de la sesión', async () => {
    const res = await DELETE(requestOf('DELETE', undefined, '?propertyId=scl-depto-marco-polo'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(removeFavorite).toHaveBeenCalledWith('u1', 'scl-depto-marco-polo');
    expect(body.data).toEqual([]);
  });

  it('DELETE exige un id válido', async () => {
    expect((await DELETE(requestOf('DELETE'))).status).toBe(400);
    expect((await DELETE(requestOf('DELETE', undefined, '?propertyId=a/b'))).status).toBe(400);
    expect(removeFavorite).not.toHaveBeenCalled();
  });

  it('la lista resultante siempre viene del servidor', async () => {
    // Si la base rechazó parte de lo pedido, el cliente se entera por acá.
    addFavorites.mockResolvedValue({ ok: true, ids: ['solo-esta'] });

    const res = await POST(requestOf('POST', { propertyIds: ['esta', 'y-esta'] }));
    const body = await res.json();

    expect(body.data).toEqual(['solo-esta']);
  });
});
