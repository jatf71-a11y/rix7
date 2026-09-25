import { describe, it, expect, beforeEach, vi } from 'vitest';
import { snapshotCellKey, poisFromSnapshot, SNAPSHOT_POOL_RADIUS_M } from './poiSnapshotLookup';
import { WALKABLE_RADIUS_M } from './poiCategories';
import { MAX_OFFSET_M } from '@/lib/utils/approximateLocation';

/**
 * El módulo importa el JSON con `import()` dinámico, así que el mock solo
 * aplica si el registro de módulos se limpia antes: sin el `resetModules` el
 * primer import queda cacheado y los tests siguientes verían el snapshot real.
 */
beforeEach(() => {
  vi.resetModules();
});

describe('snapshotCellKey', () => {
  it('redondea a 4 decimales (~11 m)', () => {
    expect(snapshotCellKey(-33.41751234, -70.59809876)).toBe('-33.4175_-70.5981');
  });

  it('no usa notación científica en coordenadas pequeñas', () => {
    // `toFixed` sobre un valor diminuto da "0.0000": la clave tiene que ser
    // estable y comparable con la que genera el script del snapshot.
    expect(snapshotCellKey(0, 0)).toBe('0.0000_0.0000');
  });

  it('comparte celda entre propiedades del mismo edificio', () => {
    // Propiedades separadas por ~5 m: misma celda, un solo snapshot.
    expect(snapshotCellKey(-33.41751, -70.59801)).toBe(snapshotCellKey(-33.41753, -70.59804));
  });
});

/**
 * La invariante que sostiene el entorno de la landing.
 *
 * El pool se busca con la celda de las coordenadas reales pero las distancias
 * se miden desde el punto difuminado. Si el desplazamiento creciera (o el pool
 * se encogiera) lo suficiente, un lugar caminable quedaría fuera del pool y la
 * landing lo omitiría **sin ningún error**: la sección se vería bien y estaría
 * mintiendo por omisión.
 */
describe('cobertura del pool del snapshot', () => {
  it('alcanza para medir el radio caminable desde el punto difuminado', () => {
    expect(SNAPSHOT_POOL_RADIUS_M).toBeGreaterThanOrEqual(WALKABLE_RADIUS_M + MAX_OFFSET_M);
  });
});

describe('poisFromSnapshot', () => {
  it('devuelve null con coordenadas no numéricas', async () => {
    expect(await poisFromSnapshot(NaN, -70.598)).toBeNull();
    expect(await poisFromSnapshot(-33.4175, Infinity)).toBeNull();
  });

  it('devuelve null cuando la celda no está en el snapshot', async () => {
    vi.doMock('@/lib/data/poiSnapshot.generated.json', () => ({
      default: { generated_at: '2026-01-01T00:00:00.000Z', cells: {} },
    }));

    expect(await poisFromSnapshot(-33.4175, -70.598)).toBeNull();
  });

  it('devuelve null si el snapshot está vacío en esa celda', async () => {
    vi.doMock('@/lib/data/poiSnapshot.generated.json', () => ({
      default: {
        generated_at: '2026-01-01T00:00:00.000Z',
        cells: { '-33.4175_-70.5980': { lat: -33.4175, lng: -70.598, pois: [] } },
      },
    }));

    expect(await poisFromSnapshot(-33.4175, -70.598)).toBeNull();
  });

  it('mapea los POIs de la celda y expone la fecha de generación', async () => {
    vi.doMock('@/lib/data/poiSnapshot.generated.json', () => ({
      default: {
        generated_at: '2026-09-22T14:29:42.685Z',
        cells: {
          '-33.4175_-70.5980': {
            lat: -33.4175,
            lng: -70.598,
            pois: [
              { id: 1, lat: -33.418, lng: -70.599, name: 'Colegio X', type: 'school', category: 'education' },
              { id: 2, lat: -33.419, lng: -70.6, type: 'pharmacy', category: 'health' },
            ],
          },
        },
      },
    }));

    const result = await poisFromSnapshot(-33.4175, -70.598);
    expect(result).not.toBeNull();
    expect(result!.generatedAt).toBe('2026-09-22T14:29:42.685Z');
    expect(result!.pois).toHaveLength(2);
    // Un POI sin nombre entra igual, con cadena vacía: el texto del sector
    // distingue "sin nombre" de "no existe" y no debe romperse.
    expect(result!.pois[1]).toMatchObject({ name: '', type: 'pharmacy', category: 'health' });
  });

  it('nunca lanza si el snapshot no se puede leer', async () => {
    vi.doMock('@/lib/data/poiSnapshot.generated.json', () => {
      throw new Error('archivo corrupto');
    });

    expect(await poisFromSnapshot(-33.4175, -70.598)).toBeNull();
  });
});

/**
 * Contra el snapshot **real** del repositorio, no un mock.
 *
 * Esto es lo que protege de una regeneración que cambie el formato de la
 * clave: sin esta prueba, la landing se quedaría sin entorno en silencio
 * (la función devuelve `null` y la sección simplemente no aparece).
 */
describe('poisFromSnapshot contra el snapshot real', () => {
  // `vi.doMock` no lo limpia `resetModules`: sin este `doUnmock`, el último
  // mock del bloque anterior seguiría activo y esta prueba mediría el mock
  // en vez del snapshot del repositorio.
  beforeEach(() => {
    vi.doUnmock('@/lib/data/poiSnapshot.generated.json');
  });

  it('encuentra el entorno de una propiedad del catálogo', async () => {
    // Coordenadas de `scl-depto-marco-polo` (Torre Marco Polo, Las Condes)
    const result = await poisFromSnapshot(-33.4175, -70.598);

    expect(result).not.toBeNull();
    expect(result!.pois.length).toBeGreaterThan(0);
    expect(result!.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const categories = new Set(result!.pois.map((p) => p.category));
    // Si estas dos desaparecen, el snapshot dejó de cubrir lo que la landing
    // usa para describir el barrio.
    expect(categories.has('education')).toBe(true);
    expect(categories.size).toBeGreaterThan(1);
  });

  it('devuelve null para coordenadas fuera de las celdas generadas', async () => {
    // Punto en el océano, sin propiedades del catálogo cerca.
    expect(await poisFromSnapshot(-40.0, -80.0)).toBeNull();
  });
});
