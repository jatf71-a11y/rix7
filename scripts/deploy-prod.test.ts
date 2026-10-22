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
import { removeTreeWithRetry, stagingPathFor, sweepStaleStaging, vercelArgs } from './deploy-prod.mjs';
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
