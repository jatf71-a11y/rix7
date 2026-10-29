import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * El autómata de los registros de socios.
 *
 * Se mockean el store y el envío de correo: lo que se prueba es **la decisión y
 * sus efectos** —en qué estado queda la solicitud, qué correo sale y a quién—,
 * no la base ni Resend. Las reglas del motor tienen su propio test.
 */

const {
  updateSolicitudReview,
  getSolicitud,
  listSolicitudesForReview,
  findSolicitudByAnswerToken,
  sendEmail,
} = vi.hoisted(() => ({
  updateSolicitudReview: vi.fn(),
  getSolicitud: vi.fn(),
  listSolicitudesForReview: vi.fn(),
  findSolicitudByAnswerToken: vi.fn(),
  sendEmail: vi.fn(),
}));

const REVIEW_KEYS = {
  evaluation: 'solicitud_evaluation',
  answers: 'solicitud_answers',
  tokenHash: 'answer_token_hash',
  tokenExpiresAt: 'answer_token_expires_at',
} as const;

vi.mock('./solicitudesStore', () => ({
  updateSolicitudReview,
  getSolicitud,
  listSolicitudesForReview,
  findSolicitudByAnswerToken,
}));

vi.mock('@/lib/email/sendEmail', () => ({ sendEmail }));

import {
  autopilotSolicitud,
  normalizeAnswers,
  notifyManualDecision,
  submitSolicitudAnswers,
} from './solicitudAutopilot';
import type { Solicitud } from './solicitudes';

const TOKEN = 'a'.repeat(43);

function base(overrides: Partial<Solicitud> = {}, payload: Solicitud['payload'] = {}): Solicitud {
  return {
    id: 'sol-1',
    kind: 'corredora',
    name: 'Camila Rojas',
    email: 'camila@gmail.com',
    phone: '+56 9 1234 5678',
    company: 'Catedral Propiedades',
    message: null,
    payload: {
      rut: '76123456-0',
      coverage: 'nacional',
      regions: [],
      website: null,
      ...payload,
    },
    status: 'Recibida',
    createdAt: '2026-10-29T10:00:00.000Z',
    ...overrides,
  };
}

const COMPLETA = base(
  { email: 'camila@catedralpropiedades.cl' },
  { website: 'https://catedralpropiedades.cl' }
);

beforeEach(() => {
  updateSolicitudReview.mockReset();
  getSolicitud.mockReset();
  listSolicitudesForReview.mockReset();
  findSolicitudByAnswerToken.mockReset();
  sendEmail.mockReset();

  sendEmail.mockResolvedValue({ sent: true, skipped: false });
  listSolicitudesForReview.mockResolvedValue([]);

  // El store falso refleja lo que el autómata escribe, para que la segunda
  // lectura (la de las respuestas) vea lo mismo que vería la base.
  updateSolicitudReview.mockImplementation(async (id: string, patch: Record<string, unknown>) => {
    const payload: Solicitud['payload'] = { ...COMPLETA.payload };
    if (patch.evaluation) payload[REVIEW_KEYS.evaluation] = patch.evaluation;
    if (Array.isArray(patch.answers)) payload[REVIEW_KEYS.answers] = patch.answers;
    if (patch.answerTokenHash === null) delete payload[REVIEW_KEYS.tokenHash];
    else if (typeof patch.answerTokenHash === 'string') {
      payload[REVIEW_KEYS.tokenHash] = patch.answerTokenHash;
    }
    if (typeof patch.answerTokenExpiresAt === 'string') {
      payload[REVIEW_KEYS.tokenExpiresAt] = patch.answerTokenExpiresAt;
    }
    return {
      ok: true,
      found: true,
      persisted: true,
      solicitud: {
        ...COMPLETA,
        id,
        status: (patch.status as Solicitud['status']) ?? COMPLETA.status,
        payload,
      },
    };
  });
});

