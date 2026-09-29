import type { Metadata } from 'next';

import HomeClient from './HomeClient';

/**
 * La home era un componente de cliente sin metadata propia: heredaba el title
 * genérico del layout y no tenía canonical ni Open Graph propios (hallazgo #8).
 *
 * El componente interactivo vive en `HomeClient` y este wrapper de servidor
 * carga la metadata: es el patrón de Next para páginas cliente que necesitan
 * SEO. El import de `HomeClient` es dinámico a nivel de bundle (el wrapper no
 * añade JS al cliente: solo HTML de metadatos).
 */
export const metadata: Metadata = {
  title: 'Rix7 | Propiedades en venta y arriendo en todo Chile',
  description:
    'Busca casas, departamentos, oficinas y proyectos en venta y arriendo en todo Chile. Mapa interactivo, precios en $, UF y US$, calculadora de dividendo y catálogo actualizado en tiempo real.',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    locale: 'es_CL',
    siteName: 'Rix7',
    title: 'Rix7 | Propiedades en venta y arriendo en todo Chile',
    description:
      'Casas, departamentos y proyectos en venta y arriendo en todo Chile, con mapa interactivo y precios en $, UF y US$.',
    url: '/',
  },
  twitter: {
    card: 'summary',
    title: 'Rix7 | Propiedades en venta y arriendo en todo Chile',
    description:
      'Casas, departamentos y proyectos en venta y arriendo en todo Chile, con mapa interactivo.',
  },
};

export default function HomePage() {
  return <HomeClient />;
}
