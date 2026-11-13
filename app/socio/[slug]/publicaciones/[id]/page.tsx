import type { Metadata } from 'next';

import SocioEntry from '../../SocioEntry';
import SocioEditarPage from '../../../publicaciones/[id]/page';

/**
 * `/socio/<slug>/publicaciones/<id>` — editar una publicación sin perder la URL
 * del socio. El id sale de `useParams` dentro de la pantalla compartida.
 */

export const metadata: Metadata = {
  title: 'Panel Socios | Rix7',
  robots: { index: false, follow: false },
};

export default function EditarPorSlugPage({ params }: { params: { slug: string } }) {
  return (
    <SocioEntry slug={params.slug}>
      <SocioEditarPage />
    </SocioEntry>
  );
}
