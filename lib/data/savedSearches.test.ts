import { describe, it, expect } from 'vitest';
import {
  EMPTY_SAVED_SEARCH_FILTERS,
  describeSavedSearch,
  formatClp,
  hasAnyFilter,
  isNotifiable,
  normalizeSavedSearchFilters,
  rowToSavedSearch,
  savedSearchToParams,
  type SavedSearch,
  type SavedSearchFilters,
  type SavedSearchRow,
} from './savedSearches';
import { filterProperties } from './propertyFilters';
import { ALL_PROPERTIES } from './propertyCatalog';
import type { Property } from '@/lib/types/property';

/**
 * Búsqueda con resultados reales en el catálogo (arriendo de departamentos de 2
 * dormitorios en Las Condes = 1 propiedad), para que las pruebas de coincidencia
 * no pasen "en vacío".
 */
const ordenada: SavedSearchFilters = {
  operation: 'for_rent',
  propertyType: 'apartment',
  newPropertyType: null,
  commune: 'Las Condes',
  region: null,
  searchQuery: '',
  minPrice: null,
  maxPrice: null,
  minBedrooms: 2,
  minBathrooms: null,
  minPrivates: null,
};

function ok(input: unknown): SavedSearchFilters {
  const result = normalizeSavedSearchFilters(input);
  if (!result.ok) throw new Error(`se esperaba válido: ${result.error}`);
  return result.filters;
}

