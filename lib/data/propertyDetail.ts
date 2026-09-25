import { Property } from '@/lib/types/property';
import { getCatalogPropertyById } from '@/lib/data/propertyCatalog';
import { isSupabaseConfigured } from '@/lib/supabase/config';

export type PropertyDetailSource = 'supabase' | 'national_catalog';

export interface PropertyDetailResult {
  property: Property;
  source: PropertyDetailSource;
}

/**
 * Obtiene el detalle de una propiedad por id.
 *
 * Vive en un módulo de servidor neutral para que lo compartan tanto la route
 * `/api/properties/[id]` como la ficha (`app/properties/[id]/page.tsx`), que
 * ahora lo usa directamente en el render y así evita el viaje extra del
 * navegador hacia la API.
 *
 * Orden de resolución:
 *  1. Supabase (RPC `get_property_by_id`) si está configurado.
 *  2. Fallback: catálogo nacional en memoria.
 *  3. `null` si no existe en ninguna fuente.
 */
export async function getPropertyById(id: string): Promise<PropertyDetailResult | null> {
  if (!id) return null;

  // ═══ Intentar Supabase primero ═══
  try {
    if (isSupabaseConfigured()) {
      // Cliente sin cookies: al no usar una API dinámica, la ficha puede
      // generarse de forma estática y revalidarse (ISR) en vez de ejecutarse
      // en cada visita. La RPC es SECURITY DEFINER y la tabla tiene lectura
      // pública, así que el resultado es el mismo que con sesión.
      const { createPublicClient } = await import('@/lib/supabase/server');
      const supabase = createPublicClient();
      const { data, error } = await supabase.rpc('get_property_by_id', {
        property_id: id,
      });

      if (!error && data && data.length > 0) {
        return { property: data[0] as Property, source: 'supabase' };
      }
    }
  } catch {
    // Supabase no disponible — usar catálogo en memoria
  }

  // ═══ Fallback: catálogo nacional en memoria ═══
  const local = getCatalogPropertyById(id);
  if (local) {
    return { property: local, source: 'national_catalog' };
  }

  return null;
}
