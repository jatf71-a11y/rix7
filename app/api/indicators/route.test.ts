/**
 * Tests de la route `/api/indicators` con `fetch` mockeado a mindicador.cl.
 *
 * La route guarda estado en módulo (memo de indicadores y cortacircuitos de
 * fallas), así que cada test parte limpio con `vi.resetModules()` + import
 * dinámico — sin eso un test contaminaría al siguiente.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mindicadorOk = (uf = 39500, dolar = 950, utm = 69000) =>
  new Response(
    JSON.stringify({
      fecha: '2026-09-22T00:00:00.000Z',
      uf: { valor: uf, fecha: '2026-09-22T00:00:00.000Z' },
      dolar: { valor: dolar, fecha: '2026-09-21T00:00:00.000Z' },
      utm: { valor: utm },
    }),
    { status: 200 }
  );

let route: typeof import('@/app/api/indicators/route');
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  route = await import('@/app/api/indicators/route');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('/api/indicators', () => {
  it('devuelve UF, dólar y UTM del Banco Central', async () => {
    fetchMock.mockResolvedValueOnce(mindicadorOk(40000, 960, 70000));

    const res = await route.GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.source).toBe('Banco Central de Chile');
    expect(body.uf.value).toBe(40000);
    expect(body.dolar.value).toBe(960);
    expect(body.utm.value).toBe(70000);
  });

  it('marca la respuesta como cacheable en el CDN', async () => {
    fetchMock.mockResolvedValueOnce(mindicadorOk());

    const res = await route.GET();

    expect(res.headers.get('Cache-Control')).toContain('s-maxage=3600');
    expect(res.headers.get('Cache-Control')).toContain('stale-while-revalidate');
  });

  it('no vuelve a consultar la API externa dentro del TTL (memo en memoria)', async () => {
    fetchMock.mockResolvedValue(mindicadorOk());

    const first = await (await route.GET()).json();
    const second = await (await route.GET()).json();
    const third = await (await route.GET()).json();

    // Tres visitas, una sola llamada externa: esto es lo que elimina el ~900 ms
    // que antes pagaba cada request.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it('reconsulta la API externa cuando expira el TTL', async () => {
    fetchMock.mockResolvedValue(mindicadorOk());

    await route.GET();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 1 h + 1 s: el memo debe vencerse
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 3_601_000);
    await route.GET();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('cae a la reserva local si la API externa falla', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }));

    const res = await route.GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.source).toContain('Caché local');
    expect(body.uf.value).toBe(39500);
    expect(body.dolar.value).toBe(950);
  });

  it('cortacircuitos: tras una falla no martilla la API externa', async () => {
    fetchMock.mockRejectedValue(new Error('sin red'));

    await route.GET();
    await route.GET();
    await route.GET();

    // Solo el primer intento sale a la red; los siguientes usan la reserva.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('mantiene el último valor bueno si la API falla después de un acierto', async () => {
    fetchMock.mockResolvedValueOnce(mindicadorOk(41000, 970));

    const good = await (await route.GET()).json();
    expect(good.uf.value).toBe(41000);

    // Vence el TTL y la API ya no responde
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 3_601_000);
    fetchMock.mockRejectedValueOnce(new Error('sin red'));

    const res = await route.GET();
    const body = await res.json();

    expect(body.uf.value).toBe(41000);
    expect(res.headers.get('Cache-Control')).toContain('s-maxage=3600');
  });
});
