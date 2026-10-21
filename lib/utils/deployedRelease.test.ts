import { describe, expect, it } from 'vitest';

import { readDeployedRelease } from './deployedRelease';

const ID = '4f2a3c4b5d6e7f80';
const COMMIT = '9d1c3ab77e5f1234567890abcdef1234567890ab';

describe('readDeployedRelease', () => {
  it('lee versión, tag y build cuando el deployment los publica', () => {
    const release = readDeployedRelease(
      {
        RIX7_VERSION: '10.1.0',
        RIX7_TAG: 'v10.1.0',
        RIX7_BUILD: `1.${ID}.${COMMIT}.0.1760361600`,
      },
      '10.0.0'
    );

    expect(release).toEqual({
      version: '10.1.0',
      tag: 'v10.1.0',
      build: {
        id: ID,
        commit: COMMIT,
        dirty: false,
        builtAt: new Date(1760361600 * 1000).toISOString(),
      },
    });
  });

  it('sin variables usa la versión del manifiesto y no identifica la build', () => {
    // Es el caso de `npm run dev` y de un despliegue publicado sin el comando
    // del repositorio: hay versión del código, pero afirmar qué árbol corre
    // sería adivinar.
    const release = readDeployedRelease({}, '10.0.0');

    expect(release.version).toBe('10.0.0');
    expect(release.tag).toBeNull();
    expect(release.build).toBeNull();
  });

  it('si solo publica el tag, la versión sigue saliendo del manifiesto', () => {
    const release = readDeployedRelease({ RIX7_TAG: 'v10.0.0' }, '10.0.0');

    expect(release.version).toBe('10.0.0');
    expect(release.tag).toBe('v10.0.0');
  });

  it('ignora valores con formato inválido en vez de mostrarlos', () => {
    const release = readDeployedRelease(
      {
        RIX7_VERSION: 'la-de-ayer',
        RIX7_TAG: 'release final',
        RIX7_BUILD: 'build-1',
      },
      '10.0.0'
    );

    expect(release).toEqual({ version: '10.0.0', tag: null, build: null });
  });

  it('marca la build como sucia cuando se publicó sin commitear', () => {
    const release = readDeployedRelease({ RIX7_BUILD: `1.${ID}.-.1.1760361600` }, '10.0.0');

    expect(release.build).toMatchObject({ dirty: true, commit: null });
  });
});
