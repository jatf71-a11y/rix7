/**
 * Punto único para reportar errores desde cualquier capa del portal.
 *
 * La regla: **siempre** se registra en consola (así el error nunca desaparece
 * ni en desarrollo ni sin configurar nada) y, si Sentry está inicializado —
 * hay DSN en el entorno —, se envía además a Sentry. Sin DSN el SDK queda en
 * no-op y este helper cuesta una línea de log: activar el monitoreo no exige
 * tocar el código de nuevo.
 *
 * El import de Sentry es dinámico a propósito: en los entornos sin DSN evita
 * levantar el SDK, y en los que lo tienen el chunk se comparte tras el primer
 * uso.
 *
 * Devuelve la promesa del intento de envío, con los fallos ya tragados: los
 * llamadores pueden ignorarla (fire-and-forget) y el test puede esperarla
 * determinísticamente en vez de sondear con timeouts, que es lo que volvía
 * intermitente esta prueba en el CI.
 */

export interface ErrorContext {
  /** Datos adicionales para discriminar el error (ids, rutas, contadores). */
  extra?: Record<string, unknown>;
}

export function reportError(error: unknown, context?: ErrorContext): Promise<void> {
  // Primero la consola: en producción el digest que ve la persona sale de acá.
  console.error('[monitoring]', error, context?.extra ?? '');

  return import('@sentry/nextjs')
    .then((Sentry) => {
      if (!Sentry.isInitialized()) return;
      Sentry.captureException(error, context?.extra ? { extra: context.extra } : undefined);
    })
    .catch(() => {
      // El reporte no puede romper la app: si el chunk falla (offline, bloqueo
      // de red), ya quedó en consola.
    });
}
