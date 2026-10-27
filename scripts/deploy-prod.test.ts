/**
 * Tests del deploy a producción.
 *
 * Es el script que publica, así que casi nada de él se puede probar sin publicar
 * de verdad. Lo que sí: **cómo se arma el comando**, que es donde se rompen las
 * cosas en silencio. En particular el identificador de la build, que viaja como
 * argumento hacia el CLI de Vercel por `cmd.exe` en Windows — un espacio, una
 * comilla o un `|` y el deployment recibiría otro valor, o ninguno, y a partir
 * de ahí nadie puede comprobar que producción sea el código del repositorio.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { BUILD_ID_ENV, formatBuildIdValue } from './build-id.mjs';
import {
  confirmDeployment,
  deploymentUrlFrom,
  deploymentVerdict,
  latestProductionUrl,
  removeTreeWithRetry,
  runVercelCli,
  stagingPathFor,
  sweepStaleStaging,
  vercelArgs,
} from './deploy-prod.mjs';
import { RELEASE_TAG_ENV, RELEASE_VERSION_ENV } from './release-identity.mjs';

const SHA = '9d1c3ab77e5f1234567890abcdef1234567890ab';

/** Directorios temporales de los tests: se borran al terminar la suite. */
const scratchDirs: string[] = [];

function scratchDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rix7-deploy-test-'));
  scratchDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratchDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('vercelArgs', () => {
  it('sin identificador no agrega ninguna variable de entorno', () => {
    const args = vercelArgs({ buildValue: null });

    expect(args).toEqual(['--yes', 'vercel', '--prod', '--yes']);
    expect(args.join(' ')).not.toContain(BUILD_ID_ENV);
  });

  it('con identificador lo publica como variable del deployment', () => {
    const args = vercelArgs({ buildValue: '1.4f2a3c4b5d6e7f80.-.0.1760361600' });

    expect(args).toContain('-e');
    expect(args).toContain(`${BUILD_ID_ENV}=1.4f2a3c4b5d6e7f80.-.0.1760361600`);
    // El `-e` y su valor van pegados: si el valor quedara suelto, el CLI lo
    // leería como otro argumento.
    expect(args[args.indexOf('-e') + 1]).toBe(`${BUILD_ID_ENV}=1.4f2a3c4b5d6e7f80.-.0.1760361600`);
    // No pisa el resto del comando.
    expect(args.slice(0, 4)).toEqual(['--yes', 'vercel', '--prod', '--yes']);
  });

  it('el valor que produce build-id no necesita comillas ni escape', () => {
    const value = formatBuildIdValue({ id: '4f2a3c4b5d6e7f80', commit: SHA, dirty: true, builtAt: 1760361600 })!;
    const arg = vercelArgs({ buildValue: value }).at(-1)!;

    expect(arg).toMatch(/^[A-Za-z0-9_.=-]+$/);
  });

  it('un valor vacío no se publica como si existiera', () => {
    expect(vercelArgs({ buildValue: '' })).toEqual(['--yes', 'vercel', '--prod', '--yes']);
  });

  it('publica versión y tag para que /api/health pueda comparar la release', () => {
    const args = vercelArgs({
      buildValue: '1.4f2a3c4b5d6e7f80.-.0.1760361600',
      version: '10.1.0',
      tag: 'v10.1.0',
    });

    expect(args).toContain(`${RELEASE_VERSION_ENV}=10.1.0`);
    expect(args).toContain(`${RELEASE_TAG_ENV}=v10.1.0`);
  });

  it('sin tag publica la versión igual; sin versión, el tag igual', () => {
    expect(vercelArgs({ version: '10.1.0' })).toContain(`${RELEASE_VERSION_ENV}=10.1.0`);
    expect(vercelArgs({ version: '10.1.0' })).not.toContain(`${RELEASE_TAG_ENV}=`);
    expect(vercelArgs({ tag: 'v10.1.0' })).toContain(`${RELEASE_TAG_ENV}=v10.1.0`);
  });

  it('un valor con espacios o metacaracteres no llega al CLI', () => {
    const args = vercelArgs({ version: '10.1.0; rm -rf /', tag: 'v10.1.0 | evil' });

    expect(args.join(' ')).not.toContain('rm -rf');
    expect(args.join(' ')).not.toContain('evil');
  });
});

