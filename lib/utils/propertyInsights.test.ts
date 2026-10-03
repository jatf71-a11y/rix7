import { describe, it, expect } from 'vitest';
import type { Property } from '@/lib/types/property';
import {
  AT_MARKET_BAND,
  compareToMarket,
  demandMeter,
  findComparables,
  formatDeviation,
  marketGaugeValue,
  marketPositionFromDeviation,
  median,
  pricePerSqm,
} from './propertyInsights';

/** Propiedad mínima para comparar: el resto de campos no influye. */
function rent(overrides: Partial<Property> & { id: string; price: number }): Property {
  return {
    title: overrides.id,
    description: '',
    property_type: 'apartment',
    status: 'for_rent',
    bedrooms: 2,
    bathrooms: 1,
    area_sqm: 50,
    parking_spots: 0,
    address: 'x',
    city: 'Santiago',
    state: 'Región Metropolitana de Santiago',
    images: [],
    features: [],
    lat: 0,
    lng: 0,
    ...overrides,
  } as Property;
}

describe('pricePerSqm', () => {
  it('divide precio por superficie', () => {
    expect(pricePerSqm({ price: 500000, area_sqm: 50 })).toBe(10000);
  });

  it('devuelve 0 sin superficie válida', () => {
    expect(pricePerSqm({ price: 500000, area_sqm: 0 })).toBe(0);
    expect(pricePerSqm({ price: 500000, area_sqm: -3 })).toBe(0);
  });
});

