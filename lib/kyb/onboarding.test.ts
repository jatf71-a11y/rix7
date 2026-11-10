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

// El lector real de PDF no puede leer un PDF de cuatro bytes, y desde que el
// informe se evalúa la subida lo rechaza. Lo que se prueba acá es el vínculo
// entre la subida y la respuesta, no el lector (que tiene sus propios tests en
// `debtReport.test.ts` y `debtReportFindings.test.ts`).
const { saveDebtReport, isDebtReportFromOwner } = vi.hoisted(() => ({
  saveDebtReport: vi.fn(),
  isDebtReportFromOwner: vi.fn(),
}));

vi.mock('./documents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./documents')>()),
  saveDebtReport,
  isDebtReportFromOwner,
}));

let savedReports = 0;
saveDebtReport.mockImplementation(async () => {
  savedReports += 1;
  return {
    ok: true as const,
    document: {
      id: `informe-${savedReports}`,
      ownerKind: 'alta' as const,
      ownerId: 'alta',
      kind: 'juridica' as const,
      fileName: 'informe.pdf',
      sizeBytes: 1024,
      status: 'analyzed' as const,
      analysis: {
        read: true,
        issuedAt: '2026-11-01',
        rut: '76.543.210-3',
        debtor: 'CATEDRAL PROPIEDADES SPA',
        totalDebtClp: 1_200_000,
        creditors: 2,
        currentClp: 1_200_000,
        overdueClp: 0,
        writtenOffClp: 0,
        summary: 'Informe leído',
        notes: [],
      },
      createdAt: new Date().toISOString(),
    },
  };
});
isDebtReportFromOwner.mockResolvedValue(true);

import {
  activateKybPlan,
  answerKybQuestions,
  chooseKybPlan,
  decideApplication,
  decideKybProposal,
  kybPlanChoicesByToken,
  kybProposalByToken,
  kybStatusByToken,
  sendKybProposal,
  submitKybApplication,
} from './onboarding';
import { getApplication, listDecisions, updateApplication } from './store';
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
      workers: 12,
      revenueClp: 612_000_000,
      revenueYear: 2025,
      nameMatches: true,
    };
  },
};

