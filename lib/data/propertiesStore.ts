import type { Property, PropertyType } from '@/lib/types/property';
import { isSupabaseConfigured } from '@/lib/supabase/config';

/**
 * Publicaciones de una corredora: alta, edición, baja y listado para el panel
 * `/socio`.
 *
 * Es el espejo de escritura de `partnerProperties.ts` (que solo lee para lo
 * público) con el mismo contrato que `partners-store.ts`:
 *
 *  1. Si Supabase está configurado, la base manda y las escrituras van con la
 *     sesión del usuario — así aplica la RLS de la migración 0014: el socio
 *     solo puede escribir filas de **su** corredora.
 *  2. Toda consulta y toda escritura va filtrada por `partner_id` además de
 *     por la RLS: el filtro en la capa de datos evita traer el portal entero
 *     si alguna vez la política no estuviera presente (defensa en profundidad,
 *     el mismo criterio que `listPartnerProperties`).
 *  3. Sin Supabase (desarrollo), las operaciones funcionan en memoria para que
 *     el panel se pueda probar de punta a punta, marcadas `persisted: false`
 *     para que la UI lo diga en vez de fingir que guardó.
 *
 * La ubicación viaja como la columna `GEOGRAPHY(POINT)`: se escribe en WKT
 * (`POINT(lng lat)`) y se lee del GeoJSON que PostgREST devuelve, porque las
 * filas de la tabla no traen `lat`/`lng` planos (eso lo calcula el RPC del
 * portal público).
 */

/** Campos editables de una publicación (lo que acepta el formulario del panel). */
export interface PublicationInput {
  title: string;
  description: string;
  price: number;
  property_type: PropertyType;
  status: 'for_sale' | 'for_rent' | 'sold' | 'rented';
  bedrooms: number;
  bathrooms: number;
  area_sqm: number;
  parking_spots: number;
  year_built?: number;
  address: string;
  city: string;
  state?: string;
  zip_code?: string;
  images: string[];
  features: string[];
  lat: number;
  lng: number;
  agent_name?: string;
  agent_email?: string;
  agent_phone?: string;
  /** ROL de propiedad (SII): identificación interna, solo en el panel. */
  rol?: string;
  /** Video de la ficha (URL o subido a Storage). Cadena vacía = quitarlo. */
  video_url?: string;
}

/**
 * Lo que el panel lee: `Property` más el ROL.
 *
 * El ROL **no** vive en `Property` a propósito: ese tipo es el que viaja al
 * portal público (ficha, HTML, feeds), y un campo que jamás debe publicarse
 * no debe estar en el contrato que lo publica. El ROL existe solo acá y en la
 * respuesta de `/api/partner/properties`, que exige sesión y corredora.
 */
export interface PanelProperty extends Property {
  rol?: string;
}

/** Resultado del listado del panel. */
export interface PublicationListResult {
  properties: PanelProperty[];
  /**
   * - `supabase`: vinieron de la tabla (lo que se puede gestionar).
   * - `dev`: respaldo en memoria del desarrollo sin Supabase.
   */
  source: 'supabase' | 'dev';
  /** false = las escrituras de este entorno no se guardan de verdad */
  persistent: boolean;
}

/** Resultado de una escritura. */
export interface PublicationWriteResult {
  ok: boolean;
  property?: PanelProperty;
  /** false = se guardó solo en memoria (desarrollo sin Supabase) */
  persisted: boolean;
  /** Mensaje para mostrar al usuario */
  error?: string;
  /** Motivo legible por máquina, para que la route elija el estado HTTP */
  reason?: 'not_found' | 'database';
}

/** Columnas que se escriben desde el panel (sin id ni timestamps). */
const WRITEABLE_COLUMNS = [
  'title',
  'description',
  'price',
  'property_type',
  'status',
  'bedrooms',
  'bathrooms',
  'area_sqm',
  'parking_spots',
  'year_built',
  'address',
  'city',
  'state',
  'zip_code',
  'images',
  'features',
  'agent_name',
  'agent_email',
  'agent_phone',
  // 0015: identificación y video. Ojo: con la migración sin aplicar, una
  // fila que incluya estas columnas falla con «column does not exist» y el
  // error se muestra honesto en el panel — no se inventa un éxito. Por eso
  // el formulario las manda solo cuando traen valor: crear sin ROL ni video
  // sigue funcionando en cualquier base.
  'rol',
  'video_url',
] as const;

