/**
 * @vitest-environment node
 *
 * Tests de `GET /api/contribuciones`.
 *
 * La ruta es la puerta del panel al SII: exige sesión de socio, valida el ROL y
 * la comuna, y traduce el resultado de la consulta a un estado HTTP que el
 * formulario sepa mostrar. El guard y el módulo del SII se mockean; lo que se
 * prueba es la puerta, la validación y la forma de la respuesta.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { lookupContribucionesSII, requireMember } = vi.hoisted(() => ({
  lookupContribucionesSII: vi.fn(),
  requireMember: vi.fn(),
}));

vi.mock('@/lib/data/siiContribuciones', () => ({ lookupContribucionesSII }));
vi.mock('@/lib/supabase/auth-guard', () => ({ requireMember }));

import { GET } from './route';

function requestOf(query: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/contribuciones${query}`);
}

const VALID = '?rol=15234-67&comuna=Providencia&region=Regi%C3%B3n%20Metropolitana%20de%20Santiago';

beforeEach(() => {
  lookupContribucionesSII.mockReset().mockResolvedValue({
    ok: true,
    annual: 804468,
    year: 2026,
    source: 'sii',
    checkedAt: '2026-10-22T12:00:00.000Z',
  });
  requireMember.mockReset().mockResolvedValue({
    ok: true,
    role: 'member',
    partnerId: 'catedral',
    userId: 'u1',
  });
});

describe('GET /api/contribuciones', () => {
  it('responde lo que diga el guard y no consulta al SII', async () => {
    requireMember.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ success: false }), { status: 401 }),
    });

    const response = await GET(requestOf(VALID));

    expect(response.status).toBe(401);
    expect(lookupContribucionesSII).not.toHaveBeenCalled();
  });

  it('rechaza sin ROL o sin comuna antes de consultar', async () => {
    const sinRol = await GET(requestOf('?comuna=Providencia'));
    const sinComuna = await GET(requestOf('?rol=15234-67'));

    expect(sinRol.status).toBe(400);
    expect(sinComuna.status).toBe(400);
    expect(lookupContribucionesSII).not.toHaveBeenCalled();
  });

  it('devuelve solo monto, año, fuente y fecha; nunca datos del propietario', async () => {
    const response = await GET(requestOf(VALID));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        annual: 804468,
        year: 2026,
        source: 'sii',
        checkedAt: '2026-10-22T12:00:00.000Z',
      },
    });
    expect(lookupContribucionesSII).toHaveBeenCalledWith({
      rol: '15234-67',
      comuna: 'Providencia',
      region: 'Región Metropolitana de Santiago',
    });
  });

  it('traduce «el SII no tiene cuotas» a 404 y «no se pudo consultar» a 502', async () => {
    lookupContribucionesSII.mockResolvedValue({
      ok: false,
      reason: 'not_found',
      error: 'El SII no registra cuotas para ese ROL.',
    });
    expect((await GET(requestOf(VALID))).status).toBe(404);

    lookupContribucionesSII.mockResolvedValue({
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
});
