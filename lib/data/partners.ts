/**
 * Las tres categorías de socio del portal: una corredora, una inmobiliaria o un
 * agente independiente. El panel filtra por esta columna y el alta exige una.
 */
export const PARTNER_KINDS = ['corredora', 'inmobiliaria', 'agente'] as const;

export type PartnerKind = (typeof PARTNER_KINDS)[number];

export const PARTNER_KIND_LABELS: Record<PartnerKind, string> = {
  corredora: 'Corredora',
  inmobiliaria: 'Inmobiliaria',
  agente: 'Agente',
};

/** Valida un valor que viene de la base o de un formulario. */
export function isPartnerKind(value: unknown): value is PartnerKind {
  return typeof value === 'string' && (PARTNER_KINDS as readonly string[]).includes(value);
}

/** Etiqueta visible. `null` es una ficha histórica que nadie clasificó. */
export function partnerKindLabel(kind: PartnerKind | null | undefined): string {
  return kind ? PARTNER_KIND_LABELS[kind] : 'Sin clasificar';
}

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
  /**
   * Feed XML para agregadores (hallazgo #14): solo el **estado** vive acá. El
   * token se guarda en la base como hash SHA-256 (`feed_token_hash`), así que
   * el valor en claro se muestra **una vez** al activar o regenerar y después
   * nunca vuelve del servidor: la lectura pública de la tabla (RLS) no puede
   * filtrarlo.
   */
  feedEnabled?: boolean;
  /**
   * Categoría del socio: corredora, inmobiliaria o agente. `null`/ausente =
   * ficha sin clasificar.
   */
  kind?: PartnerKind | null;
}

export const partners: Partner[] = [
  {
    id: 'catedral',
    slug: 'catedral',
    kind: 'corredora',
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
    kind: 'inmobiliaria',
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
    kind: 'inmobiliaria',
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
    kind: 'inmobiliaria',
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
    kind: 'inmobiliaria',
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
    kind: 'inmobiliaria',
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
    kind: 'inmobiliaria',
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
    kind: 'corredora',
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
];

export function getPartnerBySlug(slug: string): Partner | undefined {
  return partners.find((p) => p.slug === slug);
}

export function getPartnerById(id: string): Partner | undefined {
  return partners.find((p) => p.id === id);
}
