/**
 * @vitest-environment node
 *
 * Tests de `/api/partner/engagement`: el guard decide quién entra y el handler
 * siempre consulta con la corredora del guard, nunca con un parámetro de la
 * URL. Es la misma garantía que `/api/partner/properties`: un socio no puede
 * ver la actividad de otra corredora cambiando el `partnerId` de la petición.
 *
 * Los tres stores se mockean completos (no hay base real acá) y el cliente de
 * Supabase solo aporta `auth.getUser`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { getUser, listPartnerShareViews, listPartnerShareEvents, listPartnerLeads } = vi.hoisted(
  () => ({
    getUser: vi.fn(),
    listPartnerShareViews: vi.fn(),
    listPartnerShareEvents: vi.fn(),
    listPartnerLeads: vi.fn(),
  })
);

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser } }),
  createPublicClient: () => ({}),
}));

vi.mock('@/lib/data/shareViewsStore', () => ({ listPartnerShareViews }));
vi.mock('@/lib/data/shareEventsStore', () => ({ listPartnerShareEvents }));
vi.mock('@/lib/data/leads-store', () => ({ listPartnerLeads }));

import { GET } from './route';

const URL = 'http://localhost/api/partner/engagement';

const get = (query = '') => new NextRequest(`${URL}${query}`) as any;

/** Sesión simulada con rol y corredora en app_metadata. */
function withUser(role?: string, partnerId?: string) {
  getUser.mockResolvedValue({
    data: {
      user: role
        ? { id: 'uuid-1', app_metadata: { role, ...(partnerId ? { partner_id: partnerId } : {}) } }
        : null,
    },
  });
}

const TODAY = new Date().toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proyecto-real.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-de-prueba');
  vi.stubEnv('NEXT_PUBLIC_SHOW_ADMIN_ENV', '');
  vi.stubEnv('NODE_ENV', 'production');

  listPartnerShareViews.mockResolvedValue({
    views: [{ propertyId: 'p1', day: TODAY.slice(0, 10), partnerId: 'catedral', views: 3 }],
    source: 'supabase',
    persistent: true,
  });
  listPartnerShareEvents.mockResolvedValue({
    events: [
      {
        id: 'e1',
        propertyId: 'p1',
        partnerId: 'catedral',
        channel: 'whatsapp',
        source: 'ficha',
        name: 'Ana Pérez',
        email: 'ana@example.com',
        phone: null,
        shareUrl: 'https://rix7.cl/compartir/p1',
        createdAt: TODAY,
      },
    ],
    source: 'supabase',
    persistent: true,
  });
  listPartnerLeads.mockResolvedValue({
    leads: [
      {
        id: 'l1',
        propertyId: 'p1',
        partnerId: 'catedral',
        name: 'Bruno Díaz',
        email: 'bruno@example.com',
        phone: '+56911111111',
        channel: 'form',
        source: 'landing',
        message: null,
        createdAt: TODAY,
      },
    ],
    source: 'supabase',
    persistent: true,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('/api/partner/engagement — guard', () => {
  it('responde 401 sin sesión y no consulta la actividad', async () => {
    withUser();

    const res = await GET(get());

    expect(res.status).toBe(401);
    expect((await res.json()).success).toBe(false);
    expect(listPartnerShareViews).not.toHaveBeenCalled();
    expect(listPartnerShareEvents).not.toHaveBeenCalled();
    expect(listPartnerLeads).not.toHaveBeenCalled();
  });

  it('responde 403 a un socio sin corredora vinculada', async () => {
    withUser('member');

    const res = await GET(get());

    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('vinculada');
    expect(listPartnerLeads).not.toHaveBeenCalled();
  });

  it('en desarrollo sin Supabase entra con la corredora de desarrollo', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    vi.stubEnv('NODE_ENV', 'development');

    const res = await GET(get());

    expect(res.status).toBe(200);
    expect(listPartnerShareViews).toHaveBeenCalledWith('dev-socio', 180);
    expect(listPartnerShareEvents).toHaveBeenCalledWith('dev-socio');
    expect(listPartnerLeads).toHaveBeenCalledWith('dev-socio');
  });
});

describe('/api/partner/engagement — informe', () => {
  it('consulta las tres fuentes con la corredora del guard, no con la URL', async () => {
    withUser('member', 'catedral');

    const res = await GET(get('?partner=otra&days=30'));

    expect(res.status).toBe(200);
    expect(listPartnerShareViews).toHaveBeenCalledWith('catedral', 180);
    expect(listPartnerShareEvents).toHaveBeenCalledWith('catedral');
    expect(listPartnerLeads).toHaveBeenCalledWith('catedral');
    // Datos de personas: no se cachean en el borde.
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('arma totales, por enlace y por canal con último toque', async () => {
    withUser('member', 'catedral');

    const res = await GET(get('?days=30'));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.persistent).toBe(true);
    expect(body.data.totals).toMatchObject({
      shares: 1,
      views: 3,
      contacts: 1,
      attributedContacts: 1,
      unattributedContacts: 0,
    });
    expect(body.data.byLink[0]).toMatchObject({
      propertyId: 'p1',
      shares: 1,
      views: 3,
      contacts: 1,
      conversion: 1,
    });
    expect(body.data.byChannel[0]).toMatchObject({
      channel: 'whatsapp',
      shares: 1,
      contacts: 1,
      conversion: 1,
    });
  });

  it('acota la ventana pedida y pide aperturas suficientes para atribuir', async () => {
    withUser('member', 'catedral');

    await GET(get('?days=9999'));
    expect(listPartnerShareViews).toHaveBeenLastCalledWith('catedral', 365);

    await GET(get('?days=abc'));
    expect(listPartnerShareViews).toHaveBeenLastCalledWith('catedral', 180);
  });

  it('declara no persistente si alguna fuente cayó al respaldo en memoria', async () => {
    withUser('member', 'catedral');
    listPartnerLeads.mockResolvedValue({ leads: [], source: 'memory', persistent: false });

    const res = await GET(get());
    const body = await res.json();

    expect(body.persistent).toBe(false);
  });
});
