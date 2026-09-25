/**
 * Contactos que dejan las visitas interesadas.
 *
 * Antes, cuando alguien dejaba sus datos y abría WhatsApp, ese contacto se
 * perdía: solo quedaba en su propio teléfono. Ahora se registra para que el
 * equipo pueda consultarlo y hacerle seguimiento.
 *
 * Este módulo es puro y compartido a propósito: la misma validación corre en el
 * navegador (antes de gastar una petición) y en el servidor (que es quien manda,
 * porque el cliente se puede saltar).
 */

export type LeadChannel = 'form' | 'call' | 'whatsapp' | 'mail';

export const LEAD_CHANNELS: readonly LeadChannel[] = ['form', 'call', 'whatsapp', 'mail'];

/** Etiqueta del canal para la UI del panel. */
export function leadChannelLabel(channel: LeadChannel): string {
  switch (channel) {
    case 'call':
      return 'Llamada';
    case 'whatsapp':
      return 'WhatsApp';
    case 'mail':
      return 'Correo';
    default:
      return 'Formulario';
  }
}

/** Límites de longitud. Los mismos que valida la política RLS de la tabla. */
export const LEAD_LIMITS = {
  name: 120,
  email: 200,
  phone: 40,
  id: 120,
  message: 500,
} as const;

export interface LeadInput {
  property_id?: unknown;
  partner_id?: unknown;
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  channel?: unknown;
  message?: unknown;
}

export interface NormalizedLead {
  property_id: string | null;
  partner_id: string | null;
  name: string;
  email: string;
  phone: string;
  channel: LeadChannel;
  message: string | null;
}

/** Fila de `public.leads` tal como la devuelve Supabase. */
export interface LeadRow {
  id: string;
  property_id: string | null;
  partner_id: string | null;
  name: string;
  email: string;
  phone: string;
  channel: string;
  message: string | null;
  created_at: string;
}

/** Contacto tal como lo consume el panel. */
export interface Lead {
  id: string;
  propertyId: string | null;
  partnerId: string | null;
  name: string;
  email: string;
  phone: string;
  channel: LeadChannel;
  message: string | null;
  createdAt: string;
}

export const LEAD_COLUMNS =
  'id, property_id, partner_id, name, email, phone, channel, message, created_at';

/** Correo con la misma forma que valida el formulario. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type LeadValidation =
  | { ok: true; lead: NormalizedLead }
  | { ok: false; error: string };

/** Texto obligatorio: recorta, colapsa espacios internos y rechaza lo que sobra. */
function readRequiredText(value: unknown, max: number, label: string): string | { error: string } {
  if (typeof value !== 'string') return { error: `Falta ${label}.` };
  const text = value.trim().replace(/\s+/g, ' ');
  if (text.length === 0) return { error: `Falta ${label}.` };
  if (text.length > max) return { error: `${label} excede el largo permitido.` };
  return text;
}

/** Texto opcional (identificadores): se acepta ausente y se recorta al límite. */
function readOptionalId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length === 0 ? null : text.slice(0, LEAD_LIMITS.id);
}

/**
 * Valida y normaliza el cuerpo de un alta de contacto.
 *
 * Nombre, correo, teléfono y canal son obligatorios: sin ellos el contacto no
 * sirve para nada. El mensaje se recorta en silencio en vez de rechazarse,
 * porque perder un contacto por un texto largo sería absurdo.
 */
export function normalizeLead(input: unknown): LeadValidation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Cuerpo de la solicitud inválido.' };
  }

  const raw = input as LeadInput;

  const name = readRequiredText(raw.name, LEAD_LIMITS.name, 'el nombre');
  if (typeof name !== 'string') return { ok: false, error: name.error };

  const email = readRequiredText(raw.email, LEAD_LIMITS.email, 'el correo');
  if (typeof email !== 'string') return { ok: false, error: email.error };
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'El correo no tiene un formato válido.' };

  const phone = readRequiredText(raw.phone, LEAD_LIMITS.phone, 'el teléfono');
  if (typeof phone !== 'string') return { ok: false, error: phone.error };
  // Se exigen al menos 9 dígitos, igual que el semáforo del formulario.
  if (phone.replace(/\D/g, '').length < 9) {
    return { ok: false, error: 'El teléfono no tiene un formato válido.' };
  }

  const channel = typeof raw.channel === 'string' ? raw.channel.trim() : '';
  if (!LEAD_CHANNELS.includes(channel as LeadChannel)) {
    return { ok: false, error: 'Canal de contacto inválido.' };
  }

  const message =
    typeof raw.message === 'string' && raw.message.trim().length > 0
      ? raw.message.trim().slice(0, LEAD_LIMITS.message)
      : null;

  return {
    ok: true,
    lead: {
      property_id: readOptionalId(raw.property_id),
      partner_id: readOptionalId(raw.partner_id),
      name,
      email,
      phone,
      channel: channel as LeadChannel,
      message,
    },
  };
}

/** Fila de la base → objeto del panel. Un canal desconocido se muestra como formulario. */
export function rowToLead(row: LeadRow): Lead {
  const channel = LEAD_CHANNELS.includes(row.channel as LeadChannel)
    ? (row.channel as LeadChannel)
    : 'form';

  return {
    id: row.id,
    propertyId: row.property_id,
    partnerId: row.partner_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    channel,
    message: row.message,
    createdAt: row.created_at,
  };
}
