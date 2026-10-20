import { describe, expect, it, vi } from 'vitest';

import {
  compareReleaseIdentity,
  formatReleaseComparison,
  readReleaseIdentity,
  sanitizeTag,
  sanitizeVersion,
} from './release-identity.mjs';

/** `run` falso: contesta solo los comandos que el test declara. */
function fakeRun(answers: Record<string, { code: number; stdout: string }>) {
  return vi.fn((command: string, args: string[]) => {
    const key = `${command} ${args.join(' ')}`;
    return answers[key] ?? { code: 1, stdout: '' };
  });
}

const manifest = (version: unknown) => () => JSON.stringify({ version });

const EXPECTED = {
  version: '10.1.0',
  tag: 'v10.1.0',
  nearestTag: 'v10.1.0',
  nearestCommit: 'aaaa1111',
  distance: 0,
  error: null,
};

describe('readReleaseIdentity', () => {
  it('lee la versión del package.json y el tag exacto del commit', () => {
    const run = fakeRun({
      'git describe --tags --exact-match HEAD': { code: 0, stdout: 'v10.1.0\n' },
      'git describe --tags --abbrev=0': { code: 0, stdout: 'v10.1.0\n' },
      'git rev-list -n 1 refs/tags/v10.1.0': { code: 0, stdout: 'aaaa1111\n' },
      'git rev-list --count v10.1.0..HEAD': { code: 0, stdout: '0\n' },
    });

    expect(readReleaseIdentity({ root: '/repo', run, read: manifest('10.1.0') })).toEqual({
      version: '10.1.0',
      tag: 'v10.1.0',
      nearestTag: 'v10.1.0',
      nearestCommit: 'aaaa1111',
      distance: 0,
      error: null,
    });
  });

  it('sin tag exacto informa el más cercano y a cuántos commits quedó', () => {
    const run = fakeRun({
      'git describe --tags --exact-match HEAD': { code: 128, stdout: '' },
      'git describe --tags --abbrev=0': { code: 0, stdout: 'v10.0.0\n' },
      'git rev-list -n 1 refs/tags/v10.0.0': { code: 0, stdout: 'bbbb2222\n' },
      'git rev-list --count v10.0.0..HEAD': { code: 0, stdout: '38\n' },
    });

    const identity = readReleaseIdentity({ root: '/repo', run, read: manifest('10.1.0') });

    expect(identity).toMatchObject({
      version: '10.1.0',
      tag: null,
      nearestTag: 'v10.0.0',
      nearestCommit: 'bbbb2222',
      distance: 38,
    });
  });

  it('sin git conserva la versión y deja los tags en null, sin lanzar', () => {
    const run = fakeRun({});

    expect(readReleaseIdentity({ root: '/repo', run, read: manifest('10.0.0') })).toEqual({
      version: '10.0.0',
      tag: null,
      nearestTag: null,
      nearestCommit: null,
      distance: null,
      error: null,
    });
  });

  it('un package.json ilegible se informa en error', () => {
    const identity = readReleaseIdentity({
      root: '/repo',
      run: fakeRun({}),
      read: () => {
        throw new Error('ENOENT');
      },
    });

    expect(identity.version).toBeNull();
    expect(identity.error).toContain('package.json');
  });
});

describe('sanitizeVersion / sanitizeTag', () => {
  it('solo aceptan semver publicable', () => {
    expect(sanitizeVersion(' 10.1.0 ')).toBe('10.1.0');
    expect(sanitizeTag('v10.1.0')).toBe('v10.1.0');
    expect(sanitizeTag('release-final')).toBeNull();
    expect(sanitizeVersion('diez')).toBeNull();
  });
});

