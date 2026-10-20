/**
 * @vitest-environment node
 *
 * Tests de `POST /api/share/event`.
 *
 * Lo que se fija acá es la puerta pública: qué cuerpos acepta, con qué
 * identidad, y cuánto se puede insistir. El store se mockea porque no hay una
 * base real; la validación que corre es la de verdad (`normalizeShareEvent`).
 *
 * El rate limit vive en estado de módulo, así que cada test parte con
 * `vi.resetModules()` y cada ráfaga usa su propia IP.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { createShareEvent } = vi.hoisted(() => ({ createShareEvent: vi.fn() }));

vi.mock('@/lib/data/shareEventsStore', () => ({ createShareEvent }));

let route: typeof import('./route');

const valido = {
  property_id: 'scl-depto-marco-polo',
  partner_id: 'catedral',
  channel: 'whatsapp',
  source: 'landing',
  name: 'Ana Prueba',
  email: 'ana.prueba@example.com',
  phone: '+56 9 1111 1111',
  share_url: 'https://rix7.cl/compartir/scl-depto-marco-polo',
};

function requestOf(body: unknown, ip = '1.2.3.4'): NextRequest {
  return new NextRequest('http://localhost:3000/api/share/event', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(async () => {
  vi.resetModules();
  route = await import('./route');
  createShareEvent.mockReset().mockResolvedValue({ ok: true, persisted: true });
});

describe('POST /api/share/event', () => {
  it('registra un compartido con identidad y responde 201', async () => {
    const response = await route.POST(requestOf(valido));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ success: true, persisted: true });

    expect(createShareEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        property_id: 'scl-depto-marco-polo',
        partner_id: 'catedral',
        channel: 'whatsapp',
        source: 'landing',
        name: 'Ana Prueba',
        email: 'ana.prueba@example.com',
      })
    );
  });

  it('no exige sesión: el registro vive en el dispositivo del visitante', async () => {
    const response = await route.POST(requestOf(valido));
    expect(response.status).toBe(201);
  });

  it('rechaza una identidad incompleta o inválida sin llegar al store', async () => {
    expect((await route.POST(requestOf({ ...valido, email: 'ana@ejemplo' }))).status).toBe(400);
    expect((await route.POST(requestOf({ ...valido, name: '   ' }))).status).toBe(400);
    expect((await route.POST(requestOf({ ...valido, channel: 'telegram' }))).status).toBe(400);
    expect((await route.POST(requestOf({ ...valido, source: 'otra' }))).status).toBe(400);
    expect((await route.POST(requestOf({ ...valido, property_id: undefined }))).status).toBe(400);

    expect(createShareEvent).not.toHaveBeenCalled();
  });

  it('rechaza un cuerpo que no es JSON', async () => {
    const response = await route.POST(requestOf('{roto'));
    expect(response.status).toBe(400);
    expect(createShareEvent).not.toHaveBeenCalled();
  });

  it('corta la ráfaga de una misma IP con 429', async () => {
    const ip = '10.0.0.7';
    for (let i = 0; i < 60; i++) {
      expect((await route.POST(requestOf(valido, ip))).status).toBe(201);
    }

    expect((await route.POST(requestOf(valido, ip))).status).toBe(429);
    expect(createShareEvent).toHaveBeenCalledTimes(60);
  });

  it('el límite es por IP: una ráfaga no bloquea a los demás', async () => {
    for (let i = 0; i < 61; i++) await route.POST(requestOf(valido, '10.0.0.8'));

    expect((await route.POST(requestOf(valido, '10.0.0.9'))).status).toBe(201);
  });

  it('avisa cuando el compartido no se pudo guardar', async () => {
    createShareEvent.mockResolvedValue({ ok: false, persisted: true, error: 'boom' });

    const response = await route.POST(requestOf(valido));
    expect(response.status).toBe(500);
    expect((await response.json()).success).toBe(false);
  });

  it('informa cuando se guardó sin persistir (desarrollo sin Supabase)', async () => {
    createShareEvent.mockResolvedValue({ ok: true, persisted: false });

    const response = await route.POST(requestOf(valido));
    expect(response.status).toBe(201);
    expect((await response.json()).persisted).toBe(false);
  });
});