describe('median', () => {
  it('toma el central con cantidad impar', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('promedia los dos centrales con cantidad par', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('no explota con lista vacía', () => {
    expect(median([])).toBe(0);
  });
});

describe('findComparables', () => {
  const subject = rent({ id: 'a', price: 500000, area_sqm: 50, city: 'Santiago' });
  const pool = [
    subject,
    rent({ id: 'b', price: 400000, area_sqm: 40, city: 'Santiago' }),
    rent({ id: 'c', price: 600000, area_sqm: 60, city: 'santiago' }),
    rent({ id: 'd', price: 900000, area_sqm: 60, city: 'Viña del Mar' }),
    rent({ id: 'e', price: 300000, area_sqm: 30, city: 'Santiago', status: 'for_sale' }),
    rent({ id: 'f', price: 300000, area_sqm: 30, city: 'Santiago', property_type: 'house' }),
    rent({ id: 'g', price: 300000, area_sqm: 0, city: 'Santiago' }),
  ];

  it('exige mismo tipo y misma ciudad (sin distinguir mayúsculas)', () => {
    const ids = findComparables(subject, pool).map((c) => c.id);
    expect(ids).toEqual(['b', 'c']);
  });

  it('no se incluye a sí misma', () => {
    expect(findComparables(subject, pool).some((c) => c.id === 'a')).toBe(false);
  });

  it('sin ciudad no hay comparables', () => {
    expect(findComparables(rent({ id: 'z', price: 1, city: '' }), pool)).toEqual([]);
  });
});

describe('compareToMarket', () => {
  it('sin muestra suficiente devuelve unknown en vez de un juicio', () => {
    const subject = rent({ id: 'a', price: 500000, area_sqm: 50 });
    const pool = [subject, rent({ id: 'b', price: 400000, area_sqm: 40 })];

    const result = compareToMarket(subject, pool);
    expect(result.position).toBe('unknown');
    expect(result.scope).toBe('none');
    expect(result.sampleSize).toBe(0);
  });

  it('no hay mercado si la propiedad no tiene superficie', () => {
    const subject = rent({ id: 'a', price: 500000, area_sqm: 0 });
    const pool = [
      subject,
      rent({ id: 'b', price: 400000, area_sqm: 40 }),
      rent({ id: 'c', price: 450000, area_sqm: 40 }),
      rent({ id: 'd', price: 350000, area_sqm: 40 }),
    ];
    expect(compareToMarket(subject, pool).position).toBe('unknown');
  });

  it('marca bajo el mercado cuando el m² está bajo la mediana', () => {
    // Comparables a 10.000/m². La propiedad está a 8.000/m² → −20 %.
    const subject = rent({ id: 'a', price: 400000, area_sqm: 50 });
    const pool = [
      subject,
      rent({ id: 'b', price: 500000, area_sqm: 50 }),
      rent({ id: 'c', price: 500000, area_sqm: 50 }),
      rent({ id: 'd', price: 500000, area_sqm: 50 }),
    ];

    const result = compareToMarket(subject, pool);
    expect(result.scope).toBe('city');
    expect(result.position).toBe('below');
    expect(result.sampleSize).toBe(3);
    expect(result.medianPerSqm).toBe(10000);
    expect(result.propertyPerSqm).toBe(8000);
    expect(result.deviationPct).toBeCloseTo(-0.2, 5);
  });

  it('marca sobre el mercado cuando el m² supera la mediana', () => {
    const subject = rent({ id: 'a', price: 600000, area_sqm: 50 }); // 12.000/m²
    const pool = [
      subject,
      rent({ id: 'b', price: 500000, area_sqm: 50 }),
      rent({ id: 'c', price: 500000, area_sqm: 50 }),
      rent({ id: 'd', price: 500000, area_sqm: 50 }),
    ];

    expect(compareToMarket(subject, pool).position).toBe('above');
  });

  it('cae a la región cuando la ciudad no junta muestra', () => {
    const subject = rent({ id: 'a', price: 500000, area_sqm: 50, city: 'Colina' });
    const pool = [
      subject,
      rent({ id: 'b', price: 500000, area_sqm: 50, city: 'Santiago' }),
      rent({ id: 'c', price: 500000, area_sqm: 50, city: 'Las Condes' }),
      rent({ id: 'd', price: 500000, area_sqm: 50, city: 'Providencia' }),
    ];

    const result = compareToMarket(subject, pool);
    expect(result.scope).toBe('state');
    expect(result.sampleSize).toBe(3);
    expect(result.position).toBe('at');
  });
});

describe('marketPositionFromDeviation / marketGaugeValue', () => {
  it('usa una banda muerta alrededor de la mediana', () => {
    expect(marketPositionFromDeviation(0)).toBe('at');
    expect(marketPositionFromDeviation(AT_MARKET_BAND)).toBe('at');
    expect(marketPositionFromDeviation(AT_MARKET_BAND + 0.001)).toBe('above');
    expect(marketPositionFromDeviation(-AT_MARKET_BAND - 0.001)).toBe('below');
  });

  it('devuelve unknown ante un número inválido', () => {
    expect(marketPositionFromDeviation(NaN)).toBe('unknown');
  });

  it('centra el arco en 0.5 y lo satura a ±30 %', () => {
    expect(marketGaugeValue(0)).toBe(0.5);
    expect(marketGaugeValue(-0.3)).toBe(1);
    expect(marketGaugeValue(0.3)).toBe(0);
    // Más allá del rango no se sale de 0..1.
    expect(marketGaugeValue(-1)).toBe(1);
    expect(marketGaugeValue(1)).toBe(0);
  });
});

describe('demandMeter', () => {
  it('normaliza visitas raras a 0', () => {
    expect(demandMeter(-5).views).toBe(0);
    expect(demandMeter(NaN).views).toBe(0);
    expect(demandMeter(undefined as unknown as number).views).toBe(0);
  });

  it('escala contra la referencia y satura', () => {
    expect(demandMeter(0).gauge).toBe(0);
    expect(demandMeter(150).gauge).toBe(1);
    expect(demandMeter(1500).gauge).toBe(1);
    expect(demandMeter(75).gauge).toBeCloseTo(0.5, 5);
  });

  it('clasifica el nivel por tramos', () => {
    expect(demandMeter(10).level).toBe('low');
    expect(demandMeter(75).level).toBe('medium');
    expect(demandMeter(140).level).toBe('high');
  });

  it('acepta una referencia distinta', () => {
    expect(demandMeter(5, 10).gauge).toBe(0.5);
    // Referencia 0: sin escala, no se puede dividir por cero.
    expect(demandMeter(5, 0).gauge).toBe(0);
  });
});

describe('formatDeviation', () => {
  it('muestra el signo y un decimal', () => {
    expect(formatDeviation(-0.2)).toBe('−20.0%');
    expect(formatDeviation(0.05)).toBe('+5.0%');
    expect(formatDeviation(0)).toBe('0.0%');
  });
});
