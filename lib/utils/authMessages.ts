/**
 * Mensajes del acceso.
 *
 * Un error de acceso casi nunca es culpa de la persona que está entrando: es el
 * proyecto sin configurar, la red, o un proveedor que todavía no está habilitado.
 * Decirle "Unsupported provider: provider is not enabled" no le sirve a nadie;
 * decirle que Google aún no está disponible y que use el enlace del correo sí.
 *
 * Módulo puro para poder probarlo sin navegador.
 */

/** Mensaje para un error que devolvió Supabase o el proveedor. */
export function describeAuthError(raw: unknown): string {
  const message = typeof raw === 'string' ? raw : raw instanceof Error ? raw.message : '';
  const text = message.toLowerCase();

  // Proveedor no habilitado en el proyecto: es el error que se ve mientras
  // Google no esté configurado en Supabase. Hay que decir qué hacer.
  if (
    text.includes('provider is not enabled') ||
    text.includes('unsupported provider') ||
    text.includes('provider is not supported')
  ) {
    return 'El acceso con Google todavía no está disponible. Puedes entrar con el enlace al correo.';
  }

  // Sin red o proyecto mal configurado: el navegador dice "Failed to fetch".
  if (!message || /fetch|network|load failed|connection/i.test(message)) {
    return 'No pudimos conectar con el servicio de acceso. Revisa tu conexión e intenta de nuevo.';
  }

  // Canceló en la pantalla de Google.
  if (text.includes('cancel') || text.includes('denied') || text.includes('access_denied')) {
    return 'Se canceló el acceso con Google. Puedes intentarlo de nuevo o usar el enlace al correo.';
  }

  return message;
}

/** Datos de error que Supabase deja en la URL al volver de un acceso externo. */
export interface AuthUrlError {
  /** Mensaje ya listo para mostrar. */
  message: string;
  /** Código técnico, si vino (`access_denied`, `otp_expired`, …). */
  code: string | null;
}

/**
 * Lee el error que quedó en la URL al volver de Google (o de un enlace vencido).
 *
 * Sin esto, un acceso fallido se ve como si no hubiera pasado nada: la persona
 * vuelve a la página, sin sesión y sin explicación. El modal lo muestra y limpia
 * la URL, para que recargar no repita el aviso.
 *
 * Se lee `window.location.search` y no `useSearchParams` porque las páginas que
 * usan esto se renderizan en el servidor y no deben volverse dinámicas por esto.
 */
export function parseAuthErrorFromUrl(search: string): AuthUrlError | null {
  if (!search) return null;

  const params = new URLSearchParams(search);
  const code = params.get('error_code') || params.get('error');
  const description = params.get('error_description');

  if (!code && !description) return null;

  // `error_description` viene más específico; el código sirve de respaldo.
  return {
    message: describeAuthError(description || code || ''),
    code: code || null,
  };
}

/** ¿La URL trae un error de acceso? Se usa para decidir si limpiarla. */
export function hasAuthError(search: string): boolean {
  if (!search) return false;

  const params = new URLSearchParams(search);
  return Boolean(params.get('error') || params.get('error_code') || params.get('error_description'));
}

/**
 * Quita de la URL los parámetros del error, conservando el resto de la búsqueda
 * (una comuna, una operación).
 *
 * **Solo** los del error: el `code` y el `state` no se tocan porque son los que
 * el cliente de Supabase necesita para canjear la sesión al volver de Google.
 * Borrarlos por limpiar rompería el acceso exitoso.
 */
export function stripAuthError(search: string): string {
  if (!search) return '';

  const params = new URLSearchParams(search);
  for (const key of ['error', 'error_code', 'error_description']) {
    params.delete(key);
  }

  const rest = params.toString();
  return rest ? `?${rest}` : '';
}