/**
 * El corte del stream del CLI.
 *
 * El caso que motivó estos tests: el CLI pierde el stream del build remoto y sale
 * con 1 aunque Vercel haya terminado y promovido el deployment (2026-10-27, dos
 * veces). El release informaba «no se publicó nada nuevo» sobre algo que sí estaba
 * sirviendo. Ahora la salida del CLI no decide sola: se le pregunta a Vercel por el
 * deployment y, si está READY, la corrida sigue —con la verificación en vivo como
 * árbitro de si rix7.cl sirve este árbol.
 */
/**
 * El lanzamiento del CLI, sin Vercel.
 *
 * Es la pieza que cambió: antes `stdio: 'inherit'` no dejaba nada que leer, y sin
 * salida no hay URL ni diagnóstico cuando el stream se corta. Lo que se prueba acá
 * es el mecanismo —capturar, reemitir y no perder el código de salida— con un
 * proceso cualquiera.
 */
describe('runVercelCli', () => {
  it('captura la salida, la reemite y devuelve el código 0', async () => {
    let eco = '';
    const sink = { write: (chunk: string) => (eco += chunk) } as unknown as NodeJS.WritableStream;

    const result = await runVercelCli(process.execPath, ['-e', 'console.log("hola desde el cli")'], {
      out: sink,
      err: sink,
    });

    expect(result.status).toBe(0);
    expect(result.error).toBeNull();
    expect(result.output).toContain('hola desde el cli');
    // Reemitida al instante: es lo que mantiene visible el progreso del build.
    expect(eco).toContain('hola desde el cli');
  });

  it('no se traga el código de salida distinto de cero', async () => {
    const sink = { write: () => {} } as unknown as NodeJS.WritableStream;

    const result = await runVercelCli(process.execPath, ['-e', 'process.exit(3)'], { out: sink, err: sink });

    expect(result.status).toBe(3);
    expect(result.error).toBeNull();
  });

  it('un comando que no existe vuelve como error, no como cuelgue', async () => {
    const sink = { write: () => {} } as unknown as NodeJS.WritableStream;

    const result = await runVercelCli('rix7-no-existe-jamas', [], { out: sink, err: sink });

    expect(result.error).toBeInstanceOf(Error);
    expect(result.status).toBeNull();
  });
});

describe('deploymentUrlFrom', () => {
  const salida = [
    'Vercel CLI 61.1.0 (Node.js 24.19.0)',
    'Deploying rix7',
    'Uploading [====================] (447.1KB/447.1KB)',
    '  Inspect         https://vercel.com/ctd5/rix7/9HXMrVuLhtF6zEBp9s3LPKRugXog',
    '  Production      https://rix7-fd7xcrhnz-ctd5.vercel.app',
    'https://rix7-fd7xcrhnz-ctd5.vercel.appBuilding…',
  ].join('\n');

  it('toma el deployment de producción, no la página del panel', () => {
    expect(deploymentUrlFrom(salida)).toBe('https://rix7-fd7xcrhnz-ctd5.vercel.app');
  });

  it('lee la línea con dos puntos y con colores de terminal', () => {
    const conColor = '\u001b[36;1m  Production:\u001b[0m https://rix7-abc123-ctd5.vercel.app,';

    expect(deploymentUrlFrom(conColor)).toBe('https://rix7-abc123-ctd5.vercel.app');
  });

  it('sin línea Production igual reconoce la URL del deployment', () => {
    expect(deploymentUrlFrom('Building… https://rix7-abc123-ctd5.vercel.app')).toBe(
      'https://rix7-abc123-ctd5.vercel.app'
    );
  });

  it('sin ninguna URL no inventa una', () => {
    expect(deploymentUrlFrom('Error: fetch failed')).toBeNull();
    expect(deploymentUrlFrom(null)).toBeNull();
  });
});

describe('deploymentVerdict', () => {
  it('READY es publicado y ERROR es fallo', () => {
    expect(deploymentVerdict('READY')).toBe('ready');
    expect(deploymentVerdict('Error')).toBe('failed');
    expect(deploymentVerdict('CANCELED')).toBe('failed');
  });

  it('construyendo es «todavía no»: se puede esperar', () => {
    for (const state of ['QUEUED', 'BUILDING', 'INITIALIZING']) {
      expect(deploymentVerdict(state), state).toBe('pending');
    }
  });

  it('un estado que no sabemos leer no se toma por bueno', () => {
    expect(deploymentVerdict(null)).toBe('unknown');
    expect(deploymentVerdict('vaya-uno-a-saber')).toBe('unknown');
  });
});

