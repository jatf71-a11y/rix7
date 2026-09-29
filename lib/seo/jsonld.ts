/**
 * Datos estructurados JSON-LD del portal.
 *
 * La fase 1 detectó que ninguna ficha llevaba JSON-LD: los buscadores veían
 * HTML sin semántica de precio, dirección ni disponibilidad, y los resultados
 * enriquecidos (rich results) quedaban fuera de alcance. Este módulo construye
 * los objetos schema.org desde los tipos de dominio, para que la regla viva en
 * un solo lugar testeado y las páginas solo monten `<script type="application/ld+json">`.
 *
 * Se serializa con `<` escapado (`\u003c`) al renderizar: un título o
 * descripción que contenga `</script>` no puede romper el documento.
 */

import { Property } from '@/lib/types/property';
import { Partner } from '@/lib/data/partners';
import { SITE_NAME, SITE_URL } from '@/lib/site';

export type JsonLdObject = Record<string, unknown>;

/** Convierte una ruta del portal en URL absoluta (requisito de Google). */
export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Las imágenes pueden ser rutas locales (`/...`) o URLs externas. */
function absoluteImage(url: string): string {
  return /^https?:\/\//i.test(url) ? url : absoluteUrl(url);
}

/**
 * `PostalAddress` solo con lo que la ficha realmente sabe: incluir claves
 * vacías enseñaría al buscador datos que no son.
 */
function postalAddress(property: Property): JsonLdObject | undefined {
  if (!property.address && !property.city && !property.state) return undefined;

  return {
    '@type': 'PostalAddress',
    streetAddress: property.address || undefined,
    addressLocality: property.city || undefined,
    addressRegion: property.state || undefined,
    addressCountry: 'CL',
  };
}

/** Disponibilidad schema.org según el estado de la publicación. */
function availabilityFor(status: Property['status']): string {
  return status === 'sold'
    ? 'https://schema.org/SoldOut'
    : 'https://schema.org/InStock';
}

/**
 * JSON-LD de una ficha de propiedad.
 *
 * @type `RealEstateListing`: el tipo específico de schema.org para anuncios
 * inmobiliarios (Google lo trata como variante de `Product` para rich results
 * de precio/disponibilidad).
 */
export function propertyJsonLd(property: Property, partner?: Partner | null): JsonLdObject {
  const url = absoluteUrl(`/properties/${property.id}`);

  const jsonLd: JsonLdObject = {
    '@context': 'https://schema.org',
    '@type': 'RealEstateListing',
    name: property.title,
    description: property.description ? property.description.slice(0, 500) : undefined,
    url,
    image: property.images?.length
      ? property.images.map((image) => absoluteImage(image))
      : undefined,
    datePosted: property.created_at || undefined,
    address: postalAddress(property),
    // Punto aproximado: el mismo que ya es público en el mapa de la ficha.
    geo:
      Number.isFinite(property.lat) && Number.isFinite(property.lng)
        ? { '@type': 'GeoCoordinates', latitude: property.lat, longitude: property.lng }
        : undefined,
    numberOfRooms: property.bedrooms > 0 ? property.bedrooms : undefined,
    numberOfBathroomsTotal: property.bathrooms > 0 ? property.bathrooms : undefined,
    floorSize:
      property.area_sqm > 0
        ? { '@type': 'QuantitativeValue', value: property.area_sqm, unitCode: 'MTK' }
        : undefined,
    yearBuilt: property.year_built || undefined,
    offers: {
      '@type': 'Offer',
      url,
      // El catálogo almacena el precio en pesos chilenos.
      priceCurrency: 'CLP',
      price: property.price,
      availability: availabilityFor(property.status),
      seller: partner
        ? {
            '@type': 'RealEstateAgent',
            name: partner.name,
            url: absoluteUrl(`/empresas/${partner.slug}`),
          }
        : { '@type': 'Organization', name: SITE_NAME },
    },
  };

  return jsonLd;
}

/**
 * JSON-LD de una corredora inscrita (página `/empresas/[slug]`).
 *
 * El contacto expuesto es el de la **corredora** (los mismos botones Llamar /
 * WhatsApp / Mail de la ficha); el del agente individual se mantiene fuera por
 * la regla de privacidad fijada en el hallazgo #5.
 */
export function realEstateAgentJsonLd(partner: Partner): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'RealEstateAgent',
    name: partner.name,
    description: partner.description || undefined,
    url: absoluteUrl(`/empresas/${partner.slug}`),
    image: partner.logo ? absoluteImage(partner.logo) : undefined,
    telephone: partner.contact?.phone || undefined,
    email: partner.contact?.email || undefined,
    sameAs: partner.website || undefined,
    areaServed: { '@type': 'Country', name: 'Chile' },
  };
}

/**
 * Serialización segura para `<script type="application/ld+json">`: escapa `<`
 * para que ningún valor pueda cerrar el script antes de tiempo.
 */
export function serializeJsonLd(data: JsonLdObject): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
