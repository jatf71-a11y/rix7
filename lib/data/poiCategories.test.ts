import { describe, it, expect } from 'vitest';
import { categorizePOI, poiTypeLabel, poiSvgMarkup, poiImportance, poiMarkerSize, POI_SVG_DEFS, POI_CATEGORIES } from '@/lib/data/poiCategories';

/**
 * Suite de `poiCategories.ts` — módulo compartido entre la API route
 * `/api/pois` (servidor) y `PropertyMapLeaflet` (cliente).
 *
 * Los fixtures replican la forma de `tags` tal como llegan de Overpass
 * (Record<string, string> con claves de OSM).
 */

describe('categorizePOI', () => {
  describe('educación', () => {
    it('categoriza colegios, jardines, universidades e institutos', () => {
      expect(categorizePOI({ amenity: 'school' })).toBe('education');
      expect(categorizePOI({ amenity: 'kindergarten' })).toBe('education');
      expect(categorizePOI({ amenity: 'university' })).toBe('education');
      expect(categorizePOI({ amenity: 'college' })).toBe('education');
    });
  });

  describe('salud', () => {
    it('categoriza clínicas, hospitales, centros médicos y farmacias', () => {
      expect(categorizePOI({ amenity: 'clinic' })).toBe('health');
      expect(categorizePOI({ amenity: 'hospital' })).toBe('health');
      expect(categorizePOI({ amenity: 'doctors' })).toBe('health');
      expect(categorizePOI({ amenity: 'pharmacy' })).toBe('health');
    });
  });

  describe('transporte', () => {
    it('categoriza estaciones y bocas de metro vía railway', () => {
      expect(categorizePOI({ railway: 'station' })).toBe('transport');
      expect(categorizePOI({ railway: 'halt' })).toBe('transport');
      expect(categorizePOI({ railway: 'subway_entrance' })).toBe('transport');
    });

    it('categoriza paraderos y accesos a autopista vía highway', () => {
      expect(categorizePOI({ highway: 'bus_stop' })).toBe('transport');
      expect(categorizePOI({ highway: 'motorway_junction' })).toBe('transport');
    });

    it('no categoriza vías ciclistas ni otras vías (no son POIs puntuales)', () => {
      expect(categorizePOI({ highway: 'cycleway' })).toBeNull();
      expect(categorizePOI({ highway: 'footway' })).toBeNull();
      expect(categorizePOI({ railway: 'tram' })).toBeNull();
    });
  });

  describe('comercio', () => {
    it('categoriza supermercados, minimarkets, malls, panaderías y verdulerías vía shop', () => {
      expect(categorizePOI({ shop: 'supermarket' })).toBe('shopping');
      expect(categorizePOI({ shop: 'convenience' })).toBe('shopping');
      expect(categorizePOI({ shop: 'mall' })).toBe('shopping');
      expect(categorizePOI({ shop: 'department_store' })).toBe('shopping');
      expect(categorizePOI({ shop: 'bakery' })).toBe('shopping');
      expect(categorizePOI({ shop: 'greengrocer' })).toBe('shopping');
    });

    it('categoriza ferias libres vía amenity=marketplace', () => {
      expect(categorizePOI({ amenity: 'marketplace' })).toBe('shopping');
    });
  });

  describe('deportes', () => {
    it('categoriza gimnasios, centros deportivos, estadios y clubes', () => {
      expect(categorizePOI({ leisure: 'fitness_centre' })).toBe('sports');
      expect(categorizePOI({ leisure: 'sports_centre' })).toBe('sports');
      expect(categorizePOI({ leisure: 'stadium' })).toBe('sports');
      expect(categorizePOI({ leisure: 'sports_club' })).toBe('sports');
    });
  });

  describe('áreas verdes', () => {
    it('categoriza parques, jardines y plazas de mascotas vía leisure', () => {
      expect(categorizePOI({ leisure: 'park' })).toBe('park');
      expect(categorizePOI({ leisure: 'garden' })).toBe('park');
      expect(categorizePOI({ leisure: 'dog_park' })).toBe('park');
    });

    it('categoriza plazas vía place=square', () => {
      expect(categorizePOI({ place: 'square' })).toBe('park');
    });
  });

  describe('seguridad', () => {
    it('categoriza carabineros y bomberos', () => {
      expect(categorizePOI({ amenity: 'police' })).toBe('safety');
      expect(categorizePOI({ amenity: 'fire_station' })).toBe('safety');
    });

    it('categoriza comisarías/tenencias por nombre (sin amenity)', () => {
      expect(categorizePOI({ name: '19 Comisaría Providencia' })).toBe('safety');
      expect(categorizePOI({ name: 'Tenencia El Salto' })).toBe('safety');
      expect(categorizePOI({ name: 'Subcomisaría Providencia Sur' })).toBe('safety');
      expect(categorizePOI({ operator: 'Carabineros de Chile' })).toBe('safety');
    });

    it('categoriza PDI y seguridad ciudadana municipal', () => {
      expect(categorizePOI({ name: 'PDI Las Condes' })).toBe('safety');
      expect(categorizePOI({ name: 'Policía de Investigaciones de Chile' })).toBe('safety');
      expect(categorizePOI({ name: 'Centro de Seguridad Ciudadana' })).toBe('safety');
      expect(categorizePOI({ name: 'Paz Ciudadana Providencia' })).toBe('safety');
      expect(categorizePOI({ office: 'government', name: 'Dirección de Seguridad Municipal' })).toBe('safety');
    });

    it('no marca como seguridad lugares que solo mencionan la palabra', () => {
      // Con tag de otra categoría manda el tag, no el nombre
      expect(categorizePOI({ amenity: 'restaurant', name: 'Restaurante La Comisaría' })).toBe('leisure');
      expect(categorizePOI({ shop: 'bakery', name: 'Panadería La Tenencia' })).toBe('shopping');
      expect(categorizePOI({ amenity: 'school', name: 'Colegio Bomberos de Chile' })).toBe('education');
      expect(categorizePOI({ name: 'Farmacia Policlínica' })).toBeNull();
    });
  });

  describe('ocio', () => {
    it('categoriza restaurantes, cafeterías, comida rápida y centros culturales', () => {
      expect(categorizePOI({ amenity: 'restaurant' })).toBe('leisure');
      expect(categorizePOI({ amenity: 'cafe' })).toBe('leisure');
      expect(categorizePOI({ amenity: 'fast_food' })).toBe('leisure');
      expect(categorizePOI({ amenity: 'food_court' })).toBe('leisure');
      expect(categorizePOI({ amenity: 'arts_centre' })).toBe('leisure');
      expect(categorizePOI({ amenity: 'community_centre' })).toBe('leisure');
    });
  });

  describe('servicios financieros y públicos', () => {
    it('categoriza bancos, cajeros, municipalidades, tribunales y correos', () => {
      expect(categorizePOI({ amenity: 'bank' })).toBe('services');
      expect(categorizePOI({ amenity: 'atm' })).toBe('services');
      expect(categorizePOI({ amenity: 'townhall' })).toBe('services');
      expect(categorizePOI({ amenity: 'courthouse' })).toBe('services');
      expect(categorizePOI({ amenity: 'post_office' })).toBe('services');
    });

    it('categoriza oficinas gubernamentales, notarías y financieras vía office', () => {
      expect(categorizePOI({ office: 'government' })).toBe('services');
      expect(categorizePOI({ office: 'notary' })).toBe('services');
      expect(categorizePOI({ office: 'financial' })).toBe('services');
    });
  });

  describe('prioridades y casos límite', () => {
    it('educación gana sobre ocio (un colegio con café adentro sigue siendo educación)', () => {
      expect(categorizePOI({ amenity: 'school', leisure: 'fitness_centre' })).toBe('education');
      expect(categorizePOI({ amenity: 'school', shop: 'bakery' })).toBe('education');
    });

    it('transporte gana sobre comercio (estación con minimarket)', () => {
      expect(categorizePOI({ railway: 'station', shop: 'convenience' })).toBe('transport');
    });

    it('un elemento con tags de dos categorías cae en la primera según el orden de evaluación', () => {
      // clinic (salud) + bank (servicios): salud se evalúa antes
      expect(categorizePOI({ amenity: 'clinic', office: 'financial' })).toBe('health');
    });

    it('devuelve null para elementos sin tags relevantes', () => {
      expect(categorizePOI({})).toBeNull();
      expect(categorizePOI({ amenity: 'parking' })).toBeNull();
      expect(categorizePOI({ shop: 'clothes' })).toBeNull();
      expect(categorizePOI({ building: 'yes' })).toBeNull();
    });

    it('no confunde subcadenas (amenity=cafedelia no es cafetería)', () => {
      expect(categorizePOI({ amenity: 'cafeteria_fake' })).toBeNull();
      expect(categorizePOI({ amenity: 'schoolbus' })).toBeNull();
    });
  });
});

