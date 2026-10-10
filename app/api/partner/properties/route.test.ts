/**
 * @vitest-environment node
 *
 * Tests de `/api/partner/properties`: el guard decide quién entra (401 sin
 * sesión, 403 sin rol o sin corredora vinculada) y el handler siempre pasa la
 * corredora del guard al store — es la garantía de que un socio no puede ni
 * leer ni escribir publicaciones ajenas, con o sin RLS aplicada.
 *
 * El store se mockea completo (no hay base real acá) y el cliente de Supabase
 * solo aporta `auth.getUser`, igual que en los tests de `/api/admin/partners`.
 * En los casos que deben fallar cerrado se fuerza `NODE_ENV=production`, porque
 * en desarrollo el guard permite el acceso a propósito (ver `requireMember`).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { getUser, listPartnerPublications, createPublication, updatePublication, deletePublication } =
  vi.hoisted(() => ({
    getUser: vi.fn(),
    listPartnerPublications: vi.fn(),
    createPublication: vi.fn(),
    updatePublication: vi.fn(),
    deletePublication: vi.fn(),
  }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser } }),
  createPublicClient: () => ({}),
}));

vi.mock('@/lib/data/propertiesStore', () => ({
  listPartnerPublications,
  createPublication,
  updatePublication,
  deletePublication,
}));

import { GET, POST, PUT, DELETE } from './route';

const URL = 'http://localhost/api/partner/properties';

const VALID_BODY = {
  title: 'Departamento en Providencia',
  description: 'Calle tranquila.',
  price: 85_000_000,
  property_type: 'apartment',
  status: 'for_sale',
  bedrooms: 2,
  bathrooms: 2,
  area_sqm: 68,
  parking_spots: 1,
  address: 'Av. Providencia 1234',
  city: 'Providencia',
  images: ['https://images.unsplash.com/photo-1'],
  features: ['Balcón'],
  lat: -33.42,
  lng: -70.61,
};

const post = (body: unknown = VALID_BODY) =>
  new Request(URL, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  }) as any;

const put = (body: unknown) =>
  new Request(URL, {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  }) as any;

const del = (id?: string) => new NextRequest(`${URL}${id ? `?id=${id}` : ''}`) as any;

/** Sesión simulada con rol y corredora en app_metadata. */
function withUser(role?: string, partnerId?: string, userId = 'uuid-1') {
  getUser.mockResolvedValue({
    data: {
      user: role
        ? {
            id: userId,
            app_metadata: { role, ...(partnerId ? { partner_id: partnerId } : {}) },
          }
        : null,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proyecto-real.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-de-prueba');
  vi.stubEnv('NEXT_PUBLIC_SHOW_ADMIN_ENV', '');
  vi.stubEnv('NODE_ENV', 'production');

  listPartnerPublications.mockResolvedValue({
    properties: [],
    source: 'supabase',
    persistent: true,
  });
  createPublication.mockResolvedValue({
    ok: true,
    property: { id: 'p1', ...VALID_BODY },
    persisted: true,
  });
  updatePublication.mockResolvedValue({ ok: true, property: { id: 'p1' }, persisted: true });
  deletePublication.mockResolvedValue({ ok: true, persisted: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('/api/partner/properties — guard', () => {
  it('responde 401 en los cuatro verbos cuando no hay sesión', async () => {
    withUser();

    for (const res of await Promise.all([
      GET(),
      POST(post()),
      PUT(put({ id: 'p1', price: 1 })),
      DELETE(del('p1')),
    ])) {
      expect(res.status).toBe(401);
      expect((await res.json()).success).toBe(false);
    }
    expect(listPartnerPublications).not.toHaveBeenCalled();
  });

  it('responde 403 a una Visita autenticada sin rol', async () => {
    withUser(undefined);
    // Sesión existe pero sin rol: el mock de arriba da user null — este caso
    // necesita un usuario autenticado sin role.
    getUser.mockResolvedValue({ data: { user: { id: 'u', app_metadata: {} } } });

    const res = await GET();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('socio');
  });

  it('responde 403 a un socio sin corredora vinculada, con mensaje explícito', async () => {
    withUser('member');

    const res = await GET();
    expect(res.status).toBe(403);
    const body = await res.json();
    // Mensaje distinto de «no hay publicaciones»: el problema es la cuenta,
    // no el stock.
    expect(body.error).toContain('vinculada');
    expect(listPartnerPublications).not.toHaveBeenCalled();
  });

  it('también exige la vinculación al admin', async () => {
    withUser('admin');

    const res = await GET();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('vinculada');
  });

  it('en desarrollo sin Supabase el bypass entra con la corredora de desarrollo', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    vi.stubEnv('NODE_ENV', 'development');

    const res = await GET();
    expect(res.status).toBe(200);
    expect(listPartnerPublications).toHaveBeenCalledWith('dev-socio');
  });
});

describe('/api/partner/properties — operaciones', () => {
  it('GET lista acotado a la corredora del guard', async () => {
    withUser('member', 'catedral');

    const res = await GET();
    expect(res.status).toBe(200);
    expect(listPartnerPublications).toHaveBeenCalledWith('catedral');
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.persistent).toBe(true);
    // Panel privado: no debe cachearse en el borde.
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('POST crea con la corredora del guard y el id de la sesión (nunca del cuerpo)', async () => {
    withUser('member', 'catedral', 'uuid-7');

    const res = await POST(post({ ...VALID_BODY, partner_id: 'corredora-ajena' }));
    expect(res.status).toBe(201);
    expect(createPublication).toHaveBeenCalledWith(VALID_BODY, {
      partnerId: 'catedral',
      userId: 'uuid-7',
    });
    // Lo que mandó el cliente en partner_id/user_id se ignora: manda la sesión.
    const [input] = createPublication.mock.calls[0];
    expect(input.partner_id).toBeUndefined();
  });

  it('POST rechaza un cuerpo inválido con 400 y no toca el store', async () => {
    withUser('member', 'catedral');

    const res = await POST(post({ ...VALID_BODY, title: 'x' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('título');
    expect(createPublication).not.toHaveBeenCalled();
  });

  it('POST sin cuerpo legible responde 400', async () => {
    withUser('member', 'catedral');
    const res = await POST(
      new Request(URL, { method: 'POST', body: 'no-es-json' }) as any
    );
    expect(res.status).toBe(400);
    expect(createPublication).not.toHaveBeenCalled();
  });

  it('PUT edita acotado por id Y corredora del guard', async () => {
    withUser('member', 'catedral');

    const res = await PUT(put({ id: 'p1', price: 99_000_000 }));
    expect(res.status).toBe(200);
    expect(updatePublication).toHaveBeenCalledWith('p1', 'catedral', { price: 99_000_000 });
  });

  it('PUT devuelve 404 cuando el store no encuentra la fila', async () => {
    withUser('member', 'catedral');
    updatePublication.mockResolvedValue({
      ok: false,
      reason: 'not_found',
      error: 'Publicación no encontrada.',
      persisted: true,
    });

    const res = await PUT(put({ id: 'p1', price: 1 }));
    expect(res.status).toBe(404);
  });

  it('DELETE exige id y acota por corredora', async () => {
    withUser('member', 'catedral');

    const sinId = await DELETE(del());
    expect(sinId.status).toBe(400);
    expect(deletePublication).not.toHaveBeenCalled();

    const res = await DELETE(del('p1'));
    expect(res.status).toBe(200);
    expect(deletePublication).toHaveBeenCalledWith('p1', 'catedral');
  });
});
