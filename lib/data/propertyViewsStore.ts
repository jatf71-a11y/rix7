import { isSupabaseConfigured } from '@/lib/supabase/config';

/**
 * Visitas de la ficha de una propiedad.
 *
 * - La **lectura es pública** (`get_property_views`), para que la ficha pueda
 *   mostrar el contador sin sesión.
 * - El **alta también es pública** (`increment_property_view`): quien visita no
 *   tiene cuenta. Las dos RPC son `SECURITY DEFINER`, así que la tabla no
 *   necesita política de escritura ni de lectura pública.
 * - Sin Supabase configurado, las visitas se cuentan en memoria del proceso: se
 *   **pierden al reiniciar**, y sirven solo para ver el velocímetro funcionando
 *   en desarrollo.
 */

export interface PropertyViewResult {
  views: number;
  /** `false` = desarrollo sin Supabase: el conteo no sobrevive al reinicio. */
  persisted: boolean;
}

/**
 * Total de visitas **con su origen**, para las lecturas.
 *
 * No basta devolver el número: quien lo muestra necesita saber si salió de
 * Supabase o del respaldo en memoria, porque el de memoria se pierde al
 * reiniciar. Es el mismo contrato que ya usan `listLeads` y `listPartners`
 * (`persistent`), adaptado al singular del conteo.
 */
export interface PropertyViewCount {
  views: number;
  /** `false` = respaldo en memoria (sin Supabase): conteo de prueba. */
  persisted: boolean;
}

/**
 * Respaldo en memoria, solo para desarrollo sin Supabase.
 *
 * En `globalThis` y no en una variable de módulo: en Next cada ruta del servidor
 * compila su propio bundle, así que la ruta que **cuenta** (`/api/properties/[id]/view`)
 * y la página que **lee** tendrían cada una su mapa. El objeto global sí es el
 * mismo proceso.
 */
const devStore = globalThis as typeof globalThis & {
  __rix7DevPropertyViews?: Map<string, number>;
};

function readDevViews(): Map<string, number> {
  devStore.__rix7DevPropertyViews ??= new Map();
  return devStore.__rix7DevPropertyViews;
}

async function publicClient() {
  const { createPublicClient } = await import('@/lib/supabase/server');
  return createPublicClient();
}

/** Visitas acumuladas de una propiedad, o `0` si no hay registro. */
export async function getPropertyViews(propertyId: string): Promise<PropertyViewCount> {
  if (!propertyId) return { views: 0, persisted: false };

  if (isSupabaseConfigured()) {
    try {
      const supabase = await publicClient();
      const { data, error } = await supabase.rpc('get_property_views', {
        p_property_id: propertyId,
      });
      if (!error) return { views: Number(data) || 0, persisted: true };
    } catch {
      // Supabase caído: se cae al respaldo en memoria.
    }
  }

  return { views: readDevViews().get(propertyId) ?? 0, persisted: false };
}

/** Suma una visita y devuelve el total ya actualizado. */
export async function recordPropertyView(propertyId: string): Promise<PropertyViewResult> {
  if (!propertyId) return { views: 0, persisted: false };

  if (isSupabaseConfigured()) {
    try {
      const supabase = await publicClient();
      const { data, error } = await supabase.rpc('increment_property_view', {
        p_property_id: propertyId,
      });
      if (!error) return { views: Number(data) || 0, persisted: true };
    } catch {
      // Supabase caído: se cae al respaldo en memoria.
    }
  }

  const store = readDevViews();
  const next = (store.get(propertyId) ?? 0) + 1;
  store.set(propertyId, next);
  return { views: next, persisted: false };
}
