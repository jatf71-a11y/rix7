export interface Partner {
  id: string;
  slug: string;
  name: string;
  logo: string; // Ruta local en /public/logos (resistente a caídas de servicios externos)
  description: string;
  website?: string;
  color: string; // Color principal de la marca
}

export const partners: Partner[] = [
  {
    id: 'catedral',
    slug: 'catedral',
    name: 'Catedral Bienes Raíces SpA',
    logo: '/logos/catedral.png',
    description: 'Corredora de propiedades con atención personalizada y trato cercano',
    color: '#3B82F6',
  },
  {
    id: 'cushman-wakefield',
    slug: 'cushman-wakefield',
    name: 'Cushman & Wakefield',
    logo: '/logos/cushmanwakefield.png',
    description: 'Líder mundial en servicios inmobiliarios comerciales',
    website: 'https://www.cushmanwakefield.com',
    color: '#003366',
  },
  {
    id: 'cbre',
    slug: 'cbre',
    name: 'CBRE Chile',
    logo: '/logos/cbre.png',
    description: 'La consultora inmobiliaria más grande del mundo',
    website: 'https://www.cbre.com',
    color: '#0050AA',
  },
  {
    id: 'colliers',
    slug: 'colliers',
    name: 'Colliers International',
    logo: '/logos/colliers.png',
    description: 'Servicios inmobiliarios y de gestión de inversiones',
    website: 'https://www.colliers.com',
    color: '#ED1C24',
  },
  {
    id: 'jll-chile',
    slug: 'jll-chile',
    name: 'JLL Chile',
    logo: '/logos/jll.ico',
    description: 'Consultoría inmobiliaria y gestión de inversiones',
    website: 'https://www.jll.com',
    color: '#CC0000',
  },
  {
    id: 'savills',
    slug: 'savills',
    name: 'Savills Chile',
    logo: '/logos/savills.png',
    description: 'Asesoría inmobiliaria de prestigio internacional',
    website: 'https://www.savills.com',
    color: '#00263A',
  },
  {
    id: 'torre-blanca',
    slug: 'torre-blanca',
    name: 'Torre Blanca SpA',
    logo: '/logos/torreblanca.svg',
    description: 'Desarrolladora inmobiliaria con más de 30 años de trayectoria',
    website: 'https://www.torreblanca.cl',
    color: '#1A5276',
  },
  {
    id: 'inelbrok',
    slug: 'inelbrok',
    name: 'Inelbrok',
    logo: '/logos/inelbrok.svg',
    description: 'Corredora de propiedades con presencia nacional',
    website: 'https://www.inelbrok.cl',
    color: '#E67E22',
  },
  {
    id: '.portal-inmobiliario',
    slug: 'portal-inmobiliario',
    name: 'Portal Inmobiliario',
    logo: '/logos/portalinmobiliario.png',
    description: 'El portal líder de propiedades en Chile',
    website: 'https://www.portalinmobiliario.com',
    color: '#FF6600',
  },
  {
    id: 'toctoc',
    slug: 'toctoc',
    name: 'Toctoc.com',
    logo: '/logos/toctoc.png',
    description: 'Plataforma digital de compra y arriendo de propiedades',
    website: 'https://www.toctoc.com',
    color: '#00C853',
  },
  {
    id: 'yapo',
    slug: 'yapo',
    name: 'Yapo.cl',
    logo: '/logos/yapo.png',
    description: 'Portal de clasificados con sección inmobiliaria líder',
    website: 'https://www.yapo.cl',
    color: '#FFC107',
  },
];

export function getPartnerBySlug(slug: string): Partner | undefined {
  return partners.find((p) => p.slug === slug);
}

export function getPartnerById(id: string): Partner | undefined {
  return partners.find((p) => p.id === id);
}
