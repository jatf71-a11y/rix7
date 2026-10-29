'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Las dos bandejas de Leads.
 *
 * Un contacto que llega por una propiedad y un propietario que pide propuestas
 * son la misma clase de cosa —alguien de afuera que quiere algo, sin cuenta
 * todavía— y por eso comparten sección. No se mezclan en una lista porque se
 * trabajan distinto: al contacto se lo llama, y al propietario hay que asignarle
 * corredoras. La pestaña activa sale de la ruta, no de un estado, para que se
 * pueda entrar por enlace directo.
 */
const TABS = [
  { href: '/admin/leads', label: 'Contactos' },
  { href: '/admin/leads/propietarios', label: 'Propietarios' },
] as const;

export default function LeadsTabs() {
  const pathname = usePathname();

  return (
    <div
      className="mb-6 inline-flex rounded-lg border border-slate-300 p-0.5"
      role="group"
      aria-label="Bandejas de Leads"
    >
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
