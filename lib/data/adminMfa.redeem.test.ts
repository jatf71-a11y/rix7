import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendEmail, recordAdminEvent, state } = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  recordAdminEvent: vi.fn(),
  state: { findRow: null as { id: string } | null, claimed: true, readUserOk: true },
}));

const chain = () => {
  const api: Record<string, unknown> = {};
  api.select = () => api;
  api.eq = () => api;
  api.is = () => api;
  api.update = () => api;
  api.maybeSingle = async () => ({ data: state.findRow, error: null });
  api.then = (resolve: (v: unknown) => unknown) =>
    resolve({ data: state.claimed ? [{ id: 'row-1' }] : [], error: null });
  return api;
};

vi.mock('@/lib/supabase/admin', () => ({
  isServiceRoleConfigured: () => true,
  createServiceRoleClient: () => ({
    from: () => chain(),
    auth: {
      admin: {
        getUserById: async () =>
          state.readUserOk
            ? { data: { user: { id: 'admin-1', factors: [] } }, error: null }
            : { data: null, error: { message: 'boom' } },
      },
    },
  }),
}));

vi.mock('@/lib/email/sendEmail', () => ({ sendEmail }));
vi.mock('@/lib/data/adminEvents', () => ({ recordAdminEvent }));

import { redeemRecoveryCode } from './adminMfa';

describe('redeemRecoveryCode · aviso al titular', () => {
  beforeEach(() => {
    sendEmail.mockReset().mockResolvedValue({ sent: true, skipped: false });
    recordAdminEvent.mockReset().mockResolvedValue({ ok: true });
    state.findRow = { id: 'row-1' };
    state.claimed = true;
    state.readUserOk = true;
  });

  it('avisa por correo cuando el canje sale bien', async () => {
    const result = await redeemRecoveryCode({
      userId: 'admin-1',
      email: 'equipo@rix7.cl',
      code: '2345-6789',
    });

    expect(result.ok).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].to).toBe('equipo@rix7.cl');
    expect(result.notified).toEqual({ sent: true, skipped: false });
  });

  it('no avisa ni canjea si el código no sirve', async () => {
    state.findRow = null;

    const result = await redeemRecoveryCode({
      userId: 'admin-1',
      email: 'equipo@rix7.cl',
      code: '2345-6789',
    });

    expect(result.ok).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('si no se pudo quitar el factor, no avisa como si hubiera salido bien', async () => {
    state.readUserOk = false;

    const result = await redeemRecoveryCode({
      userId: 'admin-1',
      email: 'equipo@rix7.cl',
      code: '2345-6789',
    });

    expect(result.ok).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