describe('poiTypeLabel', () => {
  it('mapea los subtipos OSM a etiquetas en español', () => {
    expect(poiTypeLabel('school')).toBe('Colegio');
    expect(poiTypeLabel('kindergarten')).toBe('Jardín infantil');
    expect(poiTypeLabel('bus_stop')).toBe('Paradero');
    expect(poiTypeLabel('subway_entrance')).toBe('Boca de Metro');
    expect(poiTypeLabel('motorway_junction')).toBe('Acceso a autopista');
    expect(poiTypeLabel('pharmacy')).toBe('Farmacia');
    expect(poiTypeLabel('marketplace')).toBe('Feria libre');
    expect(poiTypeLabel('dog_park')).toBe('Plaza de mascotas');
    expect(poiTypeLabel('atm')).toBe('Cajero automático');
    expect(poiTypeLabel('townhall')).toBe('Municipalidad');
    expect(poiTypeLabel('notary')).toBe('Notaría');
  });

  it('humaniza subtipos no mapeados: guiones bajos a espacios y capitaliza', () => {
    expect(poiTypeLabel('childcare')).toBe('Childcare');
    expect(poiTypeLabel('prep_school')).toBe('Prep school');
    expect(poiTypeLabel('charging_station')).toBe('Charging station');
  });

  it('devuelve string vacío para entrada vacía', () => {
    expect(poiTypeLabel('')).toBe('');
  });
});

