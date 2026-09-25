/**
 * @vitest-environment node
 *
 * Tests de `POST /api/share/view`.
 *
 * Lo que se prueba acá no es el contador en sí (eso lo hace la RPC de la base),
 * sino la puerta de entrada pública: qué cuerpos acepta, **a quién le atribuye
 * la apertura** y con qué límite. Es una ruta que puede llamar cualquiera, así
 * que sus reglas tienen que quedar fijadas.
 *
 * Nota sobre el rate limit: el contador vive en estado de módulo, así que los
 * tests que no fijan IP comparten el cubo de `unknown`. Por eso cada ráfaga usa
 * su propia IP y el resto de los casos se mantiene muy por debajo del cupo.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const recordShareView = vi.fn();

vi.mock('@/lib/data/shareViewsStore', () => ({
  recordShareView: (...args: unknown[]) => recordShareView(...args),
}));

import { POST } from './route';

function requestOf(body: unknown, ip?: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/share/view', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(ip ? { 'x-forwarded-for': ip } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  recordShareView.mockReset().mockResolvedValue({ ok: true, persisted: true });
});

describe('POST /api/share/view', () => {
  it('registra la apertura y responde 202', async () => {
    const response = await POST(requestOf({ propertyId: 'scl-depto-marco-polo', partnerId: 'catedral' }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ success: true });
    expect(recordShareView).toHaveBeenCalledWith('scl-depto-marco-polo', 'catedral');
  });

  it('atribuye a la corredora que informó la página', async () => {
    // Ese id lo puso el servidor al renderizar la landing, desde el `partner_id`
    // de la propiedad: es el dato más al día, más que la copia del catálogo.
    await POST(requestOf({ propertyId: 'inm-depto-concepcion', partnerId: 'savills' }));

    expect(recordShareView).toHaveBeenCalledWith('inm-depto-concepcion', 'savills');
  });

  it('cae al catálogo cuando no viene corredora', async () => {
    await POST(requestOf({ propertyId: 'scl-depto-marco-polo' }));

    // La propiedad del catálogo tiene corredora conocida: la apertura no debe
    // quedar sin atribuir pudiendo estarlo.
    expect(recordShareView).toHaveBeenCalledWith('scl-depto-marco-polo', 'catedral');
  });

  it('ignora una corredora vacía o absurdamente larga y usa el catálogo', async () => {
    await POST(requestOf({ propertyId: 'scl-depto-marco-polo', partnerId: '   ' }));
    expect(recordShareView).toHaveBeenLastCalledWith('scl-depto-marco-polo', 'catedral');

    await POST(requestOf({ propertyId: 'scl-depto-marco-polo', partnerId: 'x'.repeat(500) }));
    expect(recordShareView).toHaveBeenLastCalledWith('scl-depto-marco-polo', 'catedral');
  });

  it('deja la apertura sin atribuir si no hay corredora por ningún lado', async () => {
    await POST(requestOf({ propertyId: 'propiedad-desconocida' }));

    // Se cuenta igual: perder la apertura es peor que no saber de quién es.
    expect(recordShareView).toHaveBeenCalledWith('propiedad-desconocida', null);
  });

  it('rechaza sin propiedad', async () => {
    expect((await POST(requestOf({ partnerId: 'catedral' }))).status).toBe(400);
    expect((await POST(requestOf({ propertyId: '   ' }))).status).toBe(400);
    expect((await POST(requestOf({ propertyId: 'p'.repeat(200) }))).status).toBe(400);

    expect(recordShareView).not.toHaveBeenCalled();
  });

  it('rechaza un cuerpo que no es JSON', async () => {
    const response = await POST(requestOf('no soy json'));

    expect(response.status).toBe(400);
    expect(recordShareView).not.toHaveBeenCalled();
  });

  it('responde 503 si no se pudo registrar, sin romper la página', async () => {
    // El aviso es un extra: si no se pudo contar, la landing ya se mostró y no
    // hay nada que el visitante deba hacer al respecto.
    recordShareView.mockResolvedValue({ ok: false, persisted: true, error: 'sin conexión' });

    const response = await POST(requestOf({ propertyId: 'scl-depto-marco-polo' }));
    expect(response.status).toBe(503);
  });

  it('corta la ráfaga por IP', async () => {
    const ip = '10.0.0.9';
    for (let i = 0; i < 60; i++) {
      expect((await POST(requestOf({ propertyId: 'scl-depto-marco-polo' }, ip))).status).toBe(202);
    }

    expect((await POST(requestOf({ propertyId: 'scl-depto-marco-polo' }, ip))).status).toBe(429);
    // Las 60 primeras sí se contaron; la bloqueada no.
    expect(recordShareView).toHaveBeenCalledTimes(60);
  });

  it('el límite es por IP: una ráfaga no bloquea a los demás', async () => {
    const ip = '10.0.0.1';
    for (let i = 0; i < 61; i++) {
      await POST(requestOf({ propertyId: 'scl-depto-marco-polo' }, ip));
    }

    expect((await POST(requestOf({ propertyId: 'scl-depto-marco-polo' }, '10.0.0.2'))).status).toBe(202);
  });
});
