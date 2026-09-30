import type { Property } from '@/lib/types/property';
import { isSupabaseConfigured } from '@/lib/supabase/config';

/**
 * Propiedades de una corredora (plan fase 3, 2.1).
 *
 * Con `properties.partner_id` en la base, la atribución se lee de los datos:
 * la tabla se consulta **filtrando por corredora en el servidor** — nunca se
 * traen "todas" para filtrar en cliente, que era el fallback anterior y
 * habría atribuido a la corredora propiedades ajenas. Las de la tabla y las
 * del catálogo se mezclan deduplicadas por `id` (una propiedad migrada del
 * catálogo a la base no sale dos veces).
 *
 * Consumidores: la ruta pública del feed (`/feeds/<slug>.xml`, hallazgo #14)
 * y la página `/empresas/<slug>`, que resuelve el listado en el servidor.
 */

/** Resultado de la lectura de propiedades de una corredora. */
export interface PartnerPropertiesResult {
  properties: Property[];
  /**
   * - `supabase`: todo vino de la tabla (datos en caliente).
   * - `catalog`: todo vino del catálogo del build.
   * - `mixed`: tabla **y** catálogo (una corredora puede tener ambas cosas).
   */
  source: 'catalog' | 'supabase' | 'mixed';
}

export async function listPartnerProperties(
  partnerId: string
): Promise<PartnerPropertiesResult> {
  const { ALL_PROPERTIES } = await import('@/lib/data/propertyCatalog');
  const catalogProperties = ALL_PROPERTIES.filter((property) => property.partner_id === partnerId);

  if (isSupabaseConfigured()) {
    try {
      const { createPublicClient } = await import('@/lib/supabase/server');
      const supabase = createPublicClient();
      const { data, error } = await supabase
        .from('properties')
        .select('*')
        // Filtro obligatorio: sin él la consulta devolvería el portal
        // completo y el feed/la página de la corredora se llenaría de
        // propiedades ajenas.
        .eq('partner_id', partnerId)
        .limit(1000);

      if (!error && data) {
        const hot = data as Property[];
        const catalogIds = new Set(catalogProperties.map((property) => property.id));
        const merged = [...hot.filter((property) => !catalogIds.has(property.id)), ...catalogProperties];
        return {
          properties: merged,
          source: hot.length > 0 ? (catalogProperties.length > 0 ? 'mixed' : 'supabase') : 'catalog',
        };
      }
    } catch {
      // Sin Supabase disponible (o sin la columna aún, en una base sin
      // migrar): cae al catálogo, que sigue siendo la fuente correcta.
    }
  }

  return { properties: catalogProperties, source: 'catalog' };
}
