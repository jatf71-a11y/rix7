/**
 * @vitest-environment node
 *
 * Tests del guard de las rutas de administración (`/api/admin/partners`).
 *
 * El cliente de Supabase se mockea para ejercitar las ramas del guard —sin
 * sesión, con rol Cliente y con rol admin— sin un proyecto real. En los casos
 * que deben fallar cerrado se fuerza `NODE_ENV=production`, porque en
 * desarrollo el guard permite el acceso a propósito (ver `requireAdmin`).
 *
 * `NextRequest` se simula con `Request` salvo en `DELETE`, que usa
 * `request.nextUrl.searchParams`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser } }),
  createPublicClient: () => ({}),
}));

import { GET, POST, PUT, DELETE } from './route';

const URL_PARTNERS = 'http://localhost/api/admin/partners';

const post = (body: unknown = { name: 'X', slug: 'x' }) =>
  new Request(URL_PARTNERS, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  }) as any;

const put = (body: unknown = { id: 'catedral' }) =>
  new Request(URL_PARTNERS, {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  }) as any;

const del = (id?: string) =>
  new NextRequest(`${URL_PARTNERS}${id ? `?id=${id}` : ''}`) as any;

/** Sesión simulada con el rol indicado en app_metadata. */
function withUser(role?: string) {
  getUser.mockResolvedValue({
    data: { user: role ? { app_metadata: { role } } : null },
  });
}

beforeEach(() => {
  getUser.mockReset();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proyecto-real.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-de-prueba');
  vi.stubEnv('NEXT_PUBLIC_SHOW_ADMIN_ENV', '');
  vi.stubEnv('NODE_ENV', 'production');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('/api/admin/partners — guard de rol', () => {
  it('responde 401 en los cuatro verbos cuando no hay sesión', async () => {
    withUser();

    for (const res of await Promise.all([
      GET(),
      POST(post()),
      PUT(put()),
      DELETE(del()),
    ])) {
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.success).toBe(false);
    }
  });

  it('responde 403 a una Visita autenticada sin rol', async () => {
    getUser.mockResolvedValue({ data: { user: { app_metadata: {} } } });

    const res = await GET();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/admin/i);
  });

  it('responde 403 a un Cliente (member): inscribirse no da acceso al panel', async () => {
    withUser('member');

    for (const res of await Promise.all([GET(), POST(post())])) {
      expect(res.status).toBe(403);
    }
  });

  it('permite el paso con rol admin, sin mutar datos', async () => {
    withUser('admin');

    const listado = await GET();
    expect(listado.status).toBe(200);
    const body = await listado.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);

    // DELETE sin id: prueba que el guard deja pasar y que la validación propia
    // de la ruta sigue actuando, sin borrar nada.
    expect((await DELETE(del())).status).toBe(400);
  });

  it('falla cerrado en producción si no hay Supabase configurado', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://placeholder.supabase.co');
    withUser('admin');

    const res = await GET();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/supabase/i);
  });

  it('permite el bypass solo en desarrollo sin Supabase configurado', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://placeholder.supabase.co');
    vi.stubEnv('NODE_ENV', 'development');
    withUser();

    const res = await GET();
    expect(res.status).toBe(200);
  });
});
