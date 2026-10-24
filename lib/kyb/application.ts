/**
 * Validación y normalización de una solicitud KYB.
 *
 * Es la puerta del servidor, no del formulario: el cliente se puede saltar y la
 * API vuelve a comprobar todo. Se valida el RUT con módulo 11 (no basta con que
 * tenga forma), se recorta la razón social y se deriva el dominio del correo y
 * del sitio web, que es lo que después compara el motor.
 *
 * Módulo puro: sin Supabase, sin red y sin React.
 */

import { normalizeRut, RUT_MAX_LENGTH } from '@/lib/utils/rut';

export interface KybApplicationInput {
  legalName?: unknown;
  rut?: unknown;
  website?: unknown;
  email?: unknown;
  contactName?: unknown;
  phone?: unknown;
  consent?: unknown;
  coverage?: unknown;
  regions?: unknown;
  message?: unknown;
  registrationKind?: unknown;
  contactRole?: unknown;
}

/** Alcance declarado en el registro de empresas. El alta directa no lo pide. */
export type KybCoverage = 'nacional' | 'regional';

/** Camino del registro público que originó la solicitud. */
export type KybRegistrationKind = 'corredora' | 'inmobiliaria';

export interface NormalizedKybApplication {
  legalName: string;
  rut: string;
  website: string | null;
  domain: string | null;
  email: string;
  contactName: string;
  phone: string;
  consent: true;
  coverage: KybCoverage | null;
  regions: string[];
  message: string | null;
  registrationKind: KybRegistrationKind | null;
  contactRole: string | null;
}

export const KYB_LIMITS = {
  legalName: 160,
  website: 300,
  email: 200,
  contactName: 120,
  phone: 40,
  message: 1200,
  region: 80,
  regions: 16,
  contactRole: 80,
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+()\d\s.-]+$/;

/**
 * Correos de consumo masivo. No invalidan una solicitud por sí solos —un
 * agente puede usar Gmail y ser legítimo—, pero impiden la coincidencia con el
 * dominio del sitio web y bajan el puntaje de «correo corporativo».
 */
export const FREE_EMAIL_DOMAINS = [
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'hotmail.cl',
  'outlook.com',
  'outlook.cl',
  'live.com',
  'live.cl',
  'msn.com',
  'yahoo.com',
  'yahoo.cl',
  'icloud.com',
  'me.com',
  'protonmail.com',
  'proton.me',
  'gmx.com',
  'mail.ru',
  'aol.com',
];

export function isFreeEmailDomain(domain: string | null): boolean {
  if (!domain) return false;
  return FREE_EMAIL_DOMAINS.includes(domain.toLowerCase());
}

/**
 * Dominio normalizado a partir de una URL o de un dominio suelto.
 *
 * Devuelve `null` cuando no se puede leer un dominio con forma válida. Se quita
 * `www.` porque `www.empresa.cl` y `empresa.cl` son el mismo sitio y compararlos
 * literales produciría un «no coincide» falso.
 */
export function normalizeDomain(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let raw = value.trim().toLowerCase();
  if (!raw) return null;
  // Sin protocolo se asume https solo para poder usar URL; no se exige que el
  // usuario lo haya escrito (el validador del sitio web sí lo exige aparte).
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(raw)) raw = `https://${raw}`;

  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }

  host = host.replace(/^www\./, '');
  if (!host || host.includes('..')) return null;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null;
  if (!/^[a-z]{2,}$/.test(host.split('.').pop() ?? '')) return null;
  return host;
}

/** Dominio del correo (`ana@empresa.cl` → `empresa.cl`). */
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at <= 0) return null;
  return normalizeDomain(email.slice(at + 1));
}

/**
 * ¿El dominio del correo pertenece al sitio web?
 *
 * Se acepta el mismo dominio y sus subdominios en cualquier dirección:
 * `ventas@empresa.cl` con `empresa.cl` coincide, y `ana@empresa.cl` con
 * `ventas.empresa.cl` también. Comparar el texto completo marcaría como
 * sospechoso un correo perfectamente corporativo.
 */
export function domainsMatch(emailDomain: string | null, websiteDomain: string | null): boolean {
  if (!emailDomain || !websiteDomain) return false;
  if (emailDomain === websiteDomain) return true;
  return emailDomain.endsWith(`.${websiteDomain}`) || websiteDomain.endsWith(`.${emailDomain}`);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function required(
  value: unknown,
  limit: number,
  label: string,
  min = 1
): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = text(value);
  if (trimmed.length < min) return { ok: false, error: `${label} es obligatorio.` };
  if (trimmed.length > limit) return { ok: false, error: `${label} es demasiado largo.` };
  return { ok: true, value: trimmed };
}

export type KybValidation =
  | { ok: true; application: NormalizedKybApplication }
  | { ok: false; error: string };

