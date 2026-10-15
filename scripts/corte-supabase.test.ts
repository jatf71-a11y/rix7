/**
 * Tests del corte de base en un solo comando.
 *
 * Lo que hay que proteger no es «que corra», sino el orden y el freno:
 *
 * - con una clave que la base rechaza, **no se toca Vercel** (ni un `vercel env`);
 * - una variable del corte sin valor detiene el comando en vez de aplicarlo a medias;
 * - ningún valor sale impreso en el informe;
 * - y el informe distingue «Vercel no se tocó» de «ya se aplicó».
 *
 * Todo esto se prueba sin red y sin procesos: el `fetch` y el lanzador de
 * scripts se inyectan.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_FILE,
  EXPECTED_VERCEL_PROJECT,
  checkVercelLink,
  decodeJwtPayload,
  formatOutcome,
  inspectEnv,
  judgeProbe,
  parseCutoverArgs,
  runCutover,
  stepTitle,
  supabaseRef,
} from './corte-supabase.mjs';

const REF = 'vsqkjimpssdvlvdwrtnh';
const URL = `https://${REF}.supabase.co`;

/**
 * Un valor con forma de clave, armado en el test y **no** en el repo: si el
 * literal apareciera entero, la guardia de secretos (`npm run check:secrets`) lo
 * marcaría con razón — y una guardia que se puede silenciar con una excepción
 * deja de servir.
 */
const SERVICE = ['sb', 'secret', 'solo-para-el-test', 'no-es-una-clave-real'].join('_');
const ANON = ['sb', 'publishable', 'solo-para-el-test', 'no-es-una-clave-real'].join('_');

