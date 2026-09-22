/**
 * Tests del generador de snapshot de POIs.
 *
 * El script es un espejo en JS puro de `lib/data/poiCategories.ts` (corre en
 * Node sin cargador de TS), así que su categorización necesita sus propios
 * tests: un bug de regex acá no lo detecta la suite del módulo TS.
 *
 * Al importarlo no se lanza ningún barrido: `main()` solo corre si el script
 * se ejecuta directamente.
 */
import { describe, it, expect } from 'vitest';
import { categorize, rawType, safetySubtype, TYPE_INDEX, CATEGORY_QUERIES } from './generate-poi-snapshot.mjs';

describe('TYPE_INDEX (selectores Overpass → tags)', () => {
  it('se construye con los selectores entre corchetes', () => {
    // Sin esto la categorización por tags queda vacía y todo cae al fallback
    expect(TYPE_INDEX.length).toBeGreaterThan(30);
    expect(TYPE_INDEX).toContainEqual({ category: 'education', tagKey: 'amenity', value: 'school' });
    expect(TYPE_INDEX).toContainEqual({ category: 'health', tagKey: 'amenity', value: 'pharmacy' });
    expect(TYPE_INDEX).toContainEqual({ category: 'transport', tagKey: 'highway', value: 'bus_stop' });
    expect(TYPE_INDEX).toContainEqual({ category: 'services', tagKey: 'office', value: 'notary' });
  });

  it('ignora los selectores con modificador (no describen un tag concreto)', () => {
    const conModificador = CATEGORY_QUERIES.safety.filter((s: string) => s.includes(',i]'));
    expect(conModificador.length).toBe(2);
    expect(TYPE_INDEX.some((e: any) => e.tagKey === 'name' || e.tagKey === 'operator')).toBe(false);
  });
});

describe('categorize', () => {
  it('categoriza por tag de OSM, no por nombre', () => {
    expect(categorize({ amenity: 'kindergarten', name: 'Jardín Infantil Entreteniños' })).toBe('education');
    expect(categorize({ amenity: 'pharmacy', name: 'Farmacia Ahumada' })).toBe('health');
    expect(categorize({ shop: 'supermarket', name: 'Unimarc' })).toBe('shopping');
    expect(categorize({ leisure: 'park', name: 'Parque Araucano' })).toBe('park');
    expect(categorize({ amenity: 'bench' })).toBeNull();
  });

  it('categoriza seguridad real, incluida la derivada del nombre', () => {
    expect(categorize({ amenity: 'fire_station', name: '14ª Compañía de Bomberos' })).toBe('safety');
    expect(categorize({ name: '1 Comisaría Concepción' })).toBe('safety');
    expect(categorize({ name: 'Prefectura Concepción' })).toBe('safety');
    expect(categorize({ office: 'government', name: 'PDI Las Condes' })).toBe('safety');
  });

  it('no marca como seguridad lugares que solo contienen la palabra', () => {
    // "Entreteniños" contiene "reten": sin \b caía como seguridad
    expect(categorize({ amenity: 'kindergarten', name: 'Jardín Infantil Entreteniños' })).toBe('education');
    expect(categorize({ amenity: 'restaurant', name: 'Restaurante La Comisaría' })).toBe('leisure');
    expect(categorize({ shop: 'bakery', name: 'Panadería La Tenencia' })).toBe('shopping');
    expect(categorize({ amenity: 'school', name: 'Colegio Bomberos de Chile' })).toBe('education');
    // Paraderos nombrados por el hito cercano son transporte, no seguridad
    expect(categorize({ highway: 'bus_stop', name: 'Bomberos' })).toBe('transport');
    expect(categorize({ highway: 'bus_stop', name: 'Carabineros' })).toBe('transport');
    expect(categorize({ railway: 'station', name: 'Comisaría Central' })).toBe('transport');
  });
});

describe('rawType', () => {
  it('prefiere el tag de tipo y cae al subtipo de seguridad', () => {
    expect(rawType({ amenity: 'school' })).toBe('school');
    expect(rawType({ office: 'government', name: 'PDI Las Condes' })).toBe('pdi');
    expect(rawType({ name: 'Centro de Seguridad Ciudadana' })).toBe('municipal_security');
    expect(rawType({ name: '19 Comisaría Providencia' })).toBe('police');
    expect(rawType({})).toBe('');
  });
});

describe('safetySubtype', () => {
  it('distingue PDI, seguridad ciudadana y bomberos', () => {
    expect(safetySubtype({ amenity: 'police', name: 'PDI Santiago' })).toBe('pdi');
    expect(safetySubtype({ amenity: 'police', name: 'Carabineros' })).toBe('police');
    expect(safetySubtype({ name: 'Paz Ciudadana Providencia' })).toBe('municipal_security');
    expect(safetySubtype({ name: 'Cuartel General Bomberos de Concepción' })).toBe('fire_station');
  });

  it('devuelve null para lugares de otras categorías', () => {
    expect(safetySubtype({ amenity: 'hospital' })).toBeNull();
    expect(safetySubtype({ tourism: 'hotel', name: 'Hotel Bomberos' })).toBeNull();
  });
});
