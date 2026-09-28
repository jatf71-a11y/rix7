/**
 * Ejecución de esquemas Zod con respuesta de error uniforme.
 *
 * `safeParse` de Zod devuelve `issues` técnicas; el cliente del portal espera el
 * contrato `{ success, error }` que ya usaba el panel y las landings. Este
 * helper traduce: toma el primer issue con mensaje accionable y lo devuelve
 * listo para `NextResponse.json` en la ruta (que decide el código HTTP).
 */

import type { ZodTypeAny } from 'zod';

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; issues: string[] };

/**
 * Valida `input` contra `schema` y separa el caso de éxito del de error.
 *
 * En error se prioriza el primer issue no vacío; los issues de `refine` con
 * `path` vacío (p. ej. `favoritesPostSchema`) quedan como único mensaje.
 */
export function validateInput<TSchema extends ZodTypeAny>(
  schema: TSchema,
  input: unknown
): ValidationResult<import('zod').output<TSchema>> {
  const result = schema.safeParse(input);

  if (result.success) {
    return { ok: true, data: result.data };
  }

  const issues = result.error.issues
    .map((issue) => (typeof issue.message === 'string' ? issue.message : ''))
    .filter((message) => message.length > 0);

  return {
    ok: false,
    error: issues[0] ?? 'Solicitud inválida.',
    issues,
  };
}

/**
 * Versión para query strings de URL: convierte `URLSearchParams` a un objeto
 * plano (última aparición de cada clave) antes de validar.
 */
export function searchParamsToObject(searchParams: URLSearchParams): Record<string, string> {
  const entries: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    entries[key] = value;
  });
  return entries;
}
