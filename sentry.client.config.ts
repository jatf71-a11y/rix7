/**
 * Punto de entrada de Sentry para el bundle del navegador.
 *
 * `@sentry/nextjs` exige este archivo por convención en la raíz; la carga del
 * SDK es **condicional al DSN**: Next inlinea `NEXT_PUBLIC_*` en tiempo de
 * build, así que sin la variable el import dinámico se elimina del bundle y el
 * portal no paga ni un byte del SDK (~66 kB). Con DSN configurado, el SDK se
 * carga de forma asíncrona (sin bloquear el render).
 *
 * La implementación vive en `lib/monitoring/sentry.client.ts`.
 */
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  void import('./lib/monitoring/sentry.client');
}
