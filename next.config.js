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

module.exports = nextConfig;
