import type { Metadata } from 'next';

import { getPartnerById } from '@/lib/data/partners-store';
import { requireMember } from '@/lib/supabase/auth-guard';

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
  title: 'Panel Socios | Rix7',
  robots: { index: false, follow: false },
};

export default async function SocioLayout({ children }: { children: React.ReactNode }) {
  // La identidad del socio se lee acá, en el servidor, con el mismo guardia que
  // protege el panel: el cliente no elige de qué corredora es. Si la cuenta no
  // está vinculada (o no hay sesión, que es la pantalla de acceso), no hay
  // identidad y el panel queda con la marca de Rix7.
  const guard = await requireMember({ allowPendingMfa: true });
  const partner = guard.ok ? await getPartnerById(guard.partnerId).catch(() => undefined) : undefined;

  return (
    <SocioShell
      identity={
        partner
          ? { name: partner.name, logo: partner.logo ?? null, color: partner.color ?? null }
          : null
      }
      banner={<MorosidadBanner />}
    >
      {children}
    </SocioShell>
  );
}
