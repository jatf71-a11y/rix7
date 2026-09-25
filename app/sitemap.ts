import type { MetadataRoute } from 'next';
import { createClient } from '@supabase/supabase-js';
import { SITE_URL } from '@/lib/site';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { ALL_PROPERTIES } from '@/lib/data/propertyCatalog';
import { listPartners } from '@/lib/data/partners-store';

export const revalidate = 3600; // regenerar cada hora

interface PropertyRow {
  id: string;
  updated_at?: string | null;
  created_at?: string | null;
}

/**
 * IDs de propiedades para el sitemap.
 * Primero intenta Supabase (catálogo real); si no está configurado o falla,
 * usa el catálogo en memoria. Nunca lanza: el sitemap siempre se genera.
 */
async function getPropertyRows(): Promise<PropertyRow[]> {
  if (isSupabaseConfigured()) {
    try {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL as string,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
      );
      const { data, error } = await supabase
        .from('properties')
        .select('id, updated_at, created_at');
      if (!error && data && data.length > 0) return data as PropertyRow[];
    } catch {
      // fallback abajo
    }
  }
  return ALL_PROPERTIES.map((p) => ({ id: p.id, created_at: p.created_at ?? null }));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const properties = await getPropertyRows();
  // Las corredoras viven en Supabase: una que se dé de alta en el panel entra al
  // sitemap sin tocar código.
  const { partners } = await listPartners();

  const propertyEntries: MetadataRoute.Sitemap = properties.map((p) => ({
    url: `${SITE_URL}/properties/${p.id}`,
    lastModified: p.updated_at || p.created_at || undefined,
    changeFrequency: 'weekly',
    priority: 0.8,
  }));

  const partnerEntries: MetadataRoute.Sitemap = partners.map((partner) => ({
    url: `${SITE_URL}/empresas/${partner.slug}`,
    changeFrequency: 'weekly',
    priority: 0.6,
  }));

  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    ...propertyEntries,
    ...partnerEntries,
  ];
}
