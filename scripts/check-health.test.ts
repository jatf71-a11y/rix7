/**
 * Tests de la sonda de salud.
 *
 * Lo que hay que proteger es el **veredicto**: este script decide si el CI se
 * pone rojo porque falta algo crítico en producción. Un falso «todo bien»
 * —con Supabase caído— dejaría el portal guardando nada sin que nadie se entere;
 * y un falso rojo por algo meramente degradado (sin Resend, sin Sentry)
 * entrenaría a todos a ignorar el job. Ambos extremos se prueban acá.
 */
import { describe, expect, it } from 'vitest';

import { compareBuilds } from './build-id.mjs';
import {
  DEFAULT_HEALTH_URL,
  formatReport,
  healthUrl,
  judgeHealth,
  normalizeBaseUrl,
  readLiveBuild,
  readLiveRelease,
  runCheck,
  summaryMarkdown,
} from './check-health.mjs';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const HEALTHY = {
  status: 'ok',
  summary: 'Todo lo que el portal necesita está configurado.',
  missing: { broken: [], degraded: [], optional: [] },
  subsystems: [],
};

const HEALTHY_WITH_GAPS = {
  status: 'degraded',
  summary: '2 de 6 subsistemas sin configurar — degradados: service_role, email.',
  missing: { broken: [], degraded: ['service_role', 'email'], optional: [] },
  subsystems: [],
};

/** El estado real de producción mientras Supabase siga en placeholder. */
const BROKEN_SUPABASE = {
  status: 'broken',
  summary: '4 de 6 subsistemas sin configurar — críticos: supabase; degradados: service_role, email; opcionales: monitoring.',
  missing: { broken: ['supabase'], degraded: ['service_role', 'email'], optional: ['monitoring'] },
  subsystems: [
    {
      id: 'supabase',
      label: 'Supabase (proyecto real)',
      severity: 'critical',
      configured: false,
      reason: 'NEXT_PUBLIC_SUPABASE_URL apunta a un proyecto de ejemplo.',
      impact: 'No se guarda nada de lo que hace la gente.',
      fix: 'Pon las claves del proyecto real en Vercel.',
    },
  ],
};

describe('normalizeBaseUrl / healthUrl', () => {
  it('quita la barra final para no armar //api/health', () => {
    expect(healthUrl('https://rix7.vercel.app/')).toBe('https://rix7.vercel.app/api/health');
  });

  it('recorta espacios y barras repetidas', () => {
    expect(normalizeBaseUrl('  https://rix7.cl/// ')).toBe('https://rix7.cl');
  });

  it('soporta un puerto local', () => {
    expect(healthUrl('http://localhost:3111')).toBe('http://localhost:3111/api/health');
  });
});

