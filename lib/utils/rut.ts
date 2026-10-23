/**
 * RUT chileno: formato y dígito verificador.
 *
 * El RUT dejó de ser opcional en el registro de corredoras, inmobiliarias y
 * agentes: es lo que identifica a la empresa (o a la persona natural, en el
 * caso del agente) y con lo que se acredita la solicitud. Un campo obligatorio
 * sin validación acepta «abc», así que acá se comprueba el módulo 11 y se
 * devuelve el RUT en una forma canónica (`76.123.456-0`), la misma que se
 * guarda y la que se ve en el panel.
 *
 * Se acepta lo que la gente escribe de verdad: con o sin puntos, con o sin
 * guion, con `k` minúscula. Y se rechaza lo que no puede ser un RUT, incluido
 * un dígito verificador equivocado: una solicitud con un RUT inválido no se
 * puede verificar y no debería llegar al panel como si fuera válida.
 *
 * Vive en un módulo puro porque lo usan el formulario y la validación del
 * servidor; duplicar el algoritmo es cómo una de las dos capas empieza a
 * aceptar algo que la otra rechaza.
 */

export const RUT_MAX_LENGTH = 20;

/** Cuerpo numérico y dígito verificador, sin puntos: `12345678-5`. */
const RUT_PATTERN = /^([1-9]\d{0,7})-?([\dK])$/;

/**
 * Dígito verificador de un cuerpo numérico, por módulo 11.
 *
 * Se recorre de derecha a izquierda con los factores 2..7 que se repiten; el
 * resto se resta de 11 y sus casos especiales son 11 → `0` y 10 → `K`.
 */
export function rutCheckDigit(body: string): string {
  let sum = 0;
  let factor = 2;

  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += Number(body[index]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }

  const remainder = 11 - (sum % 11);
  if (remainder === 11) return '0';
  if (remainder === 10) return 'K';
  return String(remainder);
}

function formatBody(body: string): string {
  return body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * RUT canónico (`12.345.678-5`) o `null` si el texto no es un RUT válido.
 *
 * El largo se acota antes de normalizar para no procesar una cadena enorme que
 * venga de un cliente hecho a mano.
 */
export function normalizeRut(value: string): string | null {
  if (value.length > RUT_MAX_LENGTH) return null;

  const cleaned = value.trim().toUpperCase().replace(/[.\s]/g, '');
  const match = RUT_PATTERN.exec(cleaned);
  if (!match) return null;

  const [, body, checkDigit] = match;
  if (rutCheckDigit(body) !== checkDigit) return null;

  return `${formatBody(body)}-${checkDigit}`;
}

/** ¿El texto es un RUT válido? Se normaliza antes de comparar. */
export function isValidRut(value: string): boolean {
  return normalizeRut(value) !== null;
}
