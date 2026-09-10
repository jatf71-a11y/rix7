/** @type {import('next').NextConfig} */
const nextConfig = {
  // Run Next's internal dev-server workers (e.g. the static-paths
  // jest-worker) inside worker_threads instead of forked child processes.
  // Forked children were dying on this machine (low free RAM / Windows fork
  // flakiness), crashing every dev route with "Jest worker encountered
  // 2 child process exceptions".
  experimental: {
    workerThreads: true,
  },
  images: {
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
  webpack: (config) => {
    // Fix maplibre-gl worker in Next.js
    config.resolve.alias = {
      ...config.resolve.alias,
    };
    return config;
  },
};

module.exports = nextConfig;
