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
import { describe, expect, it } from 'vitest';

import { BUILD_ID_ENV, formatBuildIdValue } from './build-id.mjs';
import { vercelArgs } from './deploy-prod.mjs';
import { RELEASE_TAG_ENV, RELEASE_VERSION_ENV } from './release-identity.mjs';

const SHA = '9d1c3ab77e5f1234567890abcdef1234567890ab';

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
