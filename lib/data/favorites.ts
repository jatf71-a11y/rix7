/**
 * Favoritos de la cuenta.
 *
 * Antes vivían solo en `localStorage`, así que se quedaban en el dispositivo
 * donde se marcaron. Ahora viven en `public.favorites`: siguen a la persona
 * entre el celular y el computador.
 *
 * Módulo puro (sin Supabase ni React): lo comparten la ruta, el proveedor del
 * cliente y los tests.
 */

/**
 * Clave de `localStorage` **histórica**. Se conserva tal cual porque es donde
 * están los favoritos de quienes ya usaban la web: cambiar el nombre sería
 * perderlos. Ahora solo se usa para migrarlos a la cuenta una vez.
 */
export const FAVORITES_STORAGE_KEY = 'rix7_favorites';

/**
 * Tope de favoritos por cuenta.
 *
 * No es una regla de negocio, es un límite de cordura: sin él, un script podría
 * meter miles de filas por usuario. Guardar 200 propiedades ya es guardar más
 * de lo que alguien mira.
 */
export const MAX_FAVORITES = 200;

/** Longitud máxima aceptada para un id de propiedad. */
const MAX_ID_LENGTH = 80;

export interface FavoriteRow {
  user_id: string;
  property_id: string;
  created_at: string;
}

export const FAVORITE_COLUMNS = 'property_id, created_at';

/**
 * Valida un id de propiedad que llega del navegador.
 *
 * Los ids del catálogo son legibles (`scl-depto-marco-polo`), no UUID, así que
 * se acepta un alfabeto acotado en vez de confiar en el valor: evita que un POST
 * armado a mano guarde basura o algo enorme.
 */
export function normalizePropertyId(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const id = value.trim();
  if (!id || id.length > MAX_ID_LENGTH) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(id)) return null;

  return id;
}

/** Normaliza una lista y descarta lo inválido, sin duplicados. */
export function normalizePropertyIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  for (const entry of value) {
    const id = normalizePropertyId(entry);
    if (id) seen.add(id);
  }

  // `Array.from` y no spread: el `target` del proyecto no habilita iterar un
  // `Set` directamente.
  return Array.from(seen);
}

/**
 * Lee los favoritos del dispositivo tal como quedaron guardados.
 *
 * Nunca lanza: un `localStorage` con JSON roto (o con otra cosa) devuelve vacío
 * en vez de romper la ficha. Antes ese `JSON.parse` estaba sin protección en el
 * componente, así que un valor corrupto tiraba la página.
 */
export function parseLocalFavorites(raw: string | null): string[] {
  if (!raw) return [];

  try {
    return normalizePropertyIds(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** Fila de `public.favorites` → id de propiedad. */
function rowToFavoritePropertyId(row: { property_id?: unknown }): string | null {
  return normalizePropertyId(row?.property_id);
}

/** Filas → ids, de la más nueva a la más vieja (el orden lo pone la consulta). */
export function rowsToPropertyIds(rows: Array<{ property_id?: unknown }>): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    const id = rowToFavoritePropertyId(row);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Decide qué hacer con los favoritos del dispositivo al entrar a la cuenta.
 *
 * La regla es **la cuenta manda**:
 *
 * - Si la cuenta ya tiene favoritos, se usan esos y lo del dispositivo se
 *   ignora. Es a propósito: si en otro dispositivo se quitó un favorito,
 *   reimportar lo local lo resucitaría y volvería a aparecer marcado.
 * - Si la cuenta está vacía, lo del dispositivo **se sube**: es el caso de quien
 *   venía usando la web sin cuenta y acaba de entrar. Sin esto, entrar le
 *   borraría lo que había guardado.
 *
 * Se devuelve también qué hacer con el `localStorage`, para que el proveedor no
 * tenga que volver a razonar esta decisión.
 */
export type LocalFavoritesDecision =
  | { action: 'import'; ids: string[] }
  | { action: 'ignore' }
  | { action: 'none' };

export function decideLocalFavoritesMigration(
  accountIds: string[],
  localIds: string[]
): LocalFavoritesDecision {
  if (accountIds.length > 0) return { action: 'ignore' };
  if (localIds.length === 0) return { action: 'none' };

  return { action: 'import', ids: localIds.slice(0, MAX_FAVORITES) };
}

/** ¿Se alcanzó el tope? Se usa para avisar antes de intentar guardar. */
export function isFavoritesLimitReached(ids: string[]): boolean {
  return ids.length >= MAX_FAVORITES;
}
