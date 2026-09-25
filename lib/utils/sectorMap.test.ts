import { describe, it, expect } from 'vitest';
import {
  AREA_STYLES,
  createSectorProjection,
  groupAreaPaths,
  groupRoadPaths,
  polylinePath,
  projectPoints,
  roadStyle,
  streetLabels,
} from './sectorMap';

const CENTER = { centerLat: -33.4175, centerLng: -70.598 };
const WIDTH = 1200;
const HEIGHT = 750;
const RADIUS_M = 1200;

const projection = createSectorProjection({ ...CENTER, width: WIDTH, height: HEIGHT, radiusM: RADIUS_M });

/** Distancia en unidades del lienzo entre un punto y el centro del anillo. */
function ringDistance(lat: number, lng: number): number {
  const [x, y] = projection.toXY(lat, lng);
  return Math.hypot(x - projection.ring.cx, y - projection.ring.cy);
}

describe('createSectorProjection', () => {
  it('centra la propiedad en el centro del lienzo', () => {
    const [x, y] = projection.toXY(CENTER.centerLat, CENTER.centerLng);
    expect(x).toBe(WIDTH / 2);
    expect(y).toBe(HEIGHT / 2);
  });

  it('el anillo de 15 minutos cabe entero en el lienzo', () => {
    // Es la regla que hace que el mapa defina el barrio: si el anillo se saliera,
    // el borde de la imagen no serían 15 minutos y el dibujo mentiría.
    expect(projection.ring.r).toBeGreaterThan(0);
    expect(projection.ring.r).toBeLessThanOrEqual(Math.min(WIDTH, HEIGHT) / 2);
    expect(projection.ring.cx - projection.ring.r).toBeGreaterThanOrEqual(0);
    expect(projection.ring.cy - projection.ring.r).toBeGreaterThanOrEqual(0);
    expect(projection.ring.cx + projection.ring.r).toBeLessThanOrEqual(WIDTH);
    expect(projection.ring.cy + projection.ring.r).toBeLessThanOrEqual(HEIGHT);
  });

  it('hacia el norte sube (Y menor), que es como va el lienzo', () => {
    const north = projection.toXY(CENTER.centerLat + 0.001, CENTER.centerLng);
    const south = projection.toXY(CENTER.centerLat - 0.001, CENTER.centerLng);
    const east = projection.toXY(CENTER.centerLat, CENTER.centerLng + 0.001);
    const west = projection.toXY(CENTER.centerLat, CENTER.centerLng - 0.001);

    expect(north[1]).toBeLessThan(south[1]);
    expect(east[0]).toBeGreaterThan(west[0]);
  });

  it('un kilómetro al norte cae exactamente en el anillo', () => {
    const lat = CENTER.centerLat + RADIUS_M / 111320;
    expect(ringDistance(lat, CENTER.centerLng)).toBeCloseTo(projection.ring.r, 0);
  });

  it('un kilómetro al este también, corrigiendo por latitud', () => {
    // Santiago está a ~33°: sin corregir por cos(lat) el mapa quedaría 16 % más
    // ancho que alto y el anillo ya no sería un círculo de 15 minutos.
    const cosLat = Math.cos((CENTER.centerLat * Math.PI) / 180);
    const lng = CENTER.centerLng + RADIUS_M / (111320 * cosLat);
    expect(ringDistance(CENTER.centerLat, lng)).toBeCloseTo(projection.ring.r, 0);
  });

  it('sigue siendo un círculo y no una elipse', () => {
    const cosLat = Math.cos((CENTER.centerLat * Math.PI) / 180);
    const north = ringDistance(CENTER.centerLat + 0.01, CENTER.centerLng);
    const east = ringDistance(CENTER.centerLat, CENTER.centerLng + 0.01 / cosLat);
    expect(east / north).toBeCloseTo(1, 3);
  });

  it('un radio inválido cae al estándar en vez de dividir entre cero', () => {
    const tiny = createSectorProjection({ ...CENTER, width: WIDTH, height: HEIGHT, radiusM: 0 });
    // Con radio 0 la escala sería Infinity y toda la geometría saldría en Inf:
    // en SVG eso significa "no se dibuja nada", que es un mapa vacío sin error.
    expect(Number.isFinite(tiny.unitsPerMeter)).toBe(true);
    expect(tiny.unitsPerMeter).toBeGreaterThan(0);
    expect(tiny.radiusM).toBe(RADIUS_M);

    const nan = createSectorProjection({ ...CENTER, width: WIDTH, height: HEIGHT, radiusM: NaN });
    expect(Number.isFinite(nan.unitsPerMeter)).toBe(true);
  });
});

