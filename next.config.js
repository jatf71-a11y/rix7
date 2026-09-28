/**
 * Envoltorio de Sentry para la configuración de Next.
 *
 * Inyecta los puntos de entrada (`sentry.{client,server,edge}.config.ts`) en
 * los bundles correspondientes y sube sourcemaps cuando hay token y org/proyecto
 * definidos. Todo es opt-in por variables de entorno: **sin Sentry configurado
 * el build es idéntico al de antes** (el wrapper no hace nada y las variables
 * de release quedan vacías), por eso es seguro para CI y para builds locales.
 *
 * Referencia de variables (todas opcionales):
 * - NEXT_PUBLIC_SENTRY_DSN / SENTRY_DSN → activa el envío de eventos.
 * - SENTRY_ORG, SENTRY_PROJECT, SENTRY_AUTH_TOKEN → subida de sourcemaps.
 * - SENTRY_RELEASE → versión que se reporta (en Vercel lo aporta el build).
 */
const { withSentryConfig } = require('@sentry/nextjs');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Run Next's internal dev-server workers (e.g. the static-paths
  // jest-worker) inside worker_threads instead of forked child processes.
  // Forked children were dying on this machine (low free RAM / Windows fork
  // flakiness), crashing every dev route with "Jest worker encountered
  // 2 child process exceptions".
  // Solo en desarrollo: activo durante `next build` rompe el IPC del cache
  // incremental ("Invalid URL http://localhost:undefined ... revalidateTag").
  experimental: process.env.NODE_ENV === 'development'
    ? { workerThreads: true }
    : {},
  images: {
    // AVIF ~30% más liviano que WebP; Next sirve el formato que el browser soporta
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/**',
      },
    ],
  },
};

const sentryOptions = {
  // Silencio las prompts de wizard: en CI no hay quien responda.
  silent: true,
  // Sourcemaps solo cuando hay dónde subirlos; sin token no ensucia el build.
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
  // Sin telemetría del propio SDK hacia Sentry.
  telemetry: false,
  // No listar el paquete en el bundle: la versión la conoce Sentry por release.
  disableLogger: true,
};

module.exports = withSentryConfig(nextConfig, sentryOptions);
