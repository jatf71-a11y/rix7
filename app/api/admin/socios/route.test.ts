/**
 * @vitest-environment node
 *
 * Tests de `/api/admin/socios`: la ruta que vincula una **cuenta** con una
 * **corredora** —la pieza que faltaba para que el panel de socios dejara de ser
 * inalcanzable.
 *
 * Se mockean las dos dependencias que hablan con Supabase (el cliente de sesión
 * para el guard y el de clave de servicio para Auth) y se ejercitan las ramas
 * que importan: sin sesión y sin rol no se toca nada; sin clave de servicio se
 * dice qué falta en vez de fingir un alta; el alta escribe el `app_metadata`
 * correcto, no repite trabajo si ya estaba vinculada, y desvincular devuelve la
 * cuenta a Visita.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { getUser, isServiceRoleConfigured, createServiceRoleClient } = vi.hoisted(() => ({
  getUser: vi.fn(),
  isServiceRoleConfigured: vi.fn(),
  createServiceRoleClient: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser } }),
  createPublicClient: () => ({}),
}));

vi.mock('@/lib/supabase/admin', () => ({
  isServiceRoleConfigured,
  createServiceRoleClient,
}));

import { DELETE, GET, POST } from './route';

const URL_SOCIOS = 'http://localhost/api/admin/socios';

/** Sesión simulada con el rol indicado en app_metadata. */
function withUser(role?: string) {
  getUser.mockResolvedValue({
    data: { user: role ? { app_metadata: { role } } : null },
  });
}

const listUsers = vi.fn();
const updateUserById = vi.fn();
const maybeSingle = vi.fn();

/** Cliente de servicio falso: solo lo que la ruta usa. */
function fakeAdminClient() {
  return {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
    auth: { admin: { listUsers, updateUserById } },
  };
}

/** Listado de cuentas que devuelve la API de administración. */
function account(email: string, app_metadata: Record<string, unknown>) {
  return { id: `id-${email}`, email, app_metadata };
}

function listResult(users: unknown[]) {
  listUsers.mockResolvedValue({ data: { users }, error: null });
}

const post = (body: unknown) =>
  new Request(URL_SOCIOS, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  }) as any;

const del = (query: string) => new NextRequest(`${URL_SOCIOS}${query}`) as any;

