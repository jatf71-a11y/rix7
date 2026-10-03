/**
 * Tests del resolver de `distDir`.
 *
 * Lo que se protege acá es el **default**: `.next`. Todo lo demás es opcional
 * por diseño, pero si el resolver se equivocara con la ausencia de
 * `NEXT_DIST_DIR`, CI, Vercel y `deploy:prod` dejarían de encontrar la build y
 * el fallo aparecería recién en producción.
 *
 * Los slots, además, dependen de dos invariantes que viven en otros archivos:
 * que `.gitignore` ignore `.freebuff/` (si no, los artefactos de dev ensucian
 * `git status`) y que `deploy:prod` lo excluya de la copia (si no, viajan a
 * Vercel). Los tests los comprueban leyendo esos archivos: así, si alguien los
 * saca, la suite falla antes que el problema llegue a un commit.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import {
  DEFAULT_DEV_PORT,
  DEFAULT_DIST_DIR,
  SLOT_PREFIX,
  SLOT_ROOT,
  isDefaultDistDir,
  isRejectedDistDir,
  resolveDistDir,
  slotDistDir,
  slotKey,
  slotTsconfigPath,
} from './next-paths.mjs';

const ROOT = process.cwd();

describe('resolveDistDir', () => {
  it('sin NEXT_DIST_DIR usa `.next`, que es lo que esperan CI y Vercel', () => {
    expect(resolveDistDir({ root: ROOT, env: {} })).toBe(join(ROOT, DEFAULT_DIST_DIR));
    expect(DEFAULT_DIST_DIR).toBe('.next');
  });

  it('un valor en blanco no cuenta como definido', () => {
    expect(resolveDistDir({ root: ROOT, env: { NEXT_DIST_DIR: '   ' } })).toBe(
      join(ROOT, DEFAULT_DIST_DIR)
    );
  });

  it('un valor relativo se resuelve contra el repo', () => {
    expect(resolveDistDir({ root: ROOT, env: { NEXT_DIST_DIR: '.next-3939' } })).toBe(
      join(ROOT, '.next-3939')
    );
  });

  it('un valor absoluto se respeta tal cual (lo usa el gate con --dir)', () => {
    const absolute = resolve(ROOT, 'fuera', 'del', 'repo');
    expect(resolveDistDir({ root: ROOT, env: { NEXT_DIST_DIR: absolute } })).toBe(absolute);
  });

  it('ignora un NEXT_DIST_DIR que no es texto', () => {
    expect(resolveDistDir({ root: ROOT, env: { NEXT_DIST_DIR: undefined } })).toBe(
      join(ROOT, DEFAULT_DIST_DIR)
    );
  });
});

describe('slotKey', () => {
  it('deja intacto un puerto', () => {
    expect(slotKey(3939)).toBe('3939');
    expect(slotKey(' 3111 ')).toBe('3111');
  });

  it('cae al puerto por defecto si no hay slot', () => {
    expect(slotKey('')).toBe(String(DEFAULT_DEV_PORT));
    expect(slotKey(undefined)).toBe(String(DEFAULT_DEV_PORT));
    expect(DEFAULT_DEV_PORT).toBe(3000);
  });

  it('neutraliza separadores y espacios: un slot no puede armar una ruta', () => {
    expect(slotKey('a/b')).toBe('ab');
    expect(slotKey('..\\..\\etc')).toBe('....etc');
    expect(slotKey('riesgo / / peligro')).toBe('riesgopeligro');
  });
});

describe('slotDistDir', () => {
  it('es una ruta relativa: es lo único que Next acepta como distDir', () => {
    const dir = slotDistDir(3939);
    expect(isAbsolute(dir)).toBe(false);
    expect(dir).toBe(`${SLOT_ROOT}/${SLOT_PREFIX}3939`);
  });

  it('dos puertos distintos dan dos carpetas distintas', () => {
    expect(slotDistDir(3111)).not.toBe(slotDistDir(3939));
  });
});

describe('slotTsconfigPath', () => {
  it('va al lado del slot, no dentro: `next dev` vacía el distDir al arrancar', () => {
    // Escrito dentro del distDir, Next lo borraba antes de leerlo y el alias `@/`
    // dejaba de resolverse (500 en todas las rutas).
    const dist = slotDistDir(3939);
    const tsconfig = slotTsconfigPath(3939);
    expect(tsconfig.startsWith(`${dist}/`)).toBe(false);
    expect(tsconfig.startsWith(`${SLOT_ROOT}/`)).toBe(true);
  });

  it('cada slot tiene el suyo, para que dos hilos no escriban el mismo archivo', () => {
    expect(slotTsconfigPath(3111)).not.toBe(slotTsconfigPath(3939));
  });
});

describe('invariantes del sitio elegido para los slots', () => {
  it('git ignora la carpeta de slots (si no, ensuciaría `git status`)', () => {
    const gitignore = readFileSync(join(ROOT, '.gitignore'), 'utf8');
    expect(gitignore).toMatch(new RegExp(`^\\${SLOT_ROOT}/$`, 'm'));
  });

  it('el deploy no copia la carpeta de slots (si no, viajaría a Vercel)', () => {
    const deploy = readFileSync(join(ROOT, 'scripts', 'deploy-prod.mjs'), 'utf8');
    expect(deploy).toContain(`'${SLOT_ROOT}'`);
  });

  it('el typecheck ignora la carpeta de slots (si no, compilaría sus tipos generados)', () => {
    const tsconfig = readFileSync(join(ROOT, 'tsconfig.json'), 'utf8');
    expect(tsconfig).toContain(`"${SLOT_ROOT}"`);
  });

  it('el tsconfig de la raíz no acumula entradas de slot', () => {
    // Next mete `"<distDir>/types/…"` en el `include` de tsconfig.json cuando el
    // distDir no es `.next`; el wrapper lo desvía a un tsconfig dentro del slot.
    // Si esta aserción falla, un `npm run dev` en un slot ensució un archivo
    // versionado —y con dos hilos, se pisan entre sí.
    const tsconfig = readFileSync(join(ROOT, 'tsconfig.json'), 'utf8');
    expect(tsconfig).not.toContain(SLOT_PREFIX);
  });
});

describe('isRejectedDistDir', () => {
  it('rechaza lo absoluto, que es lo que Next convierte en una ruta imposible', () => {
    expect(isRejectedDistDir(resolve(ROOT, 'fuera', 'del', 'repo'))).toBe(true);
  });

  it('acepta lo relativo, incluido el default', () => {
    expect(isRejectedDistDir('.next')).toBe(false);
    expect(isRejectedDistDir(slotDistDir(3939))).toBe(false);
  });
});

describe('isDefaultDistDir', () => {
  it('reconoce el directorio compartido', () => {
    expect(isDefaultDistDir(join(ROOT, '.next'), { root: ROOT })).toBe(true);
  });

  it('un slot no es el directorio compartido', () => {
    expect(isDefaultDistDir(slotDistDir(3939), { root: ROOT })).toBe(false);
  });

  it('resuelve rutas relativas contra el repo, no contra el directorio de trabajo', () => {
    expect(isDefaultDistDir('.next', { root: ROOT })).toBe(true);
    expect(isDefaultDistDir('.freebuff/next-3939', { root: ROOT })).toBe(false);
  });
});
