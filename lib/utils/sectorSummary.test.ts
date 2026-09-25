import { describe, it, expect } from 'vitest';
import {
  buildEducationSummary,
  buildCategorySummary,
  buildSectorSummaries,
  haversineMeters,
} from './sectorSummary';
import { poiTypeLabelPlural } from '@/lib/data/poiCategories';

const poi = (over: Partial<{ type: string; name: string; lat: number; lng: number; category: string }> = {}) => ({
  category: 'education',
  type: 'school',
  name: '',
  lat: -33.4175,
  lng: -70.608,
  ...over,
});

describe('buildEducationSummary', () => {
  it('devuelve null si no hay POIs educacionales', () => {
    expect(buildEducationSummary([poi({ category: 'health', type: 'pharmacy' })], -33.4175, -70.608)).toBeNull();
    expect(buildEducationSummary([], -33.4175, -70.608)).toBeNull();
  });

  it('enumera los subtipos presentes con plural correcto', () => {
    const pois = [
      poi({ type: 'school', name: 'A' }),
      poi({ type: 'school', name: 'B' }),
      poi({ type: 'kindergarten', name: 'C' }),
      poi({ type: 'university', name: 'D' }),
    ];
    const s = buildEducationSummary(pois, -33.4175, -70.608)!;
    expect(s).toContain('2 colegios');
    expect(s).toContain('1 jardín infantil');
    expect(s).toContain('1 universidad');
    expect(s).not.toContain('instituto');
    expect(s.startsWith('A menos de 15 min caminando:')).toBe(true);
  });

  it('ordena por cantidad y usa "y" antes del último ítem', () => {
    const s = buildEducationSummary(
      [poi({ type: 'school' }), poi({ type: 'college' })],
      -33.4175,
      -70.608
    )!;
    expect(s).toBe('A menos de 15 min caminando: 1 colegio y 1 instituto.');
  });

  it('deja lo más abundante primero', () => {
    const s = buildEducationSummary(
      [
        poi({ type: 'kindergarten' }),
        poi({ type: 'kindergarten' }),
        poi({ type: 'kindergarten' }),
        poi({ type: 'school' }),
      ],
      -33.4175,
      -70.608
    )!;
    expect(s).toContain('3 jardines infantiles y 1 colegio');
  });

  it('menciona la institución con nombre más cercana y su distancia', () => {
    // Propiedad en (0,0); colegio A a ~111 m, universidad B a ~1.111 m
    const pois = [
      poi({ type: 'university', name: 'Universidad Lejana', lat: 0.01, lng: 0 }),
      poi({ type: 'school', name: 'Colegio Cercano', lat: 0.001, lng: 0 }),
    ];
    const s = buildEducationSummary(pois, 0, 0)!;
    expect(s).toContain('Más cerca: Colegio Cercano (Colegio,');
    // El formato cierra el paréntesis antes del punto final: "... (Colegio, 111 m)."
    const m = s.match(/(\d+) m\)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(100);
    expect(Number(m![1])).toBeLessThan(120);
  });

  it('excluye instituciones fuera del radio caminable (1200 m)', () => {
    const dentro = poi({ type: 'school', name: 'Cerca', lat: 0.005, lng: 0 }); // ~556 m
    const fuera = poi({ type: 'university', name: 'Lejos', lat: 0.02, lng: 0 }); // ~2.223 m
    const s = buildEducationSummary([dentro, fuera], 0, 0)!;
    expect(s).toContain('1 colegio');
    expect(s).not.toContain('universidad');
    expect(s).not.toContain('Lejos');
  });

  it('devuelve null si todas las instituciones quedan fuera del radio', () => {
    expect(buildEducationSummary([poi({ lat: 0.5, lng: 0 })], 0, 0)).toBeNull();
  });

  it('omite la línea de cercanía si ninguna institución tiene nombre', () => {
    const s = buildEducationSummary([poi({ name: '' })], -33.4175, -70.608)!;
    expect(s).not.toContain('Más cerca');
  });

  it('incluye subtipos no listados con label genérico pluralizado', () => {
    // Un tipo sin plural explícito entra por la regla y se usa su label, por
    // poco elegante que sea en inglés
    const s = buildEducationSummary(
      [poi({ type: 'language_school' }), poi({ type: 'language_school' })],
      -33.4175,
      -70.608
    )!;
    expect(s).toContain('2 language school');
  });
});

