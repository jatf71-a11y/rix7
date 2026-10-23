/**
 * @vitest-environment node
 *
 * El contador del badge es pequeño, pero se arma con datos personales: sin
 * sesión de admin no debe responder ni el número. El store se mockea; el guard
 * ejercita los dos caminos (con y sin autorización).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireAdmin, countSolicitudesNuevas } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  countSolicitudesNuevas: vi.fn(),
}));

vi.mock('@/lib/supabase/auth-guard', () => ({ requireAdmin }));
vi.mock('@/lib/data/solicitudesStore', () => ({ countSolicitudesNuevas }));

import { GET } from './route';

beforeEach(() => {
  requireAdmin.mockReset();
  countSolicitudesNuevas.mockReset();
  requireAdmin.mockResolvedValue({ ok: true, role: 'admin', devBypass: false });
  countSolicitudesNuevas.mockResolvedValue({ count: 3, source: 'supabase', persistent: true });
});

describe('GET /api/admin/solicitudes/count', () => {
  it('devuelve cuántas solicitudes siguen sin revisar y no se cachea', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      count: 3,
      source: 'supabase',
      persistent: true,
    });
  });

  it('sin sesión de admin no consulta ni devuelve el número', async () => {
    requireAdmin.mockResolvedValue({
      ok: false,
      response: Response.json({ success: false }, { status: 403 }),
    });

    const response = await GET();

    expect(response.status).toBe(403);
    expect(countSolicitudesNuevas).not.toHaveBeenCalled();
  });

  it('en desarrollo sin Supabase informa que el número no es persistente', async () => {
    countSolicitudesNuevas.mockResolvedValue({ count: 1, source: 'memory', persistent: false });

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({
      count: 1,
      source: 'memory',
      persistent: false,
    });
  });
});
