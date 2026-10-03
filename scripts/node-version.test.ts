/**
 * Tests del guardián de versión de Node.
 *
 * Importan dos propiedades. Primero, que lea bien las formas reales de `.nvmrc`
 * y de `process.version` sin inventar números (un `lts/*` no es la major 0).
 * Segundo, que el aviso sea exactamente eso —un aviso— y no un candado: el
 * veredicto es un dato que el wrapper decide cómo usar, no una salida del
 * proceso.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EXPECTED_MAJOR,
  checkNodeVersion,
  expectedMajor,
  nodeMajor,
  parseVersionRecord,
  VERSION_RECORD_FILE,
} from './node-version.mjs';

describe('nodeMajor', () => {
  it('lee la major de una versión de process.version', () => {
    expect(nodeMajor('v24.19.0')).toBe(24);
    expect(nodeMajor('v20.11.1')).toBe(20);
    expect(nodeMajor('20.0.0')).toBe(20);
  });

  it('no inventa una major cuando no hay dígitos', () => {
    expect(nodeMajor('lts/*')).toBeNull();
    expect(nodeMajor('')).toBeNull();
    expect(nodeMajor(undefined as unknown as string)).toBeNull();
  });
});

describe('parseVersionRecord', () => {
  it('acepta las formas que la gente escribe de verdad', () => {
    expect(parseVersionRecord('20')).toBe(20);
    expect(parseVersionRecord('v20')).toBe(20);
    expect(parseVersionRecord('20.x')).toBe(20);
    expect(parseVersionRecord('20.18')).toBe(20);
    expect(parseVersionRecord('20.18.1')).toBe(20);
  });

  it('toma la primera línea no vacía y tolera CRLF y espacios', () => {
    expect(parseVersionRecord('\r\n  20  \r\n')).toBe(20);
    expect(parseVersionRecord('v20\r\n')).toBe(20);
  });

  it('devuelve null para un alias o basura en vez de adivinar', () => {
    expect(parseVersionRecord('lts/*')).toBeNull();
    expect(parseVersionRecord('node')).toBeNull();
    expect(parseVersionRecord('')).toBeNull();
  });
});

describe('expectedMajor', () => {
  it('lee la major del .nvmrc versionado', () => {
    expect(expectedMajor({ root: process.cwd() })).toBe(24);
    expect(VERSION_RECORD_FILE).toBe('.nvmrc');
  });

  it('cae al respaldo de CI si el archivo no existe', () => {
    expect(expectedMajor({ root: process.cwd() + '/no-existe-esta-carpeta' })).toBe(
      DEFAULT_EXPECTED_MAJOR
    );
  });
});

describe('checkNodeVersion', () => {
  it('aprueba cuando la major coincide', () => {
    const result = checkNodeVersion('v24.19.0', 24);
    expect(result.ok).toBe(true);
    expect(result.message).toBeNull();
  });

  it('avisa cuando la major no coincide, nombrando ambas', () => {
    const result = checkNodeVersion('v20.11.1', 24);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('v20');
    expect(result.message).toContain('24');
    expect(result.message).toContain('.nvmrc');
  });

  it('avisa, no falla: el veredicto es un dato que el wrapper decide', () => {
    // No lanza ni devuelve un código de salida: solo describe.
    expect(() => checkNodeVersion('v20.11.1', 24)).not.toThrow();
    expect(checkNodeVersion('lts/*', 24).message).toContain('desconocida');
  });
});
