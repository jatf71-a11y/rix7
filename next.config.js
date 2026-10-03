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
const fs = require('node:fs');
const path = require('node:path');
const { withSentryConfig } = require('@sentry/nextjs');

// Un hilo de trabajo, un directorio de artefactos: `scripts/dev.mjs` define
// NEXT_DIST_DIR con un slot propio por puerto, así que dos `next dev` no se
// pisan los chunks. El default sigue siendo `.next` porque CI, Vercel y
// `deploy:prod` lo esperan ahí: sin la variable, nada de esto cambia nada de lo
// que ya funcionaba. Ver `scripts/next-paths.mjs`.
const distDir = process.env.NEXT_DIST_DIR || '.next';

// Next agrega la carpeta `types` del distDir a la lista `include` de
// tsconfig.json cuando ese string exacto no está —y reescribe el archivo entero,
// reformateado—. Con un slot por hilo eso ensuciaría un archivo versionado en
// cada arranque y los hilos se pisarían entre sí. Apuntando el typecheck del
// slot a un tsconfig generado en `.freebuff/` (ignorado por git), ese desorden
// se queda donde no molesta. Lo escribe `scripts/dev.mjs`; si no existe, se usa
// el de siempre.
// El wrapper lo declara explícito; si alguien define NEXT_DIST_DIR a mano (p. ej.
// para construir en un slot sin tocar `.next`), se busca por convención al lado
// del distDir: `<distDir>.tsconfig.json`. Si no existe, se usa el de siempre.
const slotTsconfig = process.env.NEXT_SLOT_TSCONFIG ||
  (process.env.NEXT_DIST_DIR ? `${distDir}.tsconfig.json` : undefined);
const useSlotTsconfig =
  Boolean(slotTsconfig) && fs.existsSync(path.resolve(__dirname, slotTsconfig));

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir,
  typescript: useSlotTsconfig ? { tsconfigPath: slotTsconfig } : undefined,
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
