import type { Metadata } from 'next';

import AdminShell from './AdminShell';

/**
 * Metadata del panel de corredoras.
 *
 * `robots.noindex` es la protección importante: el panel es interno (dashboard,
 * empresas, contactos y landings) y no debe aparecer en resultados de búsqueda.
 * El acceso real ya lo exige el servidor por rol; esto evita además que el
 * crawler gaste presupuesto en rutas que no son públicas.
 *
 * El shell (sidebar, navegación) vive en `AdminShell` como componente de
 * cliente: un layout de servidor no puede llevar `'use client'` ni hooks, y la
 * metadata de servidor solo se exporta desde aquí (hallazgo #8).
 */
export const metadata: Metadata = {
  title: 'Panel | Rix7',
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
