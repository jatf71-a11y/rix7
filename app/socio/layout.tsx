import type { Metadata } from 'next';

import SocioShell from './SocioShell';

/**
 * Metadata del panel de socios.
 *
 * Igual criterio que `/admin`: `robots.noindex` evita que el crawler gaste
 * presupuesto en rutas internas — el acceso real ya lo exige el servidor por
 * rol y corredora vinculada (`requireMember`).
 */
export const metadata: Metadata = {
  title: 'Panel de socios | Rix7',
  robots: { index: false, follow: false },
};

export default function SocioLayout({ children }: { children: React.ReactNode }) {
  return <SocioShell>{children}</SocioShell>;
}
