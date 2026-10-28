import { isSupabaseConfigured } from '@/lib/supabase/config';
import {
  SOLICITUD_COLUMNS,
  rowToSolicitud,
  type NormalizedSolicitud,
  type Solicitud,
  type SolicitudKind,
  type SolicitudRow,
  type SolicitudStatus,
} from './solicitudes';

/**
 * Persistencia de las solicitudes de «Publicar».
 *
 * - El **alta es pública** (quien pide todavía no tiene cuenta), así que escribe
 *   con el cliente sin cookies y la política RLS de `solicitudes` lo permite.
 * - El **listado es del equipo**: usa la sesión para que el JWT lleve el rol y
 *   la RLS solo devuelva filas a un admin.
 * - Sin Supabase configurado, las solicitudes se guardan en memoria del proceso
 *   para poder probar los flujos, marcadas como no persistentes. El panel lo
 *   dice en vez de fingir que quedaron guardadas.
 *
 * El respaldo vive en `globalThis` por el mismo motivo que en `leads`: Next
 * compila cada ruta en su propio bundle y una variable de módulo no sería la
 * misma para la ruta que escribe y la que lista.
 */

export interface SolicitudWriteResult {
  ok: boolean;
  id?: string;
  persisted: boolean;
  error?: string;
}

export interface SolicitudListResult {
  solicitudes: Solicitud[];
  source: 'supabase' | 'memory';
  /** false = desarrollo sin Supabase: lo guardado se pierde al reiniciar. */
  persistent: boolean;
}

const devStore = globalThis as typeof globalThis & {
  __rix7DevSolicitudes?: Solicitud[];
  __rix7DevSolicitudCounter?: number;
};

function readDevSolicitudes(): Solicitud[] {
  devStore.__rix7DevSolicitudes ??= [];
  return devStore.__rix7DevSolicitudes;
}

async function publicClient() {
  const { createPublicClient } = await import('@/lib/supabase/server');
  return createPublicClient();
}

async function sessionClient() {
  const { createClient } = await import('@/lib/supabase/server');
  return createClient();
}

/** Alta de una solicitud ya validada por `normalizeSolicitud`. */
export async function createSolicitud(
  solicitud: NormalizedSolicitud
): Promise<SolicitudWriteResult> {
  if (!isSupabaseConfigured()) {
    devStore.__rix7DevSolicitudCounter = (devStore.__rix7DevSolicitudCounter ?? 0) + 1;
    const id = `memoria-${devStore.__rix7DevSolicitudCounter}`;

    devStore.__rix7DevSolicitudes = [
      {
        id,
        kind: solicitud.kind,
        name: solicitud.name,
        email: solicitud.email,
        phone: solicitud.phone,
        company: solicitud.company,
        message: solicitud.message,
        payload: solicitud.payload,
        status: 'Recibida',
        createdAt: new Date().toISOString(),
      },
      ...readDevSolicitudes(),
    ];

    return { ok: true, id, persisted: false };
  }

  try {
    const supabase = await publicClient();
    // El id se genera acá y se inserta explícito. No se usa `.select('id')`
    // después del insert: quién envía la solicitud es anónimo y la política de
    // SELECT de la tabla es solo para admin, así que Supabase no le devolvería
    // la fila recién creada y el alta fallaría aunque el INSERT estuviera
    // permitido.
    const id = crypto.randomUUID();
    const { error } = await supabase.from('solicitudes').insert({
      id,
      kind: solicitud.kind,
      name: solicitud.name,
      email: solicitud.email,
      phone: solicitud.phone,
      company: solicitud.company,
      message: solicitud.message,
      payload: solicitud.payload,
      consent: solicitud.consent,
    });

    if (error) {
      return {
        ok: false,
        persisted: true,
        error: error.message || 'No se pudo guardar la solicitud.',
      };
    }

    return { ok: true, id, persisted: true };
  } catch (error) {
    return {
      ok: false,
      persisted: true,
      error: error instanceof Error ? error.message : 'Error inesperado al guardar la solicitud.',
    };
  }
}

export interface SolicitudUpdateResult {
  ok: boolean;
  /** `false` cuando la solicitud no existe (o la RLS no deja verla): es un 404, no un 500. */
  found: boolean;
  persisted: boolean;
  /** La fila ya actualizada, cuando la base la devolvió. */
  solicitud?: Solicitud;
  error?: string;
}

