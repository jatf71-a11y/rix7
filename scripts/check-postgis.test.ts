/**
 * Tests de la sonda de PostGIS.
 *
 * Lo que hay que proteger es el **plazo**, porque de él depende que el aviso
 * sirva: si la sonda se pone roja antes de tiempo, el rojo llega mientras
 * todavía se está esperando a Support y se aprende a ignorarlo; si no se pone
 * roja nunca, la espera no tiene disparador y la Vía B no se ejecuta. Los otros
 * dos casos son los de siempre: un «no sé» no puede pasar por aprobado, y un
 * `404` no puede pasar por un fallo.
 *
 * Las respuestas de PostgREST que se usan acá son las reales del proyecto:
 * `200` con filas mientras la tabla está en `public` y `404` con `PGRST205`
 * cuando deja de estarlo.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  DEADLINE_ISO,
  EXPOSED_TABLE,
  classifyProbe,
  formatReport,
  judge,
  probeTable,
  runPostgisCheck,
} from './check-postgis.mjs';

/** El "no existe" de PostgREST para una tabla fuera del esquema expuesto. */
const MISSING_TABLE = {
  code: 'PGRST205',
  details: null,
  hint: null,
  message: "Could not find the table 'public.spatial_ref_sys' in the schema cache",
};

/** Un día antes del plazo y un día después: los dos lados del disparador. */
const ANTES = '2026-10-22T12:00:00Z';
const DESPUES = '2026-10-24T12:00:00Z';

describe('classifyProbe', () => {
  it('200 es que la tabla sigue expuesta', () => {
    const probe = classifyProbe({ status: 200, payload: [{ srid: 4326 }] });

    expect(probe.state).toBe('exposed');
    expect(probe.detail).toContain(EXPOSED_TABLE);
  });

  it('404 es que ya no está en public: el estado bueno', () => {
    expect(classifyProbe({ status: 404, payload: MISSING_TABLE }).state).toBe('moved');
  });

  it('PGRST205 cuenta como traslado aunque el código de estado no sea 404', () => {
    // PostgREST ya devolvió 404 en la práctica; el código es el dato estable.
    expect(classifyProbe({ status: 400, payload: MISSING_TABLE }).state).toBe('moved');
  });

  it('una clave que no puede leer es «no sé», no un aprobado', () => {
    expect(classifyProbe({ status: 401, payload: { code: '401' } }).state).toBe('unknown');
    expect(classifyProbe({ status: 403, payload: null }).state).toBe('unknown');
  });

  it('un 500 o un HTML de proxy no se interpretan como nada', () => {
    expect(classifyProbe({ status: 500, payload: null }).state).toBe('unknown');
    expect(classifyProbe({ status: 200, payload: null }).state).toBe('exposed');
    expect(classifyProbe({}).state).toBe('unknown');
  });
});

describe('judge', () => {
  it('expuesta antes del plazo: en espera, y eso no es un fallo', () => {
    const judgement = judge({ state: 'exposed', now: ANTES });

    expect(judgement).toMatchObject({ verdict: 'waiting', failed: false });
    expect(judgement.detail).toContain('2026-10-23T21:00:00');
  });

  it('expuesta pasado el plazo: rojo, y es el disparador de la Vía B', () => {
    const judgement = judge({ state: 'exposed', now: DESPUES });

    expect(judgement).toMatchObject({ verdict: 'overdue', failed: true });
  });

  it('el mismo instante del plazo ya cuenta como vencido', () => {
    // La fecha se eligió para que el primer cron posterior a ella avise: si el
    // borde quedara del lado del «todavía no», el aviso se iría un día más.
    expect(judge({ state: 'exposed', now: DEADLINE_ISO }).verdict).toBe('overdue');
  });

  it('trasladada es verde en cualquier fecha', () => {
    expect(judge({ state: 'moved', now: DESPUES })).toMatchObject({ verdict: 'moved', failed: false });
    expect(judge({ state: 'moved', now: ANTES }).failed).toBe(false);
  });

  it('no poder decidir es fallo, nunca un aprobado', () => {
    expect(judge({ state: 'unknown', now: ANTES })).toMatchObject({ verdict: 'unknown', failed: true });
  });

  it('un plazo que no es fecha es un fallo, no un «sin plazo»', () => {
    expect(judge({ state: 'exposed', now: ANTES, deadline: 'el viernes' }).failed).toBe(true);
  });

  it('acepta fechas como texto además de Date', () => {
    expect(judge({ state: 'exposed', now: DESPUES }).verdict).toBe('overdue');
  });
});