const reputationClean: ReputationAdapter = {
  source: 'simulated',
  async check() {
    return {
      source: 'simulated',
      fraudFlags: [],
      negativeReviews: 0,
      negativeTopics: [],
      mentions: [],
    };
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

/**
 * Recorre el tramo comercial: propuesta enviada, aceptada por el candidato.
 *
 * Devuelve el token de activación que llega en el correo de la aceptación. Es el
 * camino real desde 0031: aprobar ya no emite token, porque el paso siguiente es
 * una decisión de plata que el candidato tiene que tomar.
 */
async function propuestaAceptada(id: string): Promise<string> {
  const sent = await sendKybProposal({ id, plan: 'profesional' });
  if (!sent.ok) throw new Error(`no se pudo enviar la propuesta: ${sent.error}`);

  const proposalToken = tokenFromLastEmail();
  // Aceptar es decir que sí al plan: el CCA no se firma acá (es una
  // determinación posterior, con la cartera que el socio ya cargó).
  const accepted = await decideKybProposal({
    token: proposalToken,
    decision: 'aceptada',
  });
  if (!accepted.ok) throw new Error(`no se pudo aceptar la propuesta: ${accepted.error}`);

  return tokenFromLastEmail();
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

const DEBT_REPORT_ID = 'debt_report';

/**
 * Sube un informe de prueba con el token de la ronda.
 *
 * Sin clave de servicio el documento vive en memoria, así que alcanza con un
 * PDF mínimo: lo que se prueba acá es el vínculo entre la subida y la respuesta,
 * no el lector (que tiene sus propios tests en `debtReport.test.ts`).
 */
async function uploadReport(token: string): Promise<string> {
  const { saveDebtReport } = await import('./documents');
  const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'informe.pdf', {
    type: 'application/pdf',
  });
  const saved = await saveDebtReport({ token, file });
  if (!saved.ok) throw new Error(saved.error);
  return saved.document.id;
}

describe('flujo KYB', () => {
  it('acepta una empresa limpia y la deja calificada con el enlace para elegir plan', async () => {
    const result = await submitKybApplication(empresa, { deps });

    expect(result.ok).toBe(true);
    expect(result.status).toBe('Calificado');
    expect(result.score).toBe(100);

    const stored = await getApplication(result.applicationId as string);
    // Calificar no habilita nada: emite el enlace para elegir plan, y de esa
    // elección sale la propuesta comercial.
    expect(stored.data?.tokenPurpose).toBe('plan');
    expect(stored.data?.status).toBe('Calificado');
    expect(stored.data?.proposal).toEqual([]);

    const qualifiedEmail = sendEmail.mock.calls.at(-1)?.[0] as { subject: string; text: string };
    expect(qualifiedEmail.subject).toMatch(/calificada/i);
    // Los tres planes con precios y el enlace para elegir uno.
    expect(qualifiedEmail.text).toContain('Plan Básico');
    expect(qualifiedEmail.text).toContain('Plan Premium');
    expect(qualifiedEmail.text).toMatch(/empresas\/plan\?token=/);
  });

  it('evalúa con las declaraciones del registro: no vuelve a pedir lo que ya contestó', async () => {
    const result = await submitKybApplication(
      {
        ...empresa,
        website: '',
        email: 'ana.torres@gmail.com',
        registrationKind: 'corredora',
        hasWebsite: false,
        hasCompanyEmail: false,
      },
      { deps }
    );

    const stored = await getApplication(result.applicationId as string);
    expect(stored.data?.hasWebsite).toBe(false);
    expect(stored.data?.hasCompanyEmail).toBe(false);

    // Son las dos preguntas que el motor hacía a quien acababa de decir «no».
    const ids = (result.questions ?? []).map((question) => question.id);
    expect(ids).not.toContain('domain_web');
    expect(ids).not.toContain('email_corporate');
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
    // Tres aclaraciones del motor y el informe de deudas de la CMF.
    expect(submitted.questions?.length).toBe(4);

    const token = tokenFromLastEmail();
    const stored = await getApplication(submitted.applicationId as string);
    expect(stored.data?.tokenPurpose).toBe('answers');

    const reportId = await uploadReport(token);
    const answers = (submitted.questions ?? []).map((question) => ({
      id: question.id,
      answer:
        question.id === DEBT_REPORT_ID
          ? reportId
          : 'El dominio corporativo es torrespropiedades.cl y el correo oficial es contacto@torrespropiedades.cl.',
    }));

    const answered = await answerKybQuestions({ token, answers, deps });
    expect(answered.ok).toBe(true);
    expect(answered.status).toBe('Calificado');
    const subjects = sendEmail.mock.calls.map(
      (call: unknown[]) => (call[0] as { subject: string }).subject
    );
    expect(subjects.some((subject) => /calificada/i.test(subject))).toBe(true);
  });

  it('vuelve a pedir información sobre una solicitud que ya está pendiente', async () => {
    const informal = { ...empresa, website: '', email: 'ana.torres@gmail.com' };
    const submitted = await submitKybApplication(informal, { deps });
    expect(submitted.status).toBe('Pendiente_Informacion');
    const firstToken = tokenFromLastEmail();

    const asked = await decideApplication({
      id: submitted.applicationId as string,
      decision: 'Pendiente_Informacion',
      note: 'La empresa escribió para precisar el domicilio.',
      questions: ['¿Cuál es el domicilio comercial exacto donde opera la empresa?'],
      decidedBy: 'equipo@rix7.cl',
    });

    expect(asked.ok).toBe(true);
    expect(asked.status).toBe('Pendiente_Informacion');
    // La ronda lleva la pregunta del equipo y el informe de deudas del perfil.
    expect(asked.questions?.map((question) => question.id)).toEqual(['manual_1', DEBT_REPORT_ID]);
    // El correo sale igual que en el camino automático: es el de preguntas.
    const mail = sendEmail.mock.calls.at(-1)?.[0] as { subject: string; text: string };
    expect(mail.subject).toMatch(/falta información/i);
    expect(mail.text).toContain('domicilio comercial exacto');

    const stored = await getApplication(submitted.applicationId as string);
    expect(stored.data?.status).toBe('Pendiente_Informacion');
    expect(stored.data?.tokenPurpose).toBe('answers');

    // El token de la ronda anterior murió con la ronda: no sirve para responder.
    const old = await answerKybQuestions({
      token: firstToken,
      answers: [{ id: 'domain_web', answer: 'El dominio corporativo es torres.cl.' }],
      deps,
    });
    expect(old.ok).toBe(false);

    const secondToken = tokenFromLastEmail();
    expect(secondToken).not.toBe(firstToken);

    const reportId = await uploadReport(secondToken);
    const answered = await answerKybQuestions({
      token: secondToken,
      answers: [
        { id: 'manual_1', answer: 'Av. Providencia 1234, oficina 56, Santiago.' },
        { id: DEBT_REPORT_ID, answer: reportId },
      ],
      deps,
    });
    expect(answered.ok).toBe(true);

    const decisions = await listDecisions(submitted.applicationId as string);
    expect(decisions[0]?.decision).toBe('Pendiente_Informacion');
    expect(decisions[0]?.statusBefore).toBe('Pendiente_Informacion');
    expect(decisions[0]?.statusAfter).toBe('Pendiente_Informacion');
    expect(decisions[0]?.decidedBy).toBe('equipo@rix7.cl');
    expect(decisions[0]?.questions).toHaveLength(1);
    expect(decisions[0]?.note).toBe('La empresa escribió para precisar el domicilio.');
  });

  it('no deja pedir información sobre lo que ya terminó', async () => {
    const submitted = await submitKybApplication(empresa, { deps });
    expect(submitted.status).toBe('Calificado');

    const asked = await decideApplication({
      id: submitted.applicationId as string,
      decision: 'Pendiente_Informacion',
      questions: ['¿Cuál es el domicilio comercial exacto donde opera la empresa?'],
      decidedBy: 'equipo@rix7.cl',
    });

    expect(asked.ok).toBe(false);
    expect(asked.code).toBe('conflict');
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

  it('el correo de calificación lleva el perfil y los tres planes de Planes', async () => {
    await submitKybApplication({ ...empresa, registrationKind: 'corredora' }, { deps });

    const mail = sendEmail.mock.calls.at(-1)?.[0] as { subject: string; text: string };
    expect(mail.subject).toMatch(/calificada/);
    expect(mail.text).toContain('Perfil de socio: Corredora');
    expect(mail.text).toMatch(/quedó aceptada y calificada/);
    // Los tres planes con sus montos, y el enlace para elegir uno.
    expect(mail.text).toContain('Plan Básico: $19.990 de alta y $14.990 al mes');
    expect(mail.text).toContain('Plan Profesional: $49.990 de alta y $39.990 al mes');
    expect(mail.text).toContain('Plan Premium: $99.990 de alta y $99.990 al mes');
    expect(mail.text).toMatch(/empresas\/plan\?token=/);
  });

  it('la empresa elige plan desde su correo y eso arma la propuesta', async () => {
    const submitted = await submitKybApplication(
      { ...empresa, registrationKind: 'corredora' },
      { deps }
    );
    const id = submitted.applicationId as string;

    const planToken = tokenFromLastEmail();
    const choices = await kybPlanChoicesByToken(planToken);
    expect(choices.ok).toBe(true);
    expect(choices.plans?.map((plan) => plan.planId)).toEqual([
      'basico',
      'profesional',
      'premium',
    ]);

    const chosen = await chooseKybPlan({ token: planToken, plan: 'premium' });
    expect(chosen.ok).toBe(true);
    expect(chosen.proposal?.planId).toBe('premium');

    const stored = await getApplication(id);
    expect(stored.data?.status).toBe('Propuesta_Comercial');
    // El token de plan ya no sirve: se reemplazó por el de la propuesta.
    expect(stored.data?.tokenPurpose).toBe('proposal');
    expect(stored.data?.proposal).toHaveLength(1);
    // Los montos son los del plan elegido en Planes, no los del perfil.
    expect(stored.data?.proposal[0]).toMatchObject({
      planId: 'premium',
      altaClp: 99990,
      monthlyClp: 99990,
    });

    // El enlace de elección deja de abrir después de usarlo.
    const reused = await kybPlanChoicesByToken(planToken);
    expect(reused.ok).toBe(false);
  });

  it('la propuesta se acepta sin CCA y el correo del alta no lo menciona', async () => {
    const submitted = await submitKybApplication(empresa, { deps });
    const id = submitted.applicationId as string;
    await sendKybProposal({ id, plan: 'profesional' });

    const proposalToken = tokenFromLastEmail();
    sendEmail.mockClear();

    const accepted = await decideKybProposal({ token: proposalToken, decision: 'aceptada' });
    expect(accepted.ok).toBe(true);
    expect(accepted.status).toBe('Alta');

    const stored = await getApplication(id);
    expect(stored.data?.proposal.at(-1)?.commercial).toMatchObject({ captacion: false });

    const acceptedMail = sendEmail.mock.calls
      .map(([mail]) => mail as { subject: string; text: string })
      .find((mail) => /aceptada/i.test(mail.subject));
    expect(acceptedMail).toBeTruthy();
    // El CCA se determina después: ni estimación ni monto en este correo.
    expect(acceptedMail?.text).not.toMatch(/CCA/);
  });

  it('al aceptar guarda la captación y explica el plan de captación', async () => {
    const submitted = await submitKybApplication(empresa, { deps });
    const id = submitted.applicationId as string;
    await sendKybProposal({ id, plan: 'profesional', altaClp: 49990, monthlyClp: 39990 });

    const proposalToken = tokenFromLastEmail();
    sendEmail.mockClear();

    const accepted = await decideKybProposal({
      token: proposalToken,
      decision: 'aceptada',
      captacion: true,
    });
    expect(accepted.ok).toBe(true);

    const stored = await getApplication(id);
    expect(stored.data?.proposal.at(-1)?.commercial).toMatchObject({ captacion: true });

    const subjects = sendEmail.mock.calls.map(
      ([mail]) => (mail as { subject: string }).subject
    );
    expect(subjects.some((subject) => /Cómo funciona el plan de captación/.test(subject))).toBe(
      true
    );
    const acceptedMail = sendEmail.mock.calls
      .map(([mail]) => mail as { subject: string; text: string })
      .find((mail) => /aceptada/i.test(mail.subject));
    // La captación se cobra por perfil; esta empresa no declaró tipo, así que cae
    // en el perfil más chico (Profesional, $9.990) y no en el de corredora.
    expect(acceptedMail?.text).toContain('Captación de leads: $9.990 al mes');
  });

  it('envía la propuesta, la acepta el candidato y el plan habilita el panel', async () => {
    const submitted = await submitKybApplication(empresa, { deps });
    const id = submitted.applicationId as string;

    const sent = await sendKybProposal({ id, plan: 'profesional' });
    expect(sent.ok).toBe(true);
    expect(sent.status).toBe('Propuesta_Comercial');

    const storedAfterProposal = await getApplication(id);
    expect(storedAfterProposal.data?.status).toBe('Propuesta_Comercial');
    expect(storedAfterProposal.data?.tokenPurpose).toBe('proposal');
    expect(storedAfterProposal.data?.proposal).toHaveLength(1);

    const proposalToken = tokenFromLastEmail();
    const view = await kybProposalByToken(proposalToken);
    expect(view.ok).toBe(true);
    expect(view.proposal?.planId).toBe('profesional');
    // Los montos salen de Planes: son los del plan que se envía, no los del
    // perfil del registro.
    expect(view.proposal?.altaClp).toBe(49990);

    const accepted = await decideKybProposal({
      token: proposalToken,
      decision: 'aceptada',
    });
    expect(accepted.ok).toBe(true);
    expect(accepted.status).toBe('Alta');

    const token = tokenFromLastEmail();
    const status = await kybStatusByToken(token);
    expect(status.ok).toBe(true);
    expect(status.status).toBe('Alta');

    // El paso de plan muestra los montos de la propuesta, que salieron de
    // Planes: el catálogo del código ya no tiene precios que los contradigan.
    expect(status.planSummary).toMatchObject({
      planId: 'profesional',
      monthlyClp: 39990,
      altaClp: 49990,
      source: 'propuesta',
    });

    const activated = await activateKybPlan({ token, plan: 'profesional', ccaAccepted: true });
    expect(activated.ok).toBe(true);
    expect(activated.already).toBe(false);
    // Elegir plan no cierra el alta: falta el pago. La solicitud queda en «Alta»
    // y la cobranza la mueve a «Operando» cuando entra el período.
    expect(activated.status).toBe('Alta');
    expect(activated.panel?.enabled).toBe(true);
    expect(activated.panel?.account).toBe('created');
    expect(provisionCompanyPanel).toHaveBeenCalledTimes(1);

    const stored = await getApplication(id);
    expect(stored.data?.status).toBe('Alta');
    expect(stored.data?.panelEnabled).toBe(true);
    expect(stored.data?.plan).toBe('profesional');
    expect(stored.data?.partnerId).toBe('catedral-propiedades-spa-2103');
    expect(stored.data?.activatedAt).toBeTruthy();
    // La autorización del CCA queda fechada en la solicitud: es lo que respalda
    // la primera factura del concepto.
    expect(stored.data?.ccaAuthorizedAt).toBeTruthy();

    const again = await activateKybPlan({ token, plan: 'profesional', ccaAccepted: true });
    expect(again.ok).toBe(true);
    expect(again.already).toBe(true);
    // No se volvió a crear ficha ni cuenta.
    expect(provisionCompanyPanel).toHaveBeenCalledTimes(1);
  });

  it('no habilita el panel si el alta de la empresa falla', async () => {
    const submitted = await submitKybApplication(empresa, { deps });
    const token = await propuestaAceptada(submitted.applicationId as string);

    provisionCompanyPanel.mockResolvedValueOnce({
      ok: false,
      error: 'Falta SUPABASE_SERVICE_ROLE_KEY',
    });

    const activated = await activateKybPlan({ token, plan: 'basico', ccaAccepted: true });
    expect(activated.ok).toBe(false);
    expect(activated.error).toMatch(/SERVICE_ROLE_KEY/);

    const stored = await getApplication(submitted.applicationId as string);
    expect(stored.data?.panelEnabled).toBe(false);
    // El plan quedó escrito con la propuesta que el candidato aceptó; lo que no
    // pasó es el alta: el panel sigue apagado y la solicitud en `Alta`.
    expect(stored.data?.plan).toBe('profesional');
    expect(stored.data?.status).toBe('Alta');
  });

  it('no cierra el alta sin autorización del cobro del CCA', async () => {
    const submitted = await submitKybApplication(empresa, { deps });
    const token = await propuestaAceptada(submitted.applicationId as string);

    const result = await activateKybPlan({ token, plan: 'profesional' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/CCA/);

    // Sin autorización no se crea nada: ni panel, ni socio, ni fecha.
    expect(provisionCompanyPanel).not.toHaveBeenCalled();
    const stored = await getApplication(submitted.applicationId as string);
    expect(stored.data?.panelEnabled).toBe(false);
    expect(stored.data?.ccaAuthorizedAt).toBeNull();
    expect(stored.data?.status).toBe('Alta');
  });

  it('no deja elegir un plan inexistente', async () => {
    const submitted = await submitKybApplication(empresa, { deps });
    const token = await propuestaAceptada(submitted.applicationId as string);

    const result = await activateKybPlan({ token, plan: 'platino', ccaAccepted: true });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/plan/i);
    expect(submitted.applicationId).toBeTruthy();
  });

  it('un enlace de respuestas no sirve para activar', async () => {
    const informal = { ...empresa, website: '', email: 'ana.torres@gmail.com' };
    await submitKybApplication(informal, { deps });
    const token = tokenFromLastEmail();

    const result = await activateKybPlan({ token, plan: 'basico', ccaAccepted: true });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no sirve para activar/);
  });
});

describe('decisiones del equipo', () => {
  /** Solicitud que el motor dejó pendiente: el caso normal de una revisión. */
  async function pendiente() {
    const informal = { ...empresa, website: '', email: 'ana.torres@gmail.com' };
    const submitted = await submitKybApplication(informal, { deps });
    return submitted.applicationId as string;
  }

  it('aprobar a mano deja la solicitud calificada, sin token', async () => {
    const id = await pendiente();

    const result = await decideApplication({
      id,
      decision: 'Aceptada',
      note: 'Verificamos el registro por teléfono con la corredora.',
      decidedBy: 'equipo@rix7.cl',
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe('Calificado');

    const stored = await getApplication(id);
    expect(stored.data?.status).toBe('Calificado');
    // Aprobar emite el enlace para elegir plan; el de activación llega cuando el
    // candidato acepta la propuesta.
    expect(stored.data?.tokenPurpose).toBe('plan');

    const subject = (sendEmail.mock.calls.at(-1)?.[0] as { subject: string }).subject;
    expect(subject).toMatch(/calificada/i);

    const decisions = await listDecisions(id);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      decision: 'Aceptada',
      statusBefore: 'Pendiente_Informacion',
      statusAfter: 'Calificado',
      decidedBy: 'equipo@rix7.cl',
    });
  });

  it('rechazar con motivo cierra la solicitud y mata el token', async () => {
    const id = await pendiente();

    const result = await decideApplication({
      id,
      decision: 'Rechazada',
      note: 'El RUT declarado no coincide con el registro comercial y el sitio no acredita actividad.',
      decidedBy: 'equipo@rix7.cl',
    });

    expect(result.ok).toBe(true);

    const stored = await getApplication(id);
    expect(stored.data?.status).toBe('Rechazada');
    expect(stored.data?.tokenHash).toBeNull();
    expect(stored.data?.tokenPurpose).toBeNull();

    const email = sendEmail.mock.calls.at(-1)?.[0] as { text: string };
    expect(email.text).toContain('no coincide con el registro');

    const decisions = await listDecisions(id);
    expect(decisions[0].decision).toBe('Rechazada');
    expect(decisions[0].note).toContain('RUT');
  });

  it('rechazar sin motivo no toca la solicitud', async () => {
    const id = await pendiente();

    const result = await decideApplication({
      id,
      decision: 'Rechazada',
      decidedBy: 'equipo@rix7.cl',
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalid');

    const stored = await getApplication(id);
    expect(stored.data?.status).toBe('Pendiente_Informacion');
    expect(await listDecisions(id)).toHaveLength(0);
  });

  it('pedir información a mano abre una ronda con esas preguntas', async () => {
    const submitted = await submitKybApplication(empresa, { deps });
    const id = submitted.applicationId as string;
    // Se vuelve a evaluación para probar la decisión que exige preguntas: es el
    // estado desde el que el panel la ofrece.
    await updateApplication(id, { status: 'En_Evaluacion' });

    const result = await decideApplication({
      id,
      decision: 'Pendiente_Informacion',
      questions: [
        '¿Cuál es el domicilio comercial de la corredora?',
        '¿Quién figura como representante legal?',
      ],
      decidedBy: 'equipo@rix7.cl',
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe('Pendiente_Informacion');

    const stored = await getApplication(id);
    expect(stored.data?.tokenPurpose).toBe('answers');

    const email = sendEmail.mock.calls.at(-1)?.[0] as { text: string };
    expect(email.text).toContain('¿Cuál es el domicilio comercial');

    const decisions = await listDecisions(id);
    expect(decisions[0].questions).toHaveLength(2);
  });

  it('no se decide sobre una solicitud que ya terminó', async () => {
    const submitted = await submitKybApplication(empresa, { deps });
    const id = submitted.applicationId as string;
    await updateApplication(id, { status: 'Operando' });

    const result = await decideApplication({
      id,
      decision: 'Rechazada',
      note: 'Motivo suficientemente largo para pasar la validación.',
      decidedBy: 'equipo@rix7.cl',
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('conflict');
  });
});
