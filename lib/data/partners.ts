export interface PartnerContact {
  /** Central de la corredora (mesa de ventas). Se usa en "Llamar". */
  phone: string;
  /** Móvil con WhatsApp habilitado. Separado del anterior porque un número
   *  fijo no puede recibir WhatsApp: `api.whatsapp.com` lo rechaza. */
  whatsapp: string;
  /** Correo de contacto de la corredora. Se usa en "Mail". */
  email: string;
}

export interface Partner {
  id: string;
  slug: string;
  name: string;
  logo: string; // Ruta local en /public/logos (resistente a caídas de servicios externos)
  description: string;
  website?: string;
  color: string; // Color principal de la marca
  /**
   * Datos de contacto que aporta cada corredora. Son los que habilitan los
   * botones Llamar / WhatsApp / Mail de la ficha (no los del agente individual).
   *
   * ⚠️ PLACEHOLDER: los valores actuales siguen el patrón de relleno del
   * proyecto (`+56 2 2000 00XX` / `+56 9 0000 00XX`). Reemplazar por los datos
   * reales que entregue cada corredora antes de publicar.
   */
  contact: PartnerContact;
}

export const partners: Partner[] = [
  {
    id: 'catedral',
    slug: 'catedral',
    name: 'Catedral Propiedades',
    logo: '/logos/catedral.png',
    description: 'Corredora de propiedades con atención personalizada y trato cercano',
    color: '#3B82F6',
    contact: {
      phone: '+56 2 2000 0001',
      whatsapp: '+56 9 0000 0001',
      email: 'contacto@catedralpropiedades.cl',
    },
  },
  {
    id: 'cushman-wakefield',
    slug: 'cushman-wakefield',
    name: 'Cushman & Wakefield',
    logo: '/logos/cushmanwakefield.png',
    description: 'Líder mundial en servicios inmobiliarios comerciales',
    website: 'https://www.cushmanwakefield.com',
    color: '#003366',
    contact: {
      phone: '+56 2 2000 0002',
      whatsapp: '+56 9 0000 0002',
      email: 'contacto@cushmanwakefield.com',
    },
  },
  {
    id: 'cbre',
    slug: 'cbre',
    name: 'CBRE Chile',
    logo: '/logos/cbre.png',
    description: 'La consultora inmobiliaria más grande del mundo',
    website: 'https://www.cbre.com',
    color: '#0050AA',
    contact: {
      phone: '+56 2 2000 0003',
      whatsapp: '+56 9 0000 0003',
      email: 'contacto@cbre.com',
    },
  },
  {
    id: 'colliers',
    slug: 'colliers',
    name: 'Colliers International',
    logo: '/logos/colliers.png',
    description: 'Servicios inmobiliarios y de gestión de inversiones',
    website: 'https://www.colliers.com',
    color: '#ED1C24',
    contact: {
      phone: '+56 2 2000 0004',
      whatsapp: '+56 9 0000 0004',
      email: 'contacto@colliers.com',
    },
  },
  {
    id: 'jll-chile',
    slug: 'jll-chile',
    name: 'JLL Chile',
    logo: '/logos/jll.ico',
    description: 'Consultoría inmobiliaria y gestión de inversiones',
    website: 'https://www.jll.com',
    color: '#CC0000',
    contact: {
      phone: '+56 2 2000 0005',
      whatsapp: '+56 9 0000 0005',
      email: 'contacto@jll.com',
    },
  },
  {
    id: 'savills',
    slug: 'savills',
    name: 'Savills Chile',
    logo: '/logos/savills.png',
    description: 'Asesoría inmobiliaria de prestigio internacional',
    website: 'https://www.savills.com',
    color: '#00263A',
    contact: {
      phone: '+56 2 2000 0006',
      whatsapp: '+56 9 0000 0006',
      email: 'contacto@savills.com',
    },
  },
  {
    id: 'torre-blanca',
    slug: 'torre-blanca',
    name: 'Torre Blanca SpA',
    logo: '/logos/torreblanca.svg',
    description: 'Desarrolladora inmobiliaria con más de 30 años de trayectoria',
    website: 'https://www.torreblanca.cl',
    color: '#1A5276',
    contact: {
      phone: '+56 2 2000 0007',
      whatsapp: '+56 9 0000 0007',
      email: 'contacto@torreblanca.cl',
    },
  },
  {
    id: 'inelbrok',
    slug: 'inelbrok',
    name: 'Inelbrok',
    logo: '/logos/inelbrok.svg',
    description: 'Corredora de propiedades con presencia nacional',
    website: 'https://www.inelbrok.cl',
    color: '#E67E22',
    contact: {
      phone: '+56 2 2000 0008',
      whatsapp: '+56 9 0000 0008',
      email: 'contacto@inelbrok.cl',
    },
  },
  {
    id: '.portal-inmobiliario',
    slug: 'portal-inmobiliario',
    name: 'Portal Inmobiliario',
    logo: '/logos/portalinmobiliario.png',
    description: 'El portal líder de propiedades en Chile',
    website: 'https://www.portalinmobiliario.com',
    color: '#FF6600',
    contact: {
      phone: '+56 2 2000 0009',
      whatsapp: '+56 9 0000 0009',
      email: 'contacto@portalinmobiliario.com',
    },
  },
  {
    id: 'toctoc',
    slug: 'toctoc',
    name: 'Toctoc.com',
    logo: '/logos/toctoc.png',
    description: 'Plataforma digital de compra y arriendo de propiedades',
    website: 'https://www.toctoc.com',
    color: '#00C853',
    contact: {
      phone: '+56 2 2000 0010',
      whatsapp: '+56 9 0000 0010',
      email: 'contacto@toctoc.com',
    },
  },
  {
    id: 'yapo',
    slug: 'yapo',
    name: 'Yapo.cl',
    logo: '/logos/yapo.png',
    description: 'Portal de clasificados con sección inmobiliaria líder',
    website: 'https://www.yapo.cl',
    color: '#FFC107',
    contact: {
      phone: '+56 2 2000 0011',
      whatsapp: '+56 9 0000 0011',
      email: 'contacto@yapo.cl',
    },
  },
];

export function getPartnerBySlug(slug: string): Partner | undefined {
  return partners.find((p) => p.slug === slug);
}

export function getPartnerById(id: string): Partner | undefined {
  return partners.find((p) => p.id === id);
}
