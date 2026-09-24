import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
// Los estilos de Leaflet viven en `components/map/PropertyMapLeaflet.tsx`, no
// acá: son ~58 KB que se bajaban en **todas** las páginas —incluido el home y la
// landing, que no usan Leaflet— y solo hacen falta en la ficha, donde el mapa se
// carga con `dynamic()`. El CSS viaja con ese chunk.
import './globals.css';
import { Navbar } from '@/components/layout/Navbar';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { RegistrationProvider } from '@/components/auth/RegistrationProvider';
import { FavoritesProvider } from '@/components/auth/FavoritesProvider';
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
          {/* La identidad vive aquí para que el Navbar, el home y la ficha
              reconozcan al mismo usuario, no solo el formulario de contacto. */}
          <RegistrationProvider>
            {/* Los favoritos viven en la cuenta: el proveedor es el único que
                sabe si la fuente es el servidor o este dispositivo. */}
            <FavoritesProvider>
              <CurrencyProvider>
                <Navbar />
                <main className="flex-1 flex flex-col">{children}</main>
                <AuthModal />
              </CurrencyProvider>
            </FavoritesProvider>
          </RegistrationProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
