import type { Metadata } from 'next';

import MorosidadBanner from './MorosidadBanner';
import SocioShell from './SocioShell';

/**
 * Metadata del panel de socios.
 *
 * Igual criterio que `/admin`: `robots.noindex` evita que el crawler gaste
 * presupuesto en rutas internas — el acceso real ya lo exige el servidor por
 * rol y corredora vinculada (`requireMember`).
 *
 * El aviso de cobranza va en el layout para que aparezca en todas las pantallas
 * del socio: si la cuenta está morosa, tiene que verlo también cuando entra a
 * publicar, no solo en el listado.
 */
export const metadata: Metadata = {
  title: 'Panel profesional | Rix7',
  robots: { index: false, follow: false },
};

export default function SocioLayout({ children }: { children: React.ReactNode }) {
  return <SocioShell banner={<MorosidadBanner />}>{children}</SocioShell>;
}
