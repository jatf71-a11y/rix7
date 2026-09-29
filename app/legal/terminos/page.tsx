import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal/LegalPage';
import { terminos, privacidad } from '@/lib/legal/content';
import { SITE_NAME } from '@/lib/site';

export const metadata: Metadata = {
  title: terminos.title,
  description: terminos.description,
  alternates: { canonical: '/legal/terminos' },
  openGraph: {
    title: `${terminos.title} · ${SITE_NAME}`,
    description: terminos.description,
    url: '/legal/terminos',
    type: 'article',
  },
};

/**
 * Página estática: el contenido no depende de datos externos, así que Next la
 * prerenderiza y el documento queda servido como HTML puro (bueno para SEO y
 * para que un crawler legal la lea sin ejecutar JS).
 */
export default function Page() {
  return (
    <LegalPage
      doc={terminos}
      other={{ href: '/legal/privacidad', title: privacidad.title }}
    />
  );
}
