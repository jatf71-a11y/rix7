/**
 * Tests de la sonda de esquema.
 *
 * Lo que hay que proteger es el **veredicto**, porque de él depende que un
 * release se detenga o siga: un falso «la base está lista» publica código contra
 * columnas que no existen —el incidente que este script viene a evitar—, y un
 * falso rojo enseña a saltear el paso. El tercer caso, el más traicionero, es el
 * «no sé»: una respuesta que no se entiende (un HTML de proxy, un 500) **no**
 * puede contar como aprobado.
 *
 * Las respuestas de PostgREST que se usan acá son las que devolvió de verdad el
 * proyecto de producción: `42703` para una columna que falta y `PGRST202` para
 * una función que falta.
 */
import { describe, expect, it } from 'vitest';

import {
  REQUIRED_SCHEMA,
  formatReport,
  judgeColumn,
  judgeObject,
  judgeRpc,
  judgeSchema,
  normalizeBaseUrl,
  readCredentials,
  runSchemaCheck,
  schemaPlan,
} from './check-schema.mjs';

/** El "no existe" real de Postgres, tal como llegó desde producción. */
const MISSING_COLUMN = {
  code: '42703',
  details: null,
  hint: null,
  message: 'column properties.rol does not exist',
};

/** El "no existe" real de PostgREST para una función, recortado. */
const MISSING_FUNCTION = {
  code: 'PGRST202',
  details: 'Searched for the function public.rix7_partner_id without parameters …',
  hint: null,
  message: 'Could not find the function public.rix7_partner_id without parameters in the schema cache',
};

/**
 * El "hay dos" real de PostgREST, tal como llegó el 2026-10-14 desde el proyecto
 * recuperado: `get_properties_filtered` quedó con la firma vieja (sin
 * `p_partner_id`) **y** la nueva, porque `CREATE OR REPLACE` no reemplaza una
 * función cuya lista de argumentos cambió. El buscador se quedó sin una sola
 * propiedad, con la tabla llena.
 */
const AMBIGUOUS_FUNCTION = {
  code: 'PGRST203',
  details: null,
  hint: 'Try renaming the parameters or the function itself in the database so function overloading can be resolved',
  message:
    'Could not choose the best candidate function between: public.get_properties_filtered(…9 args…), public.get_properties_filtered(…10 args…)',
};

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const textResponse = (status: number, body: string) => new Response(body, { status });

/** Servidor simulado: una respuesta por URL, y registra lo que se pidió. */
function server(routes: Record<string, () => Response>) {
  const calls: { url: string; method: string; apikey: string | null }[] = [];

  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      apikey: new Headers(init?.headers).get('apikey'),
    });
    const route = routes[url];
    if (!route) throw new Error(`ruta no simulada: ${url}`);
    return route();
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
}

const BASE = 'https://proyecto.supabase.co';

describe('el buscador como requisito', () => {
  it('prueba la función como la llama el portal, no con un cuerpo vacío', () => {
    const plan = schemaPlan(
      [
        {
          id: 'get_properties_filtered(bbox)',
          kind: 'rpc' as const,
          name: 'get_properties_filtered',
          body: '{"min_lng":-76,"min_lat":-56,"max_lng":-66,"max_lat":-17}',
          migration: '0005_properties_rpc',
          because: 'es el buscador',
        },
      ],
      BASE,
    );

    expect(plan[0].body).toContain('min_lng');
    expect(plan[0].method).toBe('POST');
  });

  it('el manifiesto incluye el buscador con el recuadro de Chile', () => {
    const buscador = REQUIRED_SCHEMA.find((item) => item.name === 'get_properties_filtered');
    expect(buscador).toBeTruthy();
    expect(buscador?.migration).toBe('0005_properties_rpc');
    const body = JSON.parse(buscador?.body ?? '{}');
    // Los cuatro números del recuadro continental, y nada más: es la forma en
    // que lo llama `listCandidateProperties`.
    expect(Object.keys(body).sort()).toEqual(['max_lat', 'max_lng', 'min_lat', 'min_lng']);
  });
});

