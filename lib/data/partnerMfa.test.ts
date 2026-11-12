import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listUsers, getUserById, sendEmail, recordAdminEvent, getPartnerById } = vi.hoisted(() => ({
  listUsers: vi.fn(),
  getUserById: vi.fn(),
  sendEmail: vi.fn(),
  recordAdminEvent: vi.fn(),
  getPartnerById: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  isServiceRoleConfigured: () => true,
  createServiceRoleClient: () => ({ auth: { admin: { listUsers, getUserById } } }),
}));

vi.mock('@/lib/email/sendEmail', () => ({ sendEmail }));
vi.mock('@/lib/data/adminEvents', () => ({ recordAdminEvent }));
vi.mock('@/lib/data/partners-store', () => ({ getPartnerById }));

import { PARTNER_MFA_RESET_ACTION, resetPartnerMfa } from './partnerMfa';

const actor = { id: 'admin-1', email: 'equipo@rix7.cl' };

const user = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  email: 'socia@empresa.cl',
  app_metadata: { role: 'member', partner_id: 'corredora-4204' },
  factors: [],
  ...overrides,
});

/** La cuenta como la ve el detalle: con su factor activo. */
const withFactor = () => ({
  data: { user: user({ factors: [{ id: 'factor-9', status: 'verified' }] }) },
  error: null,
});

describe('resetPartnerMfa', () => {
  beforeEach(() => {
    listUsers.mockReset();
    getUserById.mockReset();
    sendEmail.mockReset();
    recordAdminEvent.mockReset();
    getPartnerById.mockReset();

    listUsers.mockResolvedValue({ data: { users: [user()] }, error: null });
    getUserById.mockResolvedValue(withFactor());
    sendEmail.mockResolvedValue({ sent: true, skipped: false });
    recordAdminEvent.mockResolvedValue({ ok: true });
    getPartnerById.mockResolvedValue({ id: 'corredora-4204', name: 'Corredora 4204' });

    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proyecto.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-servicio';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200 }))
    );
  });

  it('rechaza un correo que no es un correo', async () => {
    const result = await resetPartnerMfa({ partnerId: 'corredora-4204', email: 'no-es-correo', actor });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalid');
    expect(listUsers).not.toHaveBeenCalled();
  });

  it('no toca una cuenta que pertenece a otro socio', async () => {
    const result = await resetPartnerMfa({ partnerId: 'otro-socio', email: 'socia@empresa.cl', actor });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('forbidden');
    expect(fetch).not.toHaveBeenCalled();
    expect(recordAdminEvent).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('avisa cuando la cuenta no existe', async () => {
    listUsers.mockResolvedValue({ data: { users: [] }, error: null });

    const result = await resetPartnerMfa({ partnerId: 'corredora-4204', email: 'nadie@empresa.cl', actor });

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

    const result = await resetPartnerMfa({ partnerId: 'corredora-4204', email: 'Socia@Empresa.cl ', actor });

    expect(result.ok).toBe(true);
    expect(result.removed).toBe(2);
    expect(result.email).toBe('socia@empresa.cl');
    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://proyecto.supabase.co/auth/v1/admin/users/user-1/factors/factor-9');
    expect(init).toMatchObject({ method: 'DELETE' });
  });

  it('deja registro de quién lo hizo', async () => {
    await resetPartnerMfa({ partnerId: 'corredora-4204', email: 'socia@empresa.cl', actor });

    expect(recordAdminEvent).toHaveBeenCalledTimes(1);
    expect(recordAdminEvent.mock.calls[0][0]).toMatchObject({
      action: PARTNER_MFA_RESET_ACTION,
      actorId: 'admin-1',
      actorEmail: 'equipo@rix7.cl',
      partnerId: 'corredora-4204',
      targetEmail: 'socia@empresa.cl',
      detail: { factors: 1 },
    });
  });

  it('le avisa por correo a la cuenta que quedó sin segundo factor', async () => {
    const result = await resetPartnerMfa({ partnerId: 'corredora-4204', email: 'socia@empresa.cl', actor });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const mail = sendEmail.mock.calls[0][0];
    expect(mail.to).toBe('socia@empresa.cl');
    expect(mail.subject).toMatch(/verificación en dos pasos/i);
    expect(mail.text).toContain('Corredora 4204');
    expect(mail.text).toContain('/socio/cuenta');
    expect(result.notified).toEqual({ sent: true, skipped: false });
  });

  it('si el correo no sale, lo dice sin dar el reset por fallido', async () => {
    sendEmail.mockResolvedValue({ sent: false, skipped: true, error: 'Falta RESEND_API_KEY' });

    const result = await resetPartnerMfa({ partnerId: 'corredora-4204', email: 'socia@empresa.cl', actor });

    expect(result.ok).toBe(true);
    expect(result.removed).toBe(1);
    expect(result.notified).toEqual({ sent: false, skipped: true, error: 'Falta RESEND_API_KEY' });
  });

  it('si el registro falla, lo informa aparte del reset', async () => {
    recordAdminEvent.mockResolvedValue({ ok: false, error: 'No se pudo registrar la acción: sin tabla' });

    const result = await resetPartnerMfa({ partnerId: 'corredora-4204', email: 'socia@empresa.cl', actor });

    expect(result.ok).toBe(true);
    expect(result.removed).toBe(1);
    expect(result.audit).toEqual({ ok: false, error: 'No se pudo registrar la acción: sin tabla' });
  });

  it('con la cuenta sin factores no borra, no registra y no manda correo', async () => {
    getUserById.mockResolvedValue({ data: { user: user() }, error: null });

    const result = await resetPartnerMfa({ partnerId: 'corredora-4204', email: 'socia@empresa.cl', actor });

    expect(result.ok).toBe(true);
    expect(result.removed).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(recordAdminEvent).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('si la API rechaza el borrado, lo informa en vez de decir que listo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 403 }))
    );

    const result = await resetPartnerMfa({ partnerId: 'corredora-4204', email: 'socia@empresa.cl', actor });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('provider');
    expect(result.error).toMatch(/403/);
    expect(recordAdminEvent).not.toHaveBeenCalled();
  });
});