describe('compareReleaseIdentity', () => {
  it('versión y tag iguales: coincide', () => {
    const comparison = compareReleaseIdentity({
      live: { version: '10.1.0', tag: 'v10.1.0' },
      expected: EXPECTED,
    });

    expect(comparison.status).toBe('match');
    expect(comparison.ok).toBe(true);
    expect(comparison.level).toBe('ok');
  });

  it('una versión distinta es una contradicción, no un aviso', () => {
    const comparison = compareReleaseIdentity({
      live: { version: '10.0.0', tag: 'v10.0.0' },
      expected: EXPECTED,
    });

    expect(comparison.status).toBe('version-differs');
    expect(comparison.ok).toBe(false);
    expect(comparison.detail).toContain('10.0.0');
    expect(comparison.detail).toContain('10.1.0');
  });

  it('un tag distinto también falla', () => {
    const comparison = compareReleaseIdentity({
      live: { version: '10.1.0', tag: 'v10.0.0' },
      expected: EXPECTED,
    });

    expect(comparison.status).toBe('tag-differs');
    expect(comparison.ok).toBe(false);
  });

  it('un tag que no corresponde a la versión del repo falla', () => {
    const comparison = compareReleaseIdentity({
      live: { version: '10.1.0', tag: 'v10.0.0' },
      expected: { ...EXPECTED, tag: 'v10.0.0' },
    });

    expect(comparison.status).toBe('version-tag-mismatch');
    expect(comparison.ok).toBe(false);
    expect(comparison.hint).toContain('v10.1.0');
  });

  it('HEAD sin tag avisa, pero no invalida la build', () => {
    const comparison = compareReleaseIdentity({
      live: { version: '10.1.0', tag: null },
      expected: { ...EXPECTED, tag: null, nearestTag: 'v10.0.0', distance: 38, nearestCommit: 'bbbb2222' },
      publishedCommit: 'cccc3333',
    });

    expect(comparison.status).toBe('untagged');
    expect(comparison.ok).toBe(true);
    expect(comparison.level).toBe('warn');
    expect(comparison.detail).toContain('38 commits');
    expect(comparison.detail).toContain('el commit publicado no es el del tag');
  });

  it('si el tag de la versión ya existe en un commit anterior, no sugiere reusarlo', () => {
    const comparison = compareReleaseIdentity({
      live: { version: '10.0.0', tag: null },
      expected: { ...EXPECTED, version: '10.0.0', tag: null, nearestTag: 'v10.0.0', nearestCommit: 'bbbb2222', distance: 39 },
    });

    expect(comparison.hint).toContain('ya existe en un commit anterior');
    expect(comparison.hint).toContain('subí el `version`');
  });

  it('sin tag en HEAD pero con el commit del tag publicado, lo dice', () => {
    const comparison = compareReleaseIdentity({
      live: { version: '10.0.0', tag: null },
      expected: { ...EXPECTED, version: '10.0.0', tag: null, nearestTag: 'v10.0.0', nearestCommit: 'bbbb2222', distance: 0 },
      publishedCommit: 'bbbb2222',
    });

    expect(comparison.detail).toContain('el commit publicado es el del tag');
  });

  it('un despliegue sin identidad no se compara (info)', () => {
    const comparison = compareReleaseIdentity({ live: null, expected: EXPECTED });

    expect(comparison.status).toBe('no-live');
    expect(comparison.ok).toBe(true);
    expect(comparison.level).toBe('info');
  });

  it('si no se pudo leer el repo, no se afirma nada', () => {
    const comparison = compareReleaseIdentity({
      live: { version: '10.1.0', tag: 'v10.1.0' },
      expected: null,
    });

    expect(comparison.status).toBe('no-local');
    expect(comparison.ok).toBe(true);
  });
});

describe('formatReleaseComparison', () => {
  it('marca la coincidencia con ✓', () => {
    const lines = formatReleaseComparison(
      compareReleaseIdentity({ live: { version: '10.1.0', tag: 'v10.1.0' }, expected: EXPECTED })
    );

    expect(lines[0]).toContain('✓ Versión y tag');
  });

  it('marca la contradicción con ! y muestra el hint', () => {
    const lines = formatReleaseComparison(
      compareReleaseIdentity({ live: { version: '10.0.0', tag: 'v10.0.0' }, expected: EXPECTED })
    );

    expect(lines[0]).toContain('! Versión y tag');
    expect(lines.join('\n')).toContain('release:prod');
  });
});
