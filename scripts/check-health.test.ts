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

import {
  DEFAULT_HEALTH_URL,
  formatReport,
  healthUrl,
  judgeHealth,
  normalizeBaseUrl,
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
