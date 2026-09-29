import type { Metadata } from 'next';
import { SITE_NAME } from '@/lib/site';

/**
 * Metadata del segmento legal: las dos páginas heredan `template`, de modo
 * que pestaña y resultados de búsqueda muestren «… · Rix7» sin repetirlo
 * página a página.
 */
export const metadata: Metadata = {
  title: {
    default: 'Legal',
    template: `%s · ${SITE_NAME}`,
  },
};

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return children;
}