describe('polylinePath', () => {
  it('arma M y L con las coordenadas proyectadas', () => {
    const d = polylinePath(
      [
        [CENTER.centerLat, CENTER.centerLng],
        [CENTER.centerLat + 0.01, CENTER.centerLng],
      ],
      projection
    );

    expect(d.startsWith('M')).toBe(true);
    expect(d).toContain('L');
    // Una sola línea: dos puntos, dos comandos.
    expect(d.match(/M/g)).toHaveLength(1);
    expect(d.match(/L/g)).toHaveLength(1);
  });

  it('redondea a una decimal para no engordar el HTML', () => {
    const d = polylinePath(
      [
        [CENTER.centerLat, CENTER.centerLng],
        [CENTER.centerLat + 0.01, CENTER.centerLng + 0.01],
      ],
      projection
    );

    const decimals = d.match(/\.\d+/g) ?? [];
    expect(decimals.length).toBeGreaterThan(0);
    for (const value of decimals) expect(value.length).toBeLessThanOrEqual(2); // "." + 1 decimal
  });

  it('devuelve cadena vacía con menos de dos puntos', () => {
    expect(polylinePath([], projection)).toBe('');
    expect(polylinePath([[CENTER.centerLat, CENTER.centerLng]], projection)).toBe('');
    expect(polylinePath(undefined as unknown as number[][], projection)).toBe('');
  });

  it('salta nodos malformados sin romper la línea', () => {
    const d = polylinePath(
      [[CENTER.centerLat, CENTER.centerLng], [] as unknown as number[], [CENTER.centerLat + 0.005, CENTER.centerLng]],
      projection
    );

    expect(d.match(/L/g)).toHaveLength(1);
  });

  it('no recorta lo que se sale del lienzo (lo corta el SVG)', () => {
    // Una vía larga atraviesa la celda y sigue kilómetros más allá: mantener sus
    // nodos hace que el borde del mapa se vea continuo en vez de cortado.
    const d = polylinePath(
      [
        [CENTER.centerLat, CENTER.centerLng],
        [CENTER.centerLat + 0.5, CENTER.centerLng + 0.5],
      ],
      projection
    );

    const numbers = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect(Math.max(...numbers)).toBeGreaterThan(WIDTH);
  });
});

describe('roadStyle', () => {
  it('conoce las clases principales', () => {
    expect(roadStyle('primary').width).toBeGreaterThan(roadStyle('residential').width);
    expect(roadStyle('footway').dash).toBeTruthy();
  });

  it('los enlaces heredan su clase base', () => {
    expect(roadStyle('primary_link')).toEqual(roadStyle('primary'));
    expect(roadStyle('motorway_link')).toEqual(roadStyle('motorway'));
  });

  it('una clase desconocida se dibuja como calle menor', () => {
    // Mejor que aparezca como cualquier calle que romper el mapa con un trazo
    // gigante por una clase que nadie anticipó.
    expect(roadStyle('some_future_class')).toEqual(roadStyle('residential'));
  });
});

