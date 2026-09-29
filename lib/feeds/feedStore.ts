import type { Property } from '@/lib/types/property';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createServiceRoleClient, isServiceRoleConfigured } from '@/lib/supabase/admin';
import { PARTNER_COLUMNS, type PartnerRow } from '@/lib/data/partnerRow';
import {
  feedTokenMatches,
  generateFeedToken,
  hashFeedToken,
} from './token';

/**
 * Persistencia del feed XML por corredora (hallazgo #14).
 *
 * Dos caminos separados, igual que `savedSearchesStore`:
 *
 * - **Panel de admin** (habilitar/deshabilitar, regenerar token): con la clave
 *   de servicio, porque escribe `feed_token_hash` por encima de RLS y el admin
 *   del panel tiene sesión, no clave de servicio.
 * - **Ruta pública del feed**: resuelve la corredora por hash del token con el
 *   cliente público — la tabla es de lectura pública y el hash nunca sale.
 *
 * El token en claro se devuelve **solo** al habilitar o regenerar: es la única
 * vez que existe en la respuesta de una API.
 */

export interface FeedActivationResult {
  ok: boolean;
  /** Estado resultante. */
  feedEnabled?: boolean;
  /** Token en claro: SOLO se devuelve aquí, nunca en lecturas posteriores. */
  token?: string;
  /** URL lista para registrar en el agregador. */
  feedUrl?: string;
  persisted?: boolean;
  error?: string;
  reason?: 'not_found' | 'database';
}

export interface PartnerFeedRow {
  id: string;
  slug: string;
  name: string;
  feedEnabled: boolean;
  /** true si hay token activo (no se puede leer su valor). */
  hasToken: boolean;
}

function toFeedRow(row: PartnerRow): PartnerFeedRow {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    feedEnabled: row.feed_enabled ?? false,
    hasToken: !!row.feed_token_hash,
  };
}

/** Estado del feed de una corredora, para el panel (sin secretos). */
export async function getPartnerFeedState(partnerId: string): Promise<PartnerFeedRow | null> {
  if (!isServiceRoleConfigured()) return null;

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('partners')
    .select(PARTNER_COLUMNS)
    .eq('id', partnerId)
    .maybeSingle();

  if (error || !data) return null;
  return toFeedRow(data as PartnerRow);
}

/**
 * Habilita (o deshabilita) el feed de una corredora.
 *
 * Al habilitar se genera un token nuevo si no había, o si `rotate` lo pide.
 * El token en claro se devuelve una vez; en la base queda el hash.
 */
export async function setPartnerFeedEnabled(
  partnerId: string,
  enabled: boolean,
  options?: { rotate?: boolean; siteUrl?: string }
): Promise<FeedActivationResult> {
  const persisted = isServiceRoleConfigured();

  if (!persisted) {
    return {
      ok: false,
      persisted: false,
      error:
        'El feed necesita Supabase configurado: sin base no hay dónde guardar el hash del token.',
      reason: 'database',
    };
  }

  const supabase = createServiceRoleClient();

  // ¿Existe y qué estado tiene? (decide si hay que generar token)
  const { data: current, error: readError } = await supabase
    .from('partners')
    .select('id, slug, feed_enabled, feed_token_hash')
    .eq('id', partnerId)
    .maybeSingle();

  if (readError || !current) {
    return { ok: false, persisted: true, error: 'Corredora no encontrada.', reason: 'not_found' };
  }

  const row = current as Pick<PartnerRow, 'id' | 'slug' | 'feed_enabled' | 'feed_token_hash'>;
  let token: string | null = null;

  if (enabled && (!row.feed_token_hash || options?.rotate)) {
    token = generateFeedToken();
    const { error } = await supabase
      .from('partners')
      .update({ feed_enabled: true, feed_token_hash: hashFeedToken(token) })
      .eq('id', partnerId);

    if (error) {
      return { ok: false, persisted: true, error: error.message, reason: 'database' };
    }
  } else {
    const { error } = await supabase
      .from('partners')
      .update({ feed_enabled: enabled })
      .eq('id', partnerId);

    if (error) {
      return { ok: false, persisted: true, error: error.message, reason: 'database' };
    }
  }

  const siteUrl = options?.siteUrl ?? '';
  return {
    ok: true,
    persisted: true,
    feedEnabled: enabled,
    token: enabled ? (token ?? undefined) : undefined,
    feedUrl: enabled && siteUrl ? `${siteUrl}/feeds/${row.slug}.xml` : undefined,
  };
}

/**
 * Propiedades de una corredora para su feed.
 *
 * La tabla `properties` de Supabase no tiene `partner_id` (el vínculo vive en
 * el catálogo del código), así que la fuente real es: catálogo filtrado por
 * `partner_id`, **más** las propiedades de Supabase cuando la corredora las
 * publicó ahí (de momento sin marca de corredora — se documentó en la
 * evaluación #14 como ampliación futura de esquema).
 */
export async function listPartnerFeedProperties(partnerId: string): Promise<
  { properties: Property[]; source: 'catalog' | 'supabase' }
> {
  const { ALL_PROPERTIES } = await import('@/lib/data/propertyCatalog');
  const properties = ALL_PROPERTIES.filter((property) => property.partner_id === partnerId);

  // Con Supabase configurado y catálogo vacío para esta corredora, se intenta
  // la tabla: si algún día `properties` gana `partner_id`, este feed la toma
  // sin cambiar la ruta.
  if (properties.length === 0 && isSupabaseConfigured()) {
    try {
      const { createPublicClient } = await import('@/lib/supabase/server');
      const supabase = createPublicClient();
      const { data, error } = await supabase
        .from('properties')
        .select('*')
        .limit(1000);

      if (!error && data) {
        return { properties: data as Property[], source: 'supabase' }; // sin partner_id todavía: todas
      }
    } catch {
      // cae al catálogo (posiblemente vacío)
    }
  }

  return { properties, source: 'catalog' };
}

/**
 * Corredora dueña de un token del feed, para la ruta pública.
 *
 * Compara **hashes**: el hash del token presentado contra `feed_token_hash`.
 * Con la tabla de lectura pública, un atacante que la lea obtiene hashes, no
 * tokens — no puede armar la URL del feed de otro.
 */
export async function findPartnerByFeedToken(
  token: string
): Promise<{ partner: PartnerFeedRow; hash: string } | null> {
  if (!isSupabaseConfigured() || !token) return null;

  const hash = hashFeedToken(token);
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('partners')
    .select(PARTNER_COLUMNS)
    .eq('feed_token_hash', hash)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as PartnerRow;

  // Doble verificación en tiempo constante: la igualdad por query ya casó el
  // hash, pero el feed exige también que el feed esté habilitado.
  if (!row.feed_enabled) return null;
  if (!feedTokenMatches(token, row.feed_token_hash ?? '')) return null;

  return { partner: toFeedRow(row), hash };
}
