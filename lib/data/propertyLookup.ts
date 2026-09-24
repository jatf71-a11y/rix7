import { getCatalogPropertyById } from './propertyCatalog';
import { SITE_URL } from '@/lib/site';
import type { Property } from '@/lib/types/property';

/**
 * Una propiedad por id, en el orden que conviene al servidor.
 *
 * Vive fuera de la página porque la usan dos cosas que se renderizan por
 * separado: el HTML de la landing y su tarjeta de vista previa (la imagen que
 * ve quien recibe el enlace). Antes estaba dentro de la página y la imagen no
 * podía reutilizarla.
 *
 * Orden: catálogo estático → Supabase (RPC, con la anon key) → API pública.
 * Cada paso tolera su propio fallo: un enlace compartido tiene que abrir con lo
 * que haya, no quedarse sin nada porque el catálogo no traía la propiedad.
 */
export async function fetchPropertyById(id: string): Promise<Property | null> {
  const local = getCatalogPropertyById(id);
  if (local) return local;

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (url && key && !url.includes('placeholder')) {
      const supabase = createClient(url, key);
      const { data, error } = await supabase.rpc('get_property_by_id', { property_id: id });
      if (!error && data?.length) return data[0] as Property;
    }
  } catch {}

  try {
    const res = await fetch(`${SITE_URL}/api/properties/${id}`, { cache: 'no-store' });
    if (res.ok) {
      const json = await res.json();
      if (json?.success && json.data) return json.data as Property;
    }
  } catch {}

  return null;
}
