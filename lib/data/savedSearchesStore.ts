import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createServiceRoleClient, isServiceRoleConfigured } from '@/lib/supabase/admin';
import {
  SAVED_SEARCH_COLUMNS,
  describeSavedSearch,
  rowToSavedSearch,
  type SavedSearch,
  type SavedSearchFilters,
  type SavedSearchRow,
} from './savedSearches';

/**
 * Búsquedas guardadas.
 *
 * Dos caminos bien separados:
 *
 * - **Lo que hace una persona con las suyas** (listar, guardar, borrar): con el
 *   cliente de sesión, y RLS garantiza que solo toque las propias.
 * - **Lo que hace el job de alertas**: leer las de todos y marcar cuándo se
 *   avisó. Necesita la clave de servicio, porque RLS lo bloquea a propósito.
 *
 * No hay respaldo en memoria: una búsqueda guardada sin cuenta no significa
 * nada. Cuando Supabase no está configurado, se dice en vez de simularlo.
 */

export interface SavedSearchWriteResult {
  ok: boolean;
  search?: SavedSearch;
  error?: string;
  /** true cuando el problema es que no hay Supabase configurado. */
  unconfigured?: boolean;
}

async function sessionClient() {
  const { createClient } = await import('@/lib/supabase/server');
  return createClient();
}

/** Búsquedas de una persona, de la más nueva a la más vieja. */
export async function listSavedSearches(userId: string): Promise<SavedSearch[]> {
  if (!isSupabaseConfigured() || !userId) return [];

  try {
    const supabase = await sessionClient();
    const { data, error } = await supabase
      .from('saved_searches')
      .select(SAVED_SEARCH_COLUMNS)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error || !data) return [];
    return (data as SavedSearchRow[]).map(rowToSavedSearch);
  } catch {
    return [];
  }
}

/** Guarda la búsqueda de una persona. La etiqueta se calcula acá, una vez. */
export async function createSavedSearch(
  userId: string,
  filters: SavedSearchFilters
): Promise<SavedSearchWriteResult> {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      unconfigured: true,
      error: 'Guardar búsquedas necesita Supabase configurado.',
    };
  }

  try {
    const supabase = await sessionClient();
    const { data, error } = await supabase
      .from('saved_searches')
      .insert({
        user_id: userId,
        filters,
        label: describeSavedSearch(filters),
      })
      .select(SAVED_SEARCH_COLUMNS)
      .single();

    if (error || !data) {
      return { ok: false, error: error?.message ?? 'No se pudo guardar la búsqueda.' };
    }

    return { ok: true, search: rowToSavedSearch(data as SavedSearchRow) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'No se pudo guardar la búsqueda.',
    };
  }
}

/** Borra una búsqueda propia. El `user_id` se filtra además de lo que exige RLS. */
export async function deleteSavedSearch(
  id: string,
  userId: string
): Promise<SavedSearchWriteResult> {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      unconfigured: true,
      error: 'Guardar búsquedas necesita Supabase configurado.',
    };
  }

  try {
    const supabase = await sessionClient();
    const { data, error } = await supabase
      .from('saved_searches')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)
      .select('id')
      .maybeSingle();

    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: 'Búsqueda no encontrada.' };

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'No se pudo borrar la búsqueda.',
    };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Job de alertas (clave de servicio: lee y escribe por encima de RLS)
// ═════════════════════════════════════════════════════════════════════════════

export function canRunAlertsJob(): boolean {
  return isServiceRoleConfigured();
}

/** Todas las búsquedas activas, de todas las personas. */
export async function listSearchesToNotify(): Promise<SavedSearch[]> {
  if (!isServiceRoleConfigured()) return [];

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('saved_searches')
    .select(SAVED_SEARCH_COLUMNS)
    .eq('notify', true)
    .order('created_at', { ascending: true });

  if (error || !data) return [];
  return (data as SavedSearchRow[]).map(rowToSavedSearch);
}

/** Marca cuándo se avisó (o cuándo se fijó la línea base). */
export async function markSearchNotified(id: string, at: Date): Promise<boolean> {
  if (!isServiceRoleConfigured()) return false;

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from('saved_searches')
    .update({ last_notified_at: at.toISOString() })
    .eq('id', id);

  return !error;
}

/** Correo de la persona dueña de la búsqueda. */
export async function getUserEmail(userId: string): Promise<string | null> {
  if (!isServiceRoleConfigured()) return null;

  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase.auth.admin.getUserById(userId);
    if (error || !data?.user?.email) return null;
    return data.user.email;
  } catch {
    return null;
  }
}

/** Borra los avisos de una búsqueda que quedó inutilizable. Solo para el job. */
export async function disableSearch(id: string): Promise<boolean> {
  if (!isServiceRoleConfigured()) return false;

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from('saved_searches').update({ notify: false }).eq('id', id);
  return !error;
}
