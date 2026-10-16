import type { MetadataRoute } from 'next';
import { createClient } from '@supabase/supabase-js';
import { SITE_URL } from '@/lib/site';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { ALL_PROPERTIES } from '@/lib/data/propertyCatalog';
import { mergePropertyRows, type SitemapPropertyRow } from '@/lib/data/propertyRows';
import { listPartners } from '@/lib/data/partners-store';

export const revalidate = 3600; // regenerar cada hora

/**
 * Propiedades del sitemap (fase 3, 2.2).
 *
 * Tabla **y** catálogo: lo publicado en caliente entra al sitemap en la próxima
 * regeneración (cada hora, ver `revalidate`) aunque el deploy sea anterior — era
 * el punto del hallazgo. Si la tabla falla o no está configurada, queda el
 * catálogo. Nunca lanza: el sitemap siempre se genera.
 *
 * El cruce entre las dos fuentes vive en `mergePropertyRows`, que es función pura
 * y por eso está probada: comparar por id no alcanzaba (la tabla guarda un uuid y
 * el catálogo un id legible), y las fichas del catálogo ya cargadas en la base
 * aparecían dos veces, cada una con su URL.
 */
async function getPropertyRows(): Promise<SitemapPropertyRow[]> {
  const catalogRows: SitemapPropertyRow[] = ALL_PROPERTIES.map((p) => ({
    id: p.id,
    created_at: p.created_at ?? null,
    partner_id: p.partner_id ?? null,
  }));

  if (isSupabaseConfigured()) {
    try {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL as string,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
      );
      const { data, error } = await supabase
        .from('properties')
        .select('id, updated_at, created_at, partner_id');
      if (!error && data) {
        return mergePropertyRows(data as SitemapPropertyRow[], catalogRows);
      }
    } catch {
      // fallback abajo
    }
  }
  return catalogRows;
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
    // Las páginas legales son indexables y con canonical propio: entran al
    // sitemap con prioridad baja — se indexan, pero no compiten con el
    // catálogo. Rara vez cambian, así que 'yearly'.
    ...[
      '/legal/terminos',
      '/legal/privacidad',
    ].map((path) => ({
      url: `${SITE_URL}${path}`,
      changeFrequency: 'yearly' as const,
      priority: 0.3,
    })),
    ...propertyEntries,
    ...partnerEntries,
  ];
}