/** Todas las respuestas de un proyecto al día. */
const HEALTHY_ROUTES: Record<string, () => Response> = {
  [`${BASE}/rest/v1/solicitudes?select=kind&limit=1`]: () => jsonResponse(200, []),
  [`${BASE}/rest/v1/partners?select=kind&limit=1`]: () => jsonResponse(200, []),
  [`${BASE}/rest/v1/leads?select=source&limit=1`]: () => jsonResponse(200, []),
  [`${BASE}/rest/v1/share_events?select=channel&limit=1`]: () => jsonResponse(200, []),
  [`${BASE}/rest/v1/properties?select=rol&limit=1`]: () => jsonResponse(200, []),
  [`${BASE}/rest/v1/properties?select=video_url&limit=1`]: () => jsonResponse(200, []),
  [`${BASE}/rest/v1/properties?select=video_poster&limit=1`]: () => jsonResponse(200, []),
  [`${BASE}/rest/v1/properties?select=common_expenses&limit=1`]: () => jsonResponse(200, []),
  [`${BASE}/rest/v1/properties?select=property_taxes&limit=1`]: () => jsonResponse(200, []),
  [`${BASE}/rest/v1/properties?select=deposit&limit=1`]: () => jsonResponse(200, []),
  [`${BASE}/rest/v1/properties?select=property_taxes_source&limit=1`]: () => jsonResponse(200, []),
  [`${BASE}/rest/v1/properties?select=property_taxes_checked_at&limit=1`]: () =>
    jsonResponse(200, []),
  [`${BASE}/rest/v1/kyb_applications?select=status&limit=1`]: () => jsonResponse(200, []),
  [`${BASE}/rest/v1/kyb_applications?select=token_hash&limit=1`]: () => jsonResponse(200, []),
  [`${BASE}/rest/v1/kyb_evaluations?select=score&limit=1`]: () => jsonResponse(200, []),
  [`${BASE}/rest/v1/kyb_decisions?select=decided_by&limit=1`]: () => jsonResponse(200, []),
  [`${BASE}/rest/v1/rpc/rix7_partner_id`]: () => jsonResponse(200, null),
  [`${BASE}/rest/v1/rpc/get_properties_filtered`]: () => jsonResponse(200, [{ id: 'p1' }]),
};

describe('normalizeBaseUrl', () => {
  it('quita la barra final para no armar //rest/v1', () => {
    expect(normalizeBaseUrl('https://proyecto.supabase.co/')).toBe('https://proyecto.supabase.co');
  });

  it('recorta espacios y barras repetidas', () => {
    expect(normalizeBaseUrl('  https://proyecto.supabase.co/// ')).toBe('https://proyecto.supabase.co');
  });
});

