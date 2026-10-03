/**
 * Autorizaciones que la persona otorga al registrarse en Rix7.
 *
 * Vive en un módulo puro (sin React) porque el mismo dato lo necesita el modal
 * —que las dibuja— y la ruta `/api/registro` —que las vuelve a validar, porque
 * el cliente se puede saltar—. Igual que `normalizeLead`, la regla es una sola y
 * corre en los dos lados.
 *
 * La distinción importante es entre **obligatorias** y **opcionales**, y no es
 * capricho: sin una base de licitud (datos personales) y sin aceptar las reglas
 * de uso (términos) no hay registro posible, mientras que el marketing y la
 * cesión a terceros son una decisión libre de la persona. Por eso las dos
 * opcionales llegan **sin marcar**: una casilla premarcada no es consentimiento,
 * es una trampa. Y como son decisiones separadas, se piden por separado: aceptar
 * los términos no autoriza a mandar publicidad.
 */

/** Identificadores estables: son los que viajan a la API y quedan registrados. */
export type ConsentId = 'personal_data' | 'terms' | 'marketing' | 'third_party';

export interface ConsentDefinition {
  id: ConsentId;
  /** Título corto de la casilla. */
  title: string;
  /** Qué autoriza exactamente, en lenguaje llano. */
  description: string;
  /** true = el registro no se completa sin esta casilla. */
  required: boolean;
  /** Página legal que la sustenta, cuando existe. */
  link?: { href: string; label: string };
}

export const REQUIRED_CONSENTS: readonly ConsentId[] = ['personal_data', 'terms'];

/**
 * Versión de los textos de autorización que la persona aceptó al registrarse.
 *
 * Se guarda junto al alta (`public.signups.consent_version`) porque el
 * consentimiento es a **un texto concreto**, no a la idea general de aceptar
 * algo: si mañana cambia la redacción de la cesión a socios, una fila vieja sin
 * versión no probaría a qué se comprometió nadie. Por eso, cuando se edite
 * cualquiera de los textos de `CONSENTS`, hay que **subir esta fecha**: es el
 * único trabajo manual que exige el registro.
 */
export const CONSENT_VERSION = '2026-09-30';

export const CONSENTS: readonly ConsentDefinition[] = [
  {
    id: 'personal_data',
    title: 'Tratamiento de datos personales',
    description:
      'Autorizo a Rix7 a recopilar y almacenar mi nombre, correo y teléfono para gestionar mi cuenta, contactarme con las corredoras de las propiedades que me interesen y responder mis consultas, según la política de privacidad.',
    required: true,
    link: { href: '/legal/privacidad', label: 'Política de privacidad' },
  },
  {
    id: 'terms',
    title: 'Términos y condiciones',
    description:
      'Acepto las reglas de uso, las responsabilidades y las normativas de la plataforma, incluido el uso que hago de la información publicada por las corredoras y socios.',
    required: true,
    link: { href: '/legal/terminos', label: 'Términos y condiciones' },
  },
  {
    id: 'marketing',
    title: 'Envío de publicidad y novedades',
    description:
      'Quiero recibir correos con ofertas, propiedades destacadas, novedades y boletines. Puedo darme de baja cuando quiera desde cualquier correo.',
    required: false,
  },
  {
    id: 'third_party',
    title: 'Cesión de datos a socios comerciales',
    description:
      'Autorizo compartir mi nombre y correo con socios comerciales de Rix7 (inmobiliarias y corredoras) para que me contacten con ofertas relacionadas. Sin esta autorización mis datos no salen de Rix7.',
    required: false,
    link: { href: '/legal/privacidad', label: 'Política de privacidad' },
  },
];

/**
 * Permisos del navegador que el modal ofrece activar.
 *
 * No son casillas: el navegador solo concede estos permisos con una acción
 * explícita de la persona, así que se ofrecen como botones. Un check que no
 * puede cumplirse sería una promesa vacía.
 */
export type BrowserPermissionId = 'location' | 'notifications';

export interface BrowserPermissionDefinition {
  id: BrowserPermissionId;
  title: string;
  description: string;
  actionLabel: string;
}

