import { describe, it, expect, beforeEach, vi } from 'vitest';

const { sendEmail, provisionCompanyPanel } = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  provisionCompanyPanel: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  isServiceRoleConfigured: () => false,
  createServiceRoleClient: () => {
    throw new Error('sin clave de servicio en tests');
  },
}));

vi.mock('@/lib/email/sendEmail', () => ({
  sendEmail,
  isEmailConfigured: () => true,
}));

vi.mock('./provisioning', () => ({ provisionCompanyPanel }));

import {
  activateKybPlan,
  answerKybQuestions,
  kybStatusByToken,
  submitKybApplication,
} from './onboarding';
import { getApplication } from './store';
import type { TaxAdapter } from './adapters/tax';
import type { ReputationAdapter } from './adapters/reputation';

const taxOk: TaxAdapter = {
  source: 'simulated',
  async verify() {
    return {
      source: 'simulated',
      exists: true,
      active: true,
      businessName: 'Catedral Propiedades SpA',
      activity: 'Servicios inmobiliarios',
      nameMatches: true,
    };
  },
};

const reputationClean: ReputationAdapter = {
  source: 'simulated',
  async check() {
    return { source: 'simulated', fraudFlags: [], negativeReviews: 0, mentions: [] };
  },
};

const deps = { tax: taxOk, reputation: reputationClean };

const empresa = {
  legalName: 'Catedral Propiedades SpA',
  rut: '76.543.210-3',
  website: 'https://catedralpropiedades.cl',
  email: 'contacto@catedralpropiedades.cl',
  contactName: 'Ana Torres',
  phone: '+56 9 8765 4321',
  consent: true,
};

function tokenFromLastEmail(): string {
  const last = sendEmail.mock.calls.at(-1)?.[0] as { text: string } | undefined;
  const match = last?.text.match(/token=([A-Za-z0-9_-]{43})/);
  if (!match) throw new Error('el correo no trae token');
  return match[1];
}

beforeEach(() => {
  sendEmail.mockReset();
  sendEmail.mockResolvedValue({ sent: true, skipped: false });
  provisionCompanyPanel.mockReset();
  provisionCompanyPanel.mockResolvedValue({
    ok: true,
    partnerId: 'catedral-propiedades-spa-2103',
    account: 'created',
    magicLink: 'https://auth.example.com/verify?token=abc',
  });
});

