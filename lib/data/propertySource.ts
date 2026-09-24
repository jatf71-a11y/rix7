import type { Property } from '@/lib/types/property';
import { ALL_PROPERTIES } from './propertyCatalog';
import { isSupabaseConfigured } from '@/lib/supabase/config';

/**
 * De dónde salen las propiedades cuando hay que leerlas **en el servidor**.
 *
 * Estaba dentro del job de alertas, pero lo necesitaba un segundo consumidor
 * —la página de favoritos— y ahí importar el job arrastraba el armado de
 * correos y el envío. Acá vive solo la lectura, que es lo compartido.
 *
 * Orden de preferencia: la tabla (si Supabase está configurado y responde) y, si
 * no, el catálogo del código. Nunca queda vacío: un portal sin propiedades es
 * peor que uno con el catálogo del build.
 */

/** Límites del buscador: Chile continental completo. */
const CHILE_BOUNDS = {
  min_lng: -76.0,
  min_lat: -56.0,
  max_lng: -66.0,
  max_lat: -17.0,
};

export interface CandidateProperties {
  properties: Property[];
  source: 'supabase' | 'catalog';
}

export async function listCandidateProperties(): Promise<CandidateProperties> {
  if (isSupabaseConfigured()) {
    try {
      const { createPublicClient } = await import('@/lib/supabase/server');
      const supabase = createPublicClient();
      const { data, error } = await supabase.rpc('get_properties_filtered', CHILE_BOUNDS);

      if (!error && data && data.length > 0) {
        return { properties: data as Property[], source: 'supabase' };
      }
    } catch {
      // Sin Supabase disponible se usa el catálogo, abajo.
    }
  }

  return { properties: ALL_PROPERTIES, source: 'catalog' };
}
