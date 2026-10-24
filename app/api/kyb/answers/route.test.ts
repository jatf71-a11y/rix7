/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { answerKybQuestions } = vi.hoisted(() => ({ answerKybQuestions: vi.fn() }));

vi.mock('@/lib/kyb/onboarding', () => ({ answerKybQuestions }));

let route: typeof import('./route');

const token = 'a'.repeat(43);

const post = (payload: unknown, ip = '1.1.1.1') =>
  new Request('http://localhost/api/kyb/answers', {
    method: 'POST',
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
  }) as any;

beforeEach(async () => {
  vi.resetModules();
  route = await import('./route');
  answerKybQuestions.mockReset();
  answerKybQuestions.mockResolvedValue({
    ok: true,
    status: 'En_Alta',
    score: 100,
    questions: [],
    email: { sent: true, skipped: false },
  });
});

describe('POST /api/kyb/answers', () => {
  it('responde con el estado re-evaluado', async () => {
    const res = await route.POST(
      post({
        token,
        answers: [{ id: 'domain_web', answer: 'El dominio oficial es empresa.cl' }],
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.status).toBe('En_Alta');
    expect(json.data.score).toBe(100);
  });

  it('exige al menos una respuesta con contenido', async () => {
    const res = await route.POST(post({ token, answers: [] }));
    expect(res.status).toBe(400);
    expect(answerKybQuestions).not.toHaveBeenCalled();
  });

  it('traduce un token inválido a 403', async () => {
    answerKybQuestions.mockResolvedValue({
      ok: false,
      error: 'El enlace no es válido o ya expiró.',
    });

    const res = await route.POST(
      post({ token, answers: [{ id: 'x', answer: 'respuesta larga' }] })
    );
    expect(res.status).toBe(403);
  });

  it('traduce respuestas incompletas a 400', async () => {
    answerKybQuestions.mockResolvedValue({
      ok: false,
      error: 'Faltan respuestas: domain_web.',
    });

    const res = await route.POST(
      post({ token, answers: [{ id: 'domain_web', answer: 'ok' }] })
    );
    expect(res.status).toBe(400);
  });

  it('rechaza un token con forma inválida', async () => {
    const res = await route.POST(post({ token: 'corto', answers: [{ id: 'x', answer: 'suficiente' }] }));
    expect(res.status).toBe(400);
    expect(answerKybQuestions).not.toHaveBeenCalled();
  });
});