/** Columnas de texto donde la cadena vacía significa «borrar el valor». */
const CLEARABLE_TEXT_COLUMNS = ['rol', 'video_url'] as const;

/**
 * Respaldo en memoria, **solo** para desarrollo sin Supabase. No es una caché:
 * es el modo de prueba y se pierde con un reinicio del servidor.
 *
 * Vive en `globalThis` y no a nivel de módulo: en `next dev`, compilar una
 * ruta nueva — la primera vez que se abre el editor, justo en mitad del flujo
 * crear → editar — re-evalúa los módulos del servidor y un `let` de módulo se
 * vaciaría sin más. El global muere cuando el proceso muere, que es el
 * contrato que promete la UI («se pierde al reiniciar el servidor»).
 */
const DEV_STATE_KEY = '__rix7DevPublications';

interface DevState {
  publications: Property[];
  counter: number;
}

function devState(): DevState {
  const globals = globalThis as Record<string, unknown>;
  if (!globals[DEV_STATE_KEY]) {
    globals[DEV_STATE_KEY] = { publications: [], counter: 0 };
  }
  return globals[DEV_STATE_KEY] as DevState;
}

/**
 * Vacía el respaldo de desarrollo. Lo usan los tests para aislar cada caso:
 * al vivir en `globalThis`, `vi.resetModules()` ya no lo limpiaba solo.
 */
export function resetDevPublications(): void {
  delete (globalThis as Record<string, unknown>)[DEV_STATE_KEY];
}

/** Cliente con la sesión del usuario: lo exige RLS para escribir. */
async function sessionClient() {
  const { createClient } = await import('@/lib/supabase/server');
  return createClient();
}

/**
 * Campos editables → fila para insertar/actualizar.
 *
 * `location` se arma en WKT con longitud primero (convención de PostGIS):
 * PostgREST lo parsea directo contra la columna geography.
 */
function inputToRow(input: Partial<PublicationInput>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const column of WRITEABLE_COLUMNS) {
    if (input[column] !== undefined) row[column] = input[column];
  }
  // Cadena vacía en un campo clearable → NULL: si no, borrar el ROL o el
  // video desde el formulario no tendría efecto (quedaría '').
  for (const column of CLEARABLE_TEXT_COLUMNS) {
    if (row[column] === '') row[column] = null;
  }
  if (input.lat !== undefined && input.lng !== undefined) {
    row.location = `POINT(${input.lng} ${input.lat})`;
  }
  return row;
}

/**
 * Fila de la tabla → `Property` del panel.
 *
 * PostgREST devuelve `location` como GeoJSON (`coordinates: [lng, lat]`); se
 * tolera también el WKT por si viene de otra vía. Si no hay ubicación
 * legible quedan 0,0 — el formulario las pide de nuevo antes de guardar.
 */
export function rowToPublication(row: Record<string, unknown>): Property {
  const location = row.location;
  let lat = 0;
  let lng = 0;

  if (location && typeof location === 'object' && !Array.isArray(location)) {
    const coords = (location as { coordinates?: unknown }).coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      lng = Number(coords[0]);
      lat = Number(coords[1]);
    }
  } else if (typeof location === 'string') {
    const match = location.match(/POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i);
    if (match) {
      lng = Number(match[1]);
      lat = Number(match[2]);
    }
  }

  return {
    ...row,
    lat: Number.isFinite(lat) ? lat : 0,
    lng: Number.isFinite(lng) ? lng : 0,
    price: Number(row.price ?? 0),
    bathrooms: Number(row.bathrooms ?? 0),
    area_sqm: row.area_sqm == null ? Number(row.area_sqm ?? 0) : Number(row.area_sqm),
    images: Array.isArray(row.images) ? row.images : [],
    features: Array.isArray(row.features) ? row.features : [],
  } as Property;
}

