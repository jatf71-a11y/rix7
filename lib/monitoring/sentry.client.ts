import * as Sentry from '@sentry/nextjs';

/**
 * Inicialización de Sentry en el navegador.
 *
 * Es no-op sin `NEXT_PUBLIC_SENTRY_DSN`: sin DSN el SDK no envía nada. Para
 * activar el monitoreo basta definir las variables de entorno en Vercel y
 * redeployar — cero cambios de código (hallazgo #13).
 *
 * tracesSampleRate 0.1 = 10% de las transacciones: suficiente para ver
 * latencias sin pagar el volumen de 100%.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV || 'development',
  tracesSampleRate: 0.1,
});
