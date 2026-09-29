import { describe, expect, it } from 'vitest';

import { Property } from '@/lib/types/property';
import { Partner } from '@/lib/data/partners';
import {
  absoluteUrl,
  propertyJsonLd,
  realEstateAgentJsonLd,
  serializeJsonLd,
} from './jsonld';

/** Ficha de ejemplo con todos los campos relevantes poblados. */
const propertyBase: Property = {
  id: 'scl-depto-marco-polo',
  title: 'Depto Nueva York conantiago',
  description: '<script>alert("xss")</script> Departamento luminoso.',
  price: 580000000,
  property_type: 'apartment',
  status: 'for_sale',
  bedrooms: 2,
  bathrooms: 2,
  area_sqm: 68,
  parking_spots: 1,
  address: 'Nueva York 12',
  city: 'Providencia',
  state: 'Región Metropolitana',
  images: ['/properties/marco-polo/1.webp', 'https://cdn.ejemplo.cl/foto.jpg'],
  features: [],
  lat: -33.4264,
  lng: -70.617,
  created_at: '2026-09-01T10:00:00.000Z',
};

const partnerBase: Partner = {
  id: 'catedral',
  slug: 'catedral',
  name: 'Catedral Propiedades',
  logo: '/logos/catedral.png',
  description: 'Corredora con 20 años en el mercado.',
  color: '#3B82F6',
  contact: { phone: '+56 2 2000 0001', whatsapp: '', email: 'contacto@catedral.cl' },
};

describe('lib/seo/jsonld', () => {
  describe('absoluteUrl', () => {
    it('convierte rutas en URLs absolutas con el dominio canónico', () => {
      expect(absoluteUrl('/properties/x')).toBe('https://rix7.cl/properties/x');
      expect(absoluteUrl('properties/x')).toBe('https://rix7.cl/properties/x');
    });
  });

  describe('propertyJsonLd', () => {
    it('construye RealEstateListing con precio CLP y disponibilidad', () => {
      const data = propertyJsonLd(propertyBase) as Record<string, any>;

      expect(data['@type']).toBe('RealEstateListing');
      expect(data.name).toBe(propertyBase.title);
      expect(data.offers.priceCurrency).toBe('CLP');
      expect(data.offers.price).toBe(580000000);
      expect(data.offers.availability).toBe('https://schema.org/InStock');
      expect(data.offers.seller).toEqual({
        '@type': 'Organization',
        name: 'Rix7',
      });
      expect(data.url).toBe('https://rix7.cl/properties/scl-depto-marco-polo');
    });

    it('usa SoldOut para una propiedad vendida', () => {
      const data = propertyJsonLd({
        ...propertyBase,
        status: 'sold',
      }) as Record<string, any>;

      expect(data.offers.availability).toBe('https://schema.org/SoldOut');
    });

    it('atribuye a la corredora cuando la ficha tiene partner', () => {
      const data = propertyJsonLd(propertyBase, partnerBase) as Record<string, any>;

      expect(data.offers.seller).toEqual({
        '@type': 'RealEstateAgent',
        name: 'Catedral Propiedades',
        url: 'https://rix7.cl/empresas/catedral',
      });
    });

    it('arma la dirección solo con las claves que la ficha conoce', () => {
      const data = propertyJsonLd(propertyBase) as Record<string, any>;

      expect(data.address).toEqual({
        '@type': 'PostalAddress',
        streetAddress: 'Nueva York 12',
        addressLocality: 'Providencia',
        addressRegion: 'Región Metropolitana',
        addressCountry: 'CL',
      });
    });

    it('omite address y geo cuando la ficha no los sabe (coherente con la regla #5)', () => {
      const data = propertyJsonLd({
        ...propertyBase,
        address: '',
        city: '',
        state: undefined,
      }) as Record<string, any>;

      expect(data.address).toBeUndefined();
    });

    it('incluye habitaciones, baños y superficie en unidades schema.org', () => {
      const data = propertyJsonLd(propertyBase) as Record<string, any>;

      expect(data.numberOfRooms).toBe(2);
      expect(data.numberOfBathroomsTotal).toBe(2);
      expect(data.floorSize).toEqual({
        '@type': 'QuantitativeValue',
        value: 68,
        unitCode: 'MTK',
      });
    });

    it('mapea imágenes relativas a absolutas y conserva las externas', () => {
      const data = propertyJsonLd(propertyBase) as Record<string, any>;

      expect(data.image).toEqual([
        'https://rix7.cl/properties/marco-polo/1.webp',
        'https://cdn.ejemplo.cl/foto.jpg',
      ]);
    });
  });

  describe('realEstateAgentJsonLd', () => {
    it('expone el contacto de la corredora (no el del agente individual)', () => {
      const data = realEstateAgentJsonLd(partnerBase) as Record<string, any>;

      expect(data['@type']).toBe('RealEstateAgent');
      expect(data.telephone).toBe('+56 2 2000 0001');
      expect(data.email).toBe('contacto@catedral.cl');
      expect(data.url).toBe('https://rix7.cl/empresas/catedral');
    });

    it('omite claves vacías en vez de enseñar datos que no son', () => {
      const data = realEstateAgentJsonLd({
        ...partnerBase,
        contact: { phone: '', whatsapp: '', email: '' },
        website: undefined,
      }) as Record<string, any>;

      expect(data.telephone).toBeUndefined();
      expect(data.email).toBeUndefined();
      expect(data.sameAs).toBeUndefined();
    });
  });

  describe('serializeJsonLd', () => {
    it('escapa < para que ningún valor pueda cerrar el script', () => {
      const serialized = serializeJsonLd(propertyJsonLd(propertyBase));

      expect(serialized).not.toContain('</script>');
      expect(serialized).toContain('\\u003cscript>');
      expect(() => JSON.parse(serialized)).not.toThrow();
      const parsed = JSON.parse(serialized) as Record<string, any>;
      expect(parsed.description).toContain('<script>alert("xss")</script>');
    });
  });
});