describe('autopilotSolicitud', () => {
  it('acepta sola y avisa al solicitante, sin emitir token de respuestas', async () => {
    const result = await autopilotSolicitud(COMPLETA);

    expect(result.ok).toBe(true);
    expect(result.status).toBe('Aceptada');
    expect(sendEmail).toHaveBeenCalledTimes(1);

    const [mail] = sendEmail.mock.calls[0];
    expect(mail.to).toBe('camila@catedralpropiedades.cl');
    expect(mail.subject).toContain('aceptado');

    // Dos escrituras: el paso por En_Evaluacion y el estado final. El token se
    // borra al aceptar para que un enlace viejo no siga abriendo el formulario.
    const statuses = updateSolicitudReview.mock.calls.map(([, patch]) => patch.status);
    expect(statuses).toEqual(['En_Evaluacion', 'Aceptada']);
    expect(updateSolicitudReview.mock.calls[1][1].answerTokenHash).toBeNull();
  });

  it('pide información con las preguntas y un enlace nuevo', async () => {
    const result = await autopilotSolicitud(base());

    expect(result.status).toBe('Pendiente_Informacion');
    const [, patch] = updateSolicitudReview.mock.calls[1];
    expect(patch.answerTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(typeof patch.answerTokenExpiresAt).toBe('string');

    const [mail] = sendEmail.mock.calls[0];
    expect(mail.text).toContain('/socios/responder/');
    expect(mail.text).toContain('sitio web');
    expect(mail.text).toContain('proveedor gratuito');
  });

  it('no evalúa una solicitud que ya está en un estado terminal', async () => {
    const result = await autopilotSolicitud(base({ status: 'En_Alta' }));

    expect(result.ok).toBe(false);
    expect(result.code).toBe('conflict');
    expect(updateSolicitudReview).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('una solicitud de propietario no entra al autómata', async () => {
    const result = await autopilotSolicitud(base({ kind: 'propuestas' }));

    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalid');
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('submitSolicitudAnswers', () => {
  const evaluation = {
    score: 77,
    decision: 'Pendiente_Informacion',
    checks: [],
    questions: [
      { id: 'sitio', question: '¿Cuál es el sitio de la empresa?' },
      { id: 'correo', question: '¿Cuál es el correo corporativo?' },
    ],
    reasons: [],
    createdAt: '2026-10-29T10:00:00.000Z',
  };

  const pendiente = base(
    { status: 'Pendiente_Informacion' },
    {
      [REVIEW_KEYS.evaluation]: evaluation,
      [REVIEW_KEYS.tokenExpiresAt]: new Date(Date.now() + 86_400_000).toISOString(),
    }
  );

  it('vuelve a evaluar con lo aclarado y avisa el resultado', async () => {
    findSolicitudByAnswerToken.mockResolvedValue(pendiente);

    const result = await submitSolicitudAnswers(TOKEN, [
      { id: 'sitio', answer: 'https://catedralpropiedades.cl' },
      { id: 'correo', answer: 'camila@catedralpropiedades.cl' },
    ]);

    expect(result.ok).toBe(true);
    expect(result.status).toBe('Aceptada');
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].subject).toContain('aceptado');
  });

  it('un token con forma inválida no llega a la base', async () => {
    const result = await submitSolicitudAnswers('corto', []);

    expect(result.code).toBe('invalid');
    expect(findSolicitudByAnswerToken).not.toHaveBeenCalled();
  });

  it('un enlace vencido no se acepta', async () => {
    findSolicitudByAnswerToken.mockResolvedValue(
      base(
        { status: 'Pendiente_Informacion' },
        {
          [REVIEW_KEYS.evaluation]: evaluation,
          [REVIEW_KEYS.tokenExpiresAt]: '2026-10-01T00:00:00.000Z',
        }
      )
    );

    const result = await submitSolicitudAnswers(TOKEN, [
      { id: 'sitio', answer: 'https://catedralpropiedades.cl' },
      { id: 'correo', answer: 'camila@catedralpropiedades.cl' },
    ]);

    expect(result.ok).toBe(false);
    expect(result.code).toBe('conflict');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('una respuesta vacía no se guarda a medias', async () => {
    findSolicitudByAnswerToken.mockResolvedValue(pendiente);

    const result = await submitSolicitudAnswers(TOKEN, [
      { id: 'sitio', answer: 'https://catedralpropiedades.cl' },
      { id: 'correo', answer: '' },
    ]);

    expect(result.code).toBe('invalid');
    expect(updateSolicitudReview).not.toHaveBeenCalled();
  });
});

describe('normalizeAnswers', () => {
  const questions = [
    { id: 'sitio', question: '¿Sitio?' },
    { id: 'correo', question: '¿Correo?' },
  ];

  it('descarta una respuesta que no corresponde a una pregunta de la ronda', () => {
    const result = normalizeAnswers(questions, [
      { id: 'sitio', answer: 'https://x.cl' },
      { id: 'otra', answer: 'texto libre' },
    ]);

    expect(result.ok).toBe(false);
  });

  it('exige que estén todas', () => {
    const result = normalizeAnswers(questions, [{ id: 'sitio', answer: 'https://x.cl' }]);

    expect(result.ok).toBe(false);
  });
});

describe('notifyManualDecision', () => {
  it('avisa el rechazo cuando lo decide una persona del equipo', async () => {
    await notifyManualDecision(base({ status: 'Rechazada' }), 'Rechazada');

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].subject).toContain('registro');
  });

  it('no manda nada por un estado intermedio', async () => {
    const result = await notifyManualDecision(base(), 'En_Evaluacion');

    expect(result).toBeNull();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
