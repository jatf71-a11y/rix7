import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Navbar } from '@/components/layout/Navbar';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { AuthModal } from '@/components/auth/AuthModal';
import { CurrencyProvider } from '@/components/currency/CurrencyProvider';
import { ServiceWorkerRegistration } from '@/components/ServiceWorkerRegistration';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'Rix7 | Portal Inmobiliario Inteligente & Web GIS Chile',
  description: 'Plataforma inmobiliaria moderna para todo Chile con mapa MapLibre GL JS, selector de monedas ($, UF, US$), calculadora de dividendo y catálogo en tiempo real.',
  manifest: '/manifest.json',
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
