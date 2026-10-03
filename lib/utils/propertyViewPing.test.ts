import { describe, it, expect, vi } from 'vitest';
import { claimPropertyViewMarker, propertyViewMarkerKey } from './propertyViewPing';

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

describe('claimPropertyViewMarker', () => {
  it('la primera vez reclama la visita', () => {
    expect(claimPropertyViewMarker(fakeStorage(), 'scl-depto-marco-polo')).toBe(true);
  });

  it('recargar la ficha en la misma sesión no vuelve a contar', () => {
    const storage = fakeStorage();

    expect(claimPropertyViewMarker(storage, 'p')).toBe(true);
    expect(claimPropertyViewMarker(storage, 'p')).toBe(false);
  });

  it('cada propiedad se cuenta por separado', () => {
    const storage = fakeStorage();

    expect(claimPropertyViewMarker(storage, 'p1')).toBe(true);
    expect(claimPropertyViewMarker(storage, 'p2')).toBe(true);
    expect(claimPropertyViewMarker(storage, 'p1')).toBe(false);
  });

  it('sin almacenamiento cuenta igual: mejor de más que perderla', () => {
    expect(claimPropertyViewMarker(null, 'p')).toBe(true);
    expect(claimPropertyViewMarker(undefined, 'p')).toBe(true);
  });

  it('un almacenamiento que falla no impide contar', () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error('bloqueado');
      }),
      setItem: vi.fn(() => {
        throw new Error('bloqueado');
      }),
    };

    expect(claimPropertyViewMarker(storage, 'p')).toBe(true);
  });

  it('la clave lleva el id y no coincide con la de enlaces compartidos', () => {
    expect(propertyViewMarkerKey('abc')).toBe('rix7_property_view_abc');
    expect(propertyViewMarkerKey('abc')).not.toBe(propertyViewMarkerKey('abd'));
  });
});
