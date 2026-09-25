import { describe, it, expect, vi } from 'vitest';
import { claimShareViewMarker, shareViewMarkerKey } from './shareViewPing';

/** `sessionStorage` de mentira, con la misma semántica que el de verdad. */
function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

describe('claimShareViewMarker', () => {
  it('la primera vez reclama la apertura', () => {
    expect(claimShareViewMarker(fakeStorage(), 'scl-depto-marco-polo')).toBe(true);
  });

  it('la segunda vez en la misma sesión ya no', () => {
    const storage = fakeStorage();

    expect(claimShareViewMarker(storage, 'scl-depto-marco-polo')).toBe(true);
    expect(claimShareViewMarker(storage, 'scl-depto-marco-polo')).toBe(false);
    expect(claimShareViewMarker(storage, 'scl-depto-marco-polo')).toBe(false);
  });

  it('cada propiedad se cuenta por separado', () => {
    const storage = fakeStorage();

    expect(claimShareViewMarker(storage, 'prop-1')).toBe(true);
    // Abrir otra propiedad en la misma pestaña es otra apertura.
    expect(claimShareViewMarker(storage, 'prop-2')).toBe(true);
    expect(claimShareViewMarker(storage, 'prop-1')).toBe(false);
  });

  it('marca antes de que el aviso salga', () => {
    const storage = fakeStorage();

    claimShareViewMarker(storage, 'p');
    expect(storage.getItem(shareViewMarkerKey('p'))).toBe('1');
  });

  it('sin almacenamiento cuenta igual: mejor de más que perderla', () => {
    expect(claimShareViewMarker(null, 'p')).toBe(true);
    expect(claimShareViewMarker(undefined, 'p')).toBe(true);
  });

  it('un almacenamiento que falla no impide contar', () => {
    // Modo privado estricto: leer lanza, escribir lanza.
    const storage = {
      getItem: vi.fn(() => {
        throw new Error('bloqueado');
      }),
      setItem: vi.fn(() => {
        throw new Error('bloqueado');
      }),
    };

    expect(claimShareViewMarker(storage, 'p')).toBe(true);
  });

  it('un valor vacío en el almacenamiento no cuenta como ya visto', () => {
    // `''` es un valor falsy: si alguien lo dejó ahí, la apertura se cuenta.
    const storage = fakeStorage({ [shareViewMarkerKey('p')]: '' });
    expect(claimShareViewMarker(storage, 'p')).toBe(true);
  });

  it('la clave lleva el id, para no mezclar propiedades', () => {
    expect(shareViewMarkerKey('abc')).toBe('rix7_share_view_abc');
    expect(shareViewMarkerKey('abc')).not.toBe(shareViewMarkerKey('abd'));
  });
});