describe('judgeHealth', () => {
  it('un informe sano no falla', () => {
    const result = judgeHealth(HEALTHY, 200);
    expect(result.ok).toBe(true);
    expect(result.status).toBe('ok');
    expect(result.reasons).toEqual([]);
  });

  it('los degradados y opcionales NO hacen fallar el job', () => {
    const result = judgeHealth(HEALTHY_WITH_GAPS, 200);
    expect(result.ok).toBe(true);
    expect(result.status).toBe('degraded');
    expect(result.reasons).toEqual([]);
    expect(result.degraded).toEqual(['service_role', 'email']);
  });

  it('un crítico sin configurar SÍ falla, y explica qué hacer', () => {
    const result = judgeHealth(BROKEN_SUPABASE, 503);
    expect(result.ok).toBe(false);
    expect(result.status).toBe('broken');
    expect(result.broken).toEqual(['supabase']);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain('Supabase (proyecto real)');
    expect(result.reasons[0]).toContain('proyecto real');
  });

  it('la base de otra cuenta cuenta como crítico, con su motivo y su arreglo', () => {
    // El endpoint lo reporta como un crítico más; acá se comprueba que este job
    // —el que corre solo cada 6 horas— lo tome como un rojo y no lo pase de largo.
    const payload = {
      status: 'broken',
      summary: '1 de 7 subsistemas sin configurar — críticos: supabase_owner.',
      missing: { broken: ['supabase_owner'], degraded: [], optional: [] },
      subsystems: [
        {
          id: 'supabase_owner',
          label: 'Base de la cuenta dueña del proyecto',
          severity: 'critical',
          configured: false,
          reason: 'La base es del proyecto wcxpkfmevrbjrjlbayba, y el de la cuenta dueña (jatf71@gmail.com) es vsqkjimpssdvlvdwrtnh.',
          impact: 'El portal está guardando sobre una base que no es la de la cuenta dueña.',
          fix: 'Poné las credenciales del proyecto de la cuenta dueña y cortá con `npm run corte:supabase`.',
        },
      ],
    };

    const result = judgeHealth(payload, 503);

    expect(result.ok).toBe(false);
    expect(result.status).toBe('broken');
    expect(result.broken).toEqual(['supabase_owner']);
    expect(result.reasons[0]).toContain('Base de la cuenta dueña del proyecto');
    expect(result.reasons[0]).toContain('vsqkjimpssdvlvdwrtnh');
    expect(result.reasons[0]).toContain('corte:supabase');
  });

  it('un crítico sin ficha en subsystems deja un motivo genérico', () => {
    const result = judgeHealth({ missing: { broken: ['misterio'] } }, 503);
    expect(result.ok).toBe(false);
    expect(result.reasons[0]).toContain('misterio');
  });

  it('una respuesta que no es objeto falla', () => {
    expect(judgeHealth(null, 200).ok).toBe(false);
    expect(judgeHealth('hola', 200).ok).toBe(false);
    expect(judgeHealth([1, 2], 200).ok).toBe(false);
  });

  it('una respuesta sin el campo «missing» falla con motivo claro', () => {
    const result = judgeHealth({ status: 'ok' }, 200);
    expect(result.ok).toBe(false);
    expect(result.status).toBe('unreachable');
    expect(result.reasons[0]).toContain('missing');
  });

  it('tolera un «missing» vacío como informe sano', () => {
    const result = judgeHealth({ missing: {} }, 200);
    expect(result.ok).toBe(true);
  });
});

