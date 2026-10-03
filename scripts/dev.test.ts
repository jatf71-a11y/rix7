/**
 * Tests del wrapper de dev.
 *
 * `planDevRun` es la decisión que hace que dos hilos no se pisen, así que se
 * prueba como función pura: sin arrancar ningún servidor. Lo importante no es
 * solo que cada puerto dé su carpeta, sino que las opciones que el wrapper no
 * entiende lleguen intactas a `next dev` — si se perdiera una opción de Next,
 * el wrapper pasaría de arreglo a estorbo.
 *
 * Y hay un caso que devuelve error a propósito: una ruta absoluta. Next une el
 * `distDir` a la raíz del proyecto, así que un absoluto no es «otro sitio», es
 * una ruta imposible (`C:\repo\C:\Users\…`) con la que el servidor muere con un
 * ENOENT ilegible. Mejor fallar acá, con el motivo escrito.
 */
import { describe, expect, it } from 'vitest';
import { isAbsolute, resolve } from 'node:path';

import { parseDevArgs, planDevRun, slotTsconfigSource } from './dev.mjs';
import { DEFAULT_DEV_PORT, slotDistDir, slotTsconfigPath } from './next-paths.mjs';

const ROOT = process.cwd();

describe('parseDevArgs', () => {
  it('sin argumentos usa el puerto documentado', () => {
    expect(parseDevArgs([], {}).port).toBe(String(DEFAULT_DEV_PORT));
  });

  it('acepta las tres formas de pedir un puerto', () => {
    expect(parseDevArgs(['--port', '3939'], {}).port).toBe('3939');
    expect(parseDevArgs(['-p', '3939'], {}).port).toBe('3939');
    expect(parseDevArgs(['--port=3939'], {}).port).toBe('3939');
  });

  it('PORT del entorno sirve de default', () => {
    expect(parseDevArgs([], { PORT: '4321' }).port).toBe('4321');
  });

  it('recoge --dist en sus dos formas', () => {
    expect(parseDevArgs(['--dist', '.next'], {}).dist).toBe('.next');
    expect(parseDevArgs(['--dist=.next'], {}).dist).toBe('.next');
  });

  it('reconoce --help', () => {
    expect(parseDevArgs(['--help'], {}).help).toBe(true);
    expect(parseDevArgs(['-h'], {}).help).toBe(true);
  });

  it('reenvía a Next todo lo que no reconoce, en orden', () => {
    const args = parseDevArgs(['--turbo', '--port', '3939', '--experimental-https'], {});
    expect(args.port).toBe('3939');
    expect(args.passthrough).toEqual(['--turbo', '--experimental-https']);
  });

  it('no deja que un argumento suelto se pierda', () => {
    expect(parseDevArgs(['algo'], {}).passthrough).toEqual(['algo']);
  });
});

