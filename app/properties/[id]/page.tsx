import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPropertyById } from '@/lib/data/propertyDetail';
import { getPartnerById } from '@/lib/data/partners-store';
import { listCandidateProperties } from '@/lib/data/propertySource';
import { getPropertyViews } from '@/lib/data/propertyViewsStore';
import { compareToMarket, type RentInsights } from '@/lib/utils/propertyInsights';
import type { Property } from '@/lib/types/property';
import { PropertyDetailClient } from '@/components/properties/PropertyDetailClient';
import { formatArea, getPropertyTypeLabel } from '@/lib/utils/formatters';
import { propertyJsonLd } from '@/lib/seo/jsonld';
import { JsonLd } from '@/components/seo/JsonLd';

// La ficha se genera en el servidor (el HTML llega con los datos, sin un segundo
// viaje del navegador a la API) y se cachea con revalidación corta, para reflejar
// cambios publicados en caliente desde Supabase.
export const revalidate = 60;

/**
 * No se prerenderiza ninguna ficha: se generan bajo demanda en la primera visita
 * y quedan cacheadas (ISR), revalidándose cada 60 s. Declararlo es lo que hace
 * que Next trate la ruta como cacheable; sin esto, un segmento dinámico se
 * renderiza de nuevo en cada request.
 */
export function generateStaticParams() {
  return [];
}

// React `cache` deduplica la consulta entre `generateMetadata` y la página
// dentro del mismo render.
const getProperty = cache(getPropertyById);

/**
 * Resuelve los velocímetros de la ficha en arriendo.
 *
 * El precio de mercado se deriva de los comparables del catálogo completo (no de
 * un campo de la propiedad) y las visitas salen del contador público. Ninguna de
 * las dos lecturas puede tumbar la ficha: si fallan, se muestra el estado «sin
 * datos» en vez de un error.
 */
async function resolveRentInsights(property: Property): Promise<RentInsights> {
  let pool: Property[] = [];
  try {
    pool = (await listCandidateProperties()).properties;
  } catch {
    // Sin catálogo comparable: el velocímetro de precio queda «sin datos».
  }

  let views = 0;
  let viewsPersisted = false;
  try {
    const count = await getPropertyViews(property.id);
    views = count.views;
    viewsPersisted = count.persisted;
  } catch {
    // Sin contador: se muestra 0 y el ping del navegador lo completa.
  }

  return { market: compareToMarket(property, pool), views, viewsPersisted };
}

interface PageProps {
  params: { id: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const result = await getProperty(params.id);
  if (!result) {
    return { title: 'Propiedad no encontrada | Rix7' };
  }

  const { property } = result;
  const location = [property.address, property.city, property.state].filter(Boolean).join(', ');
  const typeLabel = getPropertyTypeLabel(property.property_type);
  const description = property.description
    ? property.description.slice(0, 155).trim()
    : `${typeLabel} de ${formatArea(property.area_sqm)} en ${location}.`;

  // Sin `images` manual: Next publica la tarjeta Open Graph generada por
  // opengraph-image.tsx (fase 3, 2.3) — foto, precio y specs de la ficha —
  // y Twitter hereda la misma tarjeta con summary_large_image.
  return {
    title: `${property.title} | Rix7`,
    description,
    alternates: { canonical: `/properties/${property.id}` },
    openGraph: {
      type: 'website',
      locale: 'es_CL',
      siteName: 'Rix7',
      title: property.title,
      description,
      url: `/properties/${property.id}`,
    },
    twitter: {
      card: 'summary_large_image',
      title: property.title,
      description,
    },
  };
}

export default async function PropertyDetailPage({ params }: PageProps) {
  const result = await getProperty(params.id);
  if (!result) {
    notFound();
  }

  const { property } = result;

  // La corredora se resuelve en el servidor y baja como prop: sus datos ya no
  // viven en el bundle del cliente, sino en Supabase.
  const partner = property.partner_id ? await getPartnerById(property.partner_id) : undefined;

  // Solo las fichas en arriendo llevan velocímetros: en venta la tarjeta es el
  // simulador hipotecario, que es la pregunta que se hace quien compra.
  const insights = property.status === 'for_rent' ? await resolveRentInsights(property) : undefined;

  return (
    <>
      {/* Datos estructurados para buscadores: precio, dirección y disponibilidad
          en el HTML inicial, sin segundo viaje del navegador. */}
      <JsonLd data={propertyJsonLd(property, partner)} />
      <PropertyDetailClient property={property} partner={partner} insights={insights} />
    </>
  );
}
