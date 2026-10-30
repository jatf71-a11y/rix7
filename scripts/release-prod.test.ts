/**
 * Tests del comando de release (`npm run release:prod`).
 *
 * Lo que se protege acá es **el orden y la decisión**, que es lo que hace que un
 * solo comando sea mejor que cuatro a mano:
 *
 * 1. **El orden** (build → migraciones → deploy → verificación). Las migraciones
 *    antes del deploy porque publicar código que la base no soporta es el error
 *    que ya pasó una vez (el panel de corredoras en vivo contra columnas que no
 *    existían). Si alguien reordena esto, el test se cae.
 * 2. **La bandera mal escrita falla en vez de ignorarse.** Un `--no-dbpush` que
 *    se tragara en silencio aplicaría migraciones cuando quien lo pidió creía
 *    que no, o al revés. Por eso el plan devuelve `error` y el script sale 2
 *    **antes** de tocar nada.
 * 3. **La URL que se verifica de verdad.** Un release puede salir verde
 *    verificando el deployment anterior: `--url` manda, y en producción el
 *    release verifica siempre `https://rix7.cl`, el dominio público, no la URL
 *    del deployment (`*.vercel.app`).
 * 4. **El reintento de la verificación**, porque un alias recién promovido puede
 *    tardar unos segundos en propagarse y un rojo por eso no es información.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_ATTEMPTS,
  DEFAULT_SITE_URL,
  RELEASE_STEPS,
  formatDuration,
  formatPlan,
  formatReleaseSummary,
  checkDbCredentials,
  isTransientDeployFailure,
  missingTargets,
  normalizeBaseUrl,
  parseDeployUrls,
  parseReleaseArgs,
  planRelease,
  readDbValues,
  resolveCommands,
  resolveVerifyUrl,
  runStep,
  runCaptured,
  verifyLive,
} from './release-prod.mjs';

const ROOT = path.resolve(__dirname, '..');

const ids = (steps: { id: string }[]) => steps.map((step) => step.id);

describe('parseReleaseArgs', () => {
  it('sin argumentos: los cuatro pasos, sin --url ni reintentos configurados', () => {
    expect(parseReleaseArgs([])).toEqual({
      dryRun: false,
      help: false,
      withTests: false,
      url: null,
      attempts: null,
      skip: new Set(),
      unknown: [],
    });
  });

  it('acepta --url y --attempts en sus dos formas', () => {
    expect(parseReleaseArgs(['--url', 'https://ejemplo.cl']).url).toBe('https://ejemplo.cl');
    expect(parseReleaseArgs(['--url=https://ejemplo.cl']).url).toBe('https://ejemplo.cl');
    expect(parseReleaseArgs(['--attempts', '5']).attempts).toBe('5');
    expect(parseReleaseArgs(['--attempts=5']).attempts).toBe('5');
  });

  it('consume el valor de --url y --attempts en vez de leerlo como argumento suelto', () => {
    expect(parseReleaseArgs(['--url', 'https://ejemplo.cl']).unknown).toEqual([]);
    expect(parseReleaseArgs(['--attempts', '2', '--no-db']).unknown).toEqual([]);
    expect(parseReleaseArgs(['--attempts', '2', '--no-db']).skip).toEqual(new Set(['--no-db']));
  });

  it('junta los --no-… y separa lo desconocido', () => {
    const args = parseReleaseArgs(['--no-db', '--no-verify', '--db', '-x']);
    expect(Array.from(args.skip).sort()).toEqual(['--no-db', '--no-verify']);
    expect(args.unknown).toEqual(['--db', '-x']);
  });
});

describe('planRelease', () => {
  it('por defecto corre los cinco pasos, en este orden', () => {
    const plan = planRelease({ argv: [] });
    expect(plan.error).toBeNull();
    expect(ids(plan.steps)).toEqual(['build', 'db', 'schema', 'deploy', 'verify']);
    expect(plan.skipped).toEqual([]);
    expect(plan.attempts).toBe(DEFAULT_ATTEMPTS);
  });

  it('sin --with-tests, tipos y tests quedan disponibles pero fuera del plan', () => {
    const plan = planRelease({ argv: [] });
    expect(ids(plan.available)).toEqual(['tests']);
    expect(ids(plan.steps)).not.toContain('tests');
  });

  it('--with-tests los corre primero: la señal más barata falla antes que el build', () => {
    const plan = planRelease({ argv: ['--with-tests'] });
    expect(ids(plan.steps)).toEqual(['tests', 'build', 'db', 'schema', 'deploy', 'verify']);
    expect(plan.available).toEqual([]);
  });

  it('--with-tests convive con los --no-… de los otros pasos', () => {
    const plan = planRelease({ argv: ['--with-tests', '--no-db'] });
    expect(ids(plan.steps)).toEqual(['tests', 'build', 'schema', 'deploy', 'verify']);
    expect(plan.skipped.map((step: { flag?: string }) => step.flag)).toEqual(['--no-db']);
  });

  it('--no-tests no existe: el paso se agrega con --with-tests, no se saltea', () => {
    const plan = planRelease({ argv: ['--no-tests'] });
    expect(plan.error).toContain('--no-tests');
    expect(plan.steps).toEqual([]);
  });

  it('las migraciones van antes del deploy: la base primero soporta, el código después usa', () => {
    const order = ids(planRelease({ argv: [] }).steps);
    expect(order.indexOf('db')).toBeLessThan(order.indexOf('deploy'));
  });

  it('el esquema se comprueba después de aplicar y antes de publicar', () => {
    const order = ids(planRelease({ argv: [] }).steps);

    // Aplicar sin comprobar deja el hueco por el que se publicó código contra
    // columnas inexistentes: el paso tiene que poder ver el resultado de la
    // migración, y el deploy tiene que ver el veredicto.
    expect(order.indexOf('db')).toBeLessThan(order.indexOf('schema'));
    expect(order.indexOf('schema')).toBeLessThan(order.indexOf('deploy'));
  });

  it('--no-db no saltea la comprobación del esquema: es la red, no el paracaídas', () => {
    const plan = planRelease({ argv: ['--no-db'] });
    expect(ids(plan.steps)).toContain('schema');
  });

  it('--no-… saltea el paso y lo deja dicho en el informe', () => {
    const plan = planRelease({ argv: ['--no-db', '--no-verify'] });
    expect(ids(plan.steps)).toEqual(['build', 'schema', 'deploy']);
    expect(plan.skipped.map((step: { flag?: string }) => step.flag)).toEqual(['--no-db', '--no-verify']);
  });

  it('un --no-… que no es de ningún paso es un error, no un salteo silencioso', () => {
    const plan = planRelease({ argv: ['--no-dbpush'] });
    expect(plan.error).toContain('--no-dbpush');
    expect(plan.steps).toEqual([]);
  });

  it('un argumento desconocido también corta antes de ejecutar nada', () => {
    const plan = planRelease({ argv: ['--prod'] });
    expect(plan.error).toContain('--prod');
  });

  it('--attempts exige un entero ≥ 1', () => {
    expect(planRelease({ argv: ['--attempts', '0'] }).error).toContain('--attempts');
    expect(planRelease({ argv: ['--attempts', 'dos'] }).error).toContain('--attempts');
    expect(planRelease({ argv: ['--attempts', '2'] }).attempts).toBe(2);
  });

  it('sin ningún paso no hay release que correr', () => {
    // El paso opt-in no tiene `--no-…`: se agrega con su flag, así que el único
    // modo de sacarlo del plan es no pedirlo.
    const flags = RELEASE_STEPS.map((step) => step.flag).filter((flag): flag is string => Boolean(flag));
    const plan = planRelease({ argv: flags });
    expect(plan.error).toContain('salteados');
  });

  it('--url vacío o en blanco se trata como no pedido', () => {
    expect(planRelease({ argv: ['--url='] }).url).toBeNull();
    expect(planRelease({ argv: ['--url', '   '] }).url).toBeNull();
  });

  it('--help no arma plan: solo muestra el uso', () => {
    const plan = planRelease({ argv: ['--help'] });
    expect(plan.help).toBe(true);
    expect(plan.steps).toEqual([]);
    expect(plan.error).toBeNull();
  });
});

describe('los destinos del plan existen', () => {
  it('cada paso apunta a un script real o a un binario que resuelve', () => {
    expect(missingTargets(RELEASE_STEPS, { root: ROOT, exists: existsSync })).toEqual([]);
  });

  it('un script renombrado se detecta antes de empezar', () => {
    expect(missingTargets(RELEASE_STEPS, { root: ROOT, exists: () => false })).toEqual([
      'scripts/build.mjs',
      'scripts/db-push.mjs',
      'scripts/check-schema.mjs',
      'scripts/deploy-prod.mjs',
    ]);
  });

  it('un binario de node_modules que no resuelve también se detecta', () => {
    // Es el caso «falta npm install» o un paquete que cambió de nombre: el paso
    // de tests es el único que no corre un script del repo.
    const missing = missingTargets(RELEASE_STEPS, {
      root: ROOT,
      exists: existsSync,
      resolveBin: () => null,
    });
    expect(missing).toEqual(['typescript/bin/tsc', 'vitest/vitest.mjs']);
  });

  it('resolveCommands apunta al binario resuelto y lo ejecuta con node', () => {
    const resolved = resolveCommands(
      [{ bin: 'typescript/bin/tsc', args: ['--noEmit'] }],
      () => '/tmp/tsc.js'
    );

    expect(resolved).toEqual([
      { executable: process.execPath, args: ['/tmp/tsc.js', '--noEmit'], bin: 'typescript/bin/tsc' },
    ]);
  });
});

describe('parseDeployUrls', () => {
  it('lee la salida real de `vercel --prod`', () => {
    const output = [
      '→ Preparando copia sin metadata de git…',
      'Vercel CLI 41.4.0',
      'Production   https://rix7-18uue86fb-ctd5.vercel.app',
      'Aliased      https://rix7.cl',
      '✓ Ready in 2m',
    ].join('\n');

    expect(parseDeployUrls(output)).toEqual({
      deployment: 'https://rix7-18uue86fb-ctd5.vercel.app',
      alias: 'https://rix7.cl',
    });
  });

  it('limpia los colores ANSI y el CRLF de Windows', () => {
    const output = '\u001b[32mProduction\u001b[0m  https://rix7-abc.vercel.app\r\n\u001b[1mAliased\u001b[0m  https://rix7.cl\r\n';
    expect(parseDeployUrls(output)).toEqual({
      deployment: 'https://rix7-abc.vercel.app',
      alias: 'https://rix7.cl',
    });
  });

  it('acepta la forma con dos puntos, sin inventar lo que no está', () => {
    expect(parseDeployUrls('Production: https://rix7-abc.vercel.app')).toEqual({
      deployment: 'https://rix7-abc.vercel.app',
      alias: null,
    });
    expect(parseDeployUrls('nada que leer')).toEqual({ deployment: null, alias: null });
    expect(parseDeployUrls(null)).toEqual({ deployment: null, alias: null });
  });
});

describe('runCaptured', () => {
  /** Un sumidero de escritura: el test no ensucia la salida de la suite. */
  const sink = () => ({ write: () => true });

  it('captura la salida y la muestra en vivo al mismo tiempo', async () => {
    const seen: string[] = [];
    const script = [
      "console.log('Production   https://rix7-abc.vercel.app')",
      "console.log('Aliased      https://rix7.cl')",
      "console.error('ruido de stderr')",
    ].join(';');

    const result = await runCaptured({
      executable: process.execPath,
      args: ['-e', script],
      stdout: { write: (chunk: string) => seen.push(chunk) },
      stderr: sink(),
    });

    expect(result.error).toBeNull();
    expect(result.code).toBe(0);
    // Lo que se muestra en vivo es exactamente lo que se parsea después: la
    // verificación no depende de una segunda corrida del deploy.
    expect(seen.join('')).toContain('Aliased      https://rix7.cl');
    expect(parseDeployUrls(result.output)).toEqual({
      deployment: 'https://rix7-abc.vercel.app',
      alias: 'https://rix7.cl',
    });
  });

  it('propaga el código de salida del hijo en vez de tragárselo', async () => {
    const result = await runCaptured({
      executable: process.execPath,
      args: ['-e', 'process.exit(3)'],
      stdout: sink(),
      stderr: sink(),
    });

    expect(result.code).toBe(3);
  });

  it('un ejecutable que no existe se reporta como error, no como exit 0', async () => {
    const result = await runCaptured({
      executable: path.join(ROOT, 'no-existe-este-binario'),
      args: [],
      stdout: sink(),
      stderr: sink(),
    });

    expect(result.code).toBe(1);
    expect(result.error).toBeInstanceOf(Error);
  });
});

