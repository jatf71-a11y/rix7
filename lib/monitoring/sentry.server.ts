import * as Sentry from '@sentry/nextjs';

/**
 * Inicialización de Sentry en el runtime Node del servidor.
 *
 * No-op sin `SENTRY_DSN` (o su alias `NEXT_PUBLIC_SENTRY_DSN`). A diferencia
 * del cliente, el servidor nunca envía PII: `sendDefaultPii: false` explícito.
 * El release se fija con la variable que Vercel inyecta en cada deploy.
 */
Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV || 'development',
  release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
});