describe('buildCategorySummary', () => {
  it('describe seguridad con comisarías y cuarteles de bomberos', () => {
    const pois = [
      poi({ category: 'safety', type: 'police', name: '19 Comisaría Providencia' }),
      poi({ category: 'safety', type: 'police', name: 'Subcomisaría Providencia Sur' }),
      poi({ category: 'safety', type: 'fire_station', name: '14ª Compañía de Bomberos' }),
    ];
    const s = buildCategorySummary(pois, 'safety', -33.4175, -70.608)!;
    expect(s).toContain('2 comisarías de Carabineros y 1 cuartel de bomberos');
    expect(s).toContain('Más cerca:');
  });

  it('describe PDI y seguridad ciudadana con sus plurales', () => {
    const s = buildCategorySummary(
      [
        poi({ category: 'safety', type: 'pdi', name: 'PDI Las Condes' }),
        poi({ category: 'safety', type: 'municipal_security', name: 'Seguridad Ciudadana' }),
      ],
      'safety',
      -33.4175,
      -70.608
    )!;
    expect(s).toContain('1 unidad de la PDI');
  });

  it('describe comercio con plurales correctos de etiquetas compuestas', () => {
    const s = buildCategorySummary(
      [
        poi({ category: 'shopping', type: 'atm', name: 'Cajero A' }),
        poi({ category: 'shopping', type: 'atm', name: 'Cajero B' }),
        poi({ category: 'shopping', type: 'supermarket', name: 'Unimarc' }),
      ],
      'shopping',
      -33.4175,
      -70.608
    )!;
    expect(s).toContain('2 cajeros automáticos y 1 supermercado');
  });

  it('resume los subtipos menos frecuentes cuando son muchos', () => {
    const types = ['supermarket', 'bakery', 'greengrocer', 'mall', 'convenience', 'atm', 'restaurant'];
    const pois = types.map((t, i) =>
      poi({ category: 'shopping', type: t, name: `Lugar ${i}`, lat: -33.4175 + i * 0.0001 })
    );
    const s = buildCategorySummary(pois, 'shopping', -33.4175, -70.608)!;
    expect(s).toContain('7 lugares en 7 tipos — ');
    // Solo se detallan 5; los otros no aparecen
    expect(s.split('—')[1].split('.').length).toBeGreaterThan(0);
    expect(s).not.toContain('Restaurantes');
  });

  it('devuelve null cuando la categoría no tiene POIs', () => {
    expect(buildCategorySummary([poi({ category: 'education' })], 'safety', -33.4175, -70.608)).toBeNull();
  });
});

describe('buildSectorSummaries', () => {
  it('entrega un resumen por categoría, con null en las vacías', () => {
    const pois = [
      poi({ category: 'education', type: 'school', name: 'Colegio A' }),
      poi({ category: 'park', type: 'park', name: 'Parque B' }),
    ];
    const r = buildSectorSummaries(pois, ['education', 'park', 'safety'], -33.4175, -70.608);
    expect(Object.keys(r)).toEqual(['education', 'park', 'safety']);
    expect(r.education).toContain('1 colegio');
    expect(r.park).toContain('1 parque');
    expect(r.safety).toBeNull();
  });
});

describe('poiTypeLabelPlural', () => {
  it('usa los plurales explícitos, incluidas las etiquetas compuestas', () => {
    expect(poiTypeLabelPlural('school')).toBe('colegios');
    expect(poiTypeLabelPlural('kindergarten')).toBe('jardines infantiles');
    expect(poiTypeLabelPlural('atm')).toBe('cajeros automáticos');
    expect(poiTypeLabelPlural('police')).toBe('comisarías de Carabineros');
    expect(poiTypeLabelPlural('municipal_security')).toBe('centros de seguridad ciudadana');
  });

  it('pluraliza con regla los subtipos sin plural explícito', () => {
    expect(poiTypeLabelPlural('luz')).toBe('luces'); // z → ces
    expect(poiTypeLabelPlural('bazar')).toBe('bazares'); // consonante → es
    expect(poiTypeLabelPlural('plaza')).toBe('plazas'); // vocal → s
    // Label compuesto: pluraliza la última palabra
    expect(poiTypeLabelPlural('trade_school')).toBe('trade schooles');
  });

  it('devuelve cadena vacía sin tipo', () => {
    expect(poiTypeLabelPlural('')).toBe('');
  });
});

describe('haversineMeters', () => {
  it('distancia conocida Santiago: ~1,1 km por 0,01° de latitud', () => {
    const d = haversineMeters(-33.443, -70.6539, -33.433, -70.6539);
    expect(d).toBeGreaterThan(1050);
    expect(d).toBeLessThan(1160);
  });

  it('misma coordenada → 0', () => {
    expect(haversineMeters(-33.4, -70.6, -33.4, -70.6)).toBe(0);
  });
});
