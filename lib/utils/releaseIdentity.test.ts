import { describe, expect, it } from 'vitest';

import { parseReleaseIdentity } from './releaseIdentity';

describe('parseReleaseIdentity', () => {
  it('traduce versión y tag válidos', () => {
    expect(parseReleaseIdentity('10.1.0', 'v10.1.0')).toEqual({
      version: '10.1.0',
      tag: 'v10.1.0',
    });
  });

  it('acepta pre-releases y tags sin la v', () => {
    expect(parseReleaseIdentity('10.1.0-rc.1', '10.1.0-rc.1')).toEqual({
      version: '10.1.0-rc.1',
      tag: '10.1.0-rc.1',
    });
  });

  it('recorta espacios de las variables de entorno', () => {
    expect(parseReleaseIdentity(' 10.0.0 ', ' v10.0.0 ')).toEqual({
      version: '10.0.0',
      tag: 'v10.0.0',
    });
  });

  it('un despliegue sin tag publica la versión igual', () => {
    expect(parseReleaseIdentity('10.1.0', '')).toEqual({ version: '10.1.0', tag: null });
    expect(parseReleaseIdentity('10.1.0', undefined)).toEqual({ version: '10.1.0', tag: null });
  });

  it('sin ninguna identidad válida devuelve null, no un objeto a medias', () => {
    expect(parseReleaseIdentity(undefined, undefined)).toBeNull();
    expect(parseReleaseIdentity('', '')).toBeNull();
    expect(parseReleaseIdentity('main', 'release-final')).toBeNull();
    expect(parseReleaseIdentity('10.0', 'v10')).toBeNull();
  });

  it('un valor con caracteres raros no se publica', () => {
    expect(parseReleaseIdentity('10.0.0; rm -rf /', 'v10.0.0|evil')).toBeNull();
  });

  it('si solo el tag es válido, conserva el tag y deja la versión en null', () => {
    expect(parseReleaseIdentity('diez', 'v10.0.0')).toEqual({ version: null, tag: 'v10.0.0' });
  });
});
