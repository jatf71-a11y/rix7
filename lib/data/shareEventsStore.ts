import { isSupabaseConfigured } from '@/lib/supabase/config';
import {
  SHARE_EVENT_COLUMNS,
  rowToShareEvent,
  type NormalizedShareEvent,
  type ShareEvent,
  type ShareEventRow,
} from './shareEvents';

/**
 * Compartidos de propiedades.
 *
 * - El **alta es pública**: la visita no tiene una sesión de Auth, su registro
 *   vive en el dispositivo. Se escribe con el cliente sin cookies y la política
 *   RLS de la tabla vuelve a validar la forma del dato.
 * - La **lectura es del equipo**: exige rol admin, así que usa el cliente con la
 *   sesión del usuario para que el JWT lleve su rol.
 * - Sin Supabase configurado, los compartidos se guardan en memoria del proceso
 *   para poder probar el panel, marcados como no persistentes. En producción el
 *   estado real está en la tabla.
 */

export interface ShareEventWriteResult {
  ok: boolean;
  persisted: boolean;
  error?: string;
}

export interface ShareEventListResult {
  events: ShareEvent[];
  source: 'supabase' | 'memory';
  /** false = desarrollo sin Supabase: lo guardado se pierde al reiniciar */
  persistent: boolean;
}

/**
 * Respaldo en memoria, solo para desarrollo sin Supabase.
 *
 * Vive en `globalThis` por el mismo motivo que el de `leads`: en Next cada ruta
 * del servidor compila su propio bundle, así que una variable de módulo deja de
 * ser un solo dato y la ruta que **registra** no sería la misma que la que
 * **informa** en el panel.
 */
const devStore = globalThis as typeof globalThis & {
  __rix7DevShareEvents?: ShareEvent[];
  __rix7DevShareEventCounter?: number;
};

function readDevEvents(): ShareEvent[] {
  devStore.__rix7DevShareEvents ??= [];
  return devStore.__rix7DevShareEvents;
}

async function publicClient() {
  const { createPublicClient } = await import('@/lib/supabase/server');
  return createPublicClient();
}

async function sessionClient() {
  const { createClient } = await import('@/lib/supabase/server');
  return createClient();
}

/** Alta de un compartido ya validado por `normalizeShareEvent`. */
export async function createShareEvent(
  event: NormalizedShareEvent
): Promise<ShareEventWriteResult> {
  if (!isSupabaseConfigured()) {
    devStore.__rix7DevShareEventCounter = (devStore.__rix7DevShareEventCounter ?? 0) + 1;
    devStore.__rix7DevShareEvents = [
      {
        id: `memoria-${devStore.__rix7DevShareEventCounter}`,
        propertyId: event.property_id,
        partnerId: event.partner_id,
        channel: event.channel,
        source: event.source,
        name: event.name,
        email: event.email,
        phone: event.phone,
        shareUrl: event.share_url,
        createdAt: new Date().toISOString(),
      },
      ...readDevEvents(),
    ];

    return { ok: true, persisted: false };
  }

  try {
    const supabase = await publicClient();
    const { error } = await supabase.from('share_events').insert({
      property_id: event.property_id,
      partner_id: event.partner_id,
      channel: event.channel,
      source: event.source,
      name: event.name,
      email: event.email,
      phone: event.phone,
      share_url: event.share_url,
    });

    if (error) return { ok: false, persisted: true, error: error.message };

    return { ok: true, persisted: true };
  } catch (error) {
    return {
      ok: false,
      persisted: true,
      error:
        error instanceof Error ? error.message : 'Error inesperado al registrar el compartido.',
    };
  }
}

/**
 * Compartidos de **una** corredora, para el panel del socio.
 *
 * `listShareEvents` es la vista del equipo (todos los compartidos del portal);
 * esta acota por `partner_id` en la consulta además de la RLS, con el mismo
 * criterio de defensa en profundidad que las publicaciones del panel. La
 * migración `0017_socio_actividad` es la que habilita la lectura al rol
 * `member`; sin ella la RLS devuelve una lista vacía.
 */
export async function listPartnerShareEvents(
  partnerId: string,
  limit = 500
): Promise<ShareEventListResult> {
  if (isSupabaseConfigured()) {
    try {
      const supabase = await sessionClient();
      const { data, error } = await supabase
        .from('share_events')
        .select(SHARE_EVENT_COLUMNS)
        .eq('partner_id', partnerId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (!error && data) {
        return {
          events: (data as ShareEventRow[]).map(rowToShareEvent),
          source: 'supabase',
          persistent: true,
        };
      }
    } catch {
      // Supabase caído: se muestra lo que haya en memoria, que será poco o nada.
    }
  }

  return {
    events: readDevEvents()
      .filter((event) => event.partnerId === partnerId)
      .slice(0, limit),
    source: 'memory',
    persistent: false,
  };
}

/** Listado para el panel, del más reciente al más antiguo. */
export async function listShareEvents(limit = 200): Promise<ShareEventListResult> {
  if (isSupabaseConfigured()) {
    try {
      const supabase = await sessionClient();
      const { data, error } = await supabase
        .from('share_events')
        .select(SHARE_EVENT_COLUMNS)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (!error && data) {
        return {
          events: (data as ShareEventRow[]).map(rowToShareEvent),
          source: 'supabase',
          persistent: true,
        };
      }
    } catch {
      // Supabase caído: se muestra lo que haya en memoria, que será poco o nada.
    }
  }

  return { events: readDevEvents().slice(0, limit), source: 'memory', persistent: false };
}
