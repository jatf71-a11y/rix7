/**
 * ¿Están puestas las credenciales públicas de Supabase, o sigue el placeholder?
 *
 * Vive en un módulo neutral (sin importar Supabase ni React) porque lo usan
 * tres cosas distintas: el modal de acceso en el cliente, el script de
 * diagnóstico `check:auth` y el test que lo cubre.
 *
 * Existe por un fallo concreto y feo: con el placeholder puesto, el botón de
 * Google **navega igual** a `https://placeholder-project.supabase.co/...`, un
 * dominio que no existe, y el navegador termina en su página de error. Desde
 * ahí el usuario no puede volver con el botón "atrás" a algo útil ni entiende
 * qué pasó. Lo mismo, en silencio, con el enlace al correo.
 *
 * La comprobación es deliberadamente **conservadora**: solo marca como no
 * configurado lo que es evidentemente un marcador de posición (o está vacío).
 * Una URL que no reconozco pasa como válida, porque un falso negativo aquí
 * dejaría a alguien sin poder entrar; el que avisa del placeholder es un falso
 * positivo en el peor caso.
 */

/** Señales de que el valor es de ejemplo y no de un proyecto real. */
const PLACEHOLDER_MARKERS = ['placeholder', 'tu-proyecto', 'tu-clave', 'example', 'changeme'];

/** Longitud mínima razonable de una clave anon real (son JWT largos). */
const MIN_ANON_KEY_LENGTH = 30;

function looksLikePlaceholder(value: string): boolean {
  const lower = value.toLowerCase();
  return PLACEHOLDER_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * Valida la URL del proyecto.
 *
 * @param url Valor de `NEXT_PUBLIC_SUPABASE_URL`.
 * @returns Motivo legible si no sirve, o `null` si sirve.
 */
export function describeSupabaseUrlProblem(url: string | undefined | null): string | null {
  const value = (url ?? '').trim();
  if (!value) return 'Falta NEXT_PUBLIC_SUPABASE_URL: no hay ningún proyecto configurado.';
  if (looksLikePlaceholder(value)) {
    return `Sigue el valor de ejemplo (${value}): hay que poner la URL del proyecto real.`;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return `No es una URL válida: ${value}`;
  }

  const isLocal = ['localhost', '127.0.0.1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !isLocal) {
    return `Tiene que ser https: ${value}`;
  }

  return null;
}

/**
 * Valida la clave anon pública.
 *
 * @param key Valor de `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
 * @returns Motivo legible si no sirve, o `null` si sirve.
 */
export function describeAnonKeyProblem(key: string | undefined | null): string | null {
  const value = (key ?? '').trim();
  if (!value) return 'Falta NEXT_PUBLIC_SUPABASE_ANON_KEY.';
  if (looksLikePlaceholder(value)) {
    return 'La clave anon sigue siendo la de ejemplo: hay que poner la del proyecto real.';
  }
  if (value.length < MIN_ANON_KEY_LENGTH) {
    return 'La clave anon es demasiado corta para ser real.';
  }
  return null;
}

/**
 * ¿Se puede intentar un acceso de verdad?
 *
 * @param url Valor de `NEXT_PUBLIC_SUPABASE_URL`.
 * @param anonKey Valor de `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
 */
export function isSupabaseConfigured(
  url: string | undefined | null,
  anonKey: string | undefined | null
): boolean {
  return describeSupabaseUrlProblem(url) === null && describeAnonKeyProblem(anonKey) === null;
}
