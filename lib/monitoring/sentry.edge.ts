import * as Sentry from '@sentry/nextjs';

/**
 * Inicialización de Sentry en el runtime Edge (middleware).
 *
 * El middleware corre en Edge: es el primer código que ve cada request y el
 * que aplica el CSP, así que sus errores valen la pena verlos separados. No-op
 * sin DSN, igual que los otros dos runtimes.
 */
Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV || 'development',
  release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
  tracesSampleRate: 0.1,
});