describe('formatReport', () => {
  const probe = { detail: 'la Data API responde 200: public.spatial_ref_sys sigue expuesta' };

  it('la espera se informa sin marcar fallo', () => {
    const report = formatReport({
      state: 'exposed',
      probe,
      judgement: judge({ state: 'exposed', now: ANTES }),
      now: ANTES,
    });

    expect(report).toContain('·');
    expect(report).not.toContain('✗');
  });

  it('el vencimiento marca el fallo y lleva el arreglo tras la flecha', () => {
    const report = formatReport({
      state: 'exposed',
      probe,
      judgement: judge({ state: 'exposed', now: DESPUES }),
      now: DESPUES,
    });

    const failure = report.split('\n').find((line) => line.trim().startsWith('✗'));
    expect(failure).toBeDefined();
    expect(failure).toContain('→ Ejecutar la Vía B');
  });

  it('el acierto lo dice con todas las letras', () => {
    const report = formatReport({
      state: 'moved',
      probe: { detail: '404' },
      judgement: judge({ state: 'moved', now: DESPUES }),
      now: DESPUES,
    });

    expect(report).toContain('✓');
    expect(report).not.toContain('✗');
  });
});

describe('probeTable', () => {
  it('pide solo el esquema public y manda la clave en los dos encabezados', async () => {
    const fetchImpl = vi.fn(async () => new Response('[]', { status: 200 }));
    await probeTable({ baseUrl: 'https://abc.supabase.co/', apiKey: 'anon', fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://abc.supabase.co/rest/v1/${EXPOSED_TABLE}?select=srid&limit=1`);
    expect((init.headers as Record<string, string>).apikey).toBe('anon');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer anon');
  });

  it('un cuerpo que no es JSON no rompe la lectura del estado', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>502</html>', { status: 502 }));
    const response = await probeTable({ baseUrl: 'https://abc.supabase.co', apiKey: 'anon', fetchImpl });

    expect(response).toEqual({ status: 502, payload: null });
  });
});

describe('runPostgisCheck', () => {
  it('con 200 antes del plazo, en espera y sin error', async () => {
    const result = await runPostgisCheck({
      baseUrl: 'https://abc.supabase.co',
      apiKey: 'anon',
      now: ANTES,
      fetchImpl: async () => new Response('[]', { status: 200 }),
    });

    expect(result).toMatchObject({ state: 'exposed', error: null });
    expect(result.judgement.verdict).toBe('waiting');
  });

  it('con 404 da el aviso por cerrado', async () => {
    const result = await runPostgisCheck({
      baseUrl: 'https://abc.supabase.co',
      apiKey: 'anon',
      now: DESPUES,
      fetchImpl: async () => new Response(JSON.stringify(MISSING_TABLE), { status: 404 }),
    });

    expect(result.state).toBe('moved');
    expect(result.judgement.failed).toBe(false);
  });

  it('una caída de red no se convierte en «cerrado»', async () => {
    const result = await runPostgisCheck({
      baseUrl: 'https://abc.supabase.co',
      apiKey: 'anon',
      now: DESPUES,
      fetchImpl: async () => {
        throw new Error('fetch failed');
      },
    });

    expect(result.state).toBe('unknown');
    expect(result.error).toContain('fetch failed');
    expect(result.judgement.failed).toBe(true);
  });
});
