/**
 * Tests del feed Trovit (hallazgo #14): mapeo de tipos, formato de fecha,
 * escape XML/CDATA, estructura del documento y reglas de publicación.
 *
 * El generador es puro, así que los tests verifican el XML completo sin red
 * ni base — mismo enfoque que `alertEmail.test.ts` para el correo.
 */
import { describe, expect, it } from 'vitest';
import type { Property } from '@/lib/types/property';
import {
  buildTrovitFeed,
  escapeXml,
  formatTrovitDate,
  mapToTrovitType,
} from './trovit';

function makeProperty(overrides: Partial<Property> = {}): Property {
  return {
    id: 'prop-1',
    title: 'Depto amoblado en Providencia',
    description: 'Luminoso, cerca del metro <y> con "caracteres" & acentos: áéíóú',
    price: 650000,
    property_type: 'apartment',
    status: 'for_rent',
    bedrooms: 2,
    bathrooms: 1,
    area_sqm: 65,
    parking_spots: 1,
    year_built: 2015,
    address: 'Av. Providencia 1234',
    city: 'Providencia',
    state: 'Región Metropolitana',
    zip_code: '7500001',
    images: ['https://img/1.jpg', 'https://img/2.jpg', ''],
    features: ['bodega'],
    lat: -33.43,
    lng: -70.62,
    created_at: '2026-09-28T15:30:00Z',
    partner_id: 'catedral',
    ...overrides,
  };
}

const AGENCY = {
  name: 'Catedral Bienes Raíces',
  phone: '+56 2 2000 0000',
  email: 'contacto@catedral.cl',
};
const SITE = 'https://rix7.cl';

describe('mapeo de tipos', () => {
  it('mapea los tipos del catálogo a los de Trovit', () => {
    expect(mapToTrovitType('apartment')).toBe('flat');
    expect(mapToTrovitType('house')).toBe('house');
    expect(mapToTrovitType('premium')).toBe('house');
    expect(mapToTrovitType('parcel')).toBe('land');
    expect(mapToTrovitType('land')).toBe('land');
    expect(mapToTrovitType('office')).toBe('office');
    expect(mapToTrovitType('local')).toBe('commercial');
    expect(mapToTrovitType('warehouse')).toBe('warehouse');
    expect(mapToTrovitType('parking')).toBe('garage');
  });

  it('devuelve null para tipos sin equivalente (se omiten del feed)', () => {
    expect(mapToTrovitType('all')).toBeNull();
  });
});

describe('formato de fecha Trovit', () => {
  it('usa DD/MM/AAAA (no ISO)', () => {
    expect(formatTrovitDate('2026-09-28T15:30:00Z')).toBe('28/09/2026');
    expect(formatTrovitDate('2026-01-05T00:00:00Z')).toBe('05/01/2026');
  });

  it('devuelve null para fechas inválidas', () => {
    expect(formatTrovitDate('no-es-fecha')).toBeNull();
  });
});