describe('normalizeSavedSearchFilters', () => {
  it('acepta lo que manda el buscador y lo normaliza', () => {
    const filters = ok({
      operation: 'for_sale',
      propertyType: 'apartment',
      commune: '  Las   Condes ',
      minBedrooms: '2',
      searchQuery: '  torre  ',
    });

    expect(filters).toMatchObject({
      operation: 'for_sale',
      propertyType: 'apartment',
      commune: 'Las Condes',
      minBedrooms: 2,
      searchQuery: 'torre',
    });
  });

  it('rechaza valores que no reconoce en vez de guardarlos', () => {
    // Se suma un filtro válido para que la búsqueda no quede vacía y se pueda
    // comprobar que el valor desconocido cae a su "todos".
    const base = { commune: 'Providencia' };
    expect(ok({ ...base, operation: 'alquiler' }).operation).toBe('all');
    expect(ok({ ...base, propertyType: 'castillo' }).propertyType).toBe('all');
    expect(ok({ ...base, newPropertyType: 'usado' }).newPropertyType).toBeNull();
  });

  it('convierte a número lo que llega como texto y descarta la basura', () => {
    const filters = ok({ operation: 'for_rent', minPrice: '250000', maxPrice: 'no' });
    expect(filters.minPrice).toBe(250000);
    expect(filters.maxPrice).toBeNull();
    expect(ok({ operation: 'for_rent', minBedrooms: -3 }).minBedrooms).toBeNull();
  });

  it('rechaza un rango de precio invertido: nunca avisaría nada', () => {
    const result = normalizeSavedSearchFilters({
      operation: 'for_sale',
      minPrice: 300_000_000,
      maxPrice: 100_000_000,
    });
    expect(result.ok).toBe(false);
  });

  it('exige que la búsqueda acote algo', () => {
    const result = normalizeSavedSearchFilters({ operation: 'all', propertyType: 'all' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/al menos un filtro/i);
  });

  it('rechaza cuerpos que no son objetos', () => {
    expect(normalizeSavedSearchFilters(null).ok).toBe(false);
    expect(normalizeSavedSearchFilters([]).ok).toBe(false);
    expect(normalizeSavedSearchFilters('texto').ok).toBe(false);
  });

  it('recorta textos largos en lugar de guardarlos enteros', () => {
    const filters = ok({ operation: 'for_sale', searchQuery: 'a'.repeat(500) });
    expect(filters.searchQuery.length).toBe(120);
  });
});

describe('describeSavedSearch', () => {
  it('arma el resumen que se muestra y se envía por correo', () => {
    expect(describeSavedSearch(ordenada)).toBe(
      'Arriendo · Departamentos · en Las Condes · 2 dormitorios'
    );
  });

  it('usa el mismo lenguaje que los selectores: valores exactos y 5+/4+ al final', () => {
    expect(describeSavedSearch({ ...ordenada, minBedrooms: 5 })).toContain('5+ dormitorios');
    expect(describeSavedSearch({ ...ordenada, minBedrooms: 3 })).toContain('3 dormitorios');
    expect(describeSavedSearch({ ...ordenada, minBathrooms: 4 })).toContain('4+ baños');
    expect(describeSavedSearch({ ...ordenada, minBathrooms: 2 })).toContain('2 baños');
    expect(describeSavedSearch({ ...ordenada, minPrivates: 4 })).toContain('4+ privados');
  });

  it('describe un rango de precio completo', () => {
    const descripcion = describeSavedSearch({
      ...ordenada,
      commune: null,
      minBedrooms: null,
      minPrice: 200_000_000,
      maxPrice: 350_000_000,
    });
    expect(descripcion).toContain('entre $200.000.000 y $350.000.000');
  });

  it('describe un rango abierto con "desde" o "hasta"', () => {
    expect(describeSavedSearch({ ...ordenada, minPrice: 200_000_000 })).toContain(
      'desde $200.000.000'
    );
    expect(describeSavedSearch({ ...ordenada, maxPrice: 200_000_000 })).toContain(
      'hasta $200.000.000'
    );
  });

  it('incluye la operación, el tipo y el texto buscado', () => {
    const descripcion = describeSavedSearch({ ...ordenada, operation: 'all', searchQuery: 'vitacura' });
    expect(descripcion).toContain('Venta y arriendo');
    expect(descripcion).toContain('«vitacura»');
  });

  it('un filtro vacío se describe como todo el catálogo', () => {
    expect(describeSavedSearch(EMPTY_SAVED_SEARCH_FILTERS)).toBe(
      'Venta y arriendo · Todas las categorías'
    );
  });
});

describe('savedSearchToParams', () => {
  it('normaliza los lugares para que coincidan con el buscador', () => {
    const params = savedSearchToParams({ ...ordenada, commune: 'Ñuñoa', searchQuery: 'Torre' });
    expect(params.commune).toBe('nunoa');
    expect(params.searchQuery).toBe('torre');
  });
});

describe('la coincidencia usa las mismas reglas que el buscador', () => {
  it('un aviso de Las Condes solo trae propiedades de Las Condes', () => {
    const matched = filterProperties(ALL_PROPERTIES, savedSearchToParams(ordenada));

    expect(matched.length).toBeGreaterThan(0);
    for (const p of matched) {
      expect(p.city).toBe('Las Condes');
      expect(p.status).toBe('for_rent');
      expect(p.property_type).toBe('apartment');
      expect(p.bedrooms).toBe(2);
    }
  });

  it('una búsqueda de arriendo no trae ventas', () => {
    const filters = ok({ operation: 'for_rent', commune: 'Providencia' });
    const matched = filterProperties(ALL_PROPERTIES, savedSearchToParams(filters));

    expect(matched.length).toBeGreaterThan(0);
    for (const p of matched) expect(p.status).toBe('for_rent');
  });

  it('la comuna se compara ignorando mayúsculas y acentos', () => {
    const conTilde = filterProperties(
      ALL_PROPERTIES,
      savedSearchToParams(ok({ operation: 'all', commune: 'ñuñoa' }))
    );
    const sinTilde = filterProperties(
      ALL_PROPERTIES,
      savedSearchToParams(ok({ operation: 'all', commune: 'Nunoa' }))
    );

    expect(conTilde.length).toBe(sinTilde.length);
  });

  it('el rango de precio se respeta en los dos extremos', () => {
    const filters = ok({ operation: 'all', minPrice: 100_000_000, maxPrice: 200_000_000 });
    const matched = filterProperties(ALL_PROPERTIES, savedSearchToParams(filters));
    for (const p of matched) {
      expect(p.price).toBeGreaterThanOrEqual(100_000_000);
      expect(p.price).toBeLessThanOrEqual(200_000_000);
    }
  });
});

describe('hasAnyFilter / isNotifiable', () => {
  it('un filtro vacío no acota nada', () => {
    expect(hasAnyFilter(EMPTY_SAVED_SEARCH_FILTERS)).toBe(false);
    expect(hasAnyFilter(ordenada)).toBe(true);
  });

  it('una búsqueda silenciada no genera avisos, aunque acote', () => {
    const search: SavedSearch = {
      id: 's1',
      userId: 'u1',
      filters: ordenada,
      label: 'x',
      notify: false,
      createdAt: '2026-09-01T00:00:00Z',
      lastNotifiedAt: null,
    };
    expect(isNotifiable(search)).toBe(false);
    expect(isNotifiable({ ...search, notify: true })).toBe(true);
  });

  it('una búsqueda sin filtros tampoco avisa, aunque esté activa', () => {
    const search: SavedSearch = {
      id: 's1',
      userId: 'u1',
      filters: EMPTY_SAVED_SEARCH_FILTERS,
      label: '',
      notify: true,
      createdAt: '2026-09-01T00:00:00Z',
      lastNotifiedAt: null,
    };
    expect(isNotifiable(search)).toBe(false);
  });
});

describe('rowToSavedSearch', () => {
  const row: SavedSearchRow = {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    user_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    filters: { operation: 'for_rent', commune: 'Providencia' },
    label: 'Arriendo · en Providencia',
    notify: true,
    created_at: '2026-09-20T12:00:00Z',
    last_notified_at: '2026-09-22T12:00:00Z',
  };

  it('mapea la fila, con los filtros del JSONB', () => {
    const search = rowToSavedSearch(row);
    expect(search).toMatchObject({
      id: row.id,
      userId: row.user_id,
      label: 'Arriendo · en Providencia',
      notify: true,
      lastNotifiedAt: '2026-09-22T12:00:00Z',
    });
    expect(search.filters.operation).toBe('for_rent');
    expect(search.filters.commune).toBe('Providencia');
  });

  it('un notify nulo se interpreta como activo', () => {
    expect(rowToSavedSearch({ ...row, notify: null }).notify).toBe(true);
  });

  it('filtros inservibles no rompen la lectura', () => {
    const search = rowToSavedSearch({ ...row, filters: { operation: 'nada' } });
    expect(search.filters).toEqual(EMPTY_SAVED_SEARCH_FILTERS);
    // Y esa búsqueda queda sin avisos, en vez de mandar correos de todo.
    expect(isNotifiable(search)).toBe(false);
  });
});

describe('formatClp', () => {
  it('formatea en pesos chilenos sin decimales', () => {
    expect(formatClp(249_900_000)).toBe('$249.900.000');
  });
});

describe('una propiedad publicada después encaja con la búsqueda', () => {
  it('la propiedad nueva aparece si cumple los filtros', () => {
    const base: Property = ALL_PROPERTIES[0];
    const nueva: Property = {
      ...base,
      id: 'recien-publicada',
      city: 'Las Condes',
      status: 'for_rent',
      property_type: 'apartment',
      bedrooms: 2,
      price: 900_000,
      title: 'Departamento recién publicado',
    };

    const matched = filterProperties([nueva], savedSearchToParams(ordenada));
    expect(matched).toHaveLength(1);
  });

  it('una propiedad que no cumple los filtros no genera aviso', () => {
    const base: Property = ALL_PROPERTIES[0];
    const otra: Property = {
      ...base,
      id: 'otra',
      city: 'Temuco',
      status: 'for_rent',
      property_type: 'house',
      bedrooms: 4,
    };

    expect(filterProperties([otra], savedSearchToParams(ordenada))).toHaveLength(0);
  });
});
