import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { installHook, MARKER, PRE_COMMIT } from './install-git-hooks.mjs';

describe('installHook', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function hooksDir(): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'rix7-hooks-'));
    dirs.push(dir);
    return dir;
  }

  it('escribe un pre-commit con la marca y que llama a la guardia', () => {
    const dir = hooksDir();
    const { target, backedUp } = installHook(dir);

    expect(target).toBe(path.join(dir, 'pre-commit'));
    expect(backedUp).toBeNull();
    const written = readFileSync(target, 'utf8');
    expect(written).toBe(PRE_COMMIT);
    expect(written).toContain(MARKER);
    expect(written).toContain('node scripts/check-secrets.mjs');
  });

  it('respeta un hook ajeno: lo respalda antes de reemplazarlo', () => {
    const dir = hooksDir();
    writeFileSync(path.join(dir, 'pre-commit'), '#!/bin/sh\necho ajeno\n');

    const { backedUp } = installHook(dir);

    expect(backedUp).toBe(path.join(dir, 'pre-commit.bak'));
    expect(readFileSync(backedUp as string, 'utf8')).toContain('echo ajeno');
    expect(readFileSync(path.join(dir, 'pre-commit'), 'utf8')).toContain(MARKER);
  });

  it('no pisa un respaldo que ya existe: falla y avisa', () => {
    const dir = hooksDir();
    writeFileSync(path.join(dir, 'pre-commit'), '#!/bin/sh\necho ajeno\n');
    writeFileSync(path.join(dir, 'pre-commit.bak'), '#!/bin/sh\necho otro\n');

    expect(() => installHook(dir)).toThrow(/ya hay un respaldo/);
  });

  it('reinstalar sobre el hook propio es idempotente y no crea respaldo', () => {
    const dir = hooksDir();
    installHook(dir);
    const { backedUp } = installHook(dir);

    expect(backedUp).toBeNull();
    expect(readFileSync(path.join(dir, 'pre-commit'), 'utf8')).toBe(PRE_COMMIT);
    expect(existsSync(path.join(dir, 'pre-commit.bak'))).toBe(false);
  });
});