/**
 * Cambia el estado de una solicitud: es el flujo de revisión del panel.
 *
 * Se escribe con la **sesión**, no con el cliente público: la política de UPDATE
 * de `solicitudes` exige `is_rix7_admin()`, así que el JWT es lo que autoriza el
 * cambio. Igual que el listado, sin Supabase configurado se actualiza la copia en
 * memoria y se devuelve `persisted:false` para que el panel lo diga.
 *
 * Se pide la fila de vuelta con `.select()`: sin eso no se distingue «actualicé»
 * de «no toqué ninguna fila» —un id inexistente o ajeno también devuelve éxito
 * silencioso— y el panel mostraría un estado que la base no tiene.
 */
export async function updateSolicitudStatus(
  id: string,
  status: SolicitudStatus
): Promise<SolicitudUpdateResult> {
  if (!isSupabaseConfigured()) {
    const solicitudes = readDevSolicitudes();
    const index = solicitudes.findIndex((solicitud) => solicitud.id === id);
    if (index === -1) {
      return { ok: false, found: false, persisted: false, error: 'No encontramos esa solicitud.' };
    }

    const updated: Solicitud = { ...solicitudes[index], status };
    solicitudes[index] = updated;
    return { ok: true, found: true, persisted: false, solicitud: updated };
  }

  try {
    const supabase = await sessionClient();
    const { data, error } = await supabase
      .from('solicitudes')
      .update({ status })
      .eq('id', id)
      .select(SOLICITUD_COLUMNS)
      .maybeSingle();

    if (error) {
      return { ok: false, found: true, persisted: true, error: error.message };
    }

    if (!data) {
      return {
        ok: false,
        found: false,
        persisted: true,
        error: 'No encontramos esa solicitud.',
      };
    }

    return {
      ok: true,
      found: true,
      persisted: true,
      solicitud: rowToSolicitud(data as SolicitudRow),
    };
  } catch (error) {
    return {
      ok: false,
      found: true,
      persisted: true,
      error: error instanceof Error ? error.message : 'Error inesperado al actualizar la solicitud.',
    };
  }
}

export interface SolicitudCountResult {
  /** Solicitudes en estado `nueva`, sin revisar todavía. */
  count: number;
  source: 'supabase' | 'memory';
  /** false = desarrollo sin Supabase: el número sale de la copia en memoria. */
  persistent: boolean;
}

/**
 * Cuenta las solicitudes que todavía nadie revisó, para el badge del panel.
 *
 * Es una consulta `head` (sin filas) con `count: 'exact'`: el panel necesita el
 * número en cada navegación, no traer otra vez las 300 solicitudes para contar
 * unas pocas. Va con la sesión, así que la RLS de SELECT sigue siendo la que
 * autoriza; sin Supabase se cuenta la copia en memoria.
 */
export async function countSolicitudesNuevas(): Promise<SolicitudCountResult> {
  if (isSupabaseConfigured()) {
    try {
      const supabase = await sessionClient();
      const { count, error } = await supabase
        .from('solicitudes')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'Recibida');

      if (!error && typeof count === 'number') {
        return { count, source: 'supabase', persistent: true };
      }
    } catch {
      // Igual que el listado: si la base no responde, se muestra lo que haya.
    }
  }

  return {
    count: readDevSolicitudes().filter((solicitud) => solicitud.status === 'Recibida').length,
    source: 'memory',
    persistent: false,
  };
}

/** Listado para el panel, del más reciente al más antiguo. */
export async function listSolicitudes(
  kind?: SolicitudKind,
  limit = 300
): Promise<SolicitudListResult> {
  if (isSupabaseConfigured()) {
    try {
      const supabase = await sessionClient();
      let query = supabase
        .from('solicitudes')
        .select(SOLICITUD_COLUMNS)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (kind) query = query.eq('kind', kind);

      const { data, error } = await query;

      if (!error && data) {
        return {
          solicitudes: (data as SolicitudRow[]).map(rowToSolicitud),
          source: 'supabase',
          persistent: true,
        };
      }
    } catch {
      // Supabase caído: se muestra lo que haya en memoria, que será poco o nada.
    }
  }

  return {
    solicitudes: readDevSolicitudes()
      .filter((solicitud) => !kind || solicitud.kind === kind)
      .slice(0, limit),
    source: 'memory',
    persistent: false,
  };
}
