import type { Metadata } from 'next';

import SocioEntry from '../SocioEntry';
import SocioPublicarPage from '../../publicar/page';

/** `/socio/<slug>/publicar` — la misma pantalla, sin perder la URL del socio. */

export const metadata: Metadata = {
  title: 'Panel Socios | Rix7',
  robots: { index: false, follow: false },
};

export default function PublicarPorSlugPage({ params }: { params: { slug: string } }) {
  return (
    <SocioEntry slug={params.slug}>
      <SocioPublicarPage />
    </SocioEntry>
  );
}