beforeEach(() => {
  vi.clearAllMocks();
  isServiceRoleConfigured.mockReturnValue(true);
  createServiceRoleClient.mockReturnValue(fakeAdminClient());
  maybeSingle.mockResolvedValue({ data: { id: 'catedral' }, error: null });
  updateUserById.mockResolvedValue({ data: { user: { app_metadata: {} } }, error: null });
  listResult([]);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proyecto-real.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-de-prueba');
  vi.stubEnv('NEXT_PUBLIC_SHOW_ADMIN_ENV', '');
  vi.stubEnv('NODE_ENV', 'production');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('/api/admin/socios — quién entra', () => {
  it('sin sesión responde 401 y no toca las cuentas', async () => {
    withUser();

    for (const res of await Promise.all([
      GET(),
      POST(post({ email: 'a@b.cl', partner_id: 'catedral' })),
      DELETE(del('?email=a@b.cl')),
    ])) {
      expect(res.status).toBe(401);
    }

    expect(listUsers).not.toHaveBeenCalled();
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('una Visita autenticada recibe 403 y no toca nada', async () => {
    withUser('visitor');
    const res = await POST(post({ email: 'a@b.cl', partner_id: 'catedral' }));

    expect(res.status).toBe(403);
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('sin clave de servicio responde 503 diciendo qué falta', async () => {
    withUser('admin');
    isServiceRoleConfigured.mockReturnValue(false);

    for (const res of await Promise.all([
      GET(),
      POST(post({ email: 'a@b.cl', partner_id: 'catedral' })),
      DELETE(del('?email=a@b.cl')),
    ])) {
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toContain('SUPABASE_SERVICE_ROLE_KEY');
    }
  });
});

describe('GET /api/admin/socios', () => {
  it('devuelve solo las cuentas con rol, sin metadata de más', async () => {
    withUser('admin');
    listResult([
      account('corredora@ejemplo.cl', { role: 'member', partner_id: 'catedral', plan: 'pro' }),
      account('visita@ejemplo.cl', {}),
      account('equipo@rix7.cl', { role: 'admin' }),
    ]);

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toEqual([
      { id: 'id-corredora@ejemplo.cl', email: 'corredora@ejemplo.cl', role: 'member', partnerId: 'catedral' },
      { id: 'id-equipo@rix7.cl', email: 'equipo@rix7.cl', role: 'admin', partnerId: null },
    ]);
  });
});

describe('POST /api/admin/socios — vincular', () => {
  it('escribe rol member y el vínculo en app_metadata', async () => {
    withUser('admin');
    listResult([account('corredora@ejemplo.cl', { plan: 'pro' })]);

    const res = await POST(post({ email: 'Corredora@Ejemplo.CL ', partner_id: 'catedral' }));
    expect(res.status).toBe(200);

    expect(updateUserById).toHaveBeenCalledWith('id-corredora@ejemplo.cl', {
      app_metadata: { plan: 'pro', role: 'member', partner_id: 'catedral' },
    });

    const body = await res.json();
    expect(body.data.email).toBe('corredora@ejemplo.cl');
    expect(body.note).toContain('volver a iniciar sesión');
  });

  it('no repite el trabajo si ya estaba vinculada a esa misma corredora', async () => {
    withUser('admin');
    listResult([account('corredora@ejemplo.cl', { role: 'member', partner_id: 'catedral' })]);

    const res = await POST(post({ email: 'corredora@ejemplo.cl', partner_id: 'catedral' }));

    expect(res.status).toBe(200);
    expect((await res.json()).already).toBe(true);
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('no degrada al equipo: un admin conserva su rol al vincularse', async () => {
    withUser('admin');
    listResult([account('equipo@rix7.cl', { role: 'admin' })]);

    await POST(post({ email: 'equipo@rix7.cl', partner_id: 'catedral' }));

    expect(updateUserById).toHaveBeenCalledWith('id-equipo@rix7.cl', {
      app_metadata: { role: 'admin', partner_id: 'catedral' },
    });
  });

  it('404 si no existe una cuenta con ese correo, y lo dice con el correo', async () => {
    withUser('admin');
    listResult([account('otra@ejemplo.cl', { role: 'member', partner_id: 'x' })]);

    const res = await POST(post({ email: 'nadie@ejemplo.cl', partner_id: 'catedral' }));

    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain('nadie@ejemplo.cl');
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('404 si la corredora no existe en la base', async () => {
    withUser('admin');
    maybeSingle.mockResolvedValue({ data: null, error: null });
    listResult([account('corredora@ejemplo.cl', {})]);

    const res = await POST(post({ email: 'corredora@ejemplo.cl', partner_id: 'inventada' }));

    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain('inventada');
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('400 con correo o corredora inválidos, sin consultar nada', async () => {
    withUser('admin');

    for (const body of [
      { email: 'no-es-correo', partner_id: 'catedral' },
      { email: 'a@b.cl' },
      { email: 'a@b.cl', partner_id: 'con espacio' },
      {},
    ]) {
      const res = await POST(post(body));
      expect(res.status).toBe(400);
    }

    expect(listUsers).not.toHaveBeenCalled();
  });

  it('502 si Auth falla al escribir, en vez de decir que vinculó', async () => {
    withUser('admin');
    listResult([account('corredora@ejemplo.cl', {})]);
    updateUserById.mockResolvedValue({ data: null, error: { message: 'boom' } });

    const res = await POST(post({ email: 'corredora@ejemplo.cl', partner_id: 'catedral' }));

    expect(res.status).toBe(502);
    expect((await res.json()).success).toBe(false);
  });
});

describe('DELETE /api/admin/socios — desvincular', () => {
  it('devuelve la cuenta a Visita y borra el vínculo', async () => {
    withUser('admin');
    listResult([account('corredora@ejemplo.cl', { role: 'member', partner_id: 'catedral', plan: 'pro' })]);

    const res = await DELETE(del('?email=corredora@ejemplo.cl'));
    expect(res.status).toBe(200);

    expect(updateUserById).toHaveBeenCalledWith('id-corredora@ejemplo.cl', {
      app_metadata: { plan: 'pro', role: 'visitor', partner_id: null },
    });
  });

  it('404 si la cuenta no está', async () => {
    withUser('admin');
    const res = await DELETE(del('?email=nadie@ejemplo.cl'));

    expect(res.status).toBe(404);
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('400 sin correo válido en la query', async () => {
    withUser('admin');
    const res = await DELETE(del(''));

    expect(res.status).toBe(400);
    expect(listUsers).not.toHaveBeenCalled();
  });
});
