/**
 * Tests del performance budget.
 *
 * Dos cosas se protegen acá. La primera es el agujero que dejó pasar un rojo
 * falso: `next dev` también escribe `app-build-manifest.json`, así que el gate
 * comparaba chunks de desarrollo —sin minificar y ya evictados— contra la línea
 * base de producción y marcaba como excedidas todas las rutas a la vez. Ahora
 * falla cerrado si falta `.next/BUILD_ID`. La segunda es el veredicto en sí:
 * que la tolerancia no se vuelva un colchón por accidente y que una ruta nueva
 * sin línea base nunca pase como verde.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';

import {
  DEFAULT_TOLERANCE_KB,
  evaluateBudget,
  inspectBuild,
  parseBudgetArgs,
  round,
} from './check-bundle-budget.mjs';

/** `exists` falso: responde «sí» a los archivos nombrados, por sufijo (sin depender del separador). */
const present =
  (...names: string[]) =>
  (path: string): boolean =>
    names.some((name) => path.endsWith(name));

describe('inspectBuild', () => {
  it('con manifest y BUILD_ID es una build de producción', () => {
    const result = inspectBuild({
      root: '/repo',
      exists: present('app-build-manifest.json', 'BUILD_ID'),
    });
    expect(result.production).toBe(true);
    expect(result.reason).toBe('production');
    expect(result.message).toBeNull();
  });

  it('sin manifest manda a correr el build', () => {
    const result = inspectBuild({ root: '/repo', exists: () => false });
    expect(result.production).toBe(false);
    expect(result.reason).toBe('sin-manifest');
    expect(result.message).toContain('app-build-manifest.json');
    expect(result.message).toContain('npm run build');
  });

  it('el manifest solo no alcanza: es el caso que antes pasaba por bueno', () => {
    // Este es exactamente el estado de un `.next` que acaba de usar el dev
    // server: el manifest existe y el script seguiría midiendo chunks de dev.
    const result = inspectBuild({ root: '/repo', exists: present('app-build-manifest.json') });
    expect(result.production).toBe(false);
    expect(result.reason).toBe('sin-build-id');
    expect(result.message).toContain('BUILD_ID');
    expect(result.message).toContain('next dev');
    expect(result.message).toContain('npm run build');
  });
});

describe('evaluateBudget', () => {
  const baseline = {
    sharedFirstLoadKb: 87.5,
    pages: { '/': 206.3, '/properties/[id]': 184.3 },
    toleranceKb: 5,
  };

  it('dentro de la tolerancia no reporta nada', () => {
    const result = evaluateBudget({
      computed: { '/': 209, '/properties/[id]': 186 },
      sharedKb: 90,
      baseline,
    });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('una ruta que crece más allá de la tolerancia se nombra con sus números', () => {
    const result = evaluateBudget({
      computed: { '/': 209, '/properties/[id]': 200 },
      sharedKb: 90,
      baseline,
    });
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toContain('/properties/[id]');
    expect(result.violations[0]).toContain('200 kB');
    expect(result.violations[0]).toContain('184.3 kB');
  });

  it('el First Load compartido también es un techo', () => {
    const result = evaluateBudget({
      computed: { '/': 209, '/properties/[id]': 186 },
      sharedKb: 93,
      baseline,
    });
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toContain('compartido');
    expect(result.violations[0]).toContain('93 kB');
  });

  it('una ruta nueva sin línea base nunca pasa como verde', () => {
    const result = evaluateBudget({
      computed: { '/': 209, '/properties/[id]': 186, '/nueva': 20 },
      sharedKb: 90,
      baseline,
    });
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toContain('nueva ruta sin línea base');
    expect(result.violations[0]).toContain('/nueva');
  });

  it('una ruta justo en el límite (techo + tolerancia) pasa', () => {
    const result = evaluateBudget({
      computed: { '/': 211.3 },
      sharedKb: 92.5,
      baseline: { sharedFirstLoadKb: 87.5, pages: { '/': 206.3 }, toleranceKb: 5 },
    });
    expect(result.ok).toBe(true);
  });

  it('sin toleranceKb en la línea base usa la tolerancia por defecto', () => {
    const { toleranceKb, ...sinTolerancia } = baseline;
    expect(toleranceKb).toBe(DEFAULT_TOLERANCE_KB);

    const medida = { computed: { '/': 105.5 }, sharedKb: 87.5 };
    const linea = { ...sinTolerancia, pages: { '/': 100 } };
    // 105.5 supera por 5.5 kB: con la tolerancia por defecto (5) no pasa…
    expect(evaluateBudget({ ...medida, baseline: linea }).ok).toBe(false);
    // …y con una tolerancia explícita de 6, sí: el parámetro manda sobre la línea base.
    expect(evaluateBudget({ ...medida, baseline: linea, tolerance: 6 }).ok).toBe(true);
  });
});

describe('inspectBuild con un distDir explícito', () => {
  it('busca el manifest y el BUILD_ID dentro del distDir indicado', () => {
    const distDir = join('/repo', '.next-slot');
    const seen: string[] = [];
    inspectBuild({
      root: '/repo',
      distDir,
      exists: (path: string) => {
        seen.push(path);
        return false;
      },
    });
    // El primer sondeo es el manifest de ESTE distDir, no el `.next` del root:
    // medir el directorio equivocado es exactamente lo que el guard evita.
    expect(seen[0]).toBe(join(distDir, 'app-build-manifest.json'));
  });

  it('nombra la carpeta ajena en el mensaje, para saber cuál se midió', () => {
    const distDir = join('/tmp', 'rix7-next-3939');
    const result = inspectBuild({ root: '/repo', distDir, exists: () => false });
    expect(result.message).toContain(distDir);
    expect(result.message).toContain('app-build-manifest.json');
  });
});

describe('parseBudgetArgs', () => {
  it('reconoce --update', () => {
    expect(parseBudgetArgs(['--update']).update).toBe(true);
    expect(parseBudgetArgs([]).update).toBe(false);
  });

  it('recoge --dir en sus dos formas', () => {
    expect(parseBudgetArgs(['--dir', '.next-slot']).dist).toBe('.next-slot');
    expect(parseBudgetArgs(['--dir=.next-slot']).dist).toBe('.next-slot');
  });

  it('sin --dir no hay distDir explícito', () => {
    expect(parseBudgetArgs(['--update']).dist).toBeUndefined();
  });
});

describe('round', () => {
  it('redondea a una décima como la tabla de Next', () => {
    expect(round(89.64)).toBe(89.6);
    expect(round(1.25)).toBe(1.3);
    expect(round(184.3)).toBe(184.3);
  });
});
