import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPropertyById } from '@/lib/data/propertyDetail';
import { getPartnerById } from '@/lib/data/partners-store';
import { PropertyDetailClient } from '@/components/properties/PropertyDetailClient';
import { formatArea, getPropertyTypeLabel } from '@/lib/utils/formatters';

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

  const images = property.images && property.images.length > 0 ? [property.images[0]] : undefined;

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
      images,
    },
    twitter: {
      card: 'summary_large_image',
      title: property.title,
      description,
      images,
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

  return <PropertyDetailClient property={property} partner={partner} />;
}
