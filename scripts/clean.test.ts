/**
 * Tests del planificador de limpieza.
 *
 * Lo que se protege es la regla que evita romper trabajo ajeno: una limpieza
 * nunca puede borrar el distDir (ni el tsconfig) de una sesión viva. Con varios
 * hilos en el mismo checkout, un `npm run clean` inocente borrando el slot de
 * otro dev server sería exactamente el tipo de accidente silencioso que este
 * proyecto intenta no tener.
 */
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';

import {
  CLEAN_TARGETS,
  DEEP_TARGET,
  TYPE_CACHE_TARGET,
  formatCleanReport,
  humanSize,
  isLivePath,
  parseCleanArgs,
  planClean,
  slotArtifactNames,
} from './clean.mjs';

const ROOT = process.cwd();

function fakeFs(present: string[], slotNames: string[] = []) {
  // Los slots viven dentro de `.freebuff/`, así que también existen como ruta.
  const paths = [...present, ...slotNames.map((name) => `.freebuff/${name}`)];
  const set = new Set(paths.map((p) => resolve(ROOT, p)));
  return {
    exists: (path: string) => set.has(resolve(ROOT, path)),
    list: (path: string) => (resolve(ROOT, path) === resolve(ROOT, '.freebuff') ? slotNames : []),
  };
}

describe('parseCleanArgs', () => {
  it('sin argumentos no borra node_modules ni fuerza', () => {
    expect(parseCleanArgs([])).toEqual({ dryRun: false, deep: false, force: false, help: false });
  });

  it('reconoce --dry-run, --deep, --force y --help', () => {
    expect(parseCleanArgs(['--dry-run']).dryRun).toBe(true);
    expect(parseCleanArgs(['--deep']).deep).toBe(true);
    expect(parseCleanArgs(['--force']).force).toBe(true);
    expect(parseCleanArgs(['--help']).help).toBe(true);
  });
});

describe('slotArtifactNames', () => {
  it('reconoce carpetas de slot y sus tsconfigs', () => {
    expect(
      slotArtifactNames(['rix7-next-3111', 'rix7-next-3111.tsconfig.json', 'slots.json', 'run.md'])
    ).toEqual(['rix7-next-3111', 'rix7-next-3111.tsconfig.json']);
  });

  it('no confunde otros archivos de estado local', () => {
    expect(slotArtifactNames(['slots.json', 'dev-server.log'])).toEqual([]);
  });
});

describe('isLivePath', () => {
  const live = [{ distDir: '.freebuff/rix7-next-3111' }];

  it('reconoce el distDir vivo y su tsconfig', () => {
    expect(isLivePath(resolve(ROOT, '.freebuff/rix7-next-3111'), { root: ROOT, live })).toBe(true);
    expect(
      isLivePath(resolve(ROOT, '.freebuff/rix7-next-3111.tsconfig.json'), { root: ROOT, live })
    ).toBe(true);
  });

  it('no protege un slot distinto', () => {
    expect(isLivePath(resolve(ROOT, '.freebuff/rix7-next-3999'), { root: ROOT, live })).toBe(false);
  });
});

describe('planClean', () => {
  it('borra los artefactos presentes y descubre los slots', () => {
    const fs = fakeFs(
      ['.next', '.build-check', 'tsconfig.tsbuildinfo', '.freebuff'],
      ['rix7-next-3939', 'rix7-next-3939.tsconfig.json', 'slots.json']
    );

    const { targets } = planClean({ root: ROOT, ...fs });
    expect(targets).toContain('.next');
    // La caché del typecheck se conserva: borrarla encarece el próximo `tsc`.
    expect(targets).not.toContain(TYPE_CACHE_TARGET);
    expect(targets).toContain('.freebuff/rix7-next-3939');
    expect(targets).toContain('.freebuff/rix7-next-3939.tsconfig.json');
    // `slots.json` no es un slot: no se borra por accidente.
    expect(targets).not.toContain('.freebuff/slots.json');
  });

  it('omite el slot de una sesión viva y lo reporta', () => {
    const fs = fakeFs(
      ['.next', '.freebuff'],
      ['rix7-next-3111', 'rix7-next-3111.tsconfig.json', 'rix7-next-3999']
    );

    const { targets, blocked } = planClean({
      root: ROOT,
      ...fs,
      live: [{ distDir: '.freebuff/rix7-next-3111' }],
    });

    expect(blocked).toEqual(['.freebuff/rix7-next-3111', '.freebuff/rix7-next-3111.tsconfig.json']);
    expect(targets).not.toContain('.freebuff/rix7-next-3111');
    expect(targets).toContain('.freebuff/rix7-next-3999');
    expect(targets).toContain('.next');
  });

  it('con --force incluye los slots vivos', () => {
    const fs = fakeFs(['.freebuff'], ['rix7-next-3111']);
    const { targets, blocked } = planClean({
      root: ROOT,
      ...fs,
      live: [{ distDir: '.freebuff/rix7-next-3111' }],
      force: true,
    });
    expect(blocked).toEqual([]);
    expect(targets).toContain('.freebuff/rix7-next-3111');
  });

  it('sin --deep no toca node_modules; con --deep sí', () => {
    const fs = fakeFs(['node_modules', ...CLEAN_TARGETS]);
    expect(planClean({ root: ROOT, ...fs }).targets).not.toContain(DEEP_TARGET);
    expect(planClean({ root: ROOT, ...fs, deep: true }).targets).toContain(DEEP_TARGET);
  });

  it('la caché de tipos solo cae con --deep: en el uso diario se conserva', () => {
    const fs = fakeFs([TYPE_CACHE_TARGET]);
    expect(planClean({ root: ROOT, ...fs }).targets).not.toContain(TYPE_CACHE_TARGET);
    expect(planClean({ root: ROOT, ...fs, deep: true }).targets).toContain(TYPE_CACHE_TARGET);
  });

  it('ignora lo que no existe', () => {
    const { targets } = planClean({ root: ROOT, exists: () => false, list: () => [] });
    expect(targets).toEqual([]);
  });
});

describe('humanSize', () => {
  it('usa la unidad adecuada', () => {
    expect(humanSize(0)).toBe('0 B');
    expect(humanSize(512)).toBe('512 B');
    expect(humanSize(2048)).toBe('2 KB');
    expect(humanSize(1536 * 1024)).toBe('1.5 MB');
    expect(humanSize(3 * 1024 ** 3)).toBe('3 GB');
  });

  it('no se rompe con valores inválidos', () => {
    expect(humanSize(Number.NaN)).toBe('0 B');
    expect(humanSize(-10)).toBe('0 B');
  });
});

describe('formatCleanReport', () => {
  it('cambia el verbo según sea dry-run', () => {
    expect(formatCleanReport({ targets: ['.next'], blocked: [], bytes: 100, dryRun: true })).toContain(
      'Se borrarían'
    );
    expect(formatCleanReport({ targets: ['.next'], blocked: [], bytes: 100, dryRun: false })).toContain(
      'Se borraron'
    );
  });

  it('dice explícitamente cuando no hay nada', () => {
    expect(formatCleanReport({ targets: [], blocked: [], bytes: 0, dryRun: false })).toContain(
      'No hay nada que limpiar'
    );
  });

  it('explica las rutas omitidas por sesión viva', () => {
    const text = formatCleanReport({
      targets: ['.next'],
      blocked: ['.freebuff/rix7-next-3111'],
      bytes: 10,
      dryRun: false,
    });
    expect(text).toContain('sesión viva');
    expect(text).toContain('rix7-next-3111');
  });
});
