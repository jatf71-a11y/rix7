import { describe, it, expect } from 'vitest';
import {
  FAVORITES_STORAGE_KEY,
  MAX_FAVORITES,
  decideLocalFavoritesMigration,
  isFavoritesLimitReached,
  normalizePropertyId,
  normalizePropertyIds,
  parseLocalFavorites,
  rowsToPropertyIds,
} from './favorites';

describe('normalizePropertyId', () => {
  it('acepta los ids del catálogo', () => {
    expect(normalizePropertyId('scl-depto-marco-polo')).toBe('scl-depto-marco-polo');
    expect(normalizePropertyId('  vit-casa-1  ')).toBe('vit-casa-1');
    expect(normalizePropertyId('a1b2.c3_d4')).toBe('a1b2.c3_d4');
  });

  it('rechaza lo que no es un id', () => {
    for (const value of [null, undefined, 42, '', '   ', {}, [], true]) {
      expect(normalizePropertyId(value)).toBeNull();
    }
  });

  it('rechaza un id con caracteres raros o demasiado largo', () => {
    expect(normalizePropertyId('scl/../../etc/passwd')).toBeNull();
    expect(normalizePropertyId("scl' OR 1=1")).toBeNull();
    expect(normalizePropertyId('a'.repeat(81))).toBeNull();
  });
});

describe('normalizePropertyIds', () => {
  it('descarta lo inválido y elimina duplicados conservando el orden', () => {
    expect(normalizePropertyIds(['b', 'a', 'b', null, 'a/b', 'c'])).toEqual(['b', 'a', 'c']);
  });

  it('con algo que no es lista devuelve vacío', () => {
    expect(normalizePropertyIds('no-soy-una-lista')).toEqual([]);
    expect(normalizePropertyIds(null)).toEqual([]);
  });
});

describe('parseLocalFavorites', () => {
  it('lee lo que dejó la versión anterior de la web', () => {
    expect(parseLocalFavorites('["scl-depto-marco-polo","vit-casa-1"]')).toEqual([
      'scl-depto-marco-polo',
      'vit-casa-1',
    ]);
  });

  it('con JSON roto devuelve vacío en vez de romper la ficha', () => {
    // Antes esto era un `JSON.parse` sin protección en el componente: un valor
    // corrupto tiraba la página entera.
    expect(parseLocalFavorites('{no es json')).toEqual([]);
    expect(parseLocalFavorites('null')).toEqual([]);
    expect(parseLocalFavorites('')).toEqual([]);
  });

  it('descarta lo que no sea una lista de ids válidos', () => {
    expect(parseLocalFavorites('{"a":1}')).toEqual([]);
    expect(parseLocalFavorites('["ok",123,"mal/id"]')).toEqual(['ok']);
  });
});

describe('rowsToPropertyIds', () => {
  it('mapea las filas y quita repetidos', () => {
    expect(
      rowsToPropertyIds([
        { property_id: 'nueva' },
        { property_id: 'vieja' },
        { property_id: 'nueva' },
        { property_id: null },
      ])
    ).toEqual(['nueva', 'vieja']);
  });
});

describe('decideLocalFavoritesMigration', () => {
  it('con la cuenta vacía sube lo del dispositivo: entrar no borra nada', () => {
    expect(decideLocalFavoritesMigration([], ['a', 'b'])).toEqual({
      action: 'import',
      ids: ['a', 'b'],
    });
  });

  it('con la cuenta llena lo del dispositivo se ignora, para no resucitar lo borrado', () => {
    // Caso real: en el computador se quitó un favorito; si al entrar desde el
    // celular se reimportara lo local, volvería a aparecer marcado.
    expect(decideLocalFavoritesMigration(['x'], ['a', 'b'])).toEqual({ action: 'ignore' });
  });

  it('sin nada en ninguno de los dos lados no hace nada', () => {
    expect(decideLocalFavoritesMigration([], [])).toEqual({ action: 'none' });
  });

  it('la importación no supera el tope de la cuenta', () => {
    const muchos = Array.from({ length: MAX_FAVORITES + 50 }, (_, i) => `p${i}`);
    const decision = decideLocalFavoritesMigration([], muchos);

    expect(decision.action).toBe('import');
    expect(decision.action === 'import' && decision.ids).toHaveLength(MAX_FAVORITES);
  });
});

describe('isFavoritesLimitReached', () => {
  it('avisa justo en el tope', () => {
    expect(isFavoritesLimitReached([])).toBe(false);
    expect(isFavoritesLimitReached(Array.from({ length: MAX_FAVORITES - 1 }, () => 'x'))).toBe(false);
    expect(isFavoritesLimitReached(Array.from({ length: MAX_FAVORITES }, () => 'x'))).toBe(true);
  });
});

describe('clave de localStorage', () => {
  it('se conserva la histórica: cambiarla perdería los favoritos ya guardados', () => {
    expect(FAVORITES_STORAGE_KEY).toBe('rix7_favorites');
  });
});
