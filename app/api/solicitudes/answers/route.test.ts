/**
 * @vitest-environment node
 *
 * La ruta pública de respuestas: el solicitante no tiene sesión, se identifica
 * con el token del correo. El autómata se mockea; lo que se prueba es el mapeo
 * de errores a estados HTTP y que el token nunca se delegue sin validar.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { submitSolicitudAnswers } = vi.hoisted(() => ({ submitSolicitudAnswers: vi.fn() }));

vi.mock('@/lib/data/solicitudAutopilot', () => ({ submitSolicitudAnswers }));

let route: typeof import('./route');

const TOKEN = 'a'.repeat(43);

const post = (body: unknown, ip = '5.5.5.5') =>
  new NextRequest('http://localhost/api/solicitudes/answers', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
  });

const valido = {
  token: TOKEN,
  answers: [{ id: 'sitio', answer: 'https://catedralpropiedades.cl' }],
};

beforeEach(async () => {
  vi.resetModules();
  route = await import('./route');
  submitSolicitudAnswers.mockReset();
  submitSolicitudAnswers.mockResolvedValue({
    ok: true,
    status: 'Aceptada',
    evaluation: { decision: 'Aceptada', score: 100 },
    questions: [],
    email: { sent: true, skipped: false },
  });
});

describe('POST /api/solicitudes/answers', () => {
  it('devuelve en qué quedó el registro después de re-evaluar', async () => {
    const response = await route.POST(post(valido));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body.data).toMatchObject({ status: 'Aceptada', decision: 'Aceptada', score: 100 });
    expect(submitSolicitudAnswers).toHaveBeenCalledWith(TOKEN, valido.answers);
  });

  it('un enlace que no existe responde 403, no 500', async () => {
    submitSolicitudAnswers.mockResolvedValue({
      ok: false,
      code: 'not_found',
      error: 'El enlace no es válido o ya se usó.',
    });

    const response = await route.POST(post(valido));

    expect(response.status).toBe(403);
  });

  it('un enlace vencido o de otra ronda es un conflicto (409)', async () => {
    submitSolicitudAnswers.mockResolvedValue({
      ok: false,
      code: 'conflict',
      error: 'El enlace venció.',
    });

    const response = await route.POST(post(valido));

    expect(response.status).toBe(409);
  });

  it('respuestas incompletas se rechazan en la forma, sin llamar al autómata', async () => {
    const response = await route.POST(post({ token: TOKEN, answers: [] }));

    expect(response.status).toBe(400);
    expect(submitSolicitudAnswers).not.toHaveBeenCalled();
  });

  it('un cuerpo que no es JSON responde 400', async () => {
    const response = await route.POST(post('{roto'));

    expect(response.status).toBe(400);
    expect(submitSolicitudAnswers).not.toHaveBeenCalled();
  });

  it('un fallo del store se informa como 500', async () => {
    submitSolicitudAnswers.mockResolvedValue({
      ok: false,
      code: 'store',
      error: 'No se pudieron guardar las respuestas.',
    });

    const response = await route.POST(post(valido));

    expect(response.status).toBe(500);
  });

  it('corta la ráfaga de una misma IP con 429', async () => {
    let limitado = 0;
    for (let i = 0; i < 40; i += 1) {
      const response = await route.POST(post(valido, '7.7.7.7'));
      if (response.status === 429) limitado += 1;
    }

    expect(limitado).toBeGreaterThan(0);
  });
});
