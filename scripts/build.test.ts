/**
 * Tests del planificador del wrapper de build.
 *
 * Dos propiedades importan. La primera es que el wrapper sea **transparente**
 * sin `--port`: construye en `.next` (lo que esperan CI y Vercel), los argumentos
 * llegan intactos a `next build` y no mide por sorpresa. La segunda es que
 * `--port 3999` sea un solo comando completo: distDir y tsconfig del slot de ese
 * puerto (los mismos de `npm run dev`) y medición al terminar, sin repetir
 * `NEXT_DIST_DIR` ni el `--dir` del gate — que era justo lo que se prestaba a
 * construir en un directorio y medir en otro.
 */
import { describe, expect, it } from 'vitest';

import { parseBuildArgs, planBuildRun } from './build.mjs';
import {
  DEFAULT_DIST_DIR,
  slotDistDir,
  slotTsconfigPath,
  slotTsconfigSource,
} from './next-paths.mjs';

describe('parseBuildArgs', () => {
  it('recoge --port en sus tres formas', () => {
    expect(parseBuildArgs(['--port', '3999']).port).toBe('3999');
    expect(parseBuildArgs(['-p', '3999']).port).toBe('3999');
    expect(parseBuildArgs(['--port=3999']).port).toBe('3999');
  });

  it('sin --port no hay puerto', () => {
    expect(parseBuildArgs([]).port).toBeNull();
    expect(parseBuildArgs(['--measure']).port).toBeNull();
  });

  it('reconoce --measure y --no-measure', () => {
    expect(parseBuildArgs(['--measure']).measure).toBe(true);
    expect(parseBuildArgs(['--no-measure']).noMeasure).toBe(true);
  });

  it('reenvía a Next todo lo que no reconoce, en orden', () => {
    const args = parseBuildArgs(['--debug', '--port', '3999', '--profile']);
    expect(args.passthrough).toEqual(['--debug', '--profile']);
  });
});

describe('planBuildRun sin --port (CI y Vercel)', () => {
  it('usa el directorio compartido y no mide por sorpresa', () => {
    const plan = planBuildRun({ argv: [], env: {} });
    expect(plan.distDir).toBe(DEFAULT_DIST_DIR);
    expect(plan.measure).toBe(false);
    expect(plan.tsconfigPath).toBeNull();
  });

  it('un NEXT_DIST_DIR en blanco no cuenta como definido', () => {
    expect(planBuildRun({ argv: [], env: { NEXT_DIST_DIR: '   ' } }).distDir).toBe(DEFAULT_DIST_DIR);
  });

  it('respeta un NEXT_DIST_DIR y busca el tsconfig por convención', () => {
    const plan = planBuildRun({ argv: [], env: { NEXT_DIST_DIR: '.freebuff/rix7-next-3999' } });
    expect(plan.distDir).toBe('.freebuff/rix7-next-3999');
    expect(plan.tsconfigPath).toBe('.freebuff/rix7-next-3999.tsconfig.json');
    expect(plan.tsconfigPath?.startsWith(`${plan.distDir}/`)).toBe(false);
  });

  it('medir es opt-in: --measure sin puerto mide el distDir resuelto', () => {
    expect(planBuildRun({ argv: ['--measure'], env: {} }).measure).toBe(true);
  });

  it('reenvía a Next todas las opciones, en orden', () => {
    expect(planBuildRun({ argv: ['--debug', '--profile'], env: {} }).passthrough).toEqual([
      '--debug',
      '--profile',
    ]);
  });
});

describe('planBuildRun con --port (un solo comando)', () => {
  it('deriva distDir y tsconfig del slot del puerto', () => {
    const plan = planBuildRun({ argv: ['--port', '3999'], env: {} });
    expect(plan.port).toBe('3999');
    expect(plan.distDir).toBe(slotDistDir(3999));
    expect(plan.tsconfigPath).toBe(slotTsconfigPath(3999));
    expect(plan.error).toBeNull();
  });

  it('mide por defecto: construir y verificar en un paso', () => {
    expect(planBuildRun({ argv: ['--port', '3999'], env: {} }).measure).toBe(true);
  });

  it('--no-measure deja solo la build', () => {
    expect(planBuildRun({ argv: ['--port', '3999', '--no-measure'], env: {} }).measure).toBe(false);
  });

  it('no reenvía a Next los flags que consume', () => {
    expect(planBuildRun({ argv: ['--port', '3999', '--turbo'], env: {} }).passthrough).toEqual([
      '--turbo',
    ]);
  });

  it('el puerto manda sobre NEXT_DIST_DIR: es la vía explícita', () => {
    const plan = planBuildRun({
      argv: ['--port', '3999'],
      env: { NEXT_DIST_DIR: '.next-propio' },
    });
    expect(plan.distDir).toBe(slotDistDir(3999));
  });

  it('un puerto que no es número falla con un mensaje claro', () => {
    const plan = planBuildRun({ argv: ['--port', 'no-es-puerto'], env: {} });
    expect(plan.error).toContain('--port');
    expect(plan.error).toContain('puerto');
  });
});

describe('slotTsconfigSource', () => {
  it('sube los niveles del slot para heredar del tsconfig real', () => {
    const source = JSON.parse(
      slotTsconfigSource('.freebuff/rix7-next-3999.tsconfig.json', { root: process.cwd() })
    );
    expect(source.extends).toBe('../tsconfig.json');
  });
});