describe('runStep', () => {
  const sink = () => ({ write: () => true });

  /** Un paso con dos comandos y un resolvedor que apunta a archivos temporales. */
  const twoCommandStep = {
    id: 'x',
    title: 'X',
    why: '',
    hint: '',
    commands: [
      { bin: 'primero', args: [] },
      { bin: 'segundo', args: [] },
    ],
  };

  it('corre los comandos en orden y no sigue si el primero falla', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rix7-release-'));
    try {
      const falla = path.join(dir, 'falla.mjs');
      const marca = path.join(dir, 'marca.mjs');
      writeFileSync(falla, "console.error('primer comando roto'); process.exit(3);");
      writeFileSync(marca, "console.log('SEGUNDO CORRIO');");

      const result = await runStep(twoCommandStep, {
        resolveBin: (spec: string) => (spec === 'primero' ? falla : marca),
        stdout: sink(),
        stderr: sink(),
      });

      expect(result.code).toBe(3);
      expect(result.output).toContain('primer comando roto');
      expect(result.output).not.toContain('SEGUNDO CORRIO');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('con los dos comandos sanos, el paso sale 0 y junta la salida de ambos', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rix7-release-'));
    try {
      const uno = path.join(dir, 'uno.mjs');
      const dos = path.join(dir, 'dos.mjs');
      writeFileSync(uno, "console.log('UNO');");
      writeFileSync(dos, "console.log('DOS');");

      const result = await runStep(twoCommandStep, {
        resolveBin: (spec: string) => (spec === 'primero' ? uno : dos),
        stdout: sink(),
        stderr: sink(),
      });

      expect(result.code).toBe(0);
      expect(result.output).toContain('UNO');
      expect(result.output).toContain('DOS');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('resolveVerifyUrl', () => {
  const alias = 'https://rix7.cl';
  const deployment = 'https://rix7-abc.vercel.app';

  it('--url manda sobre todo lo demás', () => {
    expect(resolveVerifyUrl({ override: 'http://localhost:3111', alias, deployment })).toMatchObject({
      url: 'http://localhost:3111',
      source: 'flag',
    });
  });

  it('sin --url, verifica el alias recién publicado (la URL que ve la gente)', () => {
    expect(resolveVerifyUrl({ alias, deployment })).toMatchObject({ url: alias, source: 'alias' });
  });

  it('si el deploy no imprimió el alias, usa la URL del deployment', () => {
    expect(resolveVerifyUrl({ deployment })).toMatchObject({ url: deployment, source: 'deployment' });
  });

  it('sin nada, cae al dominio por defecto y lo dice', () => {
    expect(resolveVerifyUrl({})).toMatchObject({ url: DEFAULT_SITE_URL, source: 'default' });
  });

  it('normaliza la barra final', () => {
    expect(normalizeBaseUrl('https://rix7.cl///')).toBe('https://rix7.cl');
    expect(resolveVerifyUrl({ override: 'https://rix7.cl/' }).url).toBe('https://rix7.cl');
  });
});

describe('verifyLive', () => {
  const okSmoke = async () => ({ baseUrl: 'x', ok: true, steps: [], persisted: null, hint: null });
  const okHealth = async () => ({
    url: 'x',
    ok: true,
    httpStatus: 200,
    judgement: {
      ok: true,
      status: 'ok' as const,
      broken: [],
      degraded: [],
      optional: [],
      reasons: [],
      subsystems: [],
      summary: null,
    },
    error: null,
  });

  it('verde al primer intento: no espera ni reintenta', async () => {
    const sleepImpl = vi.fn(async () => {});
    const smokeImpl = vi.fn(okSmoke);
    const result = await verifyLive({
      url: 'https://rix7.cl',
      attempts: 3,
      smokeImpl,
      healthImpl: okHealth,
      sleepImpl,
      log: () => {},
    });

    expect(result).toEqual({ ok: true, attempt: 1 });
    expect(smokeImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });

  it('rojo y después verde: reintenta y se queda con el intento que pasó', async () => {
    const failSmoke = async () => ({ baseUrl: 'x', ok: false, steps: [], persisted: null, hint: null });
    let calls = 0;
    const smokeImpl = async (options: unknown) => {
      calls += 1;
      return calls === 1 ? failSmoke() : okSmoke();
    };
    const sleepImpl = vi.fn(async () => {});

    const result = await verifyLive({
      url: 'https://rix7.cl',
      attempts: 3,
      smokeImpl,
      healthImpl: okHealth,
      sleepImpl,
      log: () => {},
    });

    expect(result).toEqual({ ok: true, attempt: 2 });
    expect(sleepImpl).toHaveBeenCalledTimes(1);
  });

  it('solo la salud crítica puede tumbar la verificación', async () => {
    const brokenHealth = async () => ({
      url: 'x',
      ok: false,
      httpStatus: 503,
      judgement: {
        ok: false,
        status: 'broken' as const,
        broken: ['supabase'],
        degraded: [],
        optional: [],
        reasons: ['sin proyecto'],
        subsystems: [],
        summary: null,
      },
      error: null,
    });

    const result = await verifyLive({
      url: 'https://rix7.cl',
      attempts: 2,
      smokeImpl: okSmoke,
      healthImpl: brokenHealth,
      sleepImpl: async () => {},
      log: () => {},
    });

    expect(result).toEqual({ ok: false, attempt: 2 });
  });

  it('rojo siempre: agota los intentos y no esconde el resultado', async () => {
    const failSmoke = async () => ({ baseUrl: 'x', ok: false, steps: [], persisted: null, hint: null });
    const sleepImpl = vi.fn(async () => {});

    const result = await verifyLive({
      url: 'https://rix7.cl',
      attempts: 3,
      smokeImpl: failSmoke,
      healthImpl: okHealth,
      sleepImpl,
      log: () => {},
    });

    expect(result).toEqual({ ok: false, attempt: 3 });
    // El último intento no espera: no hay nada después que esperar.
    expect(sleepImpl).toHaveBeenCalledTimes(2);
  });

  /**
   * La comparación con el árbol: es lo que convierte «el sitio responde» en «el
   * sitio responde y es este código». Antes, un release podía salir verde con
   * producción sirviendo cualquier otra build.
   */
  const TREE = {
    value: '1.4f2a3c4b5d6e7f80.9d1c3ab77e5f1234567890abcdef1234567890ab.0.1',
    id: '4f2a3c4b5d6e7f80',
    commit: '9d1c3ab77e5f1234567890abcdef1234567890ab',
    dirty: false,
    changed: 0,
    builtAt: 1760361600,
    files: 380,
    skipped: [],
    error: null,
  };

  const healthWithBuild = (
    status: 'match' | 'no-live' | 'no-tree' | 'stale' | 'tree-moved' | 'differs'
  ) => async () => ({
    url: 'x',
    ok: true,
    httpStatus: 200,
    judgement: {
      ok: true,
      status: 'ok' as const,
      broken: [],
      degraded: [],
      optional: [],
      reasons: [],
      subsystems: [],
      summary: null,
      build: {
        status,
        level: (status === 'match' ? 'ok' : 'warn') as 'ok' | 'warn',
        detail: '…',
        hint: null,
        live: null,
        expected: null,
        published: null,
        relation: null,
      },
    },
    error: null,
  });

  it('con identificador local, exige que lo publicado sea este árbol', async () => {
    const result = await verifyLive({
      url: 'https://rix7.cl',
      attempts: 3,
      expected: TREE,
      smokeImpl: okSmoke,
      healthImpl: healthWithBuild('match'),
      sleepImpl: async () => {},
      log: () => {},
    });

    expect(result).toEqual({ ok: true, attempt: 1 });
  });

  it('si en vivo no está este árbol, el release falla (aunque el sitio responda)', async () => {
    const sleepImpl = vi.fn(async () => {});

    const result = await verifyLive({
      url: 'https://rix7.cl',
      attempts: 2,
      expected: TREE,
      smokeImpl: okSmoke,
      healthImpl: healthWithBuild('differs'),
      sleepImpl,
      log: () => {},
    });

    expect(result).toEqual({ ok: false, attempt: 2 });
    // Reintenta: un alias recién promovido puede seguir sirviendo el anterior.
    expect(sleepImpl).toHaveBeenCalledTimes(1);
  });

  it('sin identificador local no exige nada: no puede afirmar lo que no comparó', async () => {
    const result = await verifyLive({
      url: 'https://rix7.cl',
      attempts: 1,
      smokeImpl: okSmoke,
      healthImpl: async () => ({ ...(await okHealth()), judgement: { ...(await okHealth()).judgement } }),
      sleepImpl: async () => {},
      log: () => {},
    });

    expect(result.ok).toBe(true);
  });
  /**
   * La otra mitad: el árbol puede coincidir y aun así la versión o el tag no.
   * Es el caso que dejó producción 38 commits después de `v10.0.0` sin que el
   * release lo dijera.
   */
  const RELEASE = {
    version: '10.1.0',
    tag: 'v10.1.0',
    nearestTag: 'v10.1.0',
    nearestCommit: 'aaaa1111',
    distance: 0,
    error: null,
  };

  const healthWithRelease = (ok: boolean) => async () => ({
    ...(await okHealth()),
    judgement: {
      ...(await okHealth()).judgement,
      release: {
        status: ok ? ('match' as const) : ('version-differs' as const),
        level: ok ? ('ok' as const) : ('warn' as const),
        ok,
        detail: ok ? 'coincide' : 'en vivo dice 10.0.0 y el repositorio 10.1.0',
        hint: ok ? null : 'publicá el árbol actual',
        live: null,
        expected: null,
      },
    },
  });

  it('con versión y tag locales, exige que lo publicado sea esa release', async () => {
    const result = await verifyLive({
      url: 'https://rix7.cl',
      attempts: 3,
      releaseExpected: RELEASE,
      smokeImpl: okSmoke,
      healthImpl: healthWithRelease(true),
      sleepImpl: async () => {},
      log: () => {},
    });

    expect(result).toEqual({ ok: true, attempt: 1 });
  });

  it('si la versión o el tag no coinciden, el release falla aunque el sitio responda', async () => {
    const result = await verifyLive({
      url: 'https://rix7.cl',
      attempts: 2,
      releaseExpected: RELEASE,
      smokeImpl: okSmoke,
      healthImpl: healthWithRelease(false),
      sleepImpl: async () => {},
      log: () => {},
    });

    expect(result).toEqual({ ok: false, attempt: 2 });
  });

  it('sin identidad local no exige la comparación de release', async () => {
    const result = await verifyLive({
      url: 'https://rix7.cl',
      attempts: 2,
      smokeImpl: okSmoke,
      healthImpl: healthWithRelease(false),
      sleepImpl: async () => {},
      log: () => {},
    });

    expect(result).toEqual({ ok: true, attempt: 1 });
  });
});

describe('informe final', () => {
  it('con deploy y verificación: dice qué se publicó y qué se comprobó', () => {
    const text = formatReleaseSummary({
      durationMs: 65_000,
      deployment: 'https://rix7-abc.vercel.app',
      verified: { attempt: 1 },
      attempts: 3,
      ranDeploy: true,
      ranVerify: true,
    });

    expect(text).toContain('Release completo en 1m 5s');
    expect(text).toContain('https://rix7-abc.vercel.app');
    expect(text).toContain('Verificado en el intento 1/3');
    expect(text).toContain('La persistencia de un alta NO se probó acá');
  });

  it('sin verificación no afirma que se comprobó nada', () => {
    const text = formatReleaseSummary({ durationMs: 4_000, ranDeploy: true, ranVerify: false });

    expect(text).toContain('Sin verificación en vivo (--no-verify): lo publicado no se comprobó.');
    expect(text).not.toContain('La persistencia');
  });

  it('sin deploy y sin verificación no dice que verificó lo publicado', () => {
    const text = formatReleaseSummary({ durationMs: 1_000, ranDeploy: false, ranVerify: false });

    expect(text).toContain('Sin deploy en este release (--no-deploy).');
    expect(text).not.toContain('se verificó lo que ya estaba publicado');
  });

  it('--no-deploy con verificación sí puede decir que verificó lo publicado', () => {
    const text = formatReleaseSummary({
      durationMs: 3_000,
      ranDeploy: false,
      ranVerify: true,
      verified: { attempt: 2 },
      attempts: 3,
    });

    expect(text).toContain('se verificó lo que ya estaba publicado');
    expect(text).toContain('intento 2/3');
  });

  it('nombra el identificador y dice que lo publicado es este árbol', () => {
    const text = formatReleaseSummary({
      durationMs: 2_000,
      ranDeploy: true,
      ranVerify: true,
      verified: { attempt: 1 },
      buildLabel: '4f2a3c4b… · commit 9d1c3ab · con 17 archivos sin commitear',
      buildCompared: true,
    });

    expect(text).toContain('Identificador de la build: 4f2a3c4b…');
    expect(text).toContain('en vivo coincide con el árbol');
  });

  it('sin comparación no afirma que coincida', () => {
    const text = formatReleaseSummary({
      durationMs: 2_000,
      ranDeploy: true,
      ranVerify: false,
      buildLabel: '4f2a3c4b… · commit 9d1c3ab',
    });

    expect(text).toContain('no se comparó con lo vivo');
    expect(text).not.toContain('en vivo coincide');
  });

  it('si no se pudo identificar el árbol lo dice, en vez de dar por comprobado lo que no se comparó', () => {
    const text = formatReleaseSummary({ durationMs: 2_000, ranDeploy: true, ranVerify: true, verified: { attempt: 1 } });

    expect(text).toContain('Sin identificador de la build');
    expect(text).not.toContain('en vivo coincide');
  });

  it('nombra la versión y el tag cuando lo publicado es esa release', () => {
    const text = formatReleaseSummary({
      durationMs: 2_000,
      ranDeploy: true,
      ranVerify: true,
      verified: { attempt: 1 },
      releaseLabel: '10.1.0 · tag v10.1.0',
      releaseCompared: true,
      releaseConfirmed: true,
    });

    expect(text).toContain('Versión y tag: 10.1.0 · tag v10.1.0');
    expect(text).toContain('en vivo coincide con el repositorio');
  });

  it('sin comparación de release no afirma que coincida', () => {
    const text = formatReleaseSummary({
      durationMs: 2_000,
      ranDeploy: true,
      ranVerify: false,
      releaseLabel: '10.1.0 · tag v10.1.0',
      releaseCompared: true,
    });

    expect(text).toContain('no se comparó con lo vivo');
    expect(text).not.toContain('en vivo coincide con el repositorio');
  });

  it('si no se pudo leer la versión lo dice', () => {
    const text = formatReleaseSummary({ durationMs: 2_000, ranDeploy: true, ranVerify: true, verified: { attempt: 1 } });

    expect(text).toContain('Sin versión ni tag');
  });
});

describe('informe', () => {
  it('duración legible', () => {
    expect(formatDuration(9_400)).toBe('9s');
    expect(formatDuration(65_000)).toBe('1m 5s');
    expect(formatDuration(-5)).toBe('0s');
  });

  it('el plan enumera los pasos y, en dry-run, por qué están', () => {
    const plan = planRelease({ argv: ['--dry-run', '--no-db'] });
    const text = formatPlan(plan);

    expect(text).toContain('1. Build de producción');
    expect(text).toContain('2. Esquema de la base');
    expect(text).toContain('3. Deploy a producción');
    expect(text).toContain('--no-db');
    expect(text).toContain('por qué:');
    expect(text).toContain(`hasta ${plan.attempts} intentos`);
  });

  it('el plan anuncia que se compara lo publicado con el árbol', () => {
    const text = formatPlan(planRelease({ argv: [] }));
    expect(text).toContain('compara el identificador de la build');
  });

  it('sin deploy en el plan, no promete una comparación que no va a hacer', () => {
    const text = formatPlan(planRelease({ argv: ['--no-deploy'] }));
    expect(text).not.toContain('compara el identificador de la build');
  });
});

describe('isTransientDeployFailure', () => {
  it('reconoce el rechazo intermitente del CLI que ya pasó una vez', () => {
    expect(isTransientDeployFailure('Error: Not authorized')).toBe(true);
    expect(isTransientDeployFailure('HTTP 403: Forbidden')).toBe(false);
  });

  it('reconoce límites de tasa y cortes de red', () => {
    expect(isTransientDeployFailure('429 Too Many Requests')).toBe(true);
    expect(isTransientDeployFailure('socket hang up')).toBe(true);
    expect(isTransientDeployFailure('etimedout')).toBe(true);
  });

  it('no reintenta un fallo que no se arregla solo', () => {
    expect(isTransientDeployFailure('Build failed: Type error')).toBe(false);
    expect(isTransientDeployFailure('Error: The file does not exist')).toBe(false);
    expect(isTransientDeployFailure('')).toBe(false);
    expect(isTransientDeployFailure(null)).toBe(false);
  });
});

describe('checkDbCredentials', () => {
  const token = `sbp_${'0123456789abcdef'.repeat(2)}`;
  const values = (patch = {}) => ({
    NEXT_PUBLIC_SUPABASE_URL: 'https://vsqkjimpssdvlvdwrtnh.supabase.co',
    SUPABASE_PROJECT_REF: null,
    SUPABASE_ACCESS_TOKEN: token,
    ...patch,
  });

  it('con un token que la API acepta, deja pasar y nombra el proyecto', async () => {
    const seen: any[] = [];
    const result = await checkDbCredentials({
      values: values(),
      checkTokenImpl: async (args: any) => {
        seen.push(args);
        return { ok: true, projects: ['vsqkjimpssdvlvdwrtnh'] };
      },
    });

    expect(result.ok).toBe(true);
    // La referencia se deduce de la URL: el paso de migraciones no la pide.
    expect(seen[0].ref).toBe('vsqkjimpssdvlvdwrtnh');
  });

  it('sin token no llega a preguntar, y manda a guardarlo con db:token', async () => {
    let asked = false;
    const result = await checkDbCredentials({
      values: values({ SUPABASE_ACCESS_TOKEN: null }),
      checkTokenImpl: async () => {
        asked = true;
        return { ok: true, projects: [] };
      },
    });

    expect(asked).toBe(false);
    expect(result.ok).toBe(false);
    const text = !result.ok ? result.lines.join('\n') : '';
    expect(text).toContain('SUPABASE_ACCESS_TOKEN');
    expect(text).toContain('npm run db:token');
    // La salida cuando el esquema ya está al día, sin inventar un atajo.
    expect(text).toContain('--no-db');
  });

  it('con un 401 se detiene con el mismo mensaje accionable que db:token', async () => {
    const result = await checkDbCredentials({
      values: values(),
      checkTokenImpl: async () => ({
        ok: false,
        reason: 'invalid',
        detail: 'HTTP 401: Invalid access token',
      }),
    });

    expect(result.ok).toBe(false);
    const text = !result.ok ? result.lines.join('\n') : '';
    expect(text).toContain('401');
    expect(text).toContain('https://supabase.com/dashboard/account/tokens');
    expect(text).toContain('--no-db');
    // Nunca el valor del token, ni siquiera en el diagnóstico.
    expect(text).not.toContain(token);
  });

  it('si la API no responde, no bloquea el release: lo decide el paso de migraciones', async () => {
    const result = await checkDbCredentials({
      values: values(),
      checkTokenImpl: async () => ({ ok: false, reason: 'unreachable', detail: 'HTTP 502' }),
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.warning).toContain('HTTP 502');
  });
});

describe('readDbValues', () => {
  it('el entorno manda y .env.local completa', () => {
    expect(readDbValues({
      env: { SUPABASE_ACCESS_TOKEN: 'del-entorno' },
      exists: () => true,
      read: () => 'NEXT_PUBLIC_SUPABASE_URL=https://abc.supabase.co\nSUPABASE_ACCESS_TOKEN=del-archivo\n',
    })).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
      SUPABASE_PROJECT_REF: null,
      SUPABASE_ACCESS_TOKEN: 'del-entorno',
    });
  });

  it('sin .env.local no inventa valores', () => {
    expect(readDbValues({ env: {}, exists: () => false })).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: null,
      SUPABASE_PROJECT_REF: null,
      SUPABASE_ACCESS_TOKEN: null,
    });
  });
});
