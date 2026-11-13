import type { Metadata } from 'next';

import SocioEntry from './SocioEntry';
import SocioPanelPage from '../page';

/**
 * Entrada propia de cada socio: `/socio/catedral`, `/socio/corredora-4204`.
 *
 * El panel ya estaba acotado por sesión, pero entrar siempre por el botón del
 * home obliga a un paso de más —y a que el socio recuerde una ruta genérica—.
 * Con esta ruta cada corredora tiene su enlace: se lo puede mandar por correo,
 * dejarlo en favoritos o, más adelante, usarlo como base de su propia app.
 */

export const metadata: Metadata = {
  title: 'Panel Socios | Rix7',
  robots: { index: false, follow: false },
};

export default function SocioPorSlugPage({ params }: { params: { slug: string } }) {
  return (
    <SocioEntry slug={params.slug}>
      <SocioPanelPage />
    </SocioEntry>
  );
}