describe('latestProductionUrl', () => {
  const ahora = 1_793_124_000_000;
  const payload = {
    deployments: [
      { url: 'rix7-preview-ctd5.vercel.app', target: null, createdAt: ahora },
      { url: 'rix7-viejo-ctd5.vercel.app', target: 'production', createdAt: ahora - 4 * 60 * 60 * 1000 },
      { url: 'rix7-nuevo-ctd5.vercel.app', target: 'production', createdAt: ahora },
      { url: 'rix7-medio-ctd5.vercel.app', target: 'production', createdAt: ahora - 30_000 },
    ],
  };

  it('toma el deployment de producción más reciente de esta corrida', () => {
    expect(latestProductionUrl(payload, { since: ahora })).toBe('https://rix7-nuevo-ctd5.vercel.app');
  });

  it('no confunde un preview ni uno viejo con el propio', () => {
    const soloViejo = { deployments: [payload.deployments[1]] };

    expect(latestProductionUrl(soloViejo, { since: ahora })).toBeNull();
    expect(latestProductionUrl({ deployments: [payload.deployments[0]] }, { since: ahora })).toBeNull();
  });

  it('sin lista devuelve null en vez de lanzar', () => {
    expect(latestProductionUrl(null, { since: ahora })).toBeNull();
  });
});

describe('confirmDeployment', () => {
  it('espera mientras construye y termina en ready', async () => {
    const estados = ['BUILDING', 'BUILDING', 'READY'];
    const esperas: number[] = [];

    const outcome = await confirmDeployment({
      url: 'https://rix7-abc-ctd5.vercel.app',
      delayMs: 5000,
      inspect: async () => ({ readyState: estados.shift(), aliases: ['rix7.cl'] }),
      sleep: async (ms: number) => esperas.push(ms),
      log: () => {},
    });

    expect(outcome.verdict).toBe('ready');
    expect(outcome.attempts).toBe(3);
    expect(esperas).toEqual([5000, 5000]);
  });

  it('un deployment en ERROR no se toma como publicado', async () => {
    const outcome = await confirmDeployment({
      url: 'https://rix7-abc-ctd5.vercel.app',
      inspect: async () => ({ readyState: 'ERROR' }),
      sleep: async () => {},
      log: () => {},
    });

    expect(outcome.verdict).toBe('failed');
    expect(outcome.attempts).toBe(1);
  });

  it('si nunca termina de construirse se rinde sin llamarlo publicado', async () => {
    let consultas = 0;

    const outcome = await confirmDeployment({
      url: 'https://rix7-abc-ctd5.vercel.app',
      attempts: 3,
      inspect: async () => {
        consultas += 1;
        return { readyState: 'BUILDING' };
      },
      sleep: async () => {},
      log: () => {},
    });

    expect(outcome.verdict).toBe('pending');
    expect(consultas).toBe(3);
  });

  it('si Vercel no responde no se afirma que quedó publicado', async () => {
    const outcome = await confirmDeployment({
      url: 'https://rix7-abc-ctd5.vercel.app',
      attempts: 2,
      inspect: async () => null,
      sleep: async () => {},
      log: () => {},
    });

    expect(outcome.verdict).toBe('unknown');
    expect(outcome.readyState).toBeNull();
  });
});

/**
 * El staging y su limpieza.
 *
 * El bug que motivó estos tests: la copia vivía en `.deploy-staging`, dentro del
 * árbol, el CLI la usaba como `cwd` y el `rmSync` de la limpieza fallaba con
 * EBUSY en Windows. Resultado: un directorio vacío dentro del repositorio, tapado
 * por `.gitignore` y por un aviso que se leía como ruido. La copia ahora vive en
 * el temporal del sistema —fuera del árbol, con nombre único por corrida— y el
 * borrado reintenta en vez de rendirse al primer EPERM.
 */