describe('schemaPlan', () => {
  it('a una columna la lee: una fila, una columna, sin traer datos', () => {
    const plan = schemaPlan(
      [{ id: 'properties.rol', kind: 'column', table: 'properties', column: 'rol', migration: '0015_rol_y_video', because: 'x' }],
      BASE
    );

    expect(plan).toEqual([
      {
        id: 'properties.rol',
        migration: '0015_rol_y_video',
        because: 'x',
        url: `${BASE}/rest/v1/properties?select=rol&limit=1`,
        method: 'GET',
        body: null,
      },
    ]);
  });

  it('a una función la invoca sin argumentos, con cuerpo JSON (PostgREST lo exige)', () => {
    const plan = schemaPlan(
      [{ id: 'rpc', kind: 'rpc', name: 'rix7_partner_id', migration: '0014_socio_publicaciones', because: 'x' }],
      BASE
    );

    expect(plan[0].method).toBe('POST');
    expect(plan[0].body).toBe('{}');
    expect(plan[0].url).toBe(`${BASE}/rest/v1/rpc/rix7_partner_id`);
  });

  it('el manifiesto cubre lo que el código desplegado da por existente', () => {
    const ids = schemaPlan(REQUIRED_SCHEMA, BASE).map((probe) => probe.id);
    expect(ids).toContain('properties.rol');
    expect(ids).toContain('partners.kind');
    expect(ids).toContain('solicitudes.kind');
    expect(ids).toContain('kyb_applications.status');
    expect(ids).toContain('kyb_decisions.decided_by');
    expect(ids).toContain('rix7_partner_id()');
    expect(ids).toContain('get_properties_filtered(bbox)');
    expect(new Set(REQUIRED_SCHEMA.map((item) => item.migration))).toEqual(
      new Set([
        '0005_properties_rpc',
        '0014_socio_publicaciones',
        '0015_rol_y_video',
        '0016_share_events_y_origen',
        '0018_solicitudes',
        '0022_gastos_contribuciones_garantia',
        '0023_fuente_contribuciones',
        '0024_socios_tipo',
        '0026_kyb_onboarding',
        '0027_kyb_rechazo_y_decisiones',
      ])
    );
  });
});

describe('judgeColumn', () => {
  it('200 es que existe, aunque no haya filas', () => {
    expect(judgeColumn(200, []).verdict).toBe('present');
  });

  it('42703 —el error real de producción— es que falta', () => {
    const verdict = judgeColumn(400, MISSING_COLUMN);
    expect(verdict.verdict).toBe('missing');
    expect(verdict.detail).toContain('does not exist');
  });

  it('PGRST204 también es que falta (PostgREST lo usa para columnas desconocidas)', () => {
    expect(judgeColumn(400, { code: 'PGRST204', message: "Could not find the 'rol' column" }).verdict).toBe('missing');
  });

  it('PGRST205 es que falta la tabla (una migración sin aplicar)', () => {
    expect(
      judgeColumn(404, {
        code: 'PGRST205',
        message: "Could not find the table 'public.solicitudes' in the schema cache",
      }).verdict
    ).toBe('missing');
  });

  it('un 400 que no identifica la columna es «no sé», no un aprobado', () => {
    expect(judgeColumn(400, { message: 'algo salió mal' }).verdict).toBe('unknown');
  });

  it('un 401 (clave inválida) es «no sé»: no se pudo mirar, no es que no exista', () => {
    expect(judgeColumn(401, { message: 'Invalid API key' }).verdict).toBe('unknown');
  });

  it('un HTML de proxy no rompe el juicio: es «no sé»', () => {
    expect(judgeColumn(502, null).verdict).toBe('unknown');
  });
});

describe('judgeRpc', () => {
  it('200 y 204 significan que la función existe', () => {
    expect(judgeRpc(200, null).verdict).toBe('present');
    expect(judgeRpc(204, null).verdict).toBe('present');
  });

  it('PGRST202 —el que devolvió producción— es que falta', () => {
    expect(judgeRpc(404, MISSING_FUNCTION).verdict).toBe('missing');
  });

  it('un 404 sin cuerpo reconocible igual es que falta', () => {
    expect(judgeRpc(404, null).verdict).toBe('missing');
  });

  it('401/403 cuentan como presente: está, pero el anónimo no puede ejecutarla', () => {
    expect(judgeRpc(403, { message: 'permission denied' }).verdict).toBe('present');
  });

  it('un 500 es «no sé»: puede ser la función rota por dentro', () => {
    expect(judgeRpc(500, { message: 'internal error' }).verdict).toBe('unknown');
  });

  it('PGRST203 —la sobrecarga del 2026-10-14— es que falta', () => {
    // La función está, pero no responde a la llamada del portal: para el
    // buscador es igual que faltar, así que el veredicto tiene que ser rojo y
    // no un «existe» que deja pasar un portal sin una sola propiedad.
    const verdict = judgeRpc(300, AMBIGUOUS_FUNCTION);
    expect(verdict.verdict).toBe('missing');
    expect(verdict.detail).toMatch(/sobrecarga|más de una firma/);
  });
});

