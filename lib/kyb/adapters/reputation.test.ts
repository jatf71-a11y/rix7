import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createExaReputationAdapter, defaultReputationAdapter, simulatedReputation } from './reputation';

/**
 * Adaptador de búsqueda real: lo que se prueba es el mapeo.
 *
 * El proveedor se simula con un `fetch` falso, así que lo que queda bajo prueba
 * es lo que sí es código nuestro: qué consultas se mandan, qué se cuenta, qué
 * se descarta y qué se le muestra al equipo como sustento.
 */
const EMPRESA = {
  legalName: 'Comercial Los Aromos SpA',
  rut: '76.123.456-7',
  domain: 'losaromos.cl',
};

type ExaResult = { title?: string; url: string; highlights?: string[]; text?: string };

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as unknown as Response;
}

/** Un `fetch` falso que responde según la consulta y anota lo que se pidió. */
function exaFetch(byQuery: (query: string) => ExaResult[]) {
  const calls: { query: string; includeDomains?: string[]; body: Record<string, unknown> }[] = [];

  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { query: string; includeDomains?: string[] };
    calls.push({ ...body, body: body as unknown as Record<string, unknown> });
    return jsonResponse({ results: byQuery(body.query) });
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
}

beforeEach(() => {
  // El entorno del proceso no debe decidir el proveedor en estas pruebas.
  for (const name of ['EXA_API_KEY', 'KYB_SEARCH_URL', 'KYB_SEARCH_API_KEY']) {
    vi.stubEnv(name, undefined);
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('createExaReputationAdapter', () => {
  it('convierte páginas reales en señales, motivos y menciones', async () => {
    const { fetchImpl, calls } = exaFetch((query) => {
      if (query.includes('estafa')) {
        return [
          {
            title: 'Cuidado con Comercial Los Aromos SpA',
            url: 'https://reclamos.cl/estafa-aromos',
            highlights: ['Clientes reportan una estafa de Comercial Los Aromos SpA con reservas.'],
          },
          {
            title: 'Otra corredora cualquiera',
            url: 'https://reclamos.cl/estafa-otra',
            highlights: ['Hay una estafa en otra empresa del rubro.'],
          },
        ];
      }
      if (query.includes('reclamos')) {
        return [
          {
            title: 'Reclamos por la corredora Los Aromos',
            url: 'https://opiniones.cl/aromos-reclamos',
            highlights: ['Reclamos por demoras en la entrega en Comercial Los Aromos SpA.'],
          },
        ];
      }
      if (query.includes('76.123.456-7')) return [];
      return [
        {
          title: 'Comercial Los Aromos SpA',
          url: 'https://www.losaromos.cl/quienes-somos',
          highlights: ['Somos Comercial Los Aromos SpA.'],
        },
      ];
    });

    const adapter = createExaReputationAdapter({ apiKey: 'clave-de-prueba', fetchImpl });
    const signals = await adapter.check(EMPRESA);

    expect(signals.source).toBe('search');
    expect(signals.fraudFlags).toEqual(['«estafa» en “Cuidado con Comercial Los Aromos SpA”']);
    expect(signals.negativeReviews).toBe(1);
    expect(signals.negativeTopics[0]).toMatch(/^«reclamo»: “Reclamos por demoras/);
    // Lo que decide va delante; la página institucional completa la lista.
    expect(signals.mentions.map((mention) => mention.url)).toEqual([
      'https://reclamos.cl/estafa-aromos',
      'https://opiniones.cl/aromos-reclamos',
      'https://www.losaromos.cl/quienes-somos',
    ]);

    // Cinco consultas: razón social, RUT, sitio propio, fraude y reclamos.
    expect(calls).toHaveLength(5);
    const site = calls.find((call) => call.includeDomains);
    expect(site?.includeDomains).toEqual(['losaromos.cl']);
    expect(site?.body.contents).toEqual({ highlights: true });
    expect(site?.body.type).toBe('auto');
    expect(site?.body.numResults).toBe(5);
  });

  it('no cuenta páginas que no nombran a la empresa', async () => {
    const { fetchImpl } = exaFetch((query) =>
      query.includes('estafa')
        ? [
            {
              title: 'Estafa en el rubro inmobiliario',
              url: 'https://prensa.cl/estafa-inmobiliaria',
              highlights: ['Una estafa afectó a varias familias de la ciudad.'],
            },
          ]
        : []
    );

    const adapter = createExaReputationAdapter({ apiKey: 'clave-de-prueba', fetchImpl });
    const signals = await adapter.check(EMPRESA);

    expect(signals.fraudFlags).toEqual([]);
    expect(signals.negativeReviews).toBe(0);
    expect(signals.mentions).toEqual([]);
  });

  it('no repite la misma página cuando aparece en dos consultas', async () => {
    const pagina = {
      title: 'Comercial Los Aromos SpA: reclamos de clientes',
      url: 'https://reclamos.cl/aromos',
      highlights: ['Reclamos de clientes contra Comercial Los Aromos SpA.'],
    };

    // La misma página vuelve en las cinco consultas: se cuenta una vez.
    const { fetchImpl, calls } = exaFetch((query) => (query.includes('Aromos') ? [pagina] : []));
    const signals = await createExaReputationAdapter({ apiKey: 'clave', fetchImpl }).check(EMPRESA);

    expect(calls).toHaveLength(5);
    expect(signals.fraudFlags).toEqual([]);
    expect(signals.negativeReviews).toBe(1);
    expect(signals.negativeTopics).toHaveLength(1);
    expect(signals.mentions).toHaveLength(1);
  });

  it('falla cerrado si una consulta que decide no responde', async () => {
    const fetchImpl = (async () => jsonResponse({ error: 'no credits' }, 402)) as unknown as typeof fetch;

    await expect(createExaReputationAdapter({ apiKey: 'clave', fetchImpl }).check(EMPRESA)).rejects.toThrow(
      /se quedó sin créditos/
    );
  });

  it('sigue cuando la que falla es una consulta de contexto', async () => {
    const { fetchImpl } = exaFetch((query) => {
      if (query.includes('76.123.456-7')) return [];
      if (query.includes('estafa')) {
        return [
          {
            title: 'Reclamos contra Comercial Los Aromos SpA',
            url: 'https://reclamos.cl/aromos',
            highlights: ['Hay una estafa denunciada contra Comercial Los Aromos SpA.'],
          },
        ];
      }
      return [];
    });

    const conFallo = (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { query: string };
      if (body.query.includes('76.123.456-7')) return jsonResponse({ error: 'boom' }, 500);
      return (fetchImpl as unknown as (u: string, i: RequestInit) => Promise<Response>)(url, init);
    }) as unknown as typeof fetch;

    const signals = await createExaReputationAdapter({ apiKey: 'clave', fetchImpl: conFallo }).check(EMPRESA);
    expect(signals.fraudFlags).toHaveLength(1);
  });

  it('explica el corte por tiempo en castellano', async () => {
    const fetchImpl = (async () => {
      const error = new Error('The operation was aborted due to timeout');
      error.name = 'TimeoutError';
      throw error;
    }) as unknown as typeof fetch;

    await expect(
      createExaReputationAdapter({ apiKey: 'clave', fetchImpl, timeoutMs: 8000 }).check(EMPRESA)
    ).rejects.toThrow(/no respondió en 8000 ms/);
  });

  it('corta la lista de menciones en cinco', async () => {
    const { fetchImpl } = exaFetch((query) =>
      Array.from({ length: 8 }, (_, index) => ({
        title: `Página ${index} sobre Comercial Los Aromos SpA`,
        url: `https://sitio.cl/pagina-${index}`,
        highlights: ['Comercial Los Aromos SpA.'],
      })).slice(0, query.includes('estafa') ? 8 : 0)
    );

    const signals = await createExaReputationAdapter({ apiKey: 'clave', fetchImpl }).check(EMPRESA);
    expect(signals.mentions).toHaveLength(5);
  });
});

describe('defaultReputationAdapter', () => {
  it('usa la búsqueda real cuando hay clave de Exa', async () => {
    vi.stubEnv('EXA_API_KEY', 'clave-de-prueba');
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse({ results: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const adapter = defaultReputationAdapter();
    expect(adapter.source).toBe('search');

    await adapter.check(EMPRESA);

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.exa.ai/search');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('clave-de-prueba');
  });

  it('deja que un endpoint propio mande sobre la clave de Exa', async () => {
    vi.stubEnv('EXA_API_KEY', 'clave-de-exa');
    vi.stubEnv('KYB_SEARCH_URL', 'https://busqueda.interna/reputacion');
    vi.stubEnv('KYB_SEARCH_API_KEY', 'bearer-interno');

    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse({ flags: [], negativeReviews: 0 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const signals = await defaultReputationAdapter().check(EMPRESA);

    expect(signals.negativeReviews).toBe(0);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://busqueda.interna/reputacion');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer bearer-interno');
  });

  it('cae en la simulación cuando no hay ningún proveedor configurado', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const adapter = defaultReputationAdapter();
    expect(adapter.source).toBe('simulated');

    const signals = await adapter.check(EMPRESA);
    expect(signals).toEqual(simulatedReputation(EMPRESA));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
