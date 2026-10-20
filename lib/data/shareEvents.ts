/**
 * Compartidos de propiedades, con la identidad de quien los movió.
 *
 * Es el registro que faltaba: `share_views` cuenta aperturas agregadas (sin
 * nadie detrás) y `leads` guarda el interés, pero hasta acá no había forma de
 * responder **quién compartió qué enlace, por qué canal y desde qué pantalla**.
 *
 * Este módulo es puro y compartido a propósito: la misma validación corre en el
 * navegador (antes de gastar una petición) y en el servidor (que es quien manda,
 * porque el cliente se puede saltar), y la política RLS de `share_events`
 * repite los mismos límites.
 */

/** Canales desde los que se puede compartir una propiedad. */
export const SHARE_CHANNELS = ['whatsapp', 'copy', 'share', 'card'] as const;
export type ShareChannel = (typeof SHARE_CHANNELS)[number];

/**
 * Pantalla de origen.
 *
 * - `ficha`: la barra de `/properties/[id]`.
 * - `landing`: el enlace compartido `/compartir/[id]` (alguien lo reenvía).
 * - `panel`: el socio que comparte su publicación desde `/socio`.
 */
export const SHARE_SOURCES = ['ficha', 'landing', 'panel'] as const;
export type ShareSource = (typeof SHARE_SOURCES)[number];

/** Etiqueta del canal para el panel. */
export function shareChannelLabel(channel: ShareChannel): string {
  switch (channel) {
    case 'whatsapp':
      return 'WhatsApp';
    case 'copy':
      return 'Enlace copiado';
    case 'share':
      return 'Compartir';
    default:
      return 'Tarjeta';
  }
}

/** Etiqueta del origen para el panel. */
export function shareSourceLabel(source: ShareSource): string {
  switch (source) {
    case 'landing':
      return 'Landing compartida';
    case 'panel':
      return 'Panel del socio';
    default:
      return 'Ficha';
  }
}

/** Límites de longitud. Los mismos que valida la política RLS de la tabla. */
export const SHARE_LIMITS = {
  name: 120,
  email: 200,
  phone: 40,
  id: 120,
  url: 600,
} as const;

export interface ShareEventInput {
  property_id?: unknown;
  partner_id?: unknown;
  channel?: unknown;
  source?: unknown;
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  share_url?: unknown;
}

export interface NormalizedShareEvent {
  property_id: string;
  partner_id: string | null;
  channel: ShareChannel;
  source: ShareSource;
  name: string;
  email: string;
  phone: string | null;
  share_url: string | null;
}

/** Fila de `public.share_events` tal como la devuelve Supabase. */
export interface ShareEventRow {
  id: string;
  property_id: string;
  partner_id: string | null;
  channel: string;
  source: string | null;
  name: string;
  email: string;
  phone: string | null;
  share_url: string | null;
  created_at: string;
}

/** Compartido tal como lo consume el panel. */
export interface ShareEvent {
  id: string;
  propertyId: string;
  partnerId: string | null;
  channel: ShareChannel;
  source: ShareSource;
  name: string;
  email: string;
  phone: string | null;
  shareUrl: string | null;
  createdAt: string;
}

export const SHARE_EVENT_COLUMNS =
  'id, property_id, partner_id, channel, source, name, email, phone, share_url, created_at';

/** Correo con la misma forma que valida el formulario de registro. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Id legible del catálogo (`scl-depto-marco-polo`), sin espacios ni rutas. */
const ID_RE = /^[A-Za-z0-9._-]+$/;

export type ShareEventValidation =
  | { ok: true; event: NormalizedShareEvent }
  | { ok: false; error: string };

/** Texto obligatorio: recorta, colapsa espacios internos y rechaza lo que sobra. */
function readRequiredText(value: unknown, max: number, label: string): string | { error: string } {
  if (typeof value !== 'string') return { error: `Falta ${label}.` };
  const text = value.trim().replace(/\s+/g, ' ');
  if (text.length === 0) return { error: `Falta ${label}.` };
  if (text.length > max) return { error: `${label} excede el largo permitido.` };
  return text;
}

