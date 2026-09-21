import type { Metadata } from 'next';
import Link from 'next/link';
import { getCatalogPropertyById } from '@/lib/data/propertyCatalog';
import { getPartnerById } from '@/lib/data/partners';
import { SITE_URL } from '@/lib/site';
import SharePropertyLanding from './SharePropertyLanding';

type Props = { params: { id: string } };

async function fetchProperty(id: string) {
  // Prefer catalog for static metadata; when catalog misses it, do a lightweight runtime fetch.
  const local = getCatalogPropertyById(id);
  if (local) return local;

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (url && key && !url.includes('placeholder')) {
      const supabase = createClient(url, key);
      const { data, error } = await supabase.rpc('get_property_by_id', { property_id: id });
      if (!error && data?.length) return data[0];
    }
  } catch {}

  try {
    const res = await fetch(`${SITE_URL}/api/properties/${id}`, { cache: 'no-store' });
    if (res.ok) {
      const json = await res.json();
      if (json?.success && json.data) return json.data;
    }
  } catch {}

  return null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const property = await fetchProperty(params.id);
  if (!property) return { title: 'Propiedad no encontrada | Rix7' };

  const title = `${property.title || 'Propiedad'} en ${property.city || 'Chile'} | Rix7`;
  const description = property.description?.slice(0, 160) || `${property.address}, ${property.city}`;
  const image = property.images?.[0] || '/brand-logo.png';
  const url = `${SITE_URL}/compartir/${property.id}`;

  return {
    title,
    description,
    openGraph: { title, description, url, images: [{ url: image, width: 1200, height: 630 }], type: 'website', locale: 'es_CL' },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
    alternates: { canonical: url },
  };
}

export default async function SharePropertyPage({ params }: Props) {
  const property = await fetchProperty(params.id);

  if (!property) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-2xl font-bold text-slate-900">Propiedad no encontrada</h1>
          <p className="text-slate-500">Esta propiedad puede haber sido removida o el enlace no es válido.</p>
          <Link href="/" className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white font-semibold rounded-xl">
            Volver al portal
          </Link>
        </div>
      </div>
    );
  }

  const partner = property.partner_id ? getPartnerById(property.partner_id) : undefined;

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <SharePropertyLanding property={property} partner={partner as any} shareUrl={`${SITE_URL}/compartir/${property.id}`} />
    </div>
  );
}
