/**
 * Punto de entrada de Sentry para el runtime Edge (middleware).
 *
 * `@sentry/nextjs` los descubre por convención en la raíz del proyecto; la
 * implementación vive en `lib/monitoring/sentry.edge.ts`.
 */
import './lib/monitoring/sentry.edge';