describe('escape XML', () => {
  it('escapa los cinco caracteres especiales', () => {
    expect(escapeXml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&apos;');
  });
});

describe('feed completo', () => {
  const xml = buildTrovitFeed({ properties: [makeProperty()], siteUrl: SITE, agency: AGENCY });

  it('produce un documento con cabecera y cierre', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true);
    expect(xml.trimEnd().endsWith('</trovit>')).toBe(true);
    expect(xml).toContain('<trovit>');
  });

  it('incluye el anuncio con url absoluta y tipo mapeado', () => {
    expect(xml).toContain('<ad>');
    expect(xml).toContain(`<url>${SITE}/properties/prop-1</url>`);
    expect(xml).toContain('<type>flat</type>');
    expect(xml).toContain('<property_type>flat</property_type>');
  });

  it('arriendo lleva price con period="month"; venta no', () => {
    expect(xml).toContain('<price period="month">650000</price>');
    const venta = buildTrovitFeed({
      properties: [makeProperty({ status: 'for_sale', price: 150000000 })],
      siteUrl: SITE,
      agency: AGENCY,
    });
    expect(venta).toContain('<price>150000000</price>');
    expect(venta).not.toContain('period="month"');
  });

  it('los textos van en CDATA y los caracteres especiales no rompen el XML', () => {
    // El título y la descripción deben estar dentro de CDATA con su contenido
    // original (los acentos incluidos).
    expect(xml).toContain('<title><![CDATA[Depto amoblado en Providencia]]></title>');
    expect(xml).toContain('cerca del metro <y> con "caracteres" & acentos');
  });

  it('un título con ]]> se parte en dos bloques CDATA y sigue bien formado', () => {
    const peligroso = buildTrovitFeed({
      properties: [makeProperty({ title: 'Casa ]]> con cierre' })],
      siteUrl: SITE,
      agency: AGENCY,
    });
    expect(peligroso).toContain('<title><![CDATA[Casa ]]]]><![CDATA[> con cierre]]></title>');
  });

  it('imágenes: filtra vacías, numera títulos y limita a 20', () => {
    expect((xml.match(/<picture>/g) || []).length).toBe(2);
    expect(xml).toContain('foto 1');
    expect(xml).toContain('foto 2');

    const muchas = buildTrovitFeed({
      properties: [
        makeProperty({ images: Array.from({ length: 30 }, (_, i) => `https://img/${i}.jpg`) }),
      ],
      siteUrl: SITE,
      agency: AGENCY,
    });
    expect((muchas.match(/<picture>/g) || []).length).toBe(20);
  });

  it('incluye fecha Trovit, medidas, rooms, bathrooms y parking', () => {
    expect(xml).toContain('<date>28/09/2026</date>');
    expect(xml).toContain('<floor_area unit="m²">65</floor_area>');
    expect(xml).toContain('<rooms>2</rooms>');
    expect(xml).toContain('<bathrooms>1</bathrooms>');
    expect(xml).toContain('<parking>1</parking>');
  });

  it('los campos opcionales ausentes no generan nodos vacíos', () => {
    const minimal = buildTrovitFeed({
      properties: [
        makeProperty({ state: undefined, zip_code: undefined, created_at: undefined, video_url: undefined }),
      ],
      siteUrl: SITE,
      agency: AGENCY,
    });
    expect(minimal).not.toContain('<region>');
    expect(minimal).not.toContain('<postcode>');
    expect(minimal).not.toContain('<date>');
    expect(minimal).not.toContain('<video_url>');
  });

  it('video_url viaja como multimedia', () => {
    const conVideo = buildTrovitFeed({
      properties: [makeProperty({ video_url: 'https://video/reel.mp4' })],
      siteUrl: SITE,
      agency: AGENCY,
    });
    expect(conVideo).toContain('<video_url>https://video/reel.mp4</video_url>');
  });
});

describe('reglas de publicación', () => {
  it('omite las vendidas y los tipos sin equivalente', () => {
    const xml = buildTrovitFeed({
      properties: [
        makeProperty({ id: 'venta' }),
        makeProperty({ id: 'vendida', status: 'sold' }),
        makeProperty({ id: 'raro', property_type: 'all' }),
      ],
      siteUrl: SITE,
      agency: AGENCY,
    });
    expect(xml).toContain('<id>venta</id>');
    expect(xml).not.toContain('<id>vendida</id>');
    expect(xml).not.toContain('<id>raro</id>');
  });

  it('el contacto de la corredora va en el comentario, no por propiedad', () => {
    // El teléfono/email se comentan en la cabecera (datos de la corredora,
    // no del agente individual) — el cuerpo no lleva contacto repetido.
    const xml = buildTrovitFeed({
      properties: [makeProperty(), makeProperty({ id: 'prop-2' })],
      siteUrl: SITE,
      agency: AGENCY,
    });
    expect(xml).toContain('Feed de Catedral Bienes Raíces vía Rix7');
    expect((xml.match(/<ad>/g) || []).length).toBe(2);
  });

  it('feed vacío sigue siendo XML válido (solo cabecera y cierre)', () => {
    const xml = buildTrovitFeed({ properties: [], siteUrl: SITE, agency: AGENCY });
    expect(xml.trimEnd().endsWith('</trovit>')).toBe(true);
    expect(xml).not.toContain('<ad>');
  });
});