describe('planDevRun', () => {
  it('sin nada: puerto por defecto y el slot que le corresponde', () => {
    const plan = planDevRun({ argv: [], env: {}, root: ROOT });
    expect(plan.port).toBe(String(DEFAULT_DEV_PORT));
    expect(plan.distDir).toBe(slotDistDir(DEFAULT_DEV_PORT));
    expect(plan.error).toBeNull();
  });

  it('dos hilos con puertos distintos no comparten distDir', () => {
    const a = planDevRun({ argv: ['--port', '3111'], env: {}, root: ROOT });
    const b = planDevRun({ argv: ['--port', '3939'], env: {}, root: ROOT });
    expect(a.distDir).not.toBe(b.distDir);
  });

  it('deja el distDir relativo: es lo que Next necesita', () => {
    expect(isAbsolute(planDevRun({ argv: ['--port', '3939'], env: {}, root: ROOT }).distDir)).toBe(
      false
    );
  });

  it('genera un tsconfig de slot, fuera del distDir que Next vacía al arrancar', () => {
    const plan = planDevRun({ argv: ['--port', '3939'], env: {}, root: ROOT });
    expect(plan.tsconfigPath).toBe(slotTsconfigPath('3939'));
    expect(plan.tsconfigPath?.startsWith(`${plan.distDir}/`)).toBe(false);
  });

  it('con el distDir compartido no genera nada: el tsconfig de la raíz ya sirve', () => {
    const plan = planDevRun({ argv: ['--dist', '.next'], env: {}, root: ROOT });
    expect(plan.tsconfigPath).toBeNull();
  });

  it('NEXT_DIST_DIR del entorno gana sobre el slot', () => {
    const plan = planDevRun({
      argv: ['--port', '3939'],
      env: { NEXT_DIST_DIR: '.next-propio' },
      root: ROOT,
    });
    expect(plan.distDir).toBe('.next-propio');
  });

  it('--dist gana sobre NEXT_DIST_DIR: es la vía explícita', () => {
    const plan = planDevRun({
      argv: ['--dist', '.next'],
      env: { NEXT_DIST_DIR: '.otra' },
      root: ROOT,
    });
    expect(plan.distDir).toBe('.next');
  });

  it('una ruta absoluta en --dist es un error explicado, no un ENOENT de Next', () => {
    const absolute = resolve(ROOT, 'fuera', 'del', 'repo');
    const plan = planDevRun({ argv: ['--dist', absolute], env: {}, root: ROOT });
    expect(plan.error).toContain('--dist');
    expect(plan.error).toContain('relativo');
    expect(plan.error).toContain(absolute);
  });

  it('una ruta absoluta en NEXT_DIST_DIR también se explica', () => {
    const plan = planDevRun({
      argv: [],
      env: { NEXT_DIST_DIR: resolve(ROOT, 'fuera') },
      root: ROOT,
    });
    expect(plan.error).toContain('NEXT_DIST_DIR');
  });

  it('--help se propaga para que nadie arranque un servidor por accidente', () => {
    expect(planDevRun({ argv: ['--help'], env: {}, root: ROOT }).help).toBe(true);
  });
});

describe('slotTsconfigSource', () => {
  const SLOT_TSCONFIG = '.freebuff/rix7-next-3939.tsconfig.json';
  const read = (path: string) => JSON.parse(slotTsconfigSource(path, { root: ROOT }));

  it('hereda del tsconfig real subiendo los niveles del slot', () => {
    const config = read(SLOT_TSCONFIG);
    expect(config.extends).toBe('../tsconfig.json');
    expect(config.include).toContain('../next-env.d.ts');
    expect(config.include).toContain('../**/*.ts');
    expect(config.include).toContain('../**/*.tsx');
    expect(config.exclude).toContain('../node_modules');
  });

  it('fija baseUrl absoluto a la raíz para que el alias `@/` siga resolviendo', () => {
    // Next resuelve un baseUrl relativo contra la raíz del proyecto y TypeScript
    // contra la carpeta del tsconfig: con un relativo, uno de los dos rompe y
    // todo `@/…` deja de encontrarse (el dev server responde 500).
    const { baseUrl } = read(SLOT_TSCONFIG).compilerOptions;
    expect(isAbsolute(baseUrl)).toBe(true);
    expect(baseUrl).toBe(resolve(ROOT));
  });

  it('la subida depende de la profundidad del archivo, no de un valor fijo', () => {
    expect(read('dev-tsconfig.json').extends).toBe('./tsconfig.json');
    expect(read('a/b/c.tsconfig.json').extends).toBe('../../tsconfig.json');
  });

  it('normaliza separadores de Windows en la ruta', () => {
    expect(read('.freebuff\\rix7-next-3939.tsconfig.json').extends).toBe('../tsconfig.json');
  });

  it('deja fuera los tipos generados del slot: dev y tsc miran los mismos archivos', () => {
    const config = read(SLOT_TSCONFIG);
    expect(config.exclude).toContain('../.freebuff');
    expect(config.include.some((p: string) => p.includes('.freebuff'))).toBe(false);
  });
});