describe('judgeObject', () => {
  it('elige el juicio por tipo de objeto', () => {
    expect(judgeObject('rpc', 404, MISSING_FUNCTION).verdict).toBe('missing');
    expect(judgeObject('column', 400, MISSING_COLUMN).verdict).toBe('missing');
  });
});

describe('judgeSchema', () => {
  const result = (id: string, migration: string, verdict: 'present' | 'missing' | 'unknown') => ({
    id,
    migration,
    because: `para qué sirve ${id}`,
    verdict,
    detail: 'detalle',
  });

  it('con todo presente está ok', () => {
    const judgement = judgeSchema([
      result('properties.rol', '0015_rol_y_video', 'present'),
      result('rix7_partner_id()', '0014_socio_publicaciones', 'present'),
    ]);

    expect(judgement.ok).toBe(true);
    expect(judgement.present).toEqual(['properties.rol', 'rix7_partner_id()']);
  });

  it('agrupa los faltantes por migración, sin repetir el archivo', () => {
    const judgement = judgeSchema([
      result('properties.rol', '0015_rol_y_video', 'missing'),
      result('properties.video_url', '0015_rol_y_video', 'missing'),
      result('rix7_partner_id()', '0014_socio_publicaciones', 'missing'),
    ]);

    expect(judgement.ok).toBe(false);
    expect(judgement.migrations).toEqual(['0015_rol_y_video', '0014_socio_publicaciones']);
    expect(judgement.missing.map((item) => item.id)).toEqual([
      'properties.rol',
      'properties.video_url',
      'rix7_partner_id()',
    ]);
  });

  it('un «no sé» también deja el veredicto en rojo', () => {
    const judgement = judgeSchema([result('properties.rol', '0015_rol_y_video', 'unknown')]);

    expect(judgement.ok).toBe(false);
    expect(judgement.missing).toEqual([]);
    expect(judgement.unknown).toHaveLength(1);
  });

  it('las migraciones salen en el orden del manifiesto, no en el que respondió la red', () => {
    const judgement = judgeSchema([
      result('rix7_partner_id()', '0014_socio_publicaciones', 'missing'),
      result('properties.rol', '0015_rol_y_video', 'missing'),
    ]);

    expect(judgement.migrations).toEqual(['0014_socio_publicaciones', '0015_rol_y_video']);
  });
});

