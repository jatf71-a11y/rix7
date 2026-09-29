import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal/LegalPage';
import { privacidad, terminos } from '@/lib/legal/content';
import { SITE_NAME } from '@/lib/site';

export const metadata: Metadata = {
  title: privacidad.title,
  description: privacidad.description,
  alternates: { canonical: '/legal/privacidad' },
  openGraph: {
    title: `${privacidad.title} · ${SITE_NAME}`,
    description: privacidad.description,
    url: '/legal/privacidad',
    type: 'article',
  },
};

export default function Page() {
  return (
    <LegalPage
      doc={privacidad}
      other={{ href: '/legal/terminos', title: terminos.title }}
    />
  );
}