describe('flujo KYB', () => {
  it('acepta una empresa limpia y deja la solicitud en En_Alta con token de activación', async () => {
    const result = await submitKybApplication(empresa, { deps });

    expect(result.ok).toBe(true);
    expect(result.status).toBe('En_Alta');
    expect(result.score).toBe(100);

    const stored = await getApplication(result.applicationId as string);
    expect(stored.data?.tokenPurpose).toBe('activation');
    expect(stored.data?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.data?.status).toBe('En_Alta');

    const activationEmail = sendEmail.mock.calls.at(-1)?.[0] as { subject: string };
    expect(activationEmail.subject).toMatch(/aceptada/i);
  });

  it('guarda la cobertura, las regiones y el mensaje del registro de empresas', async () => {
    const result = await submitKybApplication(
      {
        ...empresa,
        coverage: 'regional',
        regions: ['Valparaíso', 'Biobío'],
        message: 'Corredora con foco en departamentos.',
        registrationKind: 'corredora',
        contactRole: 'Gerente comercial',
      },
      { deps }
    );

    const stored = await getApplication(result.applicationId as string);
    expect(stored.data?.coverage).toBe('regional');
    expect(stored.data?.regions).toEqual(['Valparaíso', 'Biobío']);
    expect(stored.data?.message).toBe('Corredora con foco en departamentos.');
    expect(stored.data?.registrationKind).toBe('corredora');
    expect(stored.data?.contactRole).toBe('Gerente comercial');
  });

  it('pide información, guarda las respuestas y re-evalúa hasta aceptar', async () => {
    const informal = { ...empresa, website: '', email: 'ana.torres@gmail.com' };
    const submitted = await submitKybApplication(informal, { deps });

    expect(submitted.status).toBe('Pendiente_Informacion');
    expect(submitted.questions?.length).toBe(3);

    const token = tokenFromLastEmail();
    const stored = await getApplication(submitted.applicationId as string);
    expect(stored.data?.tokenPurpose).toBe('answers');

    const answers = (submitted.questions ?? []).map((question) => ({
      id: question.id,
      answer:
        'El dominio corporativo es torrespropiedades.cl y el correo oficial es contacto@torrespropiedades.cl.',
    }));

    const answered = await answerKybQuestions({ token, answers, deps });
    expect(answered.ok).toBe(true);
    expect(answered.status).toBe('En_Alta');
    const subjects = sendEmail.mock.calls.map(
      (call: unknown[]) => (call[0] as { subject: string }).subject
    );
    expect(subjects.some((subject) => /aceptada/i.test(subject))).toBe(true);
  });

  it('rechaza respuestas incompletas sin re-evaluar', async () => {
    const informal = { ...empresa, website: '', email: 'ana.torres@gmail.com' };
    const submitted = await submitKybApplication(informal, { deps });
    const token = tokenFromLastEmail();

    const result = await answerKybQuestions({
      token,
      answers: [{ id: 'domain_web', answer: 'x' }],
      deps,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Faltan respuestas/);
  });

  it('un token inventado no resuelve nada', async () => {
    const result = await answerKybQuestions({
      token: 'b'.repeat(43),
      answers: [{ id: 'domain_web', answer: 'una respuesta suficientemente larga' }],
      deps,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no es válido|expiró/);
  });

  it('habilita el panel con el plan elegido y es idempotente', async () => {
    const submitted = await submitKybApplication(empresa, { deps });
    const token = tokenFromLastEmail();

    const status = await kybStatusByToken(token);
    expect(status.ok).toBe(true);
    expect(status.status).toBe('En_Alta');

    const activated = await activateKybPlan({ token, plan: 'profesional' });
    expect(activated.ok).toBe(true);
    expect(activated.already).toBe(false);
    expect(activated.panel?.enabled).toBe(true);
    expect(activated.panel?.account).toBe('created');
    expect(provisionCompanyPanel).toHaveBeenCalledTimes(1);

    const stored = await getApplication(submitted.applicationId as string);
    expect(stored.data?.panelEnabled).toBe(true);
    expect(stored.data?.plan).toBe('profesional');
    expect(stored.data?.activatedAt).toBeTruthy();

    const again = await activateKybPlan({ token, plan: 'profesional' });
    expect(again.ok).toBe(true);
    expect(again.already).toBe(true);
    // No se volvió a crear ficha ni cuenta.
    expect(provisionCompanyPanel).toHaveBeenCalledTimes(1);
  });

  it('no habilita el panel si el alta de la empresa falla', async () => {
    const submitted = await submitKybApplication(empresa, { deps });
    const token = tokenFromLastEmail();

    provisionCompanyPanel.mockResolvedValueOnce({
      ok: false,
      error: 'Falta SUPABASE_SERVICE_ROLE_KEY',
    });

    const activated = await activateKybPlan({ token, plan: 'basico' });
    expect(activated.ok).toBe(false);
    expect(activated.error).toMatch(/SERVICE_ROLE_KEY/);

    const stored = await getApplication(submitted.applicationId as string);
    expect(stored.data?.panelEnabled).toBe(false);
    expect(stored.data?.plan).toBeNull();
  });

  it('no deja elegir un plan inexistente', async () => {
    const submitted = await submitKybApplication(empresa, { deps });
    const token = tokenFromLastEmail();

    const result = await activateKybPlan({ token, plan: 'platino' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/plan/i);
    expect(submitted.applicationId).toBeTruthy();
  });

  it('un enlace de respuestas no sirve para activar', async () => {
    const informal = { ...empresa, website: '', email: 'ana.torres@gmail.com' };
    await submitKybApplication(informal, { deps });
    const token = tokenFromLastEmail();

    const result = await activateKybPlan({ token, plan: 'basico' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no sirve para activar/);
  });
});
