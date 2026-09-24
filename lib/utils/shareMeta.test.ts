import { describe, it, expect } from 'vitest';
import {
  buildShareMeta,
  buildShareTitle,
  buildShareFacts,
  buildShareDescription,
  redactSensitive,
  truncateAtWord,
  shareLinkLabel,
  SHARE_TITLE_MAX,
  SHARE_DESCRIPTION_MAX,
} from './shareMeta';

/** La propiedad de referencia del catálogo (Torre Marco Polo, Las Condes). */
const property = {
  title: 'Departamento Amoblado en Torre Marco Polo, Las Condes',
  description:
    'Moderno departamento amoblado en la icónica Torre Marco Polo. Ubicado en el corazón de Las Condes, con vistas espectaculares.',
  property_type: 'apartment',
  status: 'for_rent',
  price: 1800000,
  bedrooms: 2,
  bathrooms: 2,
  area_sqm: 95,
  city: 'Las Condes',
  state: 'Región Metropolitana de Santiago',
  address: 'Av. Isabel Montt 1160, Piso 14',
  features: ['Amoblado completo', 'Vista cordillera', 'Gimnasio'],
};

describe('buildShareTitle', () => {
  it('encabeza con el precio y el arriendo se anota por mes', () => {
    const title = buildShareTitle(property);
    expect(title.startsWith('$ 1.800.000 /mes')).toBe(true);
  });

  it('suma tipo, dormitorios y comuna', () => {
    const title = buildShareTitle(property);
    expect(title).toContain('Departamento 2 dormitorios');
    expect(title).toContain('Las Condes');
  });

  it('la venta no lleva /mes', () => {
    const title = buildShareTitle({ ...property, status: 'for_sale' });
    expect(title.startsWith('$ 1.800.000 ·')).toBe(true);
  });

  it('respeta el límite de la tarjeta', () => {
    expect(buildShareTitle(property).length).toBeLessThanOrEqual(SHARE_TITLE_MAX);
  });

  it('con una comuna larga sacrifica el tipo antes que el precio o la comuna', () => {
    const title = buildShareTitle({ ...property, city: 'San Pedro de la Paz, Concepción' });
    expect(title.length).toBeLessThanOrEqual(SHARE_TITLE_MAX);
    expect(title).toContain('$ 1.800.000 /mes');
    expect(title).toContain('San Pedro de la Paz, Concepción');
  });

  it('sin dormitorios no deja el hueco', () => {
    const title = buildShareTitle({ ...property, bedrooms: 0 });
    expect(title).toBe('$ 1.800.000 /mes · Departamento · Las Condes');
  });

  it('nunca publica la dirección', () => {
    const title = buildShareTitle(property);
    expect(title).not.toContain('1160');
    expect(title).not.toContain('Isabel Montt');
    expect(title).toContain('Las Condes');
  });
});

describe('buildShareDescription', () => {
  it('arma la especificación con tipo, dormitorios, baños y superficie', () => {
    const description = buildShareDescription(property, 'Catedral Propiedades');
    expect(description).toContain('Departamento de 2 dormitorios, 2 baños, 95 m² en Las Condes.');
  });

  it('usa la primera oración de la corredora como gancho', () => {
    const description = buildShareDescription(property, 'Catedral Propiedades');
    expect(description).toContain('Moderno departamento amoblado en la icónica Torre Marco Polo.');
  });

  it('cierra nombrando a la corredora, que es el CTA dentro del chat', () => {
    expect(buildShareDescription(property, 'Catedral Propiedades')).toContain(
      'Fotos, entorno y datos completos con Catedral Propiedades.'
    );
  });

  it('sin descripción de la corredora usa los atributos', () => {
    const description = buildShareDescription(
      { ...property, description: undefined },
      'Catedral Propiedades'
    );
    expect(description).toContain('Amoblado completo, Vista cordillera, Gimnasio');
  });

  it('nunca publica la dirección, ni siquiera dentro del texto de la corredora', () => {
    const description = buildShareDescription(
      {
        ...property,
        description: 'Espectacular depto en Av. Isabel Montt 1160, Piso 14, con vista. Llamar al +56 9 8765 4321.',
      },
      'Catedral Propiedades'
    );
    expect(description).not.toContain('Isabel Montt');
    expect(description).not.toContain('1160');
    expect(description).not.toContain('Piso 14');
    expect(description).not.toContain('8765');
  });

  it('respeta el límite y corta por palabra', () => {
    const description = buildShareDescription(
      { ...property, description: 'Palabra '.repeat(80) },
      'Catedral Propiedades'
    );
    expect(description.length).toBeLessThanOrEqual(SHARE_DESCRIPTION_MAX);
    expect(description.endsWith('Palabr')).toBe(false);
  });

  it('sin comuna no deja preposición suelta', () => {
    const description = buildShareDescription({ ...property, city: undefined }, undefined);
    expect(description.startsWith('Departamento de 2 dormitorios, 2 baños, 95 m².')).toBe(true);
  });
});