describe('runSchemaCheck', () => {
  it('un proyecto al día sale ok, y manda la clave pública en cada petición', async () => {
    const { fetchImpl, calls } = server(HEALTHY_ROUTES);
    const result = await runSchemaCheck({ baseUrl: BASE, apiKey: 'anon-publica', fetchImpl });

    expect(result.judgement.ok).toBe(true);
    expect(result.error).toBeNull();
    expect(calls).toHaveLength(REQUIRED_SCHEMA.length);
    expect(calls.every((call) => call.apikey === 'anon-publica')).toBe(true);
    expect(calls.find((call) => call.url.includes('rix7_partner_id'))?.method).toBe('POST');
  });

  it('el caso de producción: las 0014 y 0015 sin aplicar', async () => {
    const { fetchImpl } = server({
      // 0016, 0018 y 0024 aplicadas: el caso que se estudia es el de las 0014 y 0015.
      [`${BASE}/rest/v1/solicitudes?select=kind&limit=1`]: () => jsonResponse(200, []),
      [`${BASE}/rest/v1/partners?select=kind&limit=1`]: () => jsonResponse(200, []),
      [`${BASE}/rest/v1/leads?select=source&limit=1`]: () => jsonResponse(200, []),
      [`${BASE}/rest/v1/share_events?select=channel&limit=1`]: () => jsonResponse(200, []),
      [`${BASE}/rest/v1/properties?select=rol&limit=1`]: () => jsonResponse(400, MISSING_COLUMN),
      [`${BASE}/rest/v1/properties?select=video_url&limit=1`]: () =>
        jsonResponse(400, { ...MISSING_COLUMN, message: 'column properties.video_url does not exist' }),
      [`${BASE}/rest/v1/properties?select=video_poster&limit=1`]: () =>
        jsonResponse(400, { ...MISSING_COLUMN, message: 'column properties.video_poster does not exist' }),
      // 0022 y 0023 sí están aplicadas en el escenario: los costos ya existen.
      [`${BASE}/rest/v1/properties?select=common_expenses&limit=1`]: () => jsonResponse(200, []),
      [`${BASE}/rest/v1/properties?select=property_taxes&limit=1`]: () => jsonResponse(200, []),
      [`${BASE}/rest/v1/properties?select=deposit&limit=1`]: () => jsonResponse(200, []),
      [`${BASE}/rest/v1/properties?select=property_taxes_source&limit=1`]: () =>
        jsonResponse(200, []),
      [`${BASE}/rest/v1/properties?select=property_taxes_checked_at&limit=1`]: () =>
        jsonResponse(200, []),
      // El alta de empresas (0026) sí está aplicada en este escenario.
      [`${BASE}/rest/v1/kyb_applications?select=status&limit=1`]: () => jsonResponse(200, []),
      [`${BASE}/rest/v1/kyb_applications?select=token_hash&limit=1`]: () => jsonResponse(200, []),
      [`${BASE}/rest/v1/kyb_evaluations?select=score&limit=1`]: () => jsonResponse(200, []),
      // La 0027 (decisiones del equipo) también está aplicada acá.
      [`${BASE}/rest/v1/kyb_decisions?select=decided_by&limit=1`]: () => jsonResponse(200, []),
      [`${BASE}/rest/v1/rpc/rix7_partner_id`]: () => jsonResponse(404, MISSING_FUNCTION),
      [`${BASE}/rest/v1/rpc/get_properties_filtered`]: () => jsonResponse(200, []),
    });

    const result = await runSchemaCheck({ baseUrl: BASE, apiKey: 'anon-publica', fetchImpl });

    expect(result.judgement.ok).toBe(false);
    expect(result.judgement.migrations).toEqual(['0015_rol_y_video', '0014_socio_publicaciones']);
    expect(result.judgement.unknown).toEqual([]);
  });

  it('el buscador con dos firmas: rojo, y el informe nombra la migración que lo arregla', async () => {
    const { fetchImpl } = server({
      ...HEALTHY_ROUTES,
      [`${BASE}/rest/v1/rpc/get_properties_filtered`]: () => jsonResponse(300, AMBIGUOUS_FUNCTION),
    });

    const result = await runSchemaCheck({ baseUrl: BASE, apiKey: 'anon-publica', fetchImpl });

    expect(result.judgement.ok).toBe(false);
    expect(result.judgement.missing.map((item) => item.id)).toEqual(['get_properties_filtered(bbox)']);
    expect(result.judgement.migrations).toEqual(['0005_properties_rpc']);
    expect(formatReport(result)).toContain('0005_properties_rpc');
  });

  it('una caída de red es «no sé», no un proyecto incompleto', async () => {
    const fetchImpl = (async () => {
      throw new Error('fetch failed');
    }) as unknown as typeof fetch;

    const result = await runSchemaCheck({ baseUrl: BASE, apiKey: 'anon-publica', fetchImpl });

    expect(result.judgement.ok).toBe(false);
    expect(result.judgement.missing).toEqual([]);
    expect(result.judgement.unknown).toHaveLength(REQUIRED_SCHEMA.length);
    expect(result.error).toContain('no se pudo decidir');
  });

  it('un cuerpo que no es JSON no rompe la corrida', async () => {
    const { fetchImpl } = server({
      [`${BASE}/rest/v1/properties?select=rol&limit=1`]: () => textResponse(502, '<html>Bad gateway</html>'),
      [`${BASE}/rest/v1/properties?select=video_url&limit=1`]: () => textResponse(502, '<html>Bad gateway</html>'),
      [`${BASE}/rest/v1/properties?select=video_poster&limit=1`]: () => textResponse(502, '<html>Bad gateway</html>'),
      [`${BASE}/rest/v1/rpc/rix7_partner_id`]: () => textResponse(502, '<html>Bad gateway</html>'),
    });

    const result = await runSchemaCheck({ baseUrl: BASE, apiKey: 'anon-publica', fetchImpl });

    expect(result.judgement.ok).toBe(false);
    expect(result.judgement.unknown).toHaveLength(REQUIRED_SCHEMA.length);
  });
});

