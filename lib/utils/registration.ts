/**
 * Verificación del registro del usuario para el contacto de una ficha.
 *
 * Se mantiene como módulo puro (sin React ni Supabase) para poder probar la
 * precedencia entre las dos fuentes de identidad sin levantar un navegador ni
 * un proyecto Supabase real:
 *
 *   1. Sesión del portal — si el usuario ya está logueado, está registrado y
 *      tiene acceso al portal, así que su identidad manda.
 *   2. Registro local del dispositivo, cuando no hay sesión.
 */

import { normalizeChilePhone } from './phone';

/**
 * Clave de localStorage con el registro ligero de este dispositivo.
 *
 * Vive acá (módulo puro) y no en el provider para que la puedan usar tanto el
 * reconocimiento de identidad como la cuenta, sin que los dos providers se
 * importen entre sí.
 */
export const REGISTRATION_KEY = 'rix7_contact_registration';

export type RegistrationSource = 'portal' | 'local';

export interface Registration {
  name: string;
  email: string;
  phone: string;
  source: RegistrationSource;
}

/** Registro tal como queda guardado en el dispositivo (campos incompletos permitidos). */
export interface StoredRegistration {
  name?: string;
  email?: string;
  phone?: string;
}

/** Mínimo del usuario de Supabase que se necesita acá. */
export interface SessionUserLike {
  email?: string | null;
  user_metadata?: { full_name?: unknown; phone?: unknown } | null;
}

/**
 * Teléfono que la cuenta trae en sus metadatos, en formato internacional.
 *
 * Se normaliza al vuelo para que una cuenta creada con un formato suelto siga
 * sirviendo en el botón de WhatsApp. Si no se puede reconocer el número, se
 * devuelve tal cual lo escribió la persona: es mejor mostrarlo raro que perderlo.
 */
function phoneFromSession(user: SessionUserLike): string {
  const raw = user.user_metadata?.phone;
  if (typeof raw !== 'string' || !raw.trim()) return '';
  return normalizeChilePhone(raw) ?? raw.trim();
}

/**
 * Lee el registro guardado en el dispositivo. Devuelve `null` si el JSON es
 * inválido o si falta nombre o correo: un registro a medias no identifica a nadie.
 */
export function parseStoredRegistration(raw: string | null): Registration | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as StoredRegistration;
    if (!data?.name || !data?.email) return null;
    return { name: data.name, email: data.email, phone: data.phone || '', source: 'local' };
  } catch {
    return null;
  }
}

/**
 * Nombre visible del usuario de la sesión: el nombre que dejó en el portal y,
 * si no lo dejó, la parte local de su correo.
 */
export function displayNameFromSession(user: SessionUserLike): string {
  const fullName = user.user_metadata?.full_name;
  if (typeof fullName === 'string' && fullName.trim()) return fullName.trim();
  const local = user.email?.split('@')[0];
  return local && local.trim() ? local.trim() : 'Usuario del portal';
}

/**
 * Primer nombre, para los saludos cortos del sitio ("Hola, Javier").
 * Cae a un texto genérico si el nombre viene vacío.
 */
export function firstNameOf(name: string): string {
  const first = name.trim().split(/\s+/)[0];
  return first || 'Usuario';
}

/**
 * Resuelve quién está del otro lado del formulario.
 *
 * La sesión del portal tiene prioridad sobre el registro local; el teléfono del
 * dispositivo se conserva cuando existe, porque el portal no lo pide al crear la
 * cuenta y el usuario ya lo había dejado acá.
 */
export function resolveRegistration(
  stored: Registration | null,
  sessionUser: SessionUserLike | null | undefined
): Registration | null {
  if (sessionUser) {
    return {
      name: displayNameFromSession(sessionUser),
      email: sessionUser.email || '',
      // El teléfono de la cuenta manda; si la cuenta no lo trae (cuentas creadas
      // antes de que se pidiera), se conserva el que la persona dejó acá.
      phone: phoneFromSession(sessionUser) || stored?.phone || '',
      source: 'portal',
    };
  }
  return stored ?? null;
}
