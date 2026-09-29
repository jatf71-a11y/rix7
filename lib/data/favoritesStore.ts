import { isSupabaseConfigured } from '@/lib/supabase/config';
import {
  FAVORITE_COLUMNS,
  MAX_FAVORITES,
  rowsToPropertyIds,
  type FavoriteRow,
} from './favorites';

/**
 * Favoritos de la cuenta, contra Supabase.
 *
 * Siempre con el **cliente de sesión**: RLS (`auth.uid() = user_id`) garantiza
 * que nadie toque los de otro, y además cada consulta filtra por `user_id`.
 *
 * No hay respaldo en `localStorage` acá a propósito: el respaldo del dispositivo
 * lo maneja el proveedor del cliente. Esta capa solo habla con la base, y cuando
 * no hay Supabase lo dice en vez de simular que guardó.
 */

export interface FavoritesResult {
  ok: boolean;
  /** Lista completa resultante, para que el cliente quede igual que la base. */
  ids?: string[];
  error?: string;
  unconfigured?: boolean;
}

const UNCONFIGURED: FavoritesResult = {
  ok: false,
  unconfigured: true,
  error: 'Los favoritos de la cuenta necesitan Supabase configurado.',
};

async function sessionClient() {
  const { createClient } = await import('@/lib/supabase/server');
  return createClient();
}

/** Favoritos de una persona, del más nuevo al más viejo. */
export async function listFavoriteIds(userId: string): Promise<string[]> {
  if (!isSupabaseConfigured() || !userId) return [];

  try {
    const supabase = await sessionClient();
    const { data, error } = await supabase
      .from('favorites')
      .select('property_id, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error || !data) return [];
    return rowsToPropertyIds(data as FavoriteRow[]);
  } catch {
    return [];
  }
}

/**
 * Agrega favoritos (uno o varios) y devuelve la lista completa.
 *
 * El alta es **idempotente**: `upsert` con `ignoreDuplicates` hace que guardar
 * dos veces la misma propiedad no sea un error. Sin eso, apretar el corazón dos
 * veces (o abrir la ficha en dos pestañas) devolvería un 409 y la UI quedaría
 * creyendo que falló.
 */
export async function addFavorites(userId: string, propertyIds: string[]): Promise<FavoritesResult> {
  if (!isSupabaseConfigured()) return UNCONFIGURED;
  if (propertyIds.length === 0) return { ok: true, ids: await listFavoriteIds(userId) };

  try {
    const supabase = await sessionClient();

    // Se respeta el tope sin depender de lo que haya mandado el cliente: si ya
    // hay más de las permitidas, se recortan las nuevas.
    const current = await listFavoriteIds(userId);
    const room = Math.max(0, MAX_FAVORITES - current.length);
    const toInsert = propertyIds.filter((id) => !current.includes(id)).slice(0, room);

    if (toInsert.length > 0) {
      const { error } = await supabase
        .from('favorites')
        .upsert(
          toInsert.map((propertyId) => ({ user_id: userId, property_id: propertyId })),
          { onConflict: 'user_id,property_id', ignoreDuplicates: true }
        );

      if (error) return { ok: false, error: error.message };
    }

    return { ok: true, ids: await listFavoriteIds(userId) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'No se pudo guardar el favorito.',
    };
  }
}

/** Quita un favorito y devuelve la lista completa. */
export async function removeFavorite(userId: string, propertyId: string): Promise<FavoritesResult> {
  if (!isSupabaseConfigured()) return UNCONFIGURED;

  try {
    const supabase = await sessionClient();
    const { error } = await supabase
      .from('favorites')
      .delete()
      .eq('user_id', userId)
      .eq('property_id', propertyId);

    if (error) return { ok: false, error: error.message };

    return { ok: true, ids: await listFavoriteIds(userId) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'No se pudo quitar el favorito.',
    };
  }
}


