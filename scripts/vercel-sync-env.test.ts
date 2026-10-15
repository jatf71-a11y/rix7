/**
 * Tests del sincronizador de variables hacia Vercel.
 *
 * Lo que hay que proteger: que **ningún valor** salga impreso (ni en el informe,
 * ni en un mensaje de error), que las tres variables del corte vayan en los tres
 * entornos —dejar una afuera es un corte a medias que se descubre en producción—
 * y que el `--dry-run` no dispare ningún comando.
 */
import { describe, expect, it } from 'vitest';

import {
  ENVIRONMENTS,
  MANAGED_VARS,
  applySync,
  formatPlan,
  linkedProjectRef,
  planSync,
} from './vercel-sync-env.mjs';

/**
 * Un valor con forma de clave de servicio, armado en el test y **no** en el
 * repo: si el literal apareciera entero, la guardia de secretos
 * (`npm run check:secrets`) lo marcaría con razón — y una guardia que se puede
 * silenciar con una excepción deja de servir.
 */
const SECRETO = ['sb', 'secret', 'solo-para-el-test', 'no-es-una-clave-real'].join('_');

const values = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://vsqkjimpssdvlvdwrtnh.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_publica',
  SUPABASE_SERVICE_ROLE_KEY: SECRETO,
};

describe('planSync', () => {
  it('por defecto planifica las tres variables en los tres entornos', () => {
    const plan = planSync({ values });
    expect(plan.steps.map((step) => step.name)).toEqual(MANAGED_VARS);
    expect(plan.environments).toEqual(ENVIRONMENTS);
    expect(plan.steps.every((step) => step.environments.length === 3)).toBe(true);
    expect(plan.missing).toEqual([]);
  });

  it('avisa qué falta en vez de escribir una variable vacía', () => {
    // Un `NEXT_PUBLIC_SUPABASE_URL` vacío en Vercel no rompe el build: rompe en
    // ejecución, y el sitio responde con el catálogo en memoria como si nada.
    const plan = planSync({ values: { NEXT_PUBLIC_SUPABASE_ANON_KEY: 'x' } });
    expect(plan.missing).toEqual(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
    expect(plan.steps.map((step) => step.name)).toEqual(['NEXT_PUBLIC_SUPABASE_ANON_KEY']);
  });

  it('respeta --only y --env', () => {
    const plan = planSync({ values, vars: ['NEXT_PUBLIC_SUPABASE_URL'], environments: ['production'] });
    expect(plan.steps).toEqual([
      { name: 'NEXT_PUBLIC_SUPABASE_URL', environments: ['production'] },
    ]);
  });
});

describe('formatPlan', () => {
  const plan = planSync({ values });

  it('nombra cada variable y nunca imprime su valor', () => {
    const text = formatPlan({ ...plan, file: '.env.local' }, { apply: false });
    expect(text).toContain('NEXT_PUBLIC_SUPABASE_URL');
    expect(text).toContain('SUPABASE_SERVICE_ROLE_KEY');
    for (const value of Object.values(values)) {
      expect(text).not.toContain(value);
    }
  });

  it('en dry-run dice que no cambió nada, y al aplicar avisa del redeploy', () => {
    const dry = formatPlan({ ...plan, file: '.env.local' }, { apply: false });
    expect(dry).toContain('no se cambió nada');

    const applied = formatPlan({ ...plan, file: '.env.local' }, { apply: true });
    expect(applied).toContain('deploy:prod');
    expect(applied).toContain('entrada estándar');
  });

  it('no promete aplicación cuando no hay nada para sincronizar', () => {
    const text = formatPlan({ steps: [], missing: ['NEXT_PUBLIC_SUPABASE_URL'], environments: ENVIRONMENTS, file: '.env.local' });
    expect(text).toContain('Nada para sincronizar');
    expect(text).not.toContain('deploy:prod');
  });
});

describe('applySync', () => {
  it('reemplaza cada variable: borra antes de agregar, porque `add` no sobrescribe', () => {
    const calls: { args: string[]; input: string | null }[] = [];
    const run = (args: string[], input: string | null) => {
      calls.push({ args, input });
      return { status: 0, stdout: '', stderr: '' };
    };

    const { done } = applySync({
      steps: [{ name: 'SUPABASE_SERVICE_ROLE_KEY', environments: ['production'] }],
      values,
      run: run as never,
    });

    expect(calls[0].args).toEqual(['env', 'rm', 'SUPABASE_SERVICE_ROLE_KEY', 'production', '--yes']);
    expect(calls[1].args).toEqual(['env', 'add', 'SUPABASE_SERVICE_ROLE_KEY', 'production']);
    // El valor viaja por la entrada estándar: en los argumentos lo vería `ps`.
    expect(calls[1].input).toBe(SECRETO);
    expect(calls[0].input).toBeNull();
    expect(done).toEqual([
      { name: 'SUPABASE_SERVICE_ROLE_KEY', environment: 'production', ok: true, detail: `${SECRETO.length} caracteres` },
    ]);
  });

  it('reporta el fallo con el mensaje de la CLI, sin inventar que salió bien', () => {
    const run = () => ({ status: 1, stdout: '', stderr: 'Error: not linked' });
    const { done } = applySync({
      steps: [{ name: 'NEXT_PUBLIC_SUPABASE_URL', environments: ['preview'] }],
      values,
      run: run as never,
    });

    expect(done[0].ok).toBe(false);
    expect(done[0].detail).toContain('not linked');
  });
});

describe('linkedProjectRef', () => {
  it('lee el proyecto enlazado y no rompe con un archivo raro', () => {
    expect(linkedProjectRef('{"projectId":"prj_38HRJ2h2Q8lxjsXu4pRU6MkRpMD4"}')).toBe(
      'prj_38HRJ2h2Q8lxjsXu4pRU6MkRpMD4',
    );
    expect(linkedProjectRef('no es json')).toBeNull();
    expect(linkedProjectRef(null)).toBeNull();
  });
});