describe('buildShareFacts', () => {
  it('arma dormitorios, baños y superficie', () => {
    expect(buildShareFacts(property)).toBe('2 dormitorios · 2 baños · 95 m²');
  });

  it('agrega la comuna cuando el título no la nombra', () => {
    expect(buildShareFacts({ ...property, title: 'Departamento Amoblado' })).toBe(
      '2 dormitorios · 2 baños · 95 m² · Las Condes'
    );
  });

  it('no repite la comuna que el título ya trae', () => {
    expect(buildShareFacts(property)).not.toContain('Las Condes');
  });

  it('singulariza una sola unidad', () => {
    expect(buildShareFacts({ ...property, bedrooms: 1, bathrooms: 1 })).toBe(
      '1 dormitorio · 1 baño · 95 m²'
    );
  });

  it('sin datos devuelve una cadena vacía, no separadores sueltos', () => {
    expect(
      buildShareFacts({ price: 1000, bedrooms: 0, bathrooms: 0, area_sqm: 0, city: undefined })
    ).toBe('');
  });
});

describe('redactSensitive', () => {
  it('borra teléfonos en formato chileno y correos', () => {
    const out = redactSensitive('Escribe a camila@rix7.cl o llama al +56 9 8765 4321.');
    expect(out).not.toContain('camila@rix7.cl');
    expect(out).not.toContain('8765');
  });

  it('quita el número de piso o departamento', () => {
    expect(redactSensitive('Depto en Av. Providencia, piso 14, luminoso')).not.toContain('piso 14');
  });

  it('respeta el texto cuando no hay nada que borrar', () => {
    expect(redactSensitive('Amoblado, vista cordillera y gimnasio.')).toBe(
      'Amoblado, vista cordillera y gimnasio.'
    );
  });
});

describe('truncateAtWord', () => {
  it('deja intacto lo que cabe', () => {
    expect(truncateAtWord('Corta', 20)).toBe('Corta');
  });

  it('corta en el último espacio y no deja puntuación colgando', () => {
    expect(truncateAtWord('uno dos tres cuatro', 12)).toBe('uno dos tres');
  });

  it('una sola palabra larguísima se corta duro antes de pasarse', () => {
    expect(truncateAtWord('x'.repeat(50), 10)).toBe('x'.repeat(10));
  });
});

describe('buildShareMeta', () => {
  it('devuelve las dos piezas listas para la metadata', () => {
    const meta = buildShareMeta(property, 'Catedral Propiedades');
    expect(meta.title).toContain('$ 1.800.000 /mes');
    expect(meta.description).toContain('Catedral Propiedades');
    expect(meta.title.length).toBeLessThanOrEqual(SHARE_TITLE_MAX);
    expect(meta.description.length).toBeLessThanOrEqual(SHARE_DESCRIPTION_MAX);
  });
});

describe('shareLinkLabel', () => {
  it('quita el protocolo, que en la imagen solo gasta ancho', () => {
    expect(shareLinkLabel('https://rix7.cl/compartir/scl-depto-marco-polo')).toBe(
      'rix7.cl/compartir/scl-depto-marco-polo'
    );
    expect(shareLinkLabel('http://rix7.cl/compartir/scl-depto-marco-polo')).toBe(
      'rix7.cl/compartir/scl-depto-marco-polo'
    );
  });

  it('saca la barra final para no imprimir una ruta que no existe', () => {
    expect(shareLinkLabel('https://rix7.cl/compartir/x/')).toBe('rix7.cl/compartir/x');
  });

  it('deja intacto lo que no trae protocolo', () => {
    expect(shareLinkLabel('rix7.cl/compartir/x')).toBe('rix7.cl/compartir/x');
  });

  it('conserva el puerto: en desarrollo el enlace tiene que seguir siendo el real', () => {
    expect(shareLinkLabel('http://localhost:3000/compartir/x')).toBe('localhost:3000/compartir/x');
  });
});