/**
 * Valida y normaliza una acción de compartir.
 *
 * La identidad (nombre y correo) es obligatoria: compartir exige registro, y
 * sin esos datos el evento no sirve para hacer seguimiento. El teléfono es
 * opcional —un socio que comparte desde el panel no siempre lo tiene— y un
 * valor demasiado corto se descarta en vez de tumbar el registro entero: perder
 * el evento por un teléfono mal escrito sería peor que guardarlo sin él.
 *
 * El enlace compartido tampoco rechaza: si no viene o no es `http(s)`, se guarda
 * `null`. La URL canónica la conoce el servidor (`/compartir/[id]`), así que su
 * ausencia no invalida el hecho de que la persona compartió.
 */
export function normalizeShareEvent(input: unknown): ShareEventValidation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Cuerpo de la solicitud inválido.' };
  }

  const raw = input as ShareEventInput;

  if (typeof raw.property_id !== 'string') {
    return { ok: false, error: 'Falta la propiedad.' };
  }
  const propertyId = raw.property_id.trim();
  if (propertyId.length === 0) return { ok: false, error: 'Falta la propiedad.' };
  if (propertyId.length > SHARE_LIMITS.id) {
    return { ok: false, error: 'La propiedad excede el largo permitido.' };
  }
  if (!ID_RE.test(propertyId)) {
    return { ok: false, error: 'La propiedad no es válida.' };
  }

  const partnerId =
    typeof raw.partner_id === 'string' && raw.partner_id.trim().length > 0
      ? raw.partner_id.trim().slice(0, SHARE_LIMITS.id)
      : null;

  const channel = typeof raw.channel === 'string' ? raw.channel.trim() : '';
  if (!SHARE_CHANNELS.includes(channel as ShareChannel)) {
    return { ok: false, error: 'Canal de compartir inválido.' };
  }

  const source = typeof raw.source === 'string' ? raw.source.trim() : 'ficha';
  if (!SHARE_SOURCES.includes(source as ShareSource)) {
    return { ok: false, error: 'Origen de compartir inválido.' };
  }

  const name = readRequiredText(raw.name, SHARE_LIMITS.name, 'el nombre');
  if (typeof name !== 'string') return { ok: false, error: name.error };
  // La política RLS exige al menos dos caracteres: rechazarlo acá da un 400
  // claro en vez de un 500 por una fila que la base no acepta.
  if (name.length < 2) return { ok: false, error: 'El nombre es demasiado corto.' };

  const email = readRequiredText(raw.email, SHARE_LIMITS.email, 'el correo');
  if (typeof email !== 'string') return { ok: false, error: email.error };
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'El correo no tiene un formato válido.' };

  let phone: string | null = null;
  if (typeof raw.phone === 'string') {
    const trimmed = raw.phone.trim();
    if (trimmed.length >= 6) phone = trimmed.slice(0, SHARE_LIMITS.phone);
    else if (trimmed.length > SHARE_LIMITS.phone) {
      return { ok: false, error: 'El teléfono excede el largo permitido.' };
    }
  }

  let shareUrl: string | null = null;
  if (typeof raw.share_url === 'string') {
    const trimmed = raw.share_url.trim();
    if (
      trimmed.length >= 10 &&
      trimmed.length <= SHARE_LIMITS.url &&
      /^https?:\/\//i.test(trimmed)
    ) {
      shareUrl = trimmed;
    }
  }

  return {
    ok: true,
    event: {
      property_id: propertyId,
      partner_id: partnerId,
      channel: channel as ShareChannel,
      source: source as ShareSource,
      name,
      email,
      phone,
      share_url: shareUrl,
    },
  };
}

/** Fila de la base → objeto del panel. Un valor desconocido no rompe la lista. */
export function rowToShareEvent(row: ShareEventRow): ShareEvent {
  const channel = SHARE_CHANNELS.includes(row.channel as ShareChannel)
    ? (row.channel as ShareChannel)
    : 'share';
  const source = SHARE_SOURCES.includes((row.source ?? '') as ShareSource)
    ? (row.source as ShareSource)
    : 'ficha';

  return {
    id: row.id,
    propertyId: row.property_id,
    partnerId: row.partner_id,
    channel,
    source,
    name: row.name,
    email: row.email,
    phone: row.phone,
    shareUrl: row.share_url,
    createdAt: row.created_at,
  };
}
