import { describe, it, expect } from 'vitest';
import { approximatePoint, MIN_OFFSET_M, MAX_OFFSET_M } from './approximateLocation';
import { haversineMeters } from './sectorSummary';

/** Distancia real en metros entre el punto verdadero y el difuminado. */
function distanceFrom(lat: number, lng: number, seed: string): number {
  const p = approximatePoint(lat, lng, seed);
  return haversineMeters(lat, lng, p.lat, p.lng);
}

describe('approximatePoint', () => {
  it('nunca devuelve el punto exacto', () => {
    for (const id of ['a', 'scl-depto-marco-polo', 'otra-propiedad', 'x']) {
      const p = approximatePoint(-33.4175, -70.598, id);
      expect(p.lat).not.toBeCloseTo(-33.4175, 6);
      expect(p.lng).not.toBeCloseTo(-70.598, 6);
    }
  });

  it('desplaza siempre dentro del rango previsto', () => {
    // Barrido amplio: el rango no puede depender de que el hash caiga bien.
    const seeds = Array.from({ length: 300 }, (_, i) => `propiedad-${i}`);
    for (const seed of seeds) {
      const d = distanceFrom(-33.4175, -70.598, seed);
      expect(d).toBeGreaterThanOrEqual(MIN_OFFSET_M - 1);
      expect(d).toBeLessThanOrEqual(MAX_OFFSET_M + 1);
    }
  });

  it('es determinista: el mismo id da siempre el mismo punto', () => {
    const a = approximatePoint(-33.4175, -70.598, 'scl-depto-marco-polo');
    const b = approximatePoint(-33.4175, -70.598, 'scl-depto-marco-polo');
    expect(b).toEqual(a);
  });

  it('da puntos distintos a propiedades distintas', () => {
    const a = approximatePoint(-33.4175, -70.598, 'prop-1');
    const b = approximatePoint(-33.4175, -70.598, 'prop-2');
    // Dos desplazamientos distintos: no todas las propiedades quedan al mismo lado
    expect(a.lat === b.lat && a.lng === b.lng).toBe(false);
  });

  it('aplica el desplazamiento completo cerca del ecuador y del polo sur', () => {
    // En Chile (~33°S y ~53°S) la longitud se acorta: si no se corrigiera por
    // cos(lat), el desplazamiento real quedaría por debajo del mínimo.
    for (const lat of [0, -33.4175, -53.16]) {
      const d = distanceFrom(lat, -70.598, 'seed-fijo');
      expect(d).toBeGreaterThanOrEqual(MIN_OFFSET_M - 1);
    }
  });

  it('no rompe con coordenadas inválidas', () => {
    expect(approximatePoint(NaN, -70.598, 'x')).toEqual({ lat: NaN, lng: -70.598, offsetM: 0 });
    expect(approximatePoint(-33.4175, Infinity, 'x').offsetM).toBe(0);
  });

  it('sin semilla usa las coordenadas como base del desplazamiento', () => {
    const p = approximatePoint(-33.4175, -70.598, '');
    expect(p.offsetM).toBeGreaterThanOrEqual(MIN_OFFSET_M);
  });
});
