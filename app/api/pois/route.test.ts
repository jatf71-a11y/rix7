/**
 * Tests de la route `/api/pois` con `fetch` mockeado.
 *
 * La route usa estado en módulo (caché de servidor y buckets de rate limit),
 * así que cada test parte limpio: `vi.resetModules()` + import dinámico.
 *
 * `NextRequest` se simula con el `Request` estándar — la route solo usa
 * `request.url` y `request.headers`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const okOverpass = (elements: unknown[]) =>
  new Response(JSON.stringify({ elements }), { status: 200 });

const fail = (status: number) => new Response('error', { status });

// Espejos en el orden declarado por la route
const ENDPOINT_1 = 'https://overpass-api.de/api/interpreter';
const ENDPOINT_3 = 'https://overpass.private.coffee/api/interpreter';

let route: typeof import('@/app/api/pois/route');
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  route = await import('@/app/api/pois/route');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function makeRequest(query: string, ip = '1.2.3.4'): any {
  return new Request(`http://localhost/api/pois?${query}`, {
    headers: { 'x-forwarded-for': ip },
  }) as any;
}

describe('/api/pois', () => {
  describe('validación de entrada', () => {
    it('rechaza coordenadas fuera de rango con 400', async () => {
      const res = await route.GET(makeRequest('lat=999&lng=999'));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rechaza coordenadas no numéricas con 400', async () => {
      const res = await route.GET(makeRequest('lat=abc&lng=-70.5'));
      expect(res.status).toBe(400);
    });

    it('rechaza parámetros ausentes con 400', async () => {
      const res = await route.GET(makeRequest(''));
      expect(res.status).toBe(400);
    });
  });

  describe('parsing de la respuesta de Overpass', () => {
    it('convierte elementos OSM a POIs con label, color y SVG', async () => {
      fetchMock.mockResolvedValueOnce(
        okOverpass([
          { id: 1, lat: -33.4, lon: -70.5, tags: { amenity: 'school', name: 'Colegio Los Alerces' } },
          { id: 2, lat: -33.41, lon: -70.51, tags: { amenity: 'pharmacy' } }, // sin nombre
          { id: 3, lat: -33.42, lon: -70.52, tags: { amenity: 'bench' } }, // no categorizable
        ]),
      );

      const res = await route.GET(makeRequest('lat=-33.4&lng=-70.5'));
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.cached).toBe(false);
      expect(body.data).toHaveLength(2); // bench filtrado

      const school = body.data[0];
      expect(school.name).toBe('Colegio Los Alerces');
      expect(school.type).toBe('school');
      expect(school.typeLabel).toBe('Colegio');
      expect(school.category).toBe('education');
      expect(school.color).toBe('#3b82f6');
      expect(school.svg).toContain('stroke="#3b82f6"');

      // Sin nombre → fallback al label de la categoría
      const pharmacy = body.data[1];
      expect(pharmacy.name).toBe('Salud');
      expect(pharmacy.typeLabel).toBe('Farmacia');
    });

    it('consulta el primer espejo con POST y la query completa', async () => {
      fetchMock.mockResolvedValueOnce(okOverpass([]));
      await route.GET(makeRequest('lat=-33.4&lng=-70.5'));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(ENDPOINT_1);
      expect(init.method).toBe('POST');
      expect(init.body).toContain('data=');
      const q = decodeURIComponent(init.body);
      // Radio de búsqueda codificado en la query
      expect(q).toContain('around:1500,-33.4,-70.5');
      // Nodos + ways + relations (comisarías, cuarteles y locales son
      // polígonos) con su centroide
      expect(q).toContain('nwr["amenity"~"police|fire_station"]');
      expect(q).toContain('out center;');
      expect(q).not.toContain('node["');
    });

    it('mapea ways y relations usando su centroide', async () => {
      fetchMock.mockResolvedValueOnce(
        okOverpass([
          {
            type: 'way',
            id: 100,
            center: { lat: -33.4212, lon: -70.5981 },
            tags: { amenity: 'fire_station', name: '14ª Compañía de Bomberos' },
          },
        ]),
      );

      const body = await (await route.GET(makeRequest('lat=-33.4175&lng=-70.598'))).json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].lat).toBe(-33.4212);
      expect(body.data[0].lng).toBe(-70.5981);
      expect(body.data[0].typeLabel).toBe('Cuartel de Bomberos');
    });

    it('categoriza seguridad derivada del nombre (PDI, comisaría, seguridad ciudadana)', async () => {
      fetchMock.mockResolvedValueOnce(
        okOverpass([
          { type: 'way', id: 1, center: { lat: -33.42, lon: -70.59 }, tags: { name: '19 Comisaría Providencia' } },
          { type: 'node', id: 2, lat: -33.43, lon: -70.6, tags: { office: 'government', name: 'PDI Las Condes' } },
          { type: 'node', id: 3, lat: -33.44, lon: -70.61, tags: { name: 'Centro de Seguridad Ciudadana' } },
        ]),
      );

      const body = await (await route.GET(makeRequest('lat=-33.4175&lng=-70.598'))).json();
      expect(body.data.map((p: any) => p.category)).toEqual(['safety', 'safety', 'safety']);
      expect(body.data.map((p: any) => p.typeLabel)).toEqual([
        'Comisaría de Carabineros',
        'PDI',
        'Seguridad Ciudadana municipal',
      ]);
    });

    it('no cuenta dos veces el mismo lugar (nodo + polígono del edificio)', async () => {
      fetchMock.mockResolvedValueOnce(
        okOverpass([
          { type: 'node', id: 1, lat: -33.4175, lon: -70.598, tags: { shop: 'supermarket', name: 'Unimarc' } },
          { type: 'way', id: 2, center: { lat: -33.41755, lon: -70.59805 }, tags: { shop: 'supermarket', name: 'Unimarc' } },
        ]),
      );

      const body = await (await route.GET(makeRequest('lat=-33.4175&lng=-70.598'))).json();
      expect(body.data).toHaveLength(1);
    });
  });

  describe('failover de espejos', () => {
    it('prueba el siguiente espejo cuando uno falla (503, 429)', async () => {
      fetchMock
        .mockResolvedValueOnce(fail(503))
        .mockResolvedValueOnce(fail(429))
        .mockResolvedValueOnce(okOverpass([{ id: 9, lat: -33.4, lon: -70.5, tags: { amenity: 'clinic' } }]));

      const res = await route.GET(makeRequest('lat=-33.4&lng=-70.5'));
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls[2][0]).toBe(ENDPOINT_3);
    });

    it('responde 502 elegante si todos los espejos fallan', async () => {
      fetchMock.mockResolvedValue(fail(429));

      const res = await route.GET(makeRequest('lat=-33.4&lng=-70.5'));
      expect(res.status).toBe(502);

      const body = await res.json();
      expect(body.success).toBe(false);
      // Los 5 espejos fueron probados (fallan rápido, no agotan el presupuesto)
      expect(fetchMock).toHaveBeenCalledTimes(5);
    });
  });

  describe('caché de servidor', () => {
    it('sirve la segunda visita a la misma celda sin reconsultar Overpass', async () => {
      fetchMock.mockResolvedValue(okOverpass([{ id: 1, lat: -33.4, lon: -70.5, tags: { amenity: 'school' } }]));

      const first = await route.GET(makeRequest('lat=-33.41751&lng=-70.59801', '1.1.1.1'));
      expect((await first.json()).cached).toBe(false);

      // Misma celda (~11 m): toFixed(4) idéntico, aunque IP distinta
      const second = await route.GET(makeRequest('lat=-33.41752&lng=-70.59802', '2.2.2.2'));
      expect((await second.json()).cached).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('celdas distintas disparan consultas distintas', async () => {
      // Response fresco por llamada: el body de un Response solo se lee una vez
      fetchMock.mockImplementation(async () => okOverpass([]));
      await route.GET(makeRequest('lat=-33.4175&lng=-70.5980'));
      await route.GET(makeRequest('lat=-33.4200&lng=-70.6000'));
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('NO cachea respuestas vacías (espejo degradado)', async () => {
      fetchMock.mockImplementation(async () => okOverpass([]));
      await route.GET(makeRequest('lat=-33.4175&lng=-70.5980'));
      await route.GET(makeRequest('lat=-33.4175&lng=-70.5980'));
      // Segunda consulta fue a Overpass de nuevo, no a caché
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('sirve copia vencida (stale) si Overpass falla después del TTL', async () => {
      const T0 = 1_700_000_000_000;
      vi.useFakeTimers();
      vi.setSystemTime(T0);

      fetchMock.mockResolvedValue(okOverpass([{ id: 1, lat: -33.4, lon: -70.5, tags: { amenity: 'school', name: 'Colegio' } }]));
      await route.GET(makeRequest('lat=-33.4175&lng=-70.5980'));

      // 25 h después: caché vencida y Overpass caído
      vi.setSystemTime(T0 + 25 * 60 * 60 * 1000);
      fetchMock.mockResolvedValue(fail(429));

      const res = await route.GET(makeRequest('lat=-33.4175&lng=-70.5980'));
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.stale).toBe(true);
      expect(body.cached).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].name).toBe('Colegio');
    });
  });

  describe('snapshot estático (último recurso)', () => {
    it('sirve el snapshot enriquecido cuando no hay caché y Overpass falla', async () => {
      vi.resetModules();
      vi.doMock('@/lib/data/poiSnapshot.generated.json', () => ({
        default: {
          generated_at: '2026-09-21T00:00:00Z',
          cells: {
            '-33.4175_-70.5980': {
              lat: -33.4175,
              lng: -70.598,
              pois: [
                { id: 11, lat: -33.4176, lng: -70.5981, name: 'Metro El Golf', type: 'station', category: 'transport' },
                { id: 12, lat: -33.4174, lng: -70.5979, name: '', type: 'pharmacy', category: 'health' },
              ],
            },
          },
        },
      }));
      const fresh = await import('@/app/api/pois/route');

      fetchMock.mockResolvedValue(fail(503));
      const res = await fresh.GET(makeRequest('lat=-33.4175&lng=-70.5980'));
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.snapshot).toBe(true);
      expect(body.stale).toBe(true);
      expect(body.cached).toBe(true);
      expect(body.data).toHaveLength(2);

      const station = body.data.find((p: any) => p.id === 11);
      expect(station.typeLabel).toBe('Estación');
      expect(station.color).toBe('#f59e0b');
      const pharmacy = body.data.find((p: any) => p.id === 12);
      expect(pharmacy.name).toBe('Salud'); // fallback desde la categoría
      expect(pharmacy.svg).toContain('stroke="#ef4444"');

      vi.doUnmock('@/lib/data/poiSnapshot.generated.json');
    });
  });

  describe('rate limit por IP', () => {
    it('permite 30 req/min y bloquea la 31 con Retry-After', async () => {
      fetchMock.mockImplementation(async () => okOverpass([]));

      for (let i = 0; i < 30; i++) {
        const res = await route.GET(makeRequest('lat=-33.4&lng=-70.5', '9.9.9.9'));
        expect(res.status).toBe(200);
      }

      const blocked = await route.GET(makeRequest('lat=-33.4&lng=-70.5', '9.9.9.9'));
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get('Retry-After')).toBe('60');
      const body = await blocked.json();
      expect(body.success).toBe(false);
    });

    it('el límite es por IP: otra IP no hereda el bloqueo', async () => {
      fetchMock.mockImplementation(async () => okOverpass([]));
      for (let i = 0; i < 30; i++) {
        await route.GET(makeRequest('lat=-33.4&lng=-70.5', '7.7.7.7'));
      }
      const other = await route.GET(makeRequest('lat=-33.4&lng=-70.5', '5.5.5.5'));
      expect(other.status).toBe(200);
    });
  });
});