export const BROWSER_PERMISSIONS: readonly BrowserPermissionDefinition[] = [
  {
    id: 'location',
    title: 'Ubicación',
    description:
      'Centra el mapa en tu ciudad y te muestra las propiedades cercanas con el botón «Cerca de mí». Solo se usa mientras navegas: no se guarda en tu cuenta.',
    actionLabel: 'Permitir ubicación',
  },
  {
    id: 'notifications',
    title: 'Notificaciones',
    description:
      'Avisos de propiedades nuevas que coincidan con tus búsquedas guardadas, sin tener que entrar a revisar el portal.',
    actionLabel: 'Activar avisos',
  },
];

export interface ConsentState {
  personal_data: boolean;
  terms: boolean;
  marketing: boolean;
  third_party: boolean;
}

export const EMPTY_CONSENTS: ConsentState = {
  personal_data: false,
  terms: false,
  marketing: false,
  third_party: false,
};

/** Límites de largo, alineados con los del alta de contactos. */
export const SIGNUP_LIMITS = {
  name: 120,
  email: 200,
  phone: 40,
} as const;

export interface NormalizedSignup {
  name: string;
  email: string;
  phone: string;
  /** Solo las obligatorias (marcadas) y las opcionales aceptadas. */
  consents: ConsentState;
}

export type SignupValidation =
  | { ok: true; signup: NormalizedSignup }
  | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readRequiredText(value: unknown, max: number, label: string): string | { error: string } {
  if (typeof value !== 'string') return { error: `Falta ${label}.` };
  const text = value.trim().replace(/\s+/g, ' ');
  if (text.length === 0) return { error: `Falta ${label}.` };
  if (text.length > max) return { error: `${label} excede el largo permitido.` };
  return text;
}

/** Lee una casilla del cuerpo: solo un `true` booleano cuenta como aceptada. */
function readConsent(value: unknown): boolean {
  return value === true;
}

export function readConsents(input: unknown): ConsentState {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  return {
    personal_data: readConsent(raw.personal_data),
    terms: readConsent(raw.terms),
    marketing: readConsent(raw.marketing),
    third_party: readConsent(raw.third_party),
  };
}

/** Autorizaciones obligatorias que faltan, en el orden en que se muestran. */
export function missingRequiredConsents(consents: ConsentState): ConsentDefinition[] {
  return CONSENTS.filter((c) => c.required && !consents[c.id]);
}

/**
 * Valida y normaliza un alta de registro.
 *
 * El nombre se colapsa a espacios simples, el correo se compara sin distinguir
 * mayúsculas y el teléfono exige al menos 9 dígitos —el mismo mínimo que usa el
 * formulario de contacto, para que un número aceptado allá no se rechace acá—.
 * Si falta una autorización obligatoria se dice cuál: un "datos inválidos"
 * genérico no le sirve a nadie.
 */
export function normalizeSignup(input: unknown): SignupValidation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Cuerpo de la solicitud inválido.' };
  }

  const raw = input as Record<string, unknown>;

  const name = readRequiredText(raw.name, SIGNUP_LIMITS.name, 'el nombre');
  if (typeof name !== 'string') return { ok: false, error: name.error };

  const email = readRequiredText(raw.email, SIGNUP_LIMITS.email, 'el correo');
  if (typeof email !== 'string') return { ok: false, error: email.error };
  const normalizedEmail = email.toLowerCase();
  if (!EMAIL_RE.test(normalizedEmail)) {
    return { ok: false, error: 'El correo no tiene un formato válido.' };
  }

  const phone = readRequiredText(raw.phone, SIGNUP_LIMITS.phone, 'el teléfono');
  if (typeof phone !== 'string') return { ok: false, error: phone.error };
  if (phone.replace(/\D/g, '').length < 9) {
    return { ok: false, error: 'El teléfono no tiene un formato válido.' };
  }

  const consents = readConsents(raw.consents ?? raw);
  const missing = missingRequiredConsents(consents);
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Falta autorizar: ${missing.map((c) => c.title.toLowerCase()).join(' y ')}.`,
    };
  }

  return {
    ok: true,
    signup: { name, email: normalizedEmail, phone, consents },
  };
}