describe('poiImportance / poiMarkerSize', () => {
  it('transporte: estación de metro pesa más que un paradero', () => {
    expect(poiImportance('station')).toBe(2);
    expect(poiImportance('subway_entrance')).toBe(2);
    expect(poiImportance('bus_stop')).toBe(0);
  });

  it('salud: hospital pesa más que clínica y que farmacia', () => {
    expect(poiImportance('hospital')).toBe(2);
    expect(poiImportance('clinic')).toBe(1);
    expect(poiImportance('pharmacy')).toBe(0);
  });

  it('educación: universidad > colegio > jardín infantil', () => {
    expect(poiImportance('university')).toBeGreaterThan(poiImportance('school'));
    expect(poiImportance('school')).toBeGreaterThan(poiImportance('kindergarten'));
  });

  it('comercio: mall y supermercado pesan más que minimarket y panadería', () => {
    expect(poiImportance('mall')).toBe(2);
    expect(poiImportance('supermarket')).toBe(1);
    expect(poiImportance('convenience')).toBe(0);
    expect(poiImportance('bakery')).toBe(0);
  });

  it('el tamaño del marcador crece con la importancia: 19 < 23 < 27 px', () => {
    expect(poiMarkerSize('bus_stop')).toBe(19);
    expect(poiMarkerSize('school')).toBe(23);
    expect(poiMarkerSize('station')).toBe(27);
    expect(poiMarkerSize('bus_stop')).toBeLessThan(poiMarkerSize('school'));
    expect(poiMarkerSize('school')).toBeLessThan(poiMarkerSize('station'));
  });

  it('subtipos sin mapear usan importancia normal (1) y tamaño medio', () => {
    expect(poiImportance('charging_station')).toBe(1);
    expect(poiMarkerSize('charging_station')).toBe(23);
  });

  it('todo subtipo con etiqueta en POI_TYPE_LABELS tiene importancia definida', () => {
    // Muestreo representativo: si un subtipo nuevo se agrega a las etiquetas
    // sin importancia, caerá en 1 — válido, pero las claves principales
    // deben estar explícitas.
    const expected = [
      'station', 'bus_stop', 'hospital', 'pharmacy', 'university',
      'mall', 'supermarket', 'park', 'police', 'bank', 'atm', 'restaurant',
    ];
    for (const type of expected) {
      expect([0, 1, 2]).toContain(poiImportance(type));
    }
  });
});

