import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // `/favoritos` es de cada persona y sin sesión solo invita a entrar, así
        // que no hay nada que indexar. Además lleva `noindex` como respaldo, para
        // el caso de que el crawler llegue igual (por ejemplo desde un enlace
        // externo) y no deba mostrar la invitación como si fuera contenido.
        disallow: ['/admin', '/admin/', '/api/', '/favoritos'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
