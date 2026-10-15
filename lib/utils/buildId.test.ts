/**
 * Tests del identificador de la build en la app.
 *
 * Acá se protege la parte silenciosa de todo el mecanismo: `/api/health` tiene
 * que devolver `null` cuando el despliegue no publica identificador, y un objeto
 * cuando sí. Un `{ id: '' }` en el medio haría que la comparación dijera
 * «coincide» sin haber comparado nada, que es exactamente el error que este
 * trabajo existe para evitar.
 *
 * El último bloque **ata este archivo con el script que escribe el valor**
 * (`scripts/build-id.mjs`): el formato está implementado dos veces —lo escribe el
 * release, lo lee la app— y sin una comprobación que los junte, la forma de
 * romperse es que cada lado siga andando por su cuenta.
 */
import { describe, expect, it } from 'vitest';

import { BUILD_ID_ENV, parseBuildIdValue } from '@/lib/utils/buildId';
import { formatBuildIdValue } from '../../scripts/build-id.mjs';

const ID = '4f2a3c4b5d6e7f80';
const SHA = '9d1c3ab77e5f1234567890abcdef1234567890ab';

describe('parseBuildIdValue', () => {
  it('traduce el valor del deployment a un objeto', () => {
    expect(parseBuildIdValue(`1.${ID}.${SHA}.1.1760361600`)).toEqual({
      id: ID,
      commit: SHA,
      dirty: true,
      builtAt: new Date(1760361600 * 1000).toISOString(),
    });
  });

  it('un árbol limpio se distingue de uno con cambios sin commitear', () => {
    expect(parseBuildIdValue(`1.${ID}.${SHA}.0.1760361600`)?.dirty).toBe(false);
  });

  it('sin commit publicado devuelve null en vez de una cadena falsa', () => {
    expect(parseBuildIdValue(`1.${ID}.-.0.1760361600`)).toMatchObject({ commit: null, dirty: false });
  });

  it('sin sello de tiempo no inventa una fecha', () => {
    expect(parseBuildIdValue(`1.${ID}.${SHA}.0.0`)?.builtAt).toBeNull();
  });

  it('lo que no es el formato devuelve null, sin adivinar', () => {
    // Cada caso es una forma real de romperse: la variable ausente, un valor de
    // otra versión del formato, un valor cortado, el `true` de un intento de
    // ponerlo a mano.
    const invalid: (string | null | undefined)[] = [
      null,
      undefined,
      '',
      '   ',
      'RIX7',
      `2.${ID}.${SHA}.0.1760361600`,
      `1.${ID}.${SHA}`,
      `1.${ID}.${SHA}.0`,
      '1..-.0.0',
      `1.${ID.toUpperCase()}.${SHA}.0.1`,
      `1.corto.${SHA}.0.1`,
    ];

    for (const raw of invalid) {
      expect(parseBuildIdValue(raw), String(raw)).toBeNull();
    }
  });

  it('la variable que lee la ruta es la que escribe el release', () => {
    expect(BUILD_ID_ENV).toBe('RIX7_BUILD');
  });
});

describe('el formato que escribe el release es el que lee la app', () => {
  it('ida y vuelta con el escritor de scripts/build-id.mjs', () => {
    const cases = [
      { id: ID, commit: SHA, dirty: true, builtAt: 1760361600 },
      { id: ID, commit: SHA, dirty: false, builtAt: 1760361600 },
      { id: 'abcdef0123456789', commit: null, dirty: true, builtAt: 1 },
      { id: ID, commit: SHA.toLowerCase(), dirty: false, builtAt: 0 },
    ];

    for (const build of cases) {
      const value = formatBuildIdValue(build);
      expect(value, JSON.stringify(build)).not.toBeNull();

      const parsed = parseBuildIdValue(value);
      expect(parsed, String(value)).not.toBeNull();
      expect(parsed?.id).toBe(build.id);
      expect(parsed?.commit).toBe(build.commit);
      expect(parsed?.dirty).toBe(build.dirty);
    }
  });
});