describe('groupRoadPaths', () => {
  it('una sola traza por estilo, con varias subtrazas dentro', () => {
    const groups = groupRoadPaths(
      [
        { c: 'primary', n: [[CENTER.centerLat, CENTER.centerLng], [CENTER.centerLat + 0.01, CENTER.centerLng]] },
        { c: 'primary', n: [[CENTER.centerLat, CENTER.centerLng + 0.01], [CENTER.centerLat + 0.011, CENTER.centerLng]] },
        { c: 'residential', n: [[CENTER.centerLat, CENTER.centerLng], [CENTER.centerLat + 0.005, CENTER.centerLng]] },
      ],
      projection
    );

    expect(groups).toHaveLength(2);
    const primary = groups.find((g) => g.key === 'primary')!;
    // Dos vías de la misma clase en un solo `d`: dos M, un solo elemento.
    expect(primary.d.match(/M/g)).toHaveLength(2);
  });

  it('ignora vías sin geometría', () => {
    const groups = groupRoadPaths([{ c: 'primary', n: [] }], projection);
    expect(groups).toHaveLength(0);
  });
});

describe('groupAreaPaths', () => {
  it('cierra el polígono para que el relleno tenga forma', () => {
    const groups = groupAreaPaths(
      [
        {
          k: 'park',
          n: [
            [CENTER.centerLat, CENTER.centerLng],
            [CENTER.centerLat + 0.002, CENTER.centerLng],
            [CENTER.centerLat, CENTER.centerLng + 0.002],
          ],
        },
      ],
      projection
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].d.endsWith('Z')).toBe(true);
    expect(groups[0].fill).toBe(AREA_STYLES.park.fill);
  });

  it('salta superficies sin estilo conocido', () => {
    expect(groupAreaPaths([{ k: 'desconocida', n: [[0, 0], [1, 1]] }], projection)).toHaveLength(0);
  });
});

