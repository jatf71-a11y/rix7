'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Building2, CirclePlus, ArrowLeft, ChevronRight, CreditCard } from 'lucide-react';
import { PartnerLogo } from '@/components/properties/PartnerLogo';
import MfaGate from './MfaGate';

/** Identidad del socio: su nombre y su logo, leídos en el servidor. */
export interface SocioIdentity {
  name: string;
  logo: string | null;
  color: string | null;
}

/**
 * Base de las rutas del panel: `''` para el panel genérico o `/socio/<slug>`
 * cuando la persona entró por la URL de su corredora. Los enlaces internos la
 * usan para que navegar no le borre su dirección.
 */
const SocioBaseContext = React.createContext('');

/** Prefijo de rutas del panel según la URL en la que está la persona. */
export function useSocioBase(): string {
  return React.useContext(SocioBaseContext);
}

/**
 * Segmentos que ya son pantallas del panel: si el segundo tramo es uno de
 * estos, la URL no lleva slug de socio.
 */
const PANEL_SEGMENTS = new Set(['publicar', 'cuenta', 'publicaciones']);

function socioBaseFromPathname(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] !== 'socio' || !segments[1]) return '';
  return PANEL_SEGMENTS.has(segments[1]) ? '' : `/socio/${segments[1]}`;
}

const sidebarItems = [
  {
    label: 'Mis publicaciones',
    href: '/socio',
    icon: Building2,
  },
  {
    label: 'Publicar propiedad',
    href: '/socio/publicar',
    icon: CirclePlus,
  },
  {
    label: 'Mi cuenta',
    href: '/socio/cuenta',
    icon: CreditCard,
  },
];

/**
 * Shell del panel de socios: sidebar en desktop y fila de pestañas en móvil.
 *
 * Es hermano de `AdminShell` (mismo esqueleto visual) pero más liviano: este
 * panel tiene dos secciones, no cinco, y la navegación móvil sí importa acá
 * porque quien publica desde el celular es un caso real de uso.
 */
export default function SocioShell({
  children,
  banner,
  identity,
}: {
  children: React.ReactNode;
  /** Aviso del servidor, arriba del contenido (por ejemplo, la morosidad). */
  banner?: React.ReactNode;
  /**
   * Corredora de la cuenta. Es lo que hace que el panel se sienta *suyo*: el
   * logo y el nombre de la empresa, no los de Rix7. Sin vínculo llega `null` y
   * el panel muestra la marca del portal.
   */
  identity?: SocioIdentity | null;
}) {
  const pathname = usePathname();
  const base = socioBaseFromPathname(pathname);

  /** `/socio/cuenta` → `/socio/<slug>/cuenta` cuando hay slug en la URL. */
  const withBase = (href: string) => (base ? `${base}${href.replace(/^\/socio/, '')}` : href);

  const isActive = (href: string) => {
    const full = withBase(href);
    return href === '/socio' ? pathname === full || pathname === `${full}/` : pathname.startsWith(full);
  };

  return (
    <SocioBaseContext.Provider value={base}>
    <div className="flex min-h-[calc(100vh-64px)] bg-slate-50">
      {/* Sidebar (desktop) */}
      <aside className="hidden lg:flex flex-col w-64 bg-white border-r border-slate-200 p-4 sticky top-16 h-[calc(100vh-64px)]">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
          <div className="w-10 h-10 rounded-xl overflow-hidden bg-white border border-slate-200/90 flex items-center justify-center shadow-md shrink-0">
            {identity ? (
              <PartnerLogo
                logo={identity.logo ?? undefined}
                name={identity.name}
                color={identity.color ?? '#1d4ed8'}
                className="h-8 w-8 text-base"
                decorative
              />
            ) : (
              <img src="/brand-logo.png" alt="Logo Rix7" className="w-full h-full object-contain p-1" />
            )}
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-900 truncate" title={identity?.name}>
              {identity ? identity.name : 'Panel Socios'}
            </h2>
            <p className="text-[10px] text-slate-500 truncate">
              {identity ? 'Panel Socios · tu cuenta y publicaciones' : 'Tu cuenta, tu plan y tus publicaciones'}
            </p>
          </div>
        </div>

        <nav className="flex-1 space-y-1">
          {sidebarItems.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={withBase(item.href)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  active
                    ? 'bg-blue-50 text-blue-700 border border-blue-100'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <item.icon
                  className={`w-4 h-4 ${active ? 'text-blue-600' : 'text-slate-400'}`}
                />
                <span>{item.label}</span>
                {active && <ChevronRight className="w-3 h-3 ml-auto text-blue-400" />}
              </Link>
            );
          })}
        </nav>

        <div className="pt-4 border-t border-slate-100">
          <Link
            href="/"
            className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            <span>Volver al portal</span>
          </Link>
        </div>
      </aside>

      {/* Pestañas (móvil) */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* En el móvil no hay sidebar: la empresa va en una fila propia, arriba
            de las pestañas, para que el socio se reconozca al entrar. */}
        {identity && (
          <div className="lg:hidden flex items-center gap-2 px-4 pt-3 bg-white">
            <div className="w-7 h-7 rounded-lg overflow-hidden bg-white border border-slate-200 flex items-center justify-center shrink-0">
              <PartnerLogo
                logo={identity.logo ?? undefined}
                name={identity.name}
                color={identity.color ?? '#1d4ed8'}
                className="h-6 w-6 text-xs"
                decorative
              />
            </div>
            <span className="text-sm font-bold text-slate-900 truncate">{identity.name}</span>
            <span className="text-[10px] text-slate-400 shrink-0">Panel Socios</span>
          </div>
        )}

        <nav className="lg:hidden flex items-center gap-2 px-4 py-3 bg-white border-b border-slate-200 overflow-x-auto">
          {sidebarItems.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={withBase(item.href)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <item.icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {banner}

        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-auto">
          {/* Si la cuenta tiene 2FA, el panel no se muestra hasta verificar el
              código de la app: las APIs también lo exigen. */}
          <MfaGate>{children}</MfaGate>
        </main>
      </div>
    </div>
    </SocioBaseContext.Provider>
  );
}
