/**
 * @vitest-environment node
 *
 * Tests de `/api/kyb`: el alta es pública y validada; el listado es del equipo.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { submitKybApplication, listApplications, kybSource, requireAdmin } = vi.hoisted(() => ({
  submitKybApplication: vi.fn(),
  listApplications: vi.fn(),
  kybSource: vi.fn(() => 'memory'),
  requireAdmin: vi.fn(),
}));

vi.mock('@/lib/kyb/onboarding', () => ({ submitKybApplication }));
vi.mock('@/lib/kyb/store', () => ({ listApplications, kybSource }));
vi.mock('@/lib/supabase/auth-guard', () => ({ requireAdmin }));

let route: typeof import('./route');

const body = {
  legalName: 'Catedral Propiedades SpA',
  rut: '76.543.210-3',
  website: 'https://catedralpropiedades.cl',
  email: 'contacto@catedralpropiedades.cl',
  contactName: 'Ana Torres',
  phone: '+56 9 8765 4321',
  consent: true,
};

const post = (payload: unknown, ip = '1.2.3.4') =>
  new Request('http://localhost/api/kyb', {
    method: 'POST',
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
  }) as any;

beforeEach(async () => {
  vi.resetModules();
  route = await import('./route');
  submitKybApplication.mockReset();
  listApplications.mockReset();
  requireAdmin.mockReset();

  submitKybApplication.mockResolvedValue({
    ok: true,
    applicationId: 'kyb-1',
    status: 'En_Alta',
    score: 100,
    questions: [],
    persisted: true,
    email: { sent: true, skipped: false },
  });
  listApplications.mockResolvedValue({
    ok: true,
    persisted: true,
    data: { applications: [], source: 'supabase' },
  });
  requireAdmin.mockResolvedValue({ ok: true, role: 'admin', devBypass: false });
});

describe('POST /api/kyb', () => {
  it('registra el alta y devuelve el estado resultante', async () => {
    const res = await route.POST(post(body));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.data).toMatchObject({ id: 'kyb-1', status: 'En_Alta', score: 100 });
    expect(submitKybApplication).toHaveBeenCalledWith(
      expect.objectContaining({ legalName: 'Catedral Propiedades SpA', rut: '76.543.210-3' })
    );
  });

  it('no exige sesión: la empresa todavía no tiene cuenta', async () => {
    await route.POST(post(body));
    expect(requireAdmin).not.toHaveBeenCalled();
  });

  it('rechaza un cuerpo sin consentimiento', async () => {
    const res = await route.POST(post({ ...body, consent: false }));
    expect(res.status).toBe(400);
    expect(submitKybApplication).not.toHaveBeenCalled();
  });

  it('rechaza un correo inválido sin llegar al flujo', async () => {
    const res = await route.POST(post({ ...body, email: 'no-es-correo' }));
    expect(res.status).toBe(400);
    expect(submitKybApplication).not.toHaveBeenCalled();
  });

  it('rechaza un cuerpo que no es JSON', async () => {
    const res = await route.POST(post('{roto'));
    expect(res.status).toBe(400);
  });

  it('corta la ráfaga de una misma IP', async () => {
    let limited = 0;
    for (let i = 0; i < 20; i += 1) {
      const res = await route.POST(post(body, '9.9.9.9'));
      if (res.status === 429) limited += 1;
    }
    expect(limited).toBeGreaterThan(0);
  });

  it('si el alta se guardó pero la evaluación falló, responde 201 con aviso', async () => {
    submitKybApplication.mockResolvedValue({
      ok: false,
      applicationId: 'kyb-2',
      status: 'Recibida',
      persisted: true,
      error: 'El motor no pudo completarse',
    });

    const res = await route.POST(post(body));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.warning).toBe('El motor no pudo completarse');
  });

  it('responde 500 cuando no se guardó nada', async () => {
    submitKybApplication.mockResolvedValue({ ok: false, persisted: true, error: 'boom' });

    const res = await route.POST(post(body));
    expect(res.status).toBe(500);
  });
});

describe('GET /api/kyb', () => {
  it('responde la negativa del guard', async () => {
    requireAdmin.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ success: false }), { status: 403 }),
    });

    const res = await route.GET();
    expect(res.status).toBe(403);
    expect(listApplications).not.toHaveBeenCalled();
  });

  it('lista para el equipo con origen y persistencia', async () => {
    listApplications.mockResolvedValue({
      ok: true,
      persisted: true,
      data: { applications: [{ id: 'kyb-1', status: 'Recibida' }], source: 'supabase' },
    });

    const res = await route.GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(1);
    expect(json.source).toBe('supabase');
    expect(json.persistent).toBe(true);
  });
});
