import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listUsers, getUserById } = vi.hoisted(() => ({
  listUsers: vi.fn(),
  getUserById: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  isServiceRoleConfigured: () => true,
  createServiceRoleClient: () => ({ auth: { admin: { listUsers, getUserById } } }),
}));

import { resetPartnerMfa } from './partnerMfa';

const user = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  email: 'socia@empresa.cl',
  app_metadata: { role: 'member', partner_id: 'corredora-4204' },
  factors: [],
  ...overrides,
});

describe('resetPartnerMfa', () => {
  beforeEach(() => {
    listUsers.mockReset();
    getUserById.mockReset();
    listUsers.mockResolvedValue({ data: { users: [user()] }, error: null });
    getUserById.mockResolvedValue({
      data: { user: user({ factors: [{ id: 'factor-9', status: 'verified' }] }) },
      error: null,
    });
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proyecto.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-servicio';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200 }))
    );
  });

  it('rechaza un correo que no es un correo', async () => {
    const result = await resetPartnerMfa({ partnerId: 'corredora-4204', email: 'no-es-correo' });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalid');
    expect(listUsers).not.toHaveBeenCalled();
  });

  it('no toca una cuenta que pertenece a otro socio', async () => {
    const result = await resetPartnerMfa({ partnerId: 'otro-socio', email: 'socia@empresa.cl' });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('forbidden');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('avisa cuando la cuenta no existe', async () => {
    listUsers.mockResolvedValue({ data: { users: [] }, error: null });

    const result = await resetPartnerMfa({ partnerId: 'corredora-4204', email: 'nadie@empresa.cl' });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('not_found');
  });

  it('borra los factores de la cuenta vinculada', async () => {
    getUserById.mockResolvedValue({
      data: {
        user: user({
          factors: [
            { id: 'factor-9', status: 'verified' },
            { id: 'factor-10', status: 'unverified' },
          ],
        }),
      },
      error: null,
    });

    const result = await resetPartnerMfa({ partnerId: 'corredora-4204', email: 'Socia@Empresa.cl ' });

    expect(result.ok).toBe(true);
    expect(result.removed).toBe(2);
    expect(result.email).toBe('socia@empresa.cl');
    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://proyecto.supabase.co/auth/v1/admin/users/user-1/factors/factor-9');
    expect(init).toMatchObject({ method: 'DELETE' });
  });

  it('con la cuenta sin factores no borra nada', async () => {
    getUserById.mockResolvedValue({ data: { user: user() }, error: null });

    const result = await resetPartnerMfa({ partnerId: 'corredora-4204', email: 'socia@empresa.cl' });

    expect(result.ok).toBe(true);
    expect(result.removed).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('si la API rechaza el borrado, lo informa en vez de decir que listo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 403 }))
    );

    const result = await resetPartnerMfa({ partnerId: 'corredora-4204', email: 'socia@empresa.cl' });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('provider');
    expect(result.error).toMatch(/403/);
  });
});
