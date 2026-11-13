import type { Metadata } from 'next';

import SocioEntry from '../SocioEntry';
import CuentaPage from '../../cuenta/page';

/** `/socio/<slug>/cuenta` — la misma pantalla, sin perder la URL del socio. */

export const metadata: Metadata = {
  title: 'Panel Socios | Rix7',
  robots: { index: false, follow: false },
};

export default function CuentaPorSlugPage({ params }: { params: { slug: string } }) {
  return (
    <SocioEntry slug={params.slug}>
      <CuentaPage />
    </SocioEntry>
  );
}
