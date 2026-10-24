'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  Inbox,
  ClipboardList,
  Link2,
  UserPlus,
  ArrowLeft,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react';

import type { DeployedRelease } from '@/lib/utils/deployedRelease';

const sidebarItems = [
  {
    label: 'Dashboard',
    href: '/admin',
    icon: LayoutDashboard,
  },
  {
    label: 'Socios',
    href: '/admin/empresas',
    icon: Users,
  },
  {
    label: 'Contactos',
    href: '/admin/leads',
    icon: Inbox,
  },
  {
    label: 'Solicitudes',
    href: '/admin/solicitudes',
    icon: ClipboardList,
  },
  {
    label: 'Alta de empresas',
    href: '/admin/alta-empresas',
    icon: ShieldCheck,
  },
  {
    label: 'Registros',
    href: '/admin/registros',
    icon: UserPlus,
  },
  {
    label: 'Enlaces compartidos',
    href: '/admin/landings',
    icon: Link2,
  },
];

/**
 * Fecha de publicación de la build, en UTC y con formato propio.
 *
 * No se usa `Intl` a propósito: el componente se renderiza en el servidor y se
 * hidrata en el navegador, y dos implementaciones de `es-CL` no coinciden en
 * detalles como el espacio de «a. m.». Eso producía un error de hidratación. UTC
 * explícito evita además la ambigüedad de la zona horaria.
 */
function formatBuiltAt(iso: string): string {
  return `${iso.slice(0, 16).replace('T', ' ')} UTC`;
}

export default function AdminShell({
  children,
  release,
}: {
  children: React.ReactNode;
  release: DeployedRelease;
}) {
  const pathname = usePathname();
  /**
   * Solicitudes en estado `nueva`, el número del badge de la navegación.
   *
   * `null` es «todavía no se sabe» (mientras carga o si la consulta falla): no
   * se pinta un 0 que mienta. Se vuelve a pedir en cada navegación del panel y
   * cuando la bandeja avisa que cambió un estado.
   */
  const [nuevas, setNuevas] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch('/api/admin/solicitudes/count', { cache: 'no-store' });
        if (!response.ok) return;
        const body = await response.json().catch(() => null);
        if (!cancelled && typeof body?.count === 'number') setNuevas(body.count);
      } catch {
        // El badge es un extra: sin número, el panel sigue siendo el mismo.
      }
    }

    load();
    const refresh = () => {
      void load();
    };
    window.addEventListener('rix7:solicitudes-actualizadas', refresh);

    return () => {
      cancelled = true;
      window.removeEventListener('rix7:solicitudes-actualizadas', refresh);
    };
  }, [pathname]);

  const build = release.build;
  const commit = build?.commit ? build.commit.slice(0, 7) : null;
  const builtAt = build?.builtAt ? formatBuiltAt(build.builtAt) : null;
  const buildTitle = build
    ? [
        commit ? `Commit ${commit}` : null,
        builtAt ? `Publicado ${builtAt}` : null,
        build.dirty ? 'El árbol tenía cambios sin commitear' : null,
      ]
        .filter((part): part is string => part !== null)
        .join(' · ')
    : 'Este despliegue no publica RIX7_BUILD: no se puede afirmar qué árbol está en vivo.';

  return (
    <div className="flex min-h-[calc(100vh-64px)] bg-slate-50">
      {/* Sidebar */}
      <aside className="hidden lg:flex flex-col w-64 bg-white border-r border-slate-200 p-4 sticky top-16 h-[calc(100vh-64px)]">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
          <div className="w-10 h-10 rounded-xl overflow-hidden bg-white border border-slate-200/90 p-1 flex items-center justify-center shadow-md">
            <img src="/brand-logo.png" alt="Logo Rix7" className="w-full h-full object-contain" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">Panel Admin</h2>
            <p className="text-[10px] text-slate-500">Rix7 Management</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1">
          {sidebarItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 border border-blue-100'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <item.icon className={`w-4 h-4 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
                <span>{item.label}</span>
                <span className="ml-auto flex items-center gap-1.5">
                  {item.href === '/admin/solicitudes' && nuevas !== null && nuevas > 0 && (
                    <span
                      title={`${nuevas} solicitud${nuevas === 1 ? '' : 'es'} nueva${
                        nuevas === 1 ? '' : 's'
                      } sin revisar`}
                      aria-label={`${nuevas} solicitudes nuevas sin revisar`}
                      className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold leading-4 text-white"
                    >
                      {nuevas > 99 ? '99+' : nuevas}
                    </span>
                  )}
                  {isActive && <ChevronRight className="w-3 h-3 text-blue-400" />}
                </span>
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
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

      {/* Main Content */}
      <main className="flex-1 p-6 lg:p-8 overflow-auto flex flex-col">
        <div className="flex-1">{children}</div>

        {/*
          Pie con la release publicada. La versión y el identificador salen del
          deployment, no de una constante del código: si producción quedó en un
          commit viejo, acá se ve el que realmente está sirviendo.
        */}
        <footer className="mt-10 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-slate-200 pt-4 text-[11px] text-slate-400">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold text-slate-500">Rix7 v{release.version}</span>
            {release.tag ? (
              <span>
                tag <span className="font-mono">{release.tag}</span>
              </span>
            ) : (
              <span title="El commit publicado no tiene un tag de release">sin tag</span>
            )}
          </p>

          <p className="flex flex-wrap items-center gap-x-2 gap-y-1" title={buildTitle}>
            {build ? (
              <>
                <span>
                  build <span className="font-mono text-slate-500">{build.id}</span>
                </span>
                {commit && <span className="font-mono">{commit}</span>}
                {builtAt && <span>{builtAt}</span>}
                {build.dirty && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-700">
                    sin commitear
                  </span>
                )}
              </>
            ) : (
              <span className="font-medium text-slate-500">build sin identificar</span>
            )}
            <a
              href="/api/health"
              target="_blank"
              rel="noreferrer"
              className="underline decoration-slate-300 underline-offset-2 hover:text-slate-600"
            >
              ver salud
            </a>
          </p>
        </footer>
      </main>
    </div>
  );
}