describe('formatReport', () => {
  it('nombra la migración a aplicar en vez de repetir el nombre de la columna', () => {
    const text = formatReport({
      baseUrl: BASE,
      results: [
        {
          id: 'properties.rol',
          migration: '0015_rol_y_video',
          because: 'el panel guarda el Rol del SII',
          verdict: 'missing',
          detail: 'column properties.rol does not exist',
        },
      ],
      judgement: judgeSchema([
        {
          id: 'properties.rol',
          migration: '0015_rol_y_video',
          because: 'el panel guarda el Rol del SII',
          verdict: 'missing',
          detail: 'x',
        },
      ]),
    });

    expect(text).toContain('0015_rol_y_video');
    expect(text).toContain('npm run db:push');
    expect(text).toContain('para qué');
    expect(text).not.toContain('✓ La base soporta');
  });

  it('no inventa un aprobado cuando algo quedó en «no sé»', () => {
    const text = formatReport({
      baseUrl: BASE,
      results: [
        { id: 'properties.rol', migration: '0015_rol_y_video', because: 'x', verdict: 'unknown', detail: 'HTTP 502' },
      ],
      judgement: judgeSchema([
        { id: 'properties.rol', migration: '0015_rol_y_video', because: 'x', verdict: 'unknown', detail: 'HTTP 502' },
      ]),
    });

    expect(text).toContain('No se pudo decidir');
    expect(text).not.toContain('La base soporta el código');
  });

  it('con todo presente lo dice', () => {
    const text = formatReport({
      baseUrl: BASE,
      results: REQUIRED_SCHEMA.map((item) => ({
        id: item.id,
        migration: item.migration,
        because: item.because,
        verdict: 'present',
        detail: 'existe',
      })),
      judgement: judgeSchema(
        REQUIRED_SCHEMA.map((item) => ({
          id: item.id,
          migration: item.migration,
          because: item.because,
          verdict: 'present',
          detail: 'existe',
        }))
      ),
    });

    expect(text).toContain('✓ La base soporta el código');
  });
});

describe('readCredentials', () => {
  it('prefiere lo que ya está exportado en el entorno', () => {
    const credentials = readCredentials({
      env: { NEXT_PUBLIC_SUPABASE_URL: 'https://env.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'de-env' },
      envFile: '/no/existe',
      exists: () => false,
    });

    expect(credentials).toEqual({ url: 'https://env.supabase.co', key: 'de-env' });
  });

  it('cae a .env.local cuando el entorno está vacío', () => {
    const credentials = readCredentials({
      env: {},
      envFile: '.env.local',
      exists: () => true,
      read: () => 'NEXT_PUBLIC_SUPABASE_URL=https://archivo.supabase.co\nNEXT_PUBLIC_SUPABASE_ANON_KEY=de-archivo\n',
    });

    expect(credentials).toEqual({ url: 'https://archivo.supabase.co', key: 'de-archivo' });
  });

  it('sin nada configurado devuelve null en vez de inventar una URL', () => {
    expect(readCredentials({ env: {}, envFile: '/no/existe', exists: () => false })).toEqual({
      url: null,
      key: null,
    });
  });
});
