import type { Metadata } from 'next';

import { requireAdmin } from '@/lib/supabase/auth-guard';
import { readDeployedRelease } from '@/lib/utils/deployedRelease';
import manifest from '../../package.json';
import AdminAccess from './AdminAccess';
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

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  /**
   * La puerta real del panel, en el servidor.
   *
   * Antes cada página era un componente de cliente que pedía datos a APIs
   * protegidas: los datos nunca se filtraron, pero el armazón del panel se
   * servía a cualquiera y la protección dependía de que cada página recordara
   * llamar al guard. Acá se comprueba una sola vez para todo `/admin`.
   *
   * Si no hay sesión de admin —o la cuenta es de un socio— se muestra la
   * pantalla de acceso, sin ninguna sección del panel. En local sin Supabase
   * sigue el bypass de desarrollo del guard.
   */
  const guard = await requireAdmin();
  // La pantalla de acceso se carga en diferido (`AdminAccess`): trae el cliente
  // de Supabase y solo la ve quien no tiene sesión.
  if (!guard.ok) return <AdminAccess status={guard.response.status} />;

  // El pie del panel muestra lo que el deployment publicó (versión, tag y build).
  // Se lee acá, en el servidor, para que el navegador reciba solo el resultado y
  // no dependa de una petición extra a `/api/health`.
  const release = readDeployedRelease(process.env, manifest.version);

  return <AdminShell release={release}>{children}</AdminShell>;
}