/** Listado para el panel: solo las de la corredora, las más recientes primero. */
export async function listPartnerPublications(
  partnerId: string
): Promise<PublicationListResult> {
  if (!isSupabaseConfigured()) {
    const mine = devState()
      .publications
      .filter((property) => property.partner_id === partnerId)
      .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
    return { properties: mine, source: 'dev', persistent: false };
  }

  try {
    const supabase = await sessionClient();
    const { data, error } = await supabase
      .from('properties')
      .select('*')
      // Filtro obligatorio: sin él la consulta dependería solo de la RLS.
      .eq('partner_id', partnerId)
      .order('created_at', { ascending: false })
      .limit(1000);

    if (!error && data) {
      return {
        properties: (data as Record<string, unknown>[]).map(rowToPublication),
        source: 'supabase',
        persistent: true,
      };
    }

    if (error) {
      return { properties: [], source: 'supabase', persistent: true };
    }
  } catch {
    // Supabase caído — respaldo vacío abajo: el panel informa el error real
    // al escribir; en lectura, una lista vacía sin más.
  }

  return { properties: [], source: 'supabase', persistent: true };
}

/** Alta desde el panel. El `partner_id` y el `user_id` los pone el guard. */
export async function createPublication(
  input: PublicationInput,
  owner: { partnerId: string; userId: string | null }
): Promise<PublicationWriteResult> {
  if (!isSupabaseConfigured()) {
    const state = devState();
    state.counter += 1;
    const now = new Date().toISOString();
    const property = {
      ...input,
      id: `dev-pub-${state.counter}`,
      partner_id: owner.partnerId,
      created_at: now,
    } as Property;
    state.publications = [...state.publications, property];
    return { ok: true, property, persisted: false };
  }

  try {
    const supabase = await sessionClient();
    const { data, error } = await supabase
      .from('properties')
      .insert({
        ...inputToRow(input),
        partner_id: owner.partnerId,
        user_id: owner.userId,
      })
      .select('*')
      .single();

    if (error || !data) {
      return {
        ok: false,
        persisted: true,
        error: error?.message ?? 'No se pudo crear la publicación.',
        reason: 'database',
      };
    }

    return { ok: true, property: rowToPublication(data), persisted: true };
  } catch (error) {
    return { ok: false, persisted: true, error: messageOf(error), reason: 'database' };
  }
}

/** Edición desde el panel. Solo escribe las claves que llegaron. */
export async function updatePublication(
  id: string,
  partnerId: string,
  patch: Partial<PublicationInput>
): Promise<PublicationWriteResult> {
  if (!isSupabaseConfigured()) {
    const state = devState();
    const index = state.publications.findIndex(
      (property) => property.id === id && property.partner_id === partnerId
    );
    if (index === -1) {
      return {
        ok: false,
        persisted: false,
        error: 'Publicación no encontrada.',
        reason: 'not_found',
      };
    }
    const updated = { ...state.publications[index], ...patch };
    state.publications = state.publications.map((property, i) =>
      i === index ? updated : property
    );
    return { ok: true, property: updated, persisted: false };
  }

  try {
    const supabase = await sessionClient();
    const { data, error } = await supabase
      .from('properties')
      .update(inputToRow(patch))
      .eq('id', id)
      // Mismo filtro doble que la lectura: además de la RLS.
      .eq('partner_id', partnerId)
      .select('*')
      .maybeSingle();

    if (error) return { ok: false, persisted: true, error: error.message, reason: 'database' };
    if (!data) {
      return {
        ok: false,
        persisted: true,
        error: 'Publicación no encontrada.',
        reason: 'not_found',
      };
    }

    return { ok: true, property: rowToPublication(data), persisted: true };
  } catch (error) {
    return { ok: false, persisted: true, error: messageOf(error), reason: 'database' };
  }
}

/** Baja desde el panel. */
export async function deletePublication(
  id: string,
  partnerId: string
): Promise<PublicationWriteResult> {
  if (!isSupabaseConfigured()) {
    const state = devState();
    const exists = state.publications.some(
      (property) => property.id === id && property.partner_id === partnerId
    );
    if (!exists) {
      return {
        ok: false,
        persisted: false,
        error: 'Publicación no encontrada.',
        reason: 'not_found',
      };
    }
    state.publications = state.publications.filter(
      (property) => !(property.id === id && property.partner_id === partnerId)
    );
    return { ok: true, persisted: false };
  }

  try {
    const supabase = await sessionClient();
    const { data, error } = await supabase
      .from('properties')
      .delete()
      .eq('id', id)
      .eq('partner_id', partnerId)
      .select('id')
      .maybeSingle();

    if (error) return { ok: false, persisted: true, error: error.message, reason: 'database' };
    if (!data) {
      return {
        ok: false,
        persisted: true,
        error: 'Publicación no encontrada.',
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
