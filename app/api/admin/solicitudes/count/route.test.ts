/**
 * @vitest-environment node
 *
 * El contador del badge es pequeño, pero se arma con datos personales: sin
 * sesión de admin no debe responder ni el número. Los stores se mockean; el
 * guard ejercita los dos caminos (con y sin autorización).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireAdmin, countSolicitudesNuevas, countApplicationsByStatus } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  countSolicitudesNuevas: vi.fn(),
  countApplicationsByStatus: vi.fn(),
}));

vi.mock('@/lib/supabase/auth-guard', () => ({ requireAdmin }));
vi.mock('@/lib/data/solicitudesStore', () => ({ countSolicitudesNuevas }));
vi.mock('@/lib/kyb/store', () => ({ countApplicationsByStatus }));

import { GET } from './route';

beforeEach(() => {
  requireAdmin.mockReset();
  countSolicitudesNuevas.mockReset();
  countApplicationsByStatus.mockReset();
  requireAdmin.mockResolvedValue({ ok: true, role: 'admin', devBypass: false });
  countSolicitudesNuevas.mockResolvedValue({ count: 3, source: 'supabase', persistent: true });
  countApplicationsByStatus.mockResolvedValue({ count: 2, source: 'supabase', persistent: true });
});

describe('GET /api/admin/solicitudes/count', () => {
  it('suma las solicitudes de socios y las altas KYB sin revisar, y no se cachea', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      count: 5,
      source: 'supabase',
      persistent: true,
    });

    // Una alta nace en `Recibida` en su propia tabla: el badge solo la ve si se
    // le pregunta por ese estado.
    expect(countApplicationsByStatus).toHaveBeenCalledWith('Recibida');
  });

  it('sin sesión de admin no consulta ni devuelve el número', async () => {
    requireAdmin.mockResolvedValue({
      ok: false,
      response: Response.json({ success: false }, { status: 403 }),
    });

    const response = await GET();

    expect(response.status).toBe(403);
    expect(countSolicitudesNuevas).not.toHaveBeenCalled();
    expect(countApplicationsByStatus).not.toHaveBeenCalled();
  });

  it('en desarrollo sin Supabase informa que el número no es persistente', async () => {
    countSolicitudesNuevas.mockResolvedValue({ count: 1, source: 'memory', persistent: false });
    countApplicationsByStatus.mockResolvedValue({ count: 4, source: 'memory', persistent: false });

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({
      count: 5,
      source: 'memory',
      persistent: false,
    });
  });

  it('si una de las dos fuentes no es persistente, el total tampoco lo es', async () => {
    // Caso real de una migración a medias: las solicitudes ya están en Supabase y
    // las altas todavía no tienen clave de servicio.
    countApplicationsByStatus.mockResolvedValue({ count: 1, source: 'memory', persistent: false });

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({
      count: 4,
      source: 'memory',
      persistent: false,
    });
  });
});
