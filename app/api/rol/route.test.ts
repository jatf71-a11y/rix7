/**
 * @vitest-environment node
 *
 * Tests de `GET /api/rol`.
 *
 * La ruta es la puerta del panel a la búsqueda de ROL del SII: exige sesión de
 * socio, valida dirección y comuna, y traduce el resultado a un estado HTTP que
 * el formulario sepa mostrar. El guard y el módulo del SII se mockean; lo que
 * se prueba es la puerta, la validación y la forma de la respuesta.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { lookupRolSII, requireMember } = vi.hoisted(() => ({
  lookupRolSII: vi.fn(),
  requireMember: vi.fn(),
}));

vi.mock('@/lib/data/siiRol', () => ({ lookupRolSII }));
vi.mock('@/lib/supabase/auth-guard', () => ({ requireMember }));

import { GET } from './route';

function requestOf(query: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/rol${query}`);
}

const VALID = '?direccion=Av.%20Providencia%201234%2C%20depto%20901&comuna=Providencia';

beforeEach(() => {
  lookupRolSII.mockReset().mockResolvedValue({
    ok: true,
    total: 1,
    candidates: [
      {
        rol: '14-345',
        address: 'PROVIDENCIA 1234 LC 1',
        comuna: 'PROVIDENCIA',
        destino: 'COMERCIO',
      },
    ],
  });
  requireMember.mockReset().mockResolvedValue({
    ok: true,
    role: 'member',
    partnerId: 'catedral',
    userId: 'u1',
  });
});

describe('GET /api/rol', () => {
  it('responde lo que diga el guard y no consulta al SII', async () => {
    requireMember.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ success: false }), { status: 401 }),
    });

    const response = await GET(requestOf(VALID));

    expect(response.status).toBe(401);
    expect(lookupRolSII).not.toHaveBeenCalled();
  });

  it('rechaza sin dirección o sin comuna antes de consultar', async () => {
    const sinDireccion = await GET(requestOf('?comuna=Providencia'));
    const sinComuna = await GET(requestOf('?direccion=Av.%20Providencia%201234'));

    expect(sinDireccion.status).toBe(400);
    expect(sinComuna.status).toBe(400);
    expect(lookupRolSII).not.toHaveBeenCalled();
  });

  it('devuelve los predios con su total y sin caché', async () => {
    const response = await GET(requestOf(VALID));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        total: 1,
        candidates: [
          {
            rol: '14-345',
            address: 'PROVIDENCIA 1234 LC 1',
            comuna: 'PROVIDENCIA',
            destino: 'COMERCIO',
          },
        ],
      },
    });
    expect(lookupRolSII).toHaveBeenCalledWith({
      address: 'Av. Providencia 1234, depto 901',
      comuna: 'Providencia',
    });
  });

  it('traduce «no hay predios» a 404 y «no se pudo consultar» a 502', async () => {
    lookupRolSII.mockResolvedValue({
      ok: false,
      reason: 'not_found',
      error: 'El SII no encontró predios en esa dirección.',
    });
    expect((await GET(requestOf(VALID))).status).toBe(404);

    lookupRolSII.mockResolvedValue({
      ok: false,
      reason: 'upstream',
      error: 'No se pudo consultar el SII.',
    });
    const upstream = await GET(requestOf(VALID));
    expect(upstream.status).toBe(502);
    await expect(upstream.json()).resolves.toMatchObject({
      success: false,
      reason: 'upstream',
    });
  });

  it('una dirección sin número es un 400 con el motivo puesto', async () => {
    lookupRolSII.mockResolvedValue({
      ok: false,
      reason: 'invalid',
      error: 'Escribe la dirección con su número.',
    });

    const response = await GET(requestOf(VALID));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      reason: 'invalid',
    });
  });
});