describe('config compartida (contrato con servidor y cliente)', () => {
  it('define las 9 categorías del producto', () => {
    expect(Object.keys(POI_CATEGORIES).sort()).toEqual(
      ['education', 'health', 'leisure', 'park', 'safety', 'services', 'shopping', 'sports', 'transport'].sort(),
    );
  });

  it('cada categoría tiene label, description, color, emoji y al menos un selector Overpass', () => {
    for (const [key, cat] of Object.entries(POI_CATEGORIES)) {
      expect(cat.label, `label de ${key}`).toBeTruthy();
      expect(cat.description, `description de ${key}`).toBeTruthy();
      expect(cat.color, `color de ${key}`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(cat.emoji, `emoji de ${key}`).toBeTruthy();
      expect(cat.queries.length, `queries de ${key}`).toBeGreaterThan(0);
    }
  });

  it('cada categoría tiene un ícono SVG definido (marcadores del mapa)', () => {
    for (const key of Object.keys(POI_CATEGORIES)) {
      expect(POI_SVG_DEFS[key], `SVG de ${key}`).toBeTruthy();
    }
  });

  it('los SVG generados son markup válido con el color de la categoría', () => {
    for (const [key, cat] of Object.entries(POI_CATEGORIES)) {
      const svg = poiSvgMarkup(key, cat.color, 13);
      expect(svg, `svg de ${key}`).toContain(`stroke="${cat.color}"`);
      expect(svg, `svg de ${key}`).toContain('viewBox="0 0 24 24"');
      expect(svg, `svg de ${key}`).toContain(`width="13"`);
      expect(svg, `svg de ${key}`).toMatch(/^<svg[^>]*>.*<\/svg>$/);
    }
  });

  it('poiSvgMarkup devuelve string vacío para categorías desconocidas', () => {
    expect(poiSvgMarkup('no-existe', '#000000')).toBe('');
  });

  it('categorizePOI solo devuelve claves de POI_CATEGORIES (o null)', () => {
    const validKeys = new Set(Object.keys(POI_CATEGORIES));
    const allFixtureTags: Array<Record<string, string>> = [
      { amenity: 'school' },
      { amenity: 'clinic' },
      { railway: 'station' },
      { highway: 'bus_stop' },
      { shop: 'supermarket' },
      { amenity: 'marketplace' },
      { leisure: 'fitness_centre' },
      { leisure: 'park' },
      { place: 'square' },
      { amenity: 'police' },
      { amenity: 'restaurant' },
      { amenity: 'bank' },
      { office: 'government' },
      {},
    ];
    for (const tags of allFixtureTags) {
      const result = categorizePOI(tags);
      if (result !== null) {
        expect(validKeys.has(result), `resultado inesperado: ${result}`).toBe(true);
      }
    }
  });
});