/**
 * Valida y normaliza la solicitud.
 *
 * El sitio web es opcional: una empresa puede no tenerlo y el motor lo tratará
 * como una advertencia, no como un rechazo. Lo que sí se exige es un dominio
 * legible cuando viene, para que un error de tipeo no llegue al motor como si
 * fuera un sitio real.
 */
export function normalizeKybApplication(input: KybApplicationInput): KybValidation {
  const legalName = required(input.legalName, KYB_LIMITS.legalName, 'La razón social', 2);
  if (!legalName.ok) return legalName;

  const contactName = required(input.contactName, KYB_LIMITS.contactName, 'El nombre del contacto', 2);
  if (!contactName.ok) return contactName;

  const rawRut = required(input.rut, RUT_MAX_LENGTH, 'El RUT', 8);
  if (!rawRut.ok) return rawRut;
  const rut = normalizeRut(rawRut.value);
  if (!rut) {
    return { ok: false, error: 'RUT inválido: revisa el dígito verificador (ej: 76.123.456-0).' };
  }

  const email = required(input.email, KYB_LIMITS.email, 'El correo', 5);
  if (!email.ok) return email;
  const canonicalEmail = email.value.toLowerCase();
  if (!EMAIL_RE.test(canonicalEmail) || !emailDomain(canonicalEmail)) {
    return { ok: false, error: 'El correo no tiene un formato válido.' };
  }

  const phone = required(input.phone, KYB_LIMITS.phone, 'El teléfono', 6);
  if (!phone.ok) return phone;
  const digits = phone.value.replace(/\D/g, '');
  if (digits.length < 6 || !PHONE_RE.test(phone.value)) {
    return { ok: false, error: 'El teléfono no tiene un formato válido.' };
  }

  let website: string | null = null;
  let domain: string | null = null;
  const rawWebsite = text(input.website);
  if (rawWebsite) {
    if (rawWebsite.length > KYB_LIMITS.website) {
      return { ok: false, error: 'El sitio web es demasiado largo.' };
    }
    if (!/^https?:\/\/\S+$/i.test(rawWebsite)) {
      return { ok: false, error: 'El sitio web debe empezar con http:// o https://.' };
    }
    domain = normalizeDomain(rawWebsite);
    if (!domain) {
      return { ok: false, error: 'El sitio web no tiene un dominio válido.' };
    }
    website = rawWebsite;
  }

  // ── Datos operativos del registro de empresas ───────────────────────────
  // Son opcionales: el alta directa por API no los pide. Se validan acá y no en
  // el motor porque no participan de la verificación.
  let coverage: KybCoverage | null = null;
  const rawCoverage = text(input.coverage);
  if (rawCoverage) {
    if (rawCoverage !== 'nacional' && rawCoverage !== 'regional') {
      return { ok: false, error: 'El alcance geográfico no es válido.' };
    }
    coverage = rawCoverage;
  }

  const regions: string[] = [];
  if (Array.isArray(input.regions)) {
    for (const entry of input.regions) {
      const name = text(entry);
      if (!name) continue;
      if (name.length > KYB_LIMITS.region) {
        return { ok: false, error: 'El nombre de una región es demasiado largo.' };
      }
      // Duplicados fuera: el formulario ya los evita, la API no confía en eso.
      if (!regions.includes(name)) regions.push(name);
      if (regions.length > KYB_LIMITS.regions) {
        return { ok: false, error: 'Demasiadas regiones para un solo registro.' };
      }
    }
  }

  if (coverage === 'regional' && regions.length === 0) {
    return { ok: false, error: 'Marca al menos una región donde trabaja la empresa.' };
  }

  let message: string | null = null;
  const rawMessage = text(input.message);
  if (rawMessage) {
    if (rawMessage.length > KYB_LIMITS.message) {
      return { ok: false, error: 'El mensaje es demasiado largo.' };
    }
    message = rawMessage;
  }

  let registrationKind: KybRegistrationKind | null = null;
  const rawKind = text(input.registrationKind);
  if (rawKind) {
    if (rawKind !== 'corredora' && rawKind !== 'inmobiliaria') {
      return { ok: false, error: 'El tipo de registro no es válido.' };
    }
    registrationKind = rawKind;
  }

  let contactRole: string | null = null;
  const rawRole = text(input.contactRole);
  if (rawRole) {
    if (rawRole.length > KYB_LIMITS.contactRole) {
      return { ok: false, error: 'El cargo del contacto es demasiado largo.' };
    }
    contactRole = rawRole;
  }

  if (input.consent !== true) {
    return { ok: false, error: 'Debes aceptar la verificación de datos y la política de privacidad.' };
  }

  return {
    ok: true,
    application: {
      legalName: legalName.value,
      rut,
      website,
      domain,
      email: canonicalEmail,
      contactName: contactName.value,
      phone: phone.value,
      consent: true,
      coverage,
      // Cobertura nacional implica que no hay regiones que listar.
      regions: coverage === 'regional' ? regions : [],
      message,
      registrationKind,
      contactRole,
    },
  };
}
