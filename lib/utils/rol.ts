/**
 * Formato del ROL de propiedad del SII.
 *
 * El ROL identifica un inmueble en Chile y su notación varía por
 * circunscripción: `15234-67`, `13-15234-67`, con destino `15234-67D`. La regla
 * es tolerante a propósito —empieza con dígito y admite dígitos, letras,
 * guiones, puntos, barras y espacios—, pero rechaza basura arbitraria en un
 * campo que se usa como identificación.
 *
 * Vive en un módulo puro porque lo necesitan tres capas distintas: el esquema
 * Zod de las publicaciones, el formulario del panel y la validación de la
 * solicitud de propuestas. Duplicar la expresión regular es cómo una de las
 * tres empieza a aceptar algo que las otras rechazan.
 */

export const ROL_MAX_LENGTH = 40;

const ROL_PATTERN = /^\d[\dA-Za-z\-/ .]{3,39}$/;

/** ¿El texto tiene forma de ROL? Se recorta antes de comparar. */
export function isValidRol(value: string): boolean {
  return ROL_PATTERN.test(value.trim());
}
