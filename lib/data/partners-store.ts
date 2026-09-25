import {
  getPartnerById as getCatalogPartnerById,
  getPartnerBySlug as getCatalogPartnerBySlug,
  partners as catalogPartners,
  type Partner,
} from './partners';
import {
  PARTNER_COLUMNS,
  partnerPatchToRow,
  partnerToRow,
  rowToPartner,
  type PartnerRow,
} from './partnerRow';
import { isSupabaseConfigured } from '@/lib/supabase/config';

/**
 * Corredoras inscritas: ahora son filas de `public.partners`, no memoria.
 *
 * Antes este módulo era un arreglo en memoria: sobrevivía al hot reload pero se
 * reiniciaba con el servidor, así que en Vercel cada instancia arrancaba con las
 * de fábrica y **un alta desde el panel se perdía**.
 *
 * Reglas de resolución:
 *  1. Si Supabase está configurado, la base manda.
 *  2. Si no lo está, falla, o la tabla todavía está vacía, se usa el catálogo de
 *     `lib/data/partners.ts` — el portal nunca se queda sin corredoras.
 *  3. En desarrollo sin Supabase, las escrituras siguen funcionando en memoria
 *     para poder usar el panel, pero se marcan `persisted: false` para que la UI
 *     lo diga en vez de fingir que guardó.
 */

export type PartnerSource = 'supabase' | 'catalog';

export interface PartnerListResult {
  partners: Partner[];
  source: PartnerSource;
  /** true = las altas y ediciones del panel se guardan de verdad */
  persistent: boolean;
  /** true = hay Supabase configurado pero la tabla está vacía (falta el seed) */
  emptyTable: boolean;
}

export interface PartnerWriteResult {
  ok: boolean;
  partner?: Partner;
  /** false = se guardó solo en memoria (desarrollo sin Supabase) */
  persisted: boolean;
  /** Mensaje para mostrar al usuario */
  error?: string;
  /** Motivo legible por máquina, para que la route elija el estado HTTP */
  reason?: 'not_found' | 'duplicate' | 'database';
}

/**
 * Respaldo en memoria, **solo** para desarrollo sin Supabase, donde el login es
 * imposible y el panel quedaría inservible. No es una caché: es el modo de
 * prueba, y se reinicia con el servidor.
 */
let devPartners: Partner[] = [...catalogPartners];

/** Cliente sin cookies: permite que las páginas públicas sigan siendo cacheables. */
async function publicClient() {
  const { createPublicClient } = await import('@/lib/supabase/server');
  return createPublicClient();
}

/** Cliente con la sesión del usuario: lo exige RLS para escribir. */
async function sessionClient() {
  const { createClient } = await import('@/lib/supabase/server');
  return createClient();
}

/** Orden de presentación: el declarado por el equipo y, a igualdad, por nombre. */
function sortRows(rows: PartnerRow[]): PartnerRow[] {
  return [...rows].sort((a, b) => {
    const byOrder = (a.sort_order ?? 0) - (b.sort_order ?? 0);
    return byOrder !== 0 ? byOrder : a.name.localeCompare(b.name, 'es');
  });
}

/** Listado para el panel de admin y para el carrusel de socios. */
export async function listPartners(): Promise<PartnerListResult> {
  const configured = isSupabaseConfigured();

  if (configured) {
    try {
      const supabase = await publicClient();
      const { data, error } = await supabase
        .from('partners')
        .select(PARTNER_COLUMNS)
        .order('sort_order', { ascending: true });

      if (!error && data && data.length > 0) {
        return {
          partners: sortRows(data as PartnerRow[]).map(rowToPartner),
          source: 'supabase',
          persistent: true,
          emptyTable: false,
        };
      }

      if (!error && data && data.length === 0) {
        // Configurado pero sin filas: el portal sigue mostrando el catálogo y el
        // panel avisa de que falta ejecutar `supabase/seed.sql`.
        return {
          partners: [...devPartners],
          source: 'catalog',
          persistent: true,
          emptyTable: true,
        };
      }
    } catch {
      // Supabase caído — respaldo abajo
    }
  }

  return {
    partners: [...devPartners],
    source: 'catalog',
    // Si Supabase está configurado, las escrituras siguen intentando la base
    // aunque la lectura haya fallado; lo que se marca como no persistente es
    // solo el modo de desarrollo sin Supabase.
    persistent: configured,
    emptyTable: false,
  };
}

