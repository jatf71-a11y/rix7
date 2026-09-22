import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import './globals.css';
import { Navbar } from '@/components/layout/Navbar';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { AuthModal } from '@/components/auth/AuthModal';
import { CurrencyProvider } from '@/components/currency/CurrencyProvider';
import { ServiceWorkerRegistration } from '@/components/ServiceWorkerRegistration';
import { SITE_URL, SITE_NAME, SITE_DESCRIPTION } from '@/lib/site';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'Rix7 | Portal Inmobiliario Inteligente & Web GIS Chile',
  description: SITE_DESCRIPTION,
  manifest: '/manifest.json',
  applicationName: SITE_NAME,
  icons: {
    icon: [
      { url: '/icon-192.svg', type: 'image/svg+xml', sizes: '192x192' },
      { url: '/icon-512.svg', type: 'image/svg+xml', sizes: '512x512' },
    ],
    shortcut: ['/icon-192.svg'],
  },
  openGraph: {
    type: 'website',
    locale: 'es_CL',
    siteName: SITE_NAME,
    url: '/',
    title: 'Rix7 | Portal Inmobiliario Inteligente & Web GIS Chile',
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: 'summary',
    title: 'Rix7 | Portal Inmobiliario Inteligente & Web GIS Chile',
    description: SITE_DESCRIPTION,
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Rix7',
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: '#2563eb',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className={inter.variable}>
      <body className="font-sans antialiased min-h-screen flex flex-col bg-slate-50">
        <ServiceWorkerRegistration />
        <AuthProvider>
          <CurrencyProvider>
            <Navbar />
            <main className="flex-1 flex flex-col">{children}</main>
            <AuthModal />
          </CurrencyProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
