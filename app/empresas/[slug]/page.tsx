import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPartnerBySlug } from '@/lib/data/partners-store';
import EmpresaDetail from './EmpresaDetail';

// La corredora se resuelve en el servidor desde Supabase: el HTML inicial ya
// trae su nombre, logo y descripción, sin un segundo viaje del navegador.
// Se cachea con revalidación, igual que la ficha de una propiedad.
export const revalidate = 300;

/**
 * Sin prerenderizar: cada corredora se genera bajo demanda en su primera visita
 * y queda cacheada. Declararlo es lo que hace que la ruta sea cacheable; sin
 * esto, un segmento dinámico se re-renderiza en cada request.
 */
export function generateStaticParams() {
  return [];
}

interface PageProps {
  params: { slug: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const partner = await getPartnerBySlug(params.slug);
  if (!partner) {
    return { title: 'Empresa no encontrada | Rix7' };
  }

  return {
    title: `${partner.name} | Rix7`,
    description: partner.description || `Propiedades publicadas por ${partner.name} en Rix7.`,
    alternates: { canonical: `/empresas/${partner.slug}` },
    openGraph: {
      type: 'website',
      locale: 'es_CL',
      siteName: 'Rix7',
      title: partner.name,
      description: partner.description,
      url: `/empresas/${partner.slug}`,
      images: partner.logo ? [partner.logo] : undefined,
    },
  };
}

export default async function EmpresaPage({ params }: PageProps) {
  const partner = await getPartnerBySlug(params.slug);
  if (!partner) {
    notFound();
  }

  return <EmpresaDetail partner={partner} />;
}
