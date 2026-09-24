/**
 * Teléfonos chilenos, normalizados al formato que WhatsApp entiende.
 *
 * WhatsApp (`api.whatsapp.com`) exige el número en formato internacional sin
 * signos: `+56` + `9` + ocho dígitos. Escribirlo mal es la causa más común de
 * que el botón de WhatsApp no abra nada, así que la conversión vive acá, en un
 * módulo puro y probado, en vez de repetirse con expresiones regulares sueltas.
 *
 * Se acepta lo que la gente escribe de verdad: con o sin +56, con 9 o sin 9,
 * con ceros de larga distancia, con espacios, puntos, guiones o paréntesis.
 */

/** Código de país de Chile. */
const CL_COUNTRY = '56';

/** Móvil: 9 + 8 dígitos (los números que tienen WhatsApp). */
const CL_MOBILE_RE = /^9\d{8}$/;

/**
 * Fijo: 9 dígitos nacionales = código de área + número.
 * Santiago es 2 + 8 dígitos (p. ej. 2 2345 6789) y las regiones usan códigos de
 * 2 a 9. No sirve para WhatsApp, pero se acepta y se marca con su área.
 */
const CL_LANDLINE_RE = /^[2-9]\d{8}$/;

/** Solo los dígitos, sin signos ni espacios. */
export function digitsOf(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Deja un teléfono chileno en formato E.164 (`+56912345678`).
 *
 * Devuelve `null` si no se puede reconocer un número chileno válido: es mejor
 * pedirlo de nuevo que guardar algo con lo que WhatsApp va a fallar.
 */
export function normalizeChilePhone(value: string): string | null {
  let digits = digitsOf(value);

  if (digits.length === 0) return null;

  // Prefijos internacionales: 0056 (larga distancia) y 56 (país).
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith(CL_COUNTRY)) digits = digits.slice(CL_COUNTRY.length);

  // Cero de larga distancia nacional (0 9 ...).
  if (digits.startsWith('0')) digits = digits.slice(1);

  if (CL_MOBILE_RE.test(digits)) return `+${CL_COUNTRY}${digits}`;

  // Fijo: se acepta y se marca como tal, pero no sirve para WhatsApp.
  const asLandline = digits.length === 8 ? `2${digits}` : digits;
  if (CL_LANDLINE_RE.test(asLandline)) return `+${CL_COUNTRY}${asLandline}`;

  return null;
}

/** ¿Es un móvil chileno (o sea, puede recibir WhatsApp)? */
export function isChileMobile(e164: string | null | undefined): boolean {
  if (!e164) return false;
  const digits = digitsOf(e164);
  if (!digits.startsWith(CL_COUNTRY)) return false;
  return CL_MOBILE_RE.test(digits.slice(CL_COUNTRY.length));
}

/** Formato legible para mostrar: `+56 9 1234 5678`. */
export function formatChilePhone(value: string | null | undefined): string {
  if (!value) return '';
  const digits = digitsOf(value);
  const national = digits.startsWith(CL_COUNTRY) ? digits.slice(CL_COUNTRY.length) : digits;

  if (CL_MOBILE_RE.test(national)) {
    return `+${CL_COUNTRY} ${national.slice(0, 1)} ${national.slice(1, 5)} ${national.slice(5)}`;
  }
  return `+${CL_COUNTRY} ${national}`.trim();
}

/** Enlace de WhatsApp listo para usar, o `null` si el número no sirve. */
export function whatsappHref(value: string, text?: string): string | null {
  const e164 = normalizeChilePhone(value);
  if (!isChileMobile(e164)) return null;

  const digits = digitsOf(e164 as string);
  const base = `https://api.whatsapp.com/send?phone=${digits}`;
  return text ? `${base}&text=${encodeURIComponent(text)}` : base;
}
