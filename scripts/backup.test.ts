/**
 * Tests del planificador de backup.
 *
 * Lo que se protege son las dos decisiones con consecuencias irreversibles:
 * elegir la carpeta destino correcta (refrescar el BACKUP equivocado con /MIR
 * borra su contenido) y no permitir un destino dentro del origen (eso borraría
 * el proyecto desde dentro de sí mismo). El manifiesto se prueba como contrato
 * de verificación: parsea, compara y detecta faltantes, distintos y extras.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  BACKUP_DIR_PATTERN,
  EXCLUDED_DIRS,
  buildRestauracionMd,
  compareManifests,
  formatManifestLine,
  isExcludedDir,
  isExcludedFile,
  isInside,
  listFiles,
  parseBackupArgs,
  parseManifest,
  resolveBackupDir,
} from './backup.mjs';

describe('parseBackupArgs', () => {
  it('sin argumentos no tiene destino ni ayuda', () => {
    expect(parseBackupArgs([])).toEqual({ dest: null, help: false });
  });

  it('acepta la ruta destino como argumento posicional', () => {
    expect(parseBackupArgs(['C:\\backups\\BACKUP11.0']).dest).toBe('C:\\backups\\BACKUP11.0');
  });

  it('reconoce --help', () => {
    expect(parseBackupArgs(['--help']).help).toBe(true);
    expect(parseBackupArgs(['-h']).help).toBe(true);
  });

  it('con destino y --help devuelve ambos', () => {
    expect(parseBackupArgs(['D:\\b', '--help'])).toEqual({ dest: 'D:\\b', help: true });
  });
});

describe('resolveBackupDir', () => {
  const base = 'C:/backups';

  it('la ruta explícita gana siempre', () => {
    const chosen = resolveBackupDir({
      base,
      explicit: 'C:/otra',
      entries: [{ name: 'BACKUP9.0', mtimeMs: 200 }],
    });
    expect(chosen).toBe('C:/otra');
  });

  it('sin destino explícito elige la carpeta BACKUP más reciente', () => {
    const chosen = resolveBackupDir({
      base,
      explicit: null,
      entries: [
        { name: 'BACKUP9.0', mtimeMs: 100 },
        { name: 'BACKUP10.0', mtimeMs: 300 },
        { name: 'BACKUP8.2.d.FICHA', mtimeMs: 50 },
      ],
    });
    // Por fecha, no por nombre: 10.0 es lexicalmente menor que 8.2 pero más nueva.
    expect(chosen).toBe(join(base, 'BACKUP10.0'));
  });

  it('ignora carpetas que no son BACKUP', () => {
    const chosen = resolveBackupDir({
      base,
      explicit: null,
      entries: [{ name: 'DEEPSEEK', mtimeMs: 999 }],
    });
    expect(chosen).toBeNull();
  });

  it('devuelve null cuando la base está vacía o no existe', () => {
    expect(resolveBackupDir({ base, explicit: null, entries: [] })).toBeNull();
  });
});

describe('isInside', () => {
  const ROOT = resolve('C:/Users/javie/RIX7');

  it('una ruta dentro del origen es rechazable', () => {
    expect(isInside(resolve('C:/Users/javie/RIX7/copia'), ROOT)).toBe(true);
  });

  it('la propia raíz cuenta como dentro (destino = origen sería suicidio)', () => {
    expect(isInside(ROOT, ROOT)).toBe(true);
  });

  it('un destino hermano está permitido', () => {
    expect(isInside(resolve('C:/Users/javie/otra'), ROOT)).toBe(false);
  });

  it('un nombre de carpeta que solo empieza igual no está dentro', () => {
    expect(isInside(resolve('C:/Users/javie/RIX7-copia'), ROOT)).toBe(false);
  });
});

describe('isExcludedDir', () => {
  it('excluye lo regenerable y las copias del .git', () => {
    for (const name of ['.git', ...EXCLUDED_DIRS, '.git.backup-20260928-134559']) {
      expect(isExcludedDir(name)).toBe(true);
    }
  });

  it('no excluye carpetas del proyecto', () => {
    for (const name of ['app', 'lib', 'scripts', 'supabase', 'docs']) {
      expect(isExcludedDir(name)).toBe(false);
    }
  });
});

describe('isExcludedFile', () => {
  it('excluye la caché del typecheck en cualquier nivel', () => {
    expect(isExcludedFile('tsconfig.tsbuildinfo')).toBe(true);
    expect(isExcludedFile('sub/careta/tsconfig.tsbuildinfo')).toBe(true);
  });

  it('no excluye archivos normales del proyecto', () => {
    expect(isExcludedFile('tsconfig.json')).toBe(false);
    expect(isExcludedFile('app/page.tsx')).toBe(false);
  });
});

describe('BACKUP_DIR_PATTERN', () => {
  it('reconoce la convención BACKUP* sin importar mayúsculas', () => {
    expect(BACKUP_DIR_PATTERN.test('BACKUP10.0')).toBe(true);
    expect(BACKUP_DIR_PATTERN.test('backup-prueba')).toBe(true);
  });

  it('no confunde otras carpetas de la misma base', () => {
    expect(BACKUP_DIR_PATTERN.test('DEEPSEEK')).toBe(false);
  });
});

describe('manifiesto', () => {
  it('format y parse son inversos', () => {
    const line = formatManifestLine('app/page.tsx', 'a'.repeat(32));
    expect(line).toBe(`${'a'.repeat(32)} *./app/page.tsx`);
    const parsed = parseManifest(`${line}\n`);
    expect(parsed.get('app/page.tsx')).toBe('a'.repeat(32));
  });

  it('ignora líneas que no son entradas válidas', () => {
    expect(parseManifest('basura\notra línea\n').size).toBe(0);
  });

  it('una copia idéntica compara ok', () => {
    const m = parseManifest(`${'b'.repeat(32)} *./lib/a.ts\n`);
    expect(compareManifests(m, new Map(m))).toEqual({ ok: true, missing: [], extra: [], changed: [] });
  });

  it('detecta faltantes, distintos y extras por separado', () => {
    const expected = new Map([
      ['solo-en-origen.ts', '1'.repeat(32)],
      ['distinto.ts', '2'.repeat(32)],
    ]);
    const observed = new Map([
      ['distinto.ts', 'f'.repeat(32)],
      ['solo-en-copia.ts', '3'.repeat(32)],
    ]);
    const diff = compareManifests(expected, observed);
    expect(diff.ok).toBe(false);
    expect(diff.missing).toEqual(['solo-en-origen.ts']);
    expect(diff.changed).toEqual(['distinto.ts']);
    expect(diff.extra).toEqual(['solo-en-copia.ts']);
  });
});

describe('listFiles', () => {
  it('lista el árbol saltando .git y las exclusiones, y aplica skipFile', () => {
    const root = mkdtempSync(join(tmpdir(), 'backup-test-'));
    try {
      mkdirSync(join(root, '.git', 'objects'), { recursive: true });
      mkdirSync(join(root, 'node_modules', 'paquete'), { recursive: true });
      mkdirSync(join(root, '.git.backup-viejo'), { recursive: true });
      mkdirSync(join(root, 'app'), { recursive: true });
      writeFileSync(join(root, '.git', 'HEAD'), 'ref');
      writeFileSync(join(root, 'node_modules', 'paquete', 'index.js'), 'x');
      writeFileSync(join(root, '.git.backup-viejo', 'objeto'), 'x');
      writeFileSync(join(root, 'app', 'page.tsx'), 'export default {}');
      writeFileSync(join(root, 'README.md'), '# hola');
      writeFileSync(join(root, 'MANIFIESTO.md5'), 'generado');

      const files = listFiles(root, '', (rel) => rel === 'MANIFIESTO.md5');
      expect(files.sort()).toEqual(['README.md', 'app/page.tsx']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('buildRestauracionMd', () => {
  it('documenta el HEAD, la fecha y el contenido calculado', () => {
    const text = buildRestauracionMd({ date: '2026-10-09', head: 'be87269', files: 353, bytesMb: 84 });
    expect(text).toContain('be87269');
    expect(text).toContain('2026-10-09');
    expect(text).toContain('353 archivos');
    expect(text).toContain('npm ci');
    expect(text).toContain('md5sum -c MANIFIESTO.md5');
  });
});
