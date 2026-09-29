/**
 * @vitest-environment node
 *
 * Tests de `/api/geocode`.
 *
 * Lo que más importa acá: el rate limit protege la cuota de Nominatim (1 req/s)
 * de quien quiera usar el proxy como geocodificador propio, el límite es por IP
 * y las consultas cortas siguen respondiendo 200 con lista vacía (el cliente del
 * autocompletado dispara así al montar).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as route from './route';

const fetchMock = vi.fn().mockRejectedValue(new Error('sin red en tests'));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function makeRequest(query: string, ip = '1.2.3.4'): any {
  return new Request(`http://localhost/api/geocode?${query}`, {
    headers: { 'x-forwarded-for': ip },
  }) as any;
}

describe('/api/geocode', () => {
  describe('validación de entrada', () => {
    it('responde 200 vacío con consulta ausente o corta (contrato del autocompletado)', async () => {
      vi.stubGlobal('fetch', fetchMock);

      const vacia = await route.GET(makeRequest('', '7.7.7.7'));
      expect(vacia.status).toBe(200);
      const body = await vacia.json();
      expect(body.success).toBe(true);
      expect(body.results).toEqual([]);

      const corta = await route.GET(makeRequest('q=a', '7.7.7.7'));
      expect(corta.status).toBe(200);
    });

    it('rechaza una consulta absurdamente larga con 400', async () => {
      vi.stubGlobal('fetch', fetchMock);

      const res = await route.GET(makeRequest(`q=${'x'.repeat(121)}`, '7.7.7.7'));

      expect(res.status).toBe(400);
    });
  });

  describe('rate limit', () => {
    it('corta la ráfaga de una misma IP con 429', async () => {
      vi.stubGlobal('fetch', fetchMock);

      let limitado = 0;
      for (let i = 0; i < 70; i++) {
        const res = await route.GET(makeRequest('q=providencia', '9.9.9.9'));
        if (res.status === 429) limitado += 1;
      }

      expect(limitado).toBeGreaterThan(0);
    });

    it('el límite es por IP: una ráfaga no bloquea a los demás', async () => {
      vi.stubGlobal('fetch', fetchMock);

      for (let i = 0; i < 70; i++) {
        await route.GET(makeRequest('q=providencia', '9.9.9.9'));
      }

      const res = await route.GET(makeRequest('q=providencia', '8.8.8.8'));
      expect(res.status).toBe(200);
    });
  });
});
