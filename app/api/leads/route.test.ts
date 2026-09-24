/**
 * @vitest-environment node
 *
 * Tests de `/api/leads`: el alta es pública y está limitada, el listado es solo
 * para el equipo.
 *
 * El store y el guard se mockean para poder ejercitar los caminos sin Supabase
 * real; la validación que se prueba es la de verdad (`normalizeLead`).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { createLead, listLeads, requireAdmin } = vi.hoisted(() => ({
  createLead: vi.fn(),
  listLeads: vi.fn(),
  requireAdmin: vi.fn(),
}));

vi.mock('@/lib/data/leads-store', () => ({ createLead, listLeads }));
vi.mock('@/lib/supabase/auth-guard', () => ({ requireAdmin }));

// La route guarda el rate limit en estado de módulo, así que cada test parte
// con el contador en cero (`vi.resetModules()` + import dinámico).
let route: typeof import('./route');

const valido = {
  property_id: 'scl-depto-marco-polo',
  partner_id: 'catedral',
  name: 'Javier Torres',
  email: 'javier@example.cl',
  phone: '+56 9 1111 2222',
  channel: 'whatsapp',
};

const post = (body: unknown, ip = '1.2.3.4') =>
  new Request('http://localhost/api/leads', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
  }) as any;

beforeEach(async () => {
  vi.resetModules();
  route = await import('./route');
  createLead.mockReset();
  listLeads.mockReset();
  requireAdmin.mockReset();
  createLead.mockResolvedValue({ ok: true, persisted: true });
  listLeads.mockResolvedValue({ leads: [], source: 'supabase', persistent: true });
  requireAdmin.mockResolvedValue({ ok: true, role: 'admin', devBypass: false });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/leads', () => {
  it('registra un contacto válido y responde 201', async () => {
    const res = await route.POST(post(valido));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.persisted).toBe(true);

    // El contacto llega normalizado al store.
    expect(createLead).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Javier Torres',
        channel: 'whatsapp',
        property_id: 'scl-depto-marco-polo',
      })
    );
  });

  it('no requiere sesión: la visita no tiene cuenta', async () => {
    await route.POST(post(valido));
    expect(requireAdmin).not.toHaveBeenCalled();
  });

  it('rechaza un cuerpo inválido sin llegar al store', async () => {
    const res = await route.POST(post({ ...valido, email: 'no-es-un-correo' }));

    expect(res.status).toBe(400);
    expect(createLead).not.toHaveBeenCalled();
  });

  it('rechaza un cuerpo que no es JSON', async () => {
    const res = await route.POST(post('{roto'));
    expect(res.status).toBe(400);
    expect(createLead).not.toHaveBeenCalled();
  });

  it('corta la ráfaga de una misma IP con 429', async () => {
    let limitado = 0;
    for (let i = 0; i < 40; i++) {
      const res = await route.POST(post(valido, '9.9.9.9'));
      if (res.status === 429) limitado += 1;
    }

    expect(limitado).toBeGreaterThan(0);
    // El cupo del rate limit acota cuántas veces se escribió de verdad.
    expect(createLead.mock.calls.length).toBeLessThan(40);
  });

  it('avisa cuando el contacto no se pudo guardar', async () => {
    createLead.mockResolvedValue({ ok: false, persisted: true, error: 'boom' });

    const res = await route.POST(post(valido));
    expect(res.status).toBe(500);
    expect((await res.json()).success).toBe(false);
  });

  it('informa cuando se guardó sin persistir (desarrollo sin Supabase)', async () => {
    createLead.mockResolvedValue({ ok: true, persisted: false });

    const res = await route.POST(post(valido));
    expect(res.status).toBe(201);
    expect((await res.json()).persisted).toBe(false);
  });
});

describe('GET /api/leads', () => {
  it('responde 401/403 cuando el guard rechaza', async () => {
    requireAdmin.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ success: false }), { status: 403 }),
    });

    const res = await route.GET();
    expect(res.status).toBe(403);
    expect(listLeads).not.toHaveBeenCalled();
  });

  it('devuelve el listado con su origen y si persiste', async () => {
    listLeads.mockResolvedValue({
      leads: [{ id: 'l1', name: 'Javier Torres', channel: 'form' }],
      source: 'supabase',
      persistent: true,
    });

    const res = await route.GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.source).toBe('supabase');
    expect(body.persistent).toBe(true);
  });
});