describe('runCheck', () => {
  it('consulta <base>/api/health con accept JSON', async () => {
    let calledUrl = '';
    let accept = '';
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calledUrl = url;
      accept = String(new Headers(init?.headers).get('accept'));
      return jsonResponse(200, HEALTHY);
    }) as unknown as typeof fetch;

    const result = await runCheck({ baseUrl: 'https://rix7.vercel.app/', fetchImpl });
    expect(calledUrl).toBe('https://rix7.vercel.app/api/health');
    expect(accept).toContain('application/json');
    expect(result.ok).toBe(true);
    expect(result.httpStatus).toBe(200);
  });

  it('un 503 con informe de críticos es un fallo del job (no de transporte)', async () => {
    const fetchImpl = (async () => jsonResponse(503, BROKEN_SUPABASE)) as unknown as typeof fetch;
    const result = await runCheck({ baseUrl: 'https://rix7.vercel.app', fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(503);
    expect(result.error).toBeNull();
    expect(result.judgement.broken).toEqual(['supabase']);
  });

  it('un fallo de red se reporta como inalcanzable', async () => {
    const fetchImpl = (async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    }) as unknown as typeof fetch;

    const result = await runCheck({ baseUrl: 'https://rix7.vercel.app', fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.judgement.status).toBe('unreachable');
    expect(result.error).toContain('ENOTFOUND');
  });

  it('una respuesta que no es JSON falla', async () => {
    const fetchImpl = (async () =>
      new Response('<html>Application error</html>', { status: 200 })) as unknown as typeof fetch;

    const result = await runCheck({ baseUrl: 'https://rix7.vercel.app', fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.judgement.status).toBe('unreachable');
    expect(result.judgement.reasons[0]).toContain('JSON');
  });

  it('usa la producción por defecto', async () => {
    let calledUrl = '';
    const fetchImpl = (async (url: string) => {
      calledUrl = url;
      return jsonResponse(200, HEALTHY);
    }) as unknown as typeof fetch;

    await runCheck({ fetchImpl });
    expect(calledUrl).toBe(`${DEFAULT_HEALTH_URL}/api/health`);
  });
});

describe('formatReport', () => {
  it('un sano dice que no falta nada crítico', () => {
    const text = formatReport({ url: 'https://x/api/health', httpStatus: 200, judgement: judgeHealth(HEALTHY, 200) });
    expect(text).toContain('✓');
    expect(text).toContain('https://x/api/health');
  });

  it('un roto nombra el subsistema y qué hacer', () => {
    const text = formatReport({ url: 'https://x/api/health', httpStatus: 503, judgement: judgeHealth(BROKEN_SUPABASE, 503) });
    expect(text).toContain('✗');
    expect(text).toContain('Supabase (proyecto real)');
    expect(text).toContain('Degradados');
  });
});

describe('summaryMarkdown', () => {
  it('marca el estado y lista los motivos', () => {
    const md = summaryMarkdown({ url: 'https://x/api/health', httpStatus: 503, judgement: judgeHealth(BROKEN_SUPABASE, 503) });
    expect(md).toContain('Salud del despliegue');
    expect(md).toContain('❌');
    expect(md).toContain('Supabase');
    expect(md).toContain('Degradados');
  });

  it('un sano usa el check verde', () => {
    const md = summaryMarkdown({ url: 'https://x/api/health', httpStatus: 200, judgement: judgeHealth(HEALTHY, 200) });
    expect(md).toContain('✅');
    expect(md).toContain('**ok**');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// La otra pregunta: ¿lo que está en vivo es este árbol?
// ═════════════════════════════════════════════════════════════════════════════

const TREE_ID = '4f2a3c4b5d6e7f80';
const OTHER_ID = '9a1b2c3d4e5f6071';
const COMMIT = '9d1c3ab77e5f1234567890abcdef1234567890ab';
const OLDER_COMMIT = '1122abc77e5f1234567890abcdef1234567890ab';

/** Lo que devuelve `readTreeBuildId` sobre un repo con cambios sin commitear. */
const TREE = {
  value: `1.${TREE_ID}.${COMMIT}.1.1760361600`,
  id: TREE_ID,
  commit: COMMIT,
  dirty: true,
  changed: 17,
  builtAt: 1760361600,
  files: 380,
  skipped: [],
  error: null,
};

/** Un `/api/health` que además publica de qué build es. */
const withBuild = (build: unknown) => ({ ...HEALTHY, build });

const liveBuild = (id: string, commit: string) => ({
  id,
  commit,
  dirty: false,
  builtAt: '2026-10-13T10:00:00.000Z',
});

describe('readLiveBuild', () => {
  it('lee el identificador que publica el despliegue', () => {
    expect(readLiveBuild(withBuild(liveBuild(TREE_ID, COMMIT)))).toEqual(liveBuild(TREE_ID, COMMIT));
  });

  it('sin campo `build` —o con basura— devuelve null', () => {
    // Un despliegue anterior a esta función, o uno publicado sin el comando del
    // repo, no publica identificador: eso es «no se pudo comprobar», no «coincide».
    expect(readLiveBuild(HEALTHY)).toBeNull();
    expect(readLiveBuild(withBuild(null))).toBeNull();
    expect(readLiveBuild(withBuild({ id: '' }))).toBeNull();
    expect(readLiveBuild(withBuild('4f2a3c4b5d6e7f80'))).toBeNull();
    expect(readLiveBuild(null)).toBeNull();
  });
});

describe('runCheck contra el árbol local', () => {
  it('lo publicado es este árbol: lo dice', async () => {
    const fetchImpl = (async () =>
      jsonResponse(200, withBuild(liveBuild(TREE_ID, COMMIT)))) as unknown as typeof fetch;

    const result = await runCheck({ baseUrl: 'https://rix7.cl', fetchImpl, expected: TREE });

    expect(result.ok).toBe(true);
    expect(result.judgement.build?.status).toBe('match');
  });

  it('en vivo hay otro árbol: cuenta cuántos commits va atrás', async () => {
    const fetchImpl = (async () =>
      jsonResponse(200, withBuild(liveBuild(OTHER_ID, OLDER_COMMIT)))) as unknown as typeof fetch;

    const result = await runCheck({
      baseUrl: 'https://rix7.cl',
      fetchImpl,
      expected: TREE,
      relationImpl: () => ({ relation: 'behind', count: 3, detail: 'producción está 3 commits atrás' }),
    });

    expect(result.judgement.build?.status).toBe('differs');
    expect(result.judgement.build?.level).toBe('warn');
    expect(result.judgement.build?.detail).toContain('3 commits atrás');
    // Sigue sin ser un rojo: no coincidir no es una caída, y el job no puede
    // empezar a ponerse rojo por algo normal.
    expect(result.ok).toBe(true);
  });

  it('no mira la historia si el commit es el mismo', async () => {
    let called = 0;
    const fetchImpl = (async () =>
      jsonResponse(200, withBuild(liveBuild(OTHER_ID, COMMIT)))) as unknown as typeof fetch;

    await runCheck({
      baseUrl: 'https://rix7.cl',
      fetchImpl,
      expected: TREE,
      relationImpl: () => {
        called += 1;
        return null;
      },
    });

    expect(called).toBe(0);
  });

  it('sin árbol local no compara nada (y no inventa un veredicto)', async () => {
    const fetchImpl = (async () =>
      jsonResponse(200, withBuild(liveBuild(OTHER_ID, COMMIT)))) as unknown as typeof fetch;

    const sinArbol = await runCheck({ baseUrl: 'https://rix7.cl', fetchImpl });
    expect(sinArbol.judgement.build).toBeUndefined();

    const sinIdentificador = await runCheck({ baseUrl: 'https://rix7.cl', fetchImpl, expected: null });
    expect(sinIdentificador.judgement.build?.status).toBe('no-tree');
  });

  it('un despliegue que no publica identificador queda dicho', async () => {
    const fetchImpl = (async () => jsonResponse(200, HEALTHY)) as unknown as typeof fetch;

    const result = await runCheck({ baseUrl: 'https://rix7.cl', fetchImpl, expected: TREE });
    expect(result.judgement.build?.status).toBe('no-live');
  });
});

const RELEASE = {
  version: '10.1.0',
  tag: 'v10.1.0',
  nearestTag: 'v10.1.0',
  nearestCommit: 'aaaa1111',
  distance: 0,
  error: null,
};

describe('readLiveRelease', () => {
  it('lee versión y tag del endpoint', () => {
    expect(readLiveRelease({ release: { version: '10.1.0', tag: 'v10.1.0' } })).toEqual({
      version: '10.1.0',
      tag: 'v10.1.0',
    });
  });

  it('un release vacío o ausente no es identidad', () => {
    expect(readLiveRelease(HEALTHY)).toBeNull();
    expect(readLiveRelease({ release: null })).toBeNull();
    expect(readLiveRelease({ release: {} })).toBeNull();
    expect(readLiveRelease({ release: 'v10.1.0' })).toBeNull();
    expect(readLiveRelease(null)).toBeNull();
  });
});

describe('runCheck contra la versión y el tag', () => {
  const conRelease = (release: unknown) =>
    (async () => jsonResponse(200, { ...HEALTHY, release })) as unknown as typeof fetch;

  it('si en vivo está la versión y el tag del repo, coincide', async () => {
    const result = await runCheck({
      baseUrl: 'https://rix7.cl',
      fetchImpl: conRelease({ version: '10.1.0', tag: 'v10.1.0' }),
      releaseExpected: RELEASE,
    });

    expect(result.judgement.release?.status).toBe('match');
    expect(result.judgement.release?.ok).toBe(true);
    // La comparación de release no convierte el portal en «caído»: eso sigue
    // dependiendo de los subsistemas críticos.
    expect(result.ok).toBe(true);
  });

  it('una versión distinta se marca como contradicción', async () => {
    const result = await runCheck({
      baseUrl: 'https://rix7.cl',
      fetchImpl: conRelease({ version: '10.0.0', tag: 'v10.0.0' }),
      releaseExpected: RELEASE,
    });

    expect(result.judgement.release?.status).toBe('version-differs');
    expect(result.judgement.release?.ok).toBe(false);
  });

  it('un deployment sin release no se compara ni se acusa', async () => {
    const result = await runCheck({
      baseUrl: 'https://rix7.cl',
      fetchImpl: (async () => jsonResponse(200, HEALTHY)) as unknown as typeof fetch,
      releaseExpected: RELEASE,
    });

    expect(result.judgement.release?.status).toBe('no-live');
    expect(result.judgement.release?.ok).toBe(true);
  });

  it('sin releaseExpected no agrega el veredicto', async () => {
    const result = await runCheck({
      baseUrl: 'https://rix7.cl',
      fetchImpl: conRelease({ version: '10.1.0', tag: 'v10.1.0' }),
    });

    expect(result.judgement.release).toBeUndefined();
  });
});

describe('el informe nombra la release', () => {
  it('la consola muestra la coincidencia de versión y tag', async () => {
    const result = await runCheck({
      baseUrl: 'https://rix7.cl',
      fetchImpl: (async () =>
        jsonResponse(200, { ...HEALTHY, release: { version: '10.1.0', tag: 'v10.1.0' } })) as unknown as typeof fetch,
      releaseExpected: RELEASE,
    });

    const text = formatReport(result);
    expect(text).toContain('Versión y tag');
    expect(text).toContain('coincide con el repositorio');
  });

  it('la consola marca la contradicción y el resumen la lleva', async () => {
    const result = await runCheck({
      baseUrl: 'https://rix7.cl',
      fetchImpl: (async () =>
        jsonResponse(200, { ...HEALTHY, release: { version: '10.0.0', tag: 'v10.0.0' } })) as unknown as typeof fetch,
      releaseExpected: RELEASE,
    });

    const text = formatReport(result);
    expect(text).toContain('! Versión y tag');
    expect(text).toContain('10.0.0');

    const md = summaryMarkdown(result);
    expect(md).toContain('- Release: **no coincide**');
  });
});

describe('el informe nombra la build', () => {
  const conVeredicto = (comparison: ReturnType<typeof compareBuilds>) => ({
    ...judgeHealth(HEALTHY, 200),
    build: comparison,
  });

  it('la consola dice que en vivo está este árbol', () => {
    const text = formatReport({
      url: 'https://x/api/health',
      httpStatus: 200,
      judgement: conVeredicto(compareBuilds({ live: { id: TREE_ID }, expected: TREE })),
    });

    expect(text).toContain('Identificador de la build');
    expect(text).toContain('coincide con el árbol');
  });

  it('la consola dice que producción quedó atrás, con los dos lados', () => {
    const text = formatReport({
      url: 'https://x/api/health',
      httpStatus: 200,
      judgement: conVeredicto(
        compareBuilds({ live: liveBuild(OTHER_ID, OLDER_COMMIT), expected: TREE })
      ),
    });

    expect(text).toContain('Producción no coincide con el árbol');
    expect(text).toContain('en vivo: 9a1b2c3d…');
    expect(text).toContain('árbol:   4f2a3c4b…');
  });

  it('el resumen de la corrida lo lleva en una línea', () => {
    const coinciden = summaryMarkdown({
      url: 'https://x/api/health',
      httpStatus: 200,
      judgement: conVeredicto(compareBuilds({ live: { id: TREE_ID }, expected: TREE })),
    });
    expect(coinciden).toContain('- Build: **coincide con el árbol del repositorio**');

    const atras = summaryMarkdown({
      url: 'https://x/api/health',
      httpStatus: 200,
      judgement: conVeredicto(
        compareBuilds({ live: liveBuild(OTHER_ID, OLDER_COMMIT), expected: TREE })
      ),
    });
    expect(atras).toContain('- Build: **no coincide con el árbol**');
  });
});
