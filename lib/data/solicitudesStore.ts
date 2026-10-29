import { isServiceRoleConfigured } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { SOCIO_SOLICITUD_KINDS } from './socios';
import {
  SOLICITUD_REVIEW_KEYS as REVIEW_KEYS,
  type SolicitudAnswer,
  type SolicitudEvaluation,
} from './solicitudEvaluation';
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

/**
 * Cliente con clave de servicio: la evaluación corre **sin sesión** (la dispara
 * el alta pública y, más tarde, la página de respuestas), y la RLS de
 * `solicitudes` solo deja leer y escribir a un admin. Solo lo usan las funciones
 * marcadas como de servidor; el panel sigue moviendo el estado con la sesión.
 */
async function serviceClient() {
  const { createServiceRoleClient } = await import('@/lib/supabase/admin');
  return createServiceRoleClient();
}

/** ¿Hay base **y** clave de servicio? Sin las dos, la evaluación usa memoria. */
function canUseServiceRole(): boolean {
  return isSupabaseConfigured() && isServiceRoleConfigured();
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
 *
 * Solo cuenta los caminos que son un socio (`SOCIO_SOLICITUD_KINDS`): el
 * propietario que pide propuestas se atiende en la sección de leads, así que
 * sumarlo acá mandaría al equipo a una pantalla donde esa fila no está.
 */
export async function countSolicitudesNuevas(): Promise<SolicitudCountResult> {
  if (isSupabaseConfigured()) {
    try {
      const supabase = await sessionClient();
      const { count, error } = await supabase
        .from('solicitudes')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'Recibida')
        .in('kind', [...SOCIO_SOLICITUD_KINDS]);

      if (!error && typeof count === 'number') {
        return { count, source: 'supabase', persistent: true };
      }
    } catch {
      // Igual que el listado: si la base no responde, se muestra lo que haya.
    }
  }

  return {
    count: readDevSolicitudes().filter(
      (solicitud) =>
        solicitud.status === 'Recibida' &&
        (SOCIO_SOLICITUD_KINDS as readonly string[]).includes(solicitud.kind)
    ).length,
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

/** Una solicitud por id. La usa el autómata y la página de respuestas. */
export async function getSolicitud(id: string): Promise<Solicitud | null> {
  if (!canUseServiceRole()) {
    return readDevSolicitudes().find((solicitud) => solicitud.id === id) ?? null;
  }

  try {
    const supabase = await serviceClient();
    const { data, error } = await supabase
      .from('solicitudes')
      .select(SOLICITUD_COLUMNS)
      .eq('id', id)
      .maybeSingle();

    if (error || !data) return null;
    return rowToSolicitud(data as SolicitudRow);
  } catch {
    return null;
  }
}

/**
 * Las solicitudes ya guardadas, sin sesión.
 *
 * Existe para una sola pregunta: ¿ya hay un registro con este RUT o este
 * correo? Se lee con la clave de servicio porque el alta es pública y la RLS de
 * SELECT es solo para admin. Lo que se devuelve no sale de acá: el autómata usa
 * los datos para puntuar y no los publica.
 */
export async function listSolicitudesForReview(limit = 500): Promise<Solicitud[]> {
  if (!canUseServiceRole()) {
    return readDevSolicitudes()
      .filter((solicitud) => (SOCIO_SOLICITUD_KINDS as readonly string[]).includes(solicitud.kind))
      .slice(0, limit);
  }

  try {
    const supabase = await serviceClient();
    const { data, error } = await supabase
      .from('solicitudes')
      .select(SOLICITUD_COLUMNS)
      .in('kind', [...SOCIO_SOLICITUD_KINDS])
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !data) return [];
    return (data as SolicitudRow[]).map(rowToSolicitud);
  } catch {
    return [];
  }
}

export interface SolicitudReviewPatch {
  status?: SolicitudStatus;
  evaluation?: SolicitudEvaluation;
  /**
   * Hash del token de la ronda vigente; el token en claro nunca se guarda.
   * `null` lo borra: al aceptar, el enlace de la ronda anterior deja de servir.
   */
  answerTokenHash?: string | null;
  answerTokenExpiresAt?: string;
  /** Respuestas de una ronda: se suman a las anteriores, no las pisan. */
  answers?: SolicitudAnswer[];
}

/**
 * Guarda el resultado de la evaluación y mueve el estado, en una sola escritura.
 *
 * Va con la clave de servicio porque la evaluación no tiene sesión. Es de
 * **servidor**: la ruta pública de respuestas la usa, y por eso el patch solo
 * acepta lo que el autómata calcula —nunca datos del navegador—. El estado que
 * el equipo mueve a mano sigue yendo por `updateSolicitudStatus`, con su sesión
 * y su RLS.
 *
 * El catálogo de lo que se puede escribir está en `REVIEW_KEYS`: el `payload` es
 * JSONB y la tabla no tiene columnas para la evaluación (no hizo falta una
 * migración para esto).
 */
export async function updateSolicitudReview(
  id: string,
  patch: SolicitudReviewPatch
): Promise<SolicitudUpdateResult> {
  if (!canUseServiceRole()) {
    const solicitudes = readDevSolicitudes();
    const index = solicitudes.findIndex((solicitud) => solicitud.id === id);
    if (index === -1) {
      return { ok: false, found: false, persisted: false, error: 'No encontramos esa solicitud.' };
    }

    const current = solicitudes[index];
    const updated: Solicitud = {
      ...current,
      status: patch.status ?? current.status,
      payload: mergeReviewPayload(current.payload, patch),
    };
    solicitudes[index] = updated;
    return { ok: true, found: true, persisted: false, solicitud: updated };
  }

  try {
    const supabase = await serviceClient();
    const { data: row, error: readError } = await supabase
      .from('solicitudes')
      .select(SOLICITUD_COLUMNS)
      .eq('id', id)
      .maybeSingle();

    if (readError) return { ok: false, found: true, persisted: true, error: readError.message };
    if (!row) {
      return { ok: false, found: false, persisted: true, error: 'No encontramos esa solicitud.' };
    }

    const current = rowToSolicitud(row as SolicitudRow);
    const { data, error } = await supabase
      .from('solicitudes')
      .update({
        ...(patch.status ? { status: patch.status } : {}),
        payload: mergeReviewPayload(current.payload, patch),
      })
      .eq('id', id)
      .select(SOLICITUD_COLUMNS)
      .maybeSingle();

    if (error) return { ok: false, found: true, persisted: true, error: error.message };
    if (!data) {
      return { ok: false, found: false, persisted: true, error: 'No encontramos esa solicitud.' };
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
      error: error instanceof Error ? error.message : 'Error inesperado al guardar la evaluación.',
    };
  }
}

/** Mezcla el resultado de la evaluación en el `payload` de la fila. */
function mergeReviewPayload(
  payload: Solicitud['payload'],
  patch: SolicitudReviewPatch
): Solicitud['payload'] {
  const next: Solicitud['payload'] = { ...payload };

  if (patch.evaluation) next[REVIEW_KEYS.evaluation] = patch.evaluation;
  if (patch.answerTokenHash !== undefined) next[REVIEW_KEYS.tokenHash] = patch.answerTokenHash;
  if (patch.answerTokenExpiresAt) next[REVIEW_KEYS.tokenExpiresAt] = patch.answerTokenExpiresAt;
  if (patch.answers?.length) {
    const previous = Array.isArray(payload[REVIEW_KEYS.answers])
      ? (payload[REVIEW_KEYS.answers] as unknown[])
      : [];
    next[REVIEW_KEYS.answers] = [...previous, ...patch.answers];
  }

  return next;
}

/**
 * Busca la solicitud de un token de respuestas por su hash.
 *
 * El token en claro no se guarda: se hashea lo que llegó por la URL y se busca
 * esa huella en el `payload`. Devuelve `null` cuando no existe, así la página
 * muestra «enlace no válido» sin distinguir entre un token inventado y uno de
 * otra ronda.
 */
export async function findSolicitudByAnswerToken(hash: string): Promise<Solicitud | null> {
  if (!canUseServiceRole()) {
    return (
      readDevSolicitudes().find(
        (solicitud) => solicitud.payload[REVIEW_KEYS.tokenHash] === hash
      ) ?? null
    );
  }

  try {
    const supabase = await serviceClient();
    // Se leen las pendientes y se compara el hash en código en vez de filtrar
    // por `payload->>clave`: así no depende de que el PostgREST desplegado
    // soporte rutas JSON en los filtros. Son pocas filas —una solicitud deja de
    // estar pendiente cuando se responde—, y el hash nunca sale de acá.
    const { data, error } = await supabase
      .from('solicitudes')
      .select(SOLICITUD_COLUMNS)
      .eq('status', 'Pendiente_Informacion')
      .in('kind', [...SOCIO_SOLICITUD_KINDS])
      .order('created_at', { ascending: false })
      .limit(500);

    if (error || !data) return null;

    const match = (data as SolicitudRow[])
      .map(rowToSolicitud)
      .find((solicitud) => solicitud.payload[REVIEW_KEYS.tokenHash] === hash);

    return match ?? null;
  } catch {
    return null;
  }
}