describe('projectPoints', () => {
  it('devuelve las posiciones redondeadas', () => {
    const points = projectPoints(
      [
        { lat: CENTER.centerLat, lng: CENTER.centerLng },
        { lat: CENTER.centerLat + 0.01, lng: CENTER.centerLng + 0.01 },
      ],
      projection
    );

    expect(points).toHaveLength(2);
    expect(points[0]).toEqual([WIDTH / 2, HEIGHT / 2]);
    for (const [x, y] of points) {
      expect(String(x).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(1);
      expect(String(y).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(1);
    }
  });

  it('un punto al norte queda por encima del centro', () => {
    const [x, y] = projectPoints([{ lat: CENTER.centerLat + 0.01, lng: CENTER.centerLng }], projection)[0];
    expect(y).toBeLessThan(HEIGHT / 2);
    expect(x).toBe(WIDTH / 2);
  });
});

describe('streetLabels', () => {
  const road = (c: string, n: number[][], name?: string) => ({ c, n, ...(name ? { name } : {}) });
  const east = (lat: number, span: number): number[][] => [
    [lat, CENTER.centerLng],
    [lat, CENTER.centerLng + span],
  ];

  it('rinde un rótulo por nombre, anclado al segmento más largo', () => {
    const labels = streetLabels(
      [
        road('residential', east(CENTER.centerLat, 0.002), 'Los Leones'),
        road('residential', east(CENTER.centerLat + 0.01, 0.003), 'Los Leones'),
      ],
      projection
    );

    expect(labels).toHaveLength(1);
    expect(labels[0].text).toBe('Los Leones');
    // El segmento más largo es el segundo: el rótulo va en su punto medio.
    const [mx, my] = projection.toXY(CENTER.centerLat + 0.01, CENTER.centerLng + 0.0015);
    expect(labels[0].x).toBeCloseTo(mx, 1);
    expect(labels[0].y).toBeCloseTo(my, 1);
    expect(labels[0].angle).toBe(0); // este, boca arriba
  });

  it('descarta vías sin nombre y clases que no se rotulan', () => {
    const seg = east(CENTER.centerLat, 0.002);
    expect(streetLabels([road('residential', seg)], projection)).toHaveLength(0);
    expect(streetLabels([road('footway', seg, 'Sendero')], projection)).toHaveLength(0);
    expect(streetLabels([road('service', seg, 'Acceso')], projection)).toHaveLength(0);
  });

  it('normaliza el rumbo para que el texto nunca quede boca abajo', () => {
    const west = streetLabels(
      [
        road(
          'primary',
          [
            [CENTER.centerLat, CENTER.centerLng + 0.002],
            [CENTER.centerLat, CENTER.centerLng],
          ],
          'Avenida X'
        ),
      ],
      projection
    );
    expect(west[0].angle).toBe(0); // de este a oeste: 180° → 0°

    const south = streetLabels(
      [
        road(
          'primary',
          [
            [CENTER.centerLat + 0.002, CENTER.centerLng],
            [CENTER.centerLat, CENTER.centerLng],
          ],
          'Avenida Y'
        ),
      ],
      projection
    );
    expect(south[0].angle).toBe(-90); // de norte a sur: 90° → -90°
  });

  it('las vías cortas y los nombres absurdos no rotulan', () => {
    // ~2,6 u de largo: el texto taparía la esquina entera.
    expect(
      streetLabels([road('residential', east(CENTER.centerLat, 0.0001), 'Corta')], projection)
    ).toHaveLength(0);
    // Más largo que el lienzo entero: no es un nombre de calle.
    expect(
      streetLabels([road('residential', east(CENTER.centerLat, 0.004), 'A'.repeat(60))], projection)
    ).toHaveLength(0);
  });

  it('una calle cuyo punto medio cae fuera del lienzo no gasta cupo', () => {
    // 0.05° al sur ≈ 1.550 u bajo el centro: queda bajo el viewBox y SVG lo
    // cortaría igual. Si rotulara igual, desplazaría a una calle visible.
    const outside = streetLabels(
      [road('residential', east(CENTER.centerLat - 0.05, 0.002), 'Fuera Del Encuadre')],
      projection
    );
    expect(outside).toHaveLength(0);
  });

  it('la clase define el tamaño y el tope corta por la cola', () => {
    const seg = east(CENTER.centerLat, 0.003);
    const labels = streetLabels(
      [road('residential', seg, 'Calle Secundaria'), road('primary', seg, 'Avenida Principal')],
      projection,
      { max: 1 }
    );
    expect(labels).toHaveLength(1);
    expect(labels[0].text).toBe('Avenida Principal');
    expect(labels[0].fontSize).toBe(16);

    const minor = streetLabels([road('residential', seg, 'Calle')], projection);
    expect(minor[0].fontSize).toBe(14);
  });

  it('dos rótulos encimados se resuelven en uno; separados, caben ambos', () => {
    const base = east(CENTER.centerLat, 0.002);
    const stacked = streetLabels(
      [
        road('residential', base, 'Calle A'),
        // ~15 u arriba: cajas encimadas.
        road('residential', base.map(([la, ln]) => [la + 0.0005, ln]), 'Calle B'),
      ],
      projection
    );
    expect(stacked).toHaveLength(1);
    expect(stacked[0].text).toBe('Calle A');

    const spaced = streetLabels(
      [
        road('residential', base, 'Calle A'),
        // ~56 u arriba: cuadras distintas, ambas se nombran.
        road('residential', base.map(([la, ln]) => [la + 0.002, ln]), 'Calle B'),
      ],
      projection
    );
    expect(spaced).toHaveLength(2);
  });

  it('corta los "varias alternativas" de OSM en la primera', () => {
    const labels = streetLabels(
      [road('primary', east(CENTER.centerLat, 0.002), 'Autopista Central;AP')],
      projection
    );
    expect(labels[0].text).toBe('Autopista Central');
  });

  it('respeta el tope de rótulos', () => {
    const roads = Array.from({ length: 5 }, (_, i) =>
      road('residential', east(CENTER.centerLat + i * 0.003, 0.002), `Calle ${i}`)
    );
    expect(streetLabels(roads, projection, { max: 3 })).toHaveLength(3);
  });
});