describe('stagingPathFor', () => {
  it('arma la copia en el temporal del sistema, no en el árbol del proyecto', () => {
    const tmpdir = path.join(os.tmpdir(), 'rix7-tmp-probe');
    const staging = stagingPathFor({ tmpdir, now: Date.parse('2026-10-22T18:00:00Z'), pid: 4242 });

    expect(staging.startsWith(tmpdir)).toBe(true);
    expect(path.dirname(staging)).toBe(tmpdir);
    // Nada de `.deploy-staging` dentro del proyecto: es lo que ensuciaba el árbol.
    expect(staging).not.toContain('.deploy-staging');
  });

  it('dos corridas en el mismo milisegundo no comparten directorio', () => {
    const now = Date.parse('2026-10-22T18:00:00Z');
    const a = stagingPathFor({ now, pid: 100 });
    const b = stagingPathFor({ now, pid: 101 });

    // La versión anterior borraba el staging al empezar: un segundo deploy le
    // vaciaba la copia al primero en pleno vuelo.
    expect(a).not.toBe(b);
  });

  it('dos corridas del mismo proceso tampoco', () => {
    expect(stagingPathFor({ now: 1, pid: 7 })).not.toBe(stagingPathFor({ now: 2, pid: 7 }));
  });
});

describe('removeTreeWithRetry', () => {
  it('borra el árbol y devuelve true', () => {
    const dir = scratchDir();
    fs.mkdirSync(path.join(dir, 'a', 'b'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'a', 'b', 'archivo.txt'), 'x');

    expect(removeTreeWithRetry(dir, { sleep: () => {} })).toBe(true);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('reintenta cuando Windows todavía tiene el handle (EBUSY)', () => {
    let intentos = 0;
    const esperas: number[] = [];

    const removed = removeTreeWithRetry('/tmp/da-igual', {
      retries: 3,
      baseDelayMs: 100,
      rm: () => {
        intentos += 1;
        if (intentos < 3) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      },
      sleep: (ms: number) => esperas.push(ms),
    });

    expect(removed).toBe(true);
    expect(intentos).toBe(3);
    // Espera creciente: 100 ms, 200 ms.
    expect(esperas).toEqual([100, 200]);
  });

  it('se rinde con false tras agotar los reintentos, sin lanzar', () => {
    let intentos = 0;

    const removed = removeTreeWithRetry('/tmp/da-igual', {
      retries: 2,
      rm: () => {
        intentos += 1;
        throw Object.assign(new Error('busy'), { code: 'EPERM' });
      },
      sleep: () => {},
    });

    expect(removed).toBe(false);
    expect(intentos).toBe(3);
  });

  it('no reintenta un error que no es «todavía no»', () => {
    let intentos = 0;

    const removed = removeTreeWithRetry('/tmp/da-igual', {
      retries: 5,
      rm: () => {
        intentos += 1;
        throw Object.assign(new Error('no existe'), { code: 'ENOENT' });
      },
      sleep: () => {},
    });

    expect(removed).toBe(false);
    expect(intentos).toBe(1);
  });
});

describe('sweepStaleStaging', () => {
  it('barre los stagings viejos y deja en paz los recientes y los ajenos', () => {
    const tmpdir = scratchDir();
    const viejo = path.join(tmpdir, 'rix7-deploy-viejo');
    const nuevo = path.join(tmpdir, 'rix7-deploy-nuevo');
    const ajeno = path.join(tmpdir, 'otra-herramienta');
    for (const dir of [viejo, nuevo, ajeno]) fs.mkdirSync(dir, { recursive: true });

    const ahora = Date.now();
    fs.utimesSync(viejo, new Date(ahora - 3 * 60 * 60 * 1000), new Date(ahora - 3 * 60 * 60 * 1000));

    const removed = sweepStaleStaging({ tmpdir, maxAgeMs: 60 * 60 * 1000, now: ahora });

    expect(removed).toBe(1);
    expect(fs.existsSync(viejo)).toBe(false);
    // Uno reciente puede ser un deploy corriendo ahora: no se toca.
    expect(fs.existsSync(nuevo)).toBe(true);
    // Y menos lo que no es nuestro.
    expect(fs.existsSync(ajeno)).toBe(true);
  });

  it('un temporal ilegible no tumba el deploy', () => {
    expect(sweepStaleStaging({ tmpdir: path.join(os.tmpdir(), 'no-existe-' + Date.now()) })).toBe(0);
  });
});