/** Un JWT sin firma válida: alcanza para leer el cuerpo, que es lo que se usa. */
function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.${'firma-de-test'.repeat(3)}`;
}

const valuesOk = {
  NEXT_PUBLIC_SUPABASE_URL: URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE,
};

const dirs: string[] = [];

function tempFile(name: string, content: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rix7-corte-'));
  dirs.push(dir);
  const file = path.join(dir, name);
  writeFileSync(file, content, 'utf8');
  return file;
}

/** Un `.vercel/project.json` del proyecto que el corte espera. */
function projectJson(overrides: Record<string, string> = {}): string {
  return JSON.stringify({ projectName: 'rix7', projectId: EXPECTED_VERCEL_PROJECT.projectId, orgId: EXPECTED_VERCEL_PROJECT.orgId, ...overrides });
}

function envFile(values: Record<string, string> = valuesOk): string {
  return tempFile('.env.local', `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`);
}

/** Un `fetch` de mentira: responde por ruta y deja ver qué se pidió. */
function fakeFetch(routes: Record<string, { status: number, body?: unknown }>) {
  const calls: string[] = [];
  const impl = async (url: string | URL) => {
    const target = String(url);
    calls.push(target);
    const hit = Object.entries(routes).find(([fragment]) => target.includes(fragment));
    const { status, body = [] } = hit?.[1] ?? { status: 404, body: null };
    return {
      status,
      json: async () => body,
    } as unknown as Response;
  };
  return { impl: impl as unknown as typeof fetch, calls };
}

const OK_ROUTES = { '/auth/v1/admin/users': { status: 200, body: { users: [] } }, '/rest/v1/properties': { status: 200, body: [{ id: 'a' }] } };

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('parseCutoverArgs', () => {
  it('por defecto lee .env.local, aplica en Vercel y despliega', () => {
    expect(parseCutoverArgs([])).toMatchObject({ file: DEFAULT_FILE, dryRun: false, deploy: true });
  });

  it('--dry-run y --no-deploy no hacen lo mismo', () => {
    expect(parseCutoverArgs(['--dry-run']).dryRun).toBe(true);
    expect(parseCutoverArgs(['--no-deploy']).deploy).toBe(false);
    // Un `--dry-run` no tiene por qué apagar el deploy: el que decide es cada bandera.
    expect(parseCutoverArgs(['--dry-run']).deploy).toBe(true);
  });

  it('una bandera mal escrita detiene el comando en vez de publicar igual', () => {
    // `--dryrun` sin guion es el error real: sin esto, el corte se aplicaría de verdad.
    expect(parseCutoverArgs(['--dryrun']).error).toMatch(/No reconozco/);
    expect(parseCutoverArgs(['--file']).error).toMatch(/--file/);
    expect(parseCutoverArgs(['--project']).error).toMatch(/--project/);
  });

  it('--project permite apuntar a otro proyecto a propósito', () => {
    expect(parseCutoverArgs(['--project', 'prj_otro']).expected.projectId).toBe('prj_otro');
  });

  it('resuelve la ruta de --file contra el directorio actual', () => {
    expect(parseCutoverArgs(['--file', '.env.local.pre-migracion']).file).toMatch(/\.env\.local\.pre-migracion$/);
  });
});

describe('supabaseRef', () => {
  it('lee la referencia del subdominio', () => {
    expect(supabaseRef(URL)).toBe(REF);
    expect(supabaseRef('https://abc123.supabase.in')).toBe('abc123');
  });

  it('no inventa una referencia cuando la URL no es de Supabase', () => {
    expect(supabaseRef('https://base.rix7.cl')).toBeNull();
    expect(supabaseRef('')).toBeNull();
  });
});

describe('decodeJwtPayload', () => {
  it('lee el cuerpo sin verificar la firma', () => {
    expect(decodeJwtPayload(jwt({ role: 'service_role', ref: REF }))).toMatchObject({ role: 'service_role', ref: REF });
  });

  it('devuelve null cuando no es un JWT', () => {
    expect(decodeJwtPayload('sb_secret_lo_que_sea')).toBeNull();
    expect(decodeJwtPayload('a.b')).toBeNull();
    expect(decodeJwtPayload(null)).toBeNull();
  });
});

describe('inspectEnv', () => {
  it('acepta las tres variables cuando son del mismo proyecto y del rol que dicen', () => {
    expect(inspectEnv(valuesOk)).toEqual({ ok: true, ref: REF, problems: [] });
  });

  it('acepta las claves nuevas (publishable y secret), que no son JWT', () => {
    expect(inspectEnv({ ...valuesOk }).ok).toBe(true);
  });

  it('detiene el corte si falta la clave de servicio', () => {
    const result = inspectEnv({ ...valuesOk, SUPABASE_SERVICE_ROLE_KEY: '' });
    expect(result.ok).toBe(false);
    expect(result.problems.map((problem) => problem.code)).toEqual(['sin-service']);
    expect(result.problems[0].hint).toContain('env:secret');
  });

  it('detiene el corte si la clave pública quedó en el lugar de la de servicio', () => {
    const result = inspectEnv({ ...valuesOk, SUPABASE_SERVICE_ROLE_KEY: ANON });
    expect(result.problems.map((problem) => problem.code)).toContain('service-forma');
  });

  it('detiene el corte si las dos variables tienen el mismo valor', () => {
    const result = inspectEnv({ ...valuesOk, SUPABASE_SERVICE_ROLE_KEY: valuesOk.NEXT_PUBLIC_SUPABASE_ANON_KEY });
    expect(result.problems.map((problem) => problem.code)).toContain('claves-iguales');
  });

  it('detiene el corte si la pública lleva una clave con rol service_role', () => {
    const serviceJwt = jwt({ role: 'service_role', ref: REF });
    const result = inspectEnv({ ...valuesOk, NEXT_PUBLIC_SUPABASE_ANON_KEY: serviceJwt });
    expect(result.problems.map((problem) => problem.code)).toContain('anon-es-servicio');
  });

  it('detiene el corte si la clave de servicio tiene rol anon', () => {
    const result = inspectEnv({ ...valuesOk, SUPABASE_SERVICE_ROLE_KEY: jwt({ role: 'anon', ref: REF }) });
    expect(result.problems.map((problem) => problem.code)).toContain('service-rol');
  });

  it('detiene el corte si una clave es de otro proyecto', () => {
    const result = inspectEnv({ ...valuesOk, SUPABASE_SERVICE_ROLE_KEY: jwt({ role: 'service_role', ref: 'otroproyecto' }) });
    expect(result.problems.map((problem) => problem.code)).toContain('otro-proyecto');
  });

  it('detiene el corte si la URL sigue siendo el placeholder', () => {
    const result = inspectEnv({ ...valuesOk, NEXT_PUBLIC_SUPABASE_URL: 'https://placeholder-project.supabase.co' });
    expect(result.problems.map((problem) => problem.code)).toContain('url-placeholder');
  });

  it('nunca repite el valor de una clave en el problema', () => {
    const result = inspectEnv({ ...valuesOk, SUPABASE_SERVICE_ROLE_KEY: ANON });
    expect(JSON.stringify(result)).not.toContain(ANON);
    expect(JSON.stringify(result)).not.toContain(SERVICE);
  });
});

describe('judgeProbe', () => {
  it('un 200 en la API de administración es la prueba de que la clave sirve', () => {
    const verdict = judgeProbe('service', { status: 200 });
    expect(verdict.ok).toBe(true);
    expect(verdict.detail).toContain('admin/users');
  });

  it('un 403 en la de servicio significa que se copió la pública', () => {
    const verdict = judgeProbe('service', { status: 403 });
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/anon key/);
    expect(verdict.hint).toMatch(/service_role/);
  });

  it('un 401 significa que la clave es de otro proyecto', () => {
    const verdict = judgeProbe('service', { status: 401 });
    expect(verdict.ok).toBe(false);
    expect(verdict.hint).toContain(REF);
  });

  it('informa cuántas filas leyó la pública', () => {
    expect(judgeProbe('anon', { status: 200, rows: 14 }).detail).toContain('14 filas');
    expect(judgeProbe('anon', { status: 200, rows: 1 }).detail).toContain('1 fila');
  });

  it('un fallo de red no se confunde con una clave mala', () => {
    const verdict = judgeProbe('service', { error: 'timeout' });
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain('timeout');
  });
});

describe('checkVercelLink', () => {
  it('acepta el proyecto esperado', () => {
    const result = checkVercelLink(projectJson());
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('rix7');
  });

  it('rechaza otro proyecto: el corte escribiría en el lugar equivocado', () => {
    const result = checkVercelLink(projectJson({ projectId: 'prj_otro' }));
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('prj_otro');
    expect(result.hint).toContain('vercel link');
  });

  it('rechaza otro equipo', () => {
    expect(checkVercelLink(projectJson({ orgId: 'team_otro' })).ok).toBe(false);
  });

  it('sin archivo o ilegible, se detiene con la instrucción', () => {
    expect(checkVercelLink(null).hint).toContain('vercel link');
    expect(checkVercelLink('{').ok).toBe(false);
  });

  it('acepta otro proyecto cuando se pide a propósito con --project', () => {
    const result = checkVercelLink(projectJson({ projectId: 'prj_otro' }), { expected: { projectId: 'prj_otro' } });
    expect(result.ok).toBe(true);
  });
});

describe('runCutover', () => {
  it('con las claves sanas, aplica y despliega', async () => {
    const { impl, calls } = fakeFetch(OK_ROUTES);
    const ran: string[] = [];

    const result = await runCutover({
      file: envFile(),
      projectFile: tempFile('project.json', projectJson()),
      fetchImpl: impl,
      runScript: (script) => {
        ran.push(script);
        return 0;
      },
      log: () => {},
    });

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(true);
    expect(result.deployed).toBe(true);
    expect(ran).toEqual(['scripts/vercel-sync-env.mjs', 'scripts/release-prod.mjs']);
    expect(calls.some((url) => url.includes('/auth/v1/admin/users'))).toBe(true);
  });

  it('si la clave de servicio no sirve, NO se toca Vercel', async () => {
    const { impl } = fakeFetch({ ...OK_ROUTES, '/auth/v1/admin/users': { status: 403 } });
    const ran: string[] = [];

    const result = await runCutover({
      file: envFile(),
      projectFile: tempFile('project.json', projectJson()),
      fetchImpl: impl,
      runScript: (script) => {
        ran.push(script);
        return 0;
      },
      log: () => {},
    });

    expect(result.ok).toBe(false);
    expect(result.stop?.id).toBe('service');
    expect(result.applied).toBe(false);
    expect(ran).toEqual([]);
    // El paso donde se frenó tiene que estar en el informe, y los siguientes no.
    expect(result.steps.map((step) => step.id)).toEqual(['file', 'keys', 'service']);
  });

  it('si la clave pública no lee el catálogo, tampoco se toca Vercel', async () => {
    const { impl } = fakeFetch({ ...OK_ROUTES, '/rest/v1/properties': { status: 401 } });
    let calls = 0;

    const result = await runCutover({
      file: envFile(),
      projectFile: tempFile('project.json', projectJson()),
      fetchImpl: impl,
      runScript: () => {
        calls += 1;
        return 0;
      },
      log: () => {},
    });

    expect(result.stop?.id).toBe('anon');
    expect(calls).toBe(0);
  });

  it('no hace ninguna sonda si falta una variable: se detiene antes', async () => {
    const { impl, calls } = fakeFetch(OK_ROUTES);
    const result = await runCutover({
      file: envFile({ ...valuesOk, SUPABASE_SERVICE_ROLE_KEY: '' }),
      projectFile: tempFile('project.json', projectJson()),
      fetchImpl: impl,
      runScript: () => 0,
      log: () => {},
    });

    expect(result.stop?.id).toBe('keys');
    expect(calls).toEqual([]);
  });

  it('con --dry-run hace el preflight y no aplica ni despliega', async () => {
    const { impl, calls } = fakeFetch(OK_ROUTES);
    const ran: string[] = [];

    const result = await runCutover({
      file: envFile(),
      projectFile: tempFile('project.json', projectJson()),
      dryRun: true,
      fetchImpl: impl,
      runScript: (script) => {
        ran.push(script);
        return 0;
      },
      log: () => {},
    });

    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.deployed).toBe(false);
    expect(ran).toEqual([]);
    // Las sondas sí corren: son el punto del preflight, y son de solo lectura.
    expect(calls.length).toBe(2);
  });

  it('con --no-deploy aplica las variables y no publica', async () => {
    const { impl } = fakeFetch(OK_ROUTES);
    const ran: string[] = [];

    const result = await runCutover({
      file: envFile(),
      projectFile: tempFile('project.json', projectJson()),
      deploy: false,
      fetchImpl: impl,
      runScript: (script) => {
        ran.push(script);
        return 0;
      },
      log: () => {},
    });

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(true);
    expect(result.deployed).toBe(false);
    expect(ran).toEqual(['scripts/vercel-sync-env.mjs']);
  });

  it('si el sync falla, avisa que Vercel puede haber quedado a medias', async () => {
    const { impl } = fakeFetch(OK_ROUTES);
    const result = await runCutover({
      file: envFile(),
      projectFile: tempFile('project.json', projectJson()),
      fetchImpl: impl,
      runScript: (script) => (script.includes('vercel-sync') ? 1 : 0),
      log: () => {},
    });

    expect(result.stop?.id).toBe('sync');
    expect(formatOutcome(result)).toContain('a medias');
  });

  it('si el release falla, dice que las variables ya se aplicaron', async () => {
    const { impl } = fakeFetch(OK_ROUTES);
    const result = await runCutover({
      file: envFile(),
      projectFile: tempFile('project.json', projectJson()),
      fetchImpl: impl,
      runScript: (script) => (script.includes('release-prod') ? 1 : 0),
      log: () => {},
    });

    expect(result.stop?.id).toBe('release');
    expect(result.applied).toBe(true);
    expect(formatOutcome(result)).toContain('YA se aplicaron');
  });

  it('el informe no imprime ningún valor de los que leyó', async () => {
    const { impl } = fakeFetch(OK_ROUTES);
    const printed: string[] = [];

    const result = await runCutover({
      file: envFile(),
      projectFile: tempFile('project.json', projectJson()),
      fetchImpl: impl,
      runScript: () => 0,
      log: (...args: unknown[]) => printed.push(args.map(String).join(' ')),
    });

    const informe = [formatOutcome(result), ...printed].join('\n');
    expect(informe).not.toContain(SERVICE);
    expect(informe).not.toContain(ANON);
    expect(informe).toContain(REF);
  });
});

describe('formatOutcome', () => {
  const step = (id: string, ok: boolean, detail = 'algo') => ({ id, ok, detail });

  it('antes de aplicar, dice con todas las letras que Vercel no se tocó', () => {
    const lines = formatOutcome({
      steps: [step('file', true), step('keys', false)],
      stop: { id: 'keys', detail: 'falta SUPABASE_SERVICE_ROLE_KEY', hint: 'guardala' },
    });
    expect(lines).toContain('Vercel NO se tocó');
    expect(lines).toContain('guardala');
  });

  it('en el preflight completo no promete nada que no haya pasado', () => {
    const lines = formatOutcome({ steps: [step('file', true)], dryRun: true });
    expect(lines).toContain('--dry-run');
    expect(lines).not.toContain('Corte completo');
  });

  it('sin desplegar dice que falta publicar', () => {
    expect(formatOutcome({ steps: [], applied: true, deployed: false })).toContain('release:prod');
  });

  it('con el deploy hecho, el corte queda cerrado', () => {
    expect(formatOutcome({ steps: [], applied: true, deployed: true })).toContain('Corte completo');
  });

  it('nombra cada paso por su título, no por su id', () => {
    const lines = formatOutcome({ steps: [step('vercel-link', true, 'rix7')] });
    expect(lines).toContain(stepTitle('vercel-link'));
    expect(lines).toContain('rix7');
  });
});