/** Corredora por id (el valor que guardan las propiedades en `partner_id`). */
export async function getPartnerById(id: string): Promise<Partner | undefined> {
  if (!id) return undefined;

  if (isSupabaseConfigured()) {
    try {
      const supabase = await publicClient();
      const { data, error } = await supabase
        .from('partners')
        .select(PARTNER_COLUMNS)
        .eq('id', id)
        .maybeSingle();

      if (!error && data) return rowToPartner(data as PartnerRow);
    } catch {
      // Respaldo abajo
    }
  }

  return getCatalogPartnerById(id);
}

/** Corredora por slug (el valor que arma las URLs de /empresas/<slug>). */
export async function getPartnerBySlug(slug: string): Promise<Partner | undefined> {
  if (!slug) return undefined;

  if (isSupabaseConfigured()) {
    try {
      const supabase = await publicClient();
      const { data, error } = await supabase
        .from('partners')
        .select(PARTNER_COLUMNS)
        .eq('slug', slug)
        .maybeSingle();

      if (!error && data) return rowToPartner(data as PartnerRow);
    } catch {
      // Respaldo abajo
    }
  }

  return getCatalogPartnerBySlug(slug);
}

/** Alta desde el panel. */
export async function createPartner(partner: Partner): Promise<PartnerWriteResult> {
  if (!isSupabaseConfigured()) {
    if (devPartners.some((p) => p.id === partner.id)) {
      return {
        ok: false,
        persisted: false,
        error: 'Ya existe una corredora con ese id.',
        reason: 'duplicate',
      };
    }
    devPartners = [...devPartners, partner];
    return { ok: true, partner, persisted: false };
  }

  try {
    const supabase = await sessionClient();
    const { data, error } = await supabase
      .from('partners')
      .insert(partnerToRow(partner, devPartners.length))
      .select(PARTNER_COLUMNS)
      .single();

    if (error || !data) {
      // 23505 = violación de clave única: el id o el slug ya existen.
      const duplicate = error?.code === '23505';
      return {
        ok: false,
        persisted: true,
        error: duplicate ? 'Ya existe una corredora con ese id o slug.' : error?.message ?? 'No se pudo crear.',
        reason: duplicate ? 'duplicate' : 'database',
      };
    }

    return { ok: true, partner: rowToPartner(data as PartnerRow), persisted: true };
  } catch (error) {
    return { ok: false, persisted: true, error: messageOf(error), reason: 'database' };
  }
}

/** Edición desde el panel. Solo escribe las claves que llegaron. */
export async function updatePartner(
  id: string,
  updates: Partial<Partner>
): Promise<PartnerWriteResult> {
  if (!isSupabaseConfigured()) {
    const index = devPartners.findIndex((p) => p.id === id);
    if (index === -1) {
      return {
        ok: false,
        persisted: false,
        error: 'Corredora no encontrada.',
        reason: 'not_found',
      };
    }

    const updated = { ...devPartners[index], ...updates };
    devPartners = devPartners.map((p, i) => (i === index ? updated : p));
    return { ok: true, partner: updated, persisted: false };
  }

  try {
    const supabase = await sessionClient();
    const { data, error } = await supabase
      .from('partners')
      .update(partnerPatchToRow(updates))
      .eq('id', id)
      .select(PARTNER_COLUMNS)
      .maybeSingle();

    if (error) return { ok: false, persisted: true, error: error.message, reason: 'database' };
    if (!data) {
      return {
        ok: false,
        persisted: true,
        error: 'Corredora no encontrada.',
        reason: 'not_found',
      };
    }

    return { ok: true, partner: rowToPartner(data as PartnerRow), persisted: true };
  } catch (error) {
    return { ok: false, persisted: true, error: messageOf(error), reason: 'database' };
  }
}

/** Baja desde el panel. */
export async function deletePartner(id: string): Promise<PartnerWriteResult> {
  if (!isSupabaseConfigured()) {
    const exists = devPartners.some((p) => p.id === id);
    if (!exists) {
      return {
        ok: false,
        persisted: false,
        error: 'Corredora no encontrada.',
        reason: 'not_found',
      };
    }

    devPartners = devPartners.filter((p) => p.id !== id);
    return { ok: true, persisted: false };
  }

  try {
    const supabase = await sessionClient();
    const { data, error } = await supabase
      .from('partners')
      .delete()
      .eq('id', id)
      .select('id')
      .maybeSingle();

    if (error) return { ok: false, persisted: true, error: error.message, reason: 'database' };
    if (!data) {
      return {
        ok: false,
        persisted: true,
        error: 'Corredora no encontrada.',
        reason: 'not_found',
      };
    }

    return { ok: true, persisted: true };
  } catch (error) {
    return { ok: false, persisted: true, error: messageOf(error), reason: 'database' };
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Error inesperado al guardar.';
}
