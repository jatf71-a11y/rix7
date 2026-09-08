import { NextRequest, NextResponse } from 'next/server';
import { Property, PropertyType } from '@/lib/types/property';
import { SAMPLE_PROPERTIES } from '@/lib/data/sampleProperties';
import { stripDiacritics } from '@/lib/utils/text';

// Propiedades manuales con más detalle (La Reina + Lo Barnechea)
const MANUAL_PROPERTIES: Property[] = [
  {
    id: 'scl-casa-la-reina',
    title: 'Casa Familiar con Jardín y Quincho en La Reina',
    description: 'Amplia casa familiar de 4 dormitorios en sector residencial de La Reina.',
    price: 580000000,
    property_type: 'house',
    status: 'for_sale',
    bedrooms: 4,
    bathrooms: 3,
    area_sqm: 220,
    parking_spots: 2,
    year_built: 2018,
    address: 'Av. Larraín 5650',
    city: 'La Reina',
    state: 'Región Metropolitana de Santiago',
    zip_code: '7850000',
    images: [
      'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1600566753376-12c8ab7fb75b?auto=format&fit=crop&w=800&q=80',
    ],
    features: ['Jardín con pasto natural', 'Quincho techado a gas', 'Chimenea', 'Cocina integral'],
    lat: -33.4515,
    lng: -70.5420,
    agent_name: 'Camila Undurraga',
    agent_email: 'camila.undurraga@rix7.cl',
    agent_phone: '+56 9 8765 4321',
    created_at: '2026-09-01T10:00:00Z',
    featured: true,
    partner_id: 'catedral',
  },
  {
    id: 'scl-premium-lo-barnechea',
    title: 'Casa de Lujo con Vista Panorámica a los Andes en Lo Barnechea',
    description: 'Exclusiva residencia de lujo con vista panorámica a la Cordillera de los Andes.',
    price: 1900000000,
    property_type: 'premium',
    status: 'for_sale',
    bedrooms: 5,
    bathrooms: 4,
    area_sqm: 450,
    parking_spots: 3,
    year_built: 2022,
    address: 'Av. La Dehesa 2340',
    city: 'Lo Barnechea',
    state: 'Región Metropolitana de Santiago',
    zip_code: '7690000',
    images: [
      'https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=80',
    ],
    features: ['Vista a los Andes', 'Piscina climatizada', 'Domótica', 'Seguridad 24h'],
    lat: -33.3520,
    lng: -70.5167,
    agent_name: 'Rodrigo Altamirano',
    agent_email: 'rodrigo.altamirano@rix7.cl',
    agent_phone: '+56 9 5555 1234',
    created_at: '2026-08-28T10:00:00Z',
    featured: true,
    partner_id: 'savills',
  },

  // ═══ PROYECTOS (year_built > 2026) ═══
  {
    id: 'proy-depto-providencia',
    title: 'Proyecto Residencial Parque Sierra en Providencia',
    description: 'Moderno proyecto residencial de 12 departamentos con terminaciones premium, jardín vertical y terraza común con parrilla. Entrega estimada: Marzo 2027.',
    price: 420000000,
    property_type: 'apartment',
    status: 'for_sale',
    bedrooms: 2,
    bathrooms: 2,
    area_sqm: 95,
    parking_spots: 1,
    year_built: 2027,
    address: 'Av. Sierra Bella 1200',
    city: 'Providencia',
    state: 'Región Metropolitana de Santiago',
    zip_code: '7500000',
    images: [
      'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=80',
    ],
    features: ['Proyecto en preventa', 'Jardín vertical', 'Terraza común con parrilla', 'Estacionamiento incluido'],
    lat: -33.4250,
    lng: -70.6100,
    agent_name: 'Camila Undurraga',
    agent_email: 'camila.undurraga@rix7.cl',
    agent_phone: '+56 9 8765 4321',
    created_at: '2026-09-03T10:00:00Z',
    featured: true,
    partner_id: 'colliers',
  },
  {
    id: 'proy-casa-vina',
    title: 'Proyecto Casas del Acantilado en Viña del Mar',
    description: '6 casas pareadas de diseño contemporáneo con vista al Pacífico, piscina compartida y acceso directo al costanero. Entrega estimada: Junio 2027.',
    price: 780000000,
    property_type: 'house',
    status: 'for_sale',
    bedrooms: 4,
    bathrooms: 3,
    area_sqm: 280,
    parking_spots: 2,
    year_built: 2027,
    address: 'Av. España 2100',
    city: 'Viña del Mar',
    state: 'Región de Valparaíso',
    zip_code: '2520000',
    images: [
      'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80',
    ],
    features: ['Vista al Pacífico', 'Piscina compartida', 'Diseño contemporáneo', 'Acceso al costanero'],
    lat: -33.0150,
    lng: -71.5500,
    agent_name: 'Rodrigo Altamirano',
    agent_email: 'rodrigo.altamirano@rix7.cl',
    agent_phone: '+56 9 5555 1234',
    created_at: '2026-09-02T10:00:00Z',
    featured: true,
    partner_id: 'cbre',
  },
  {
    id: 'proy-premium-las-condes',
    title: 'Torre Residencial Av. Apoquindo — Penthouse Premium',
    description: 'Exclusivo Penthouse de 380m² en torre de 15 pisos con vista 360° a la Cordillera. Amenidades: gimnasio, salón de eventos, coworking y terraza en azotea. Entrega: Diciembre 2028.',
    price: 2500000000,
    property_type: 'premium',
    status: 'for_sale',
    bedrooms: 4,
    bathrooms: 4,
    area_sqm: 380,
    parking_spots: 4,
    year_built: 2028,
    address: 'Av. Apoquindo 3500',
    city: 'Las Condes',
    state: 'Región Metropolitana de Santiago',
    zip_code: '7550000',
    images: [
      'https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=80',
    ],
    features: ['Vista 360° Cordillera', 'Penthouse en azotea', 'Coworking privado', 'Conserjería 24/7'],
    lat: -33.4100,
    lng: -70.5950,
    agent_name: 'Camila Undurraga',
    agent_email: 'camila.undurraga@rix7.cl',
    agent_phone: '+56 9 8765 4321',
    created_at: '2026-09-04T10:00:00Z',
    featured: true,
    partner_id: 'cushman-wakefield',
  },
  {
    id: 'proy-parcela-cajon',
    title: 'Loteos Valle del Maipo — Parcelas de Recreación',
    description: 'Proyecto de 20 parcelas de recreación entre 5.000m² y 10.000m² en Cajón del Maipo. Agua, luz y camino de acceso. Entrega de lotes limpios: Septiembre 2027.',
    price: 85000000,
    property_type: 'parcel',
    status: 'for_sale',
    bedrooms: 0,
    bathrooms: 0,
    area_sqm: 7500,
    parking_spots: 0,
    year_built: 2027,
    address: 'Camino al Volcán km 45',
    city: 'Puente Alto',
    state: 'Región Metropolitana de Santiago',
    zip_code: '8760000',
    images: [
      'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1464226184884-fa280b87c399?auto=format&fit=crop&w=800&q=80',
    ],
    features: ['Agua y luz', 'Camino de acceso', 'Vista Cordillera', 'Lote limpio'],
    lat: -33.7200,
    lng: -70.3500,
    agent_name: 'Rodrigo Altamirano',
    agent_email: 'rodrigo.altamirano@rix7.cl',
    agent_phone: '+56 9 5555 1234',
    created_at: '2026-09-01T10:00:00Z',
    featured: true,
    partner_id: 'jll-chile',
  },
  {
    id: 'proy-oficina-santiago',
    title: 'Centro Empresarial Libertad — Oficinas Grade A',
    description: 'Torre de oficinas con certificación LEED, 12 pisos de oficinas modulares de 80m² a 500m². Estacionamiento subterráneo, lobby de mármol y acceso directo al metro.',
    price: 320000000,
    property_type: 'office',
    status: 'for_sale',
    bedrooms: 0,
    bathrooms: 2,
    privates: 4,
    area_sqm: 120,
    parking_spots: 2,
    year_built: 2027,
    address: "Av. Libertador Bernardo O'Higgins 1400",
    city: 'Santiago',
    state: 'Región Metropolitana de Santiago',
    zip_code: '8320000',
    images: [
      'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=800&q=80',
    ],
    features: ['Certificación LEED', 'Acceso metro', 'Módulos flexibles', 'Lobby de mármol'],
    lat: -33.4430,
    lng: -70.6530,
    agent_name: 'Camila Undurraga',
    agent_email: 'camila.undurraga@rix7.cl',
    agent_phone: '+56 9 8765 4321',
    partner_id: 'inelbrok',
  },
  {
    id: 'proy-terreno-temuco',
    title: 'Parque Industrial Temuco — Terrenos Habilitados',
    description: 'Terrenos industriales de 2.000m² a 5.000m² con servicios basicos, closura perimetral y acceso camionero. Ideal para bodegas, logística o industria liviana.',
    price: 45000000,
    property_type: 'land',
    status: 'for_sale',
    bedrooms: 0,
    bathrooms: 0,
    area_sqm: 3500,
    parking_spots: 0,
    year_built: 2028,
    address: 'Ruta 5 Sur km 830',
    city: 'Temuco',
    state: 'Región de La Araucanía',
    zip_code: '4780000',
    images: [
      'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1580587771525-78b9dba3b914?auto=format&fit=crop&w=800&q=80',
    ],
    features: ['Servicios básicos', 'Closura perimetral', 'Acceso camionero', 'Zona industrial'],
    lat: -38.7350,
    lng: -72.6000,
    agent_name: 'Rodrigo Altamirano',
    agent_email: 'rodrigo.altamirano@rix7.cl',
    agent_phone: '+56 9 5555 1234',
    created_at: '2026-09-03T10:00:00Z',
    featured: true,
    partner_id: 'toctoc',
  },


  // ═══ ENTREGA INMEDIATA (year_built 2026) ═══
  {
    id: 'inm-depto-concepcion',
    title: 'Departamento Amoblado Entrega Inmediata en Concepción',
    description: 'Departamento totalmente amoblado y listo para habitar. Cocina integral, electrodomésticos, muebles y ropa de cama incluidos. ideal para inversionistas.',
    price: 260000000,
    property_type: 'apartment',
    status: 'for_sale',
    bedrooms: 2,
    bathrooms: 1,
    area_sqm: 75,
    parking_spots: 1,
    year_built: 2026,
    address: 'Av. Condell 850',
    city: 'Concepción',
    state: 'Región del Biobío',
    zip_code: '4030000',
    images: [
      'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=80',
    ],
    features: ['Completamente amoblado', 'Entrega inmediata', 'Cerca del centro', 'Estacionamiento'],
    lat: -36.8270,
    lng: -73.0500,
    agent_name: 'Camila Undurraga',
    agent_email: 'camila.undurraga@rix7.cl',
    agent_phone: '+56 9 8765 4321',
    created_at: '2026-09-02T10:00:00Z',
    featured: true,
    partner_id: 'catedral',
  },
  {
    id: 'inm-casa-la-serena',
    title: 'Casa Entrega Inmediata con Piscina en La Serena',
    description: 'Casa de 3 dormitorios con piscina, quincho y jardín. Sector residencial tranquilo a 10 minutos del centro. Entrega inmediata con escrituras al día.',
    price: 380000000,
    property_type: 'house',
    status: 'for_sale',
    bedrooms: 3,
    bathrooms: 2,
    area_sqm: 180,
    parking_spots: 2,
    year_built: 2026,
    address: 'Calle Los Carrera 1200',
    city: 'La Serena',
    state: 'Región de Coquimbo',
    zip_code: '1700000',
    images: [
      'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80',
    ],
    features: ['Piscina', 'Quincho', 'Jardín con riego', 'Escrituras al día'],
    lat: -29.9020,
    lng: -71.2520,
    agent_name: 'Rodrigo Altamirano',
    agent_email: 'rodrigo.altamirano@rix7.cl',
    agent_phone: '+56 9 5555 1234',
    featured: true,
    partner_id: 'catedral',
  },

  // ═══ ESTACIONAMIENTO ═══
  {
    id: 'scl-estacionamiento-vitacura',
    title: 'Estacionamiento Techado en Vitacura',
    description: 'Estacionamiento techado ubicado en sector premium de Vitacura. Acceso 24/7 con llave electrónica, vigilancia permanente y cerca de centros comerciales.',
    price: 45000000,
    property_type: 'parking',
    status: 'for_sale',
    bedrooms: 0,
    bathrooms: 0,
    area_sqm: 15,
    parking_spots: 1,
    year_built: 2020,
    address: 'Av. Alonso de Córdova 4500',
    city: 'Vitacura',
    state: 'Región Metropolitana de Santiago',
    zip_code: '7630000',
    images: [
      'https://images.unsplash.com/photo-1590674899484-d5640e854abe?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1573349252346-6f764d4bae7c?auto=format&fit=crop&w=800&q=80',
    ],
    features: ['Techado', 'Llave electrónica', 'Vigilancia 24/7', 'Cerca de Mall Sport'],
    lat: -33.4050,
    lng: -70.5830,
    agent_name: 'Camila Undurraga',
    agent_email: 'camila.undurraga@rix7.cl',    agent_phone: '+56 9 8765 4321',
    created_at: '2026-09-04T10:00:00Z',
    featured: true,
  },


  // ═══ BODEGA ═══
  {
    id: 'rcha-bodega',
    title: 'Bodega Industrial en Rancagua',
    description: 'Amplia bodega industrial de 350m² con altura de 8 metros, piso hormigón pulido, oficina integrada y acceso para camiones. Sector industrial de Rancagua, cercana a la Ruta 5.',
    price: 180000000,
    property_type: 'warehouse',
    status: 'for_sale',
    bedrooms: 0,
    bathrooms: 1,
    area_sqm: 350,
    parking_spots: 4,
    year_built: 2015,
    address: 'Camino a San Fernando km 5',
    city: 'Rancagua',
    state: 'Región de O\'Higgins',
    zip_code: '2820000',
    images: [
      'https://images.unsplash.com/photo-1553413077-190dd305871c?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=800&q=80',
    ],
    features: ['Altura 8m', 'Piso hormigón pulido', 'Oficina integrada', 'Acceso camiones'],
    lat: -34.1700,
    lng: -70.7400,
    agent_name: 'Rodrigo Altamirano',
    agent_email: 'rodrigo.altamirano@rix7.cl',
    agent_phone: '+56 9 5555 1234',
    created_at: '2026-09-01T10:00:00Z',
    featured: true,
    partner_id: 'catedral',
  },


  // ═══ LOCAL COMERCIAL ═══
  {
    id: 'puc-local',
    title: 'Local Comercial en el Centro de Pucón',
    description: 'Local comercial de alto tránsito en plena arteria comercial de Pucón. Ideal para restaurantes, tiendas o servicios turísticos. Vista al volcán Villarrica.',
    price: 250000000,
    property_type: 'local',
    status: 'for_sale',
    bedrooms: 0,
    bathrooms: 2,
    area_sqm: 120,
    parking_spots: 2,
    year_built: 2019,
    address: 'Av. Bernardo O\'Higgins 520',
    city: 'Pucón',
    state: 'Región de La Araucanía',
    zip_code: '4920000',
    images: [
      'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?auto=format&fit=crop&w=800&q=80',
    ],
    features: ['Vista al Volcán', 'Alto tránsito', 'Amoblado', 'Calefacción por leña'],
    lat: -39.2670,
    lng: -71.9670,
    agent_name: 'Camila Undurraga',
    agent_email: 'camila.undurraga@rix7.cl',
    agent_phone: '+56 9 8765 4321',
    created_at: '2026-09-06T12:00:00Z',
    featured: true,
    partner_id: 'catedral',
  },
];

// Catálogo completo: manuales + generados
const ALL_PROPERTIES: Property[] = [...MANUAL_PROPERTIES, ...SAMPLE_PROPERTIES];

// ═══ Base filter: operation + location + search + price + bedrooms + bathrooms ═══
// Used for both the main result set AND category counts (without propertyType)
function baseFilter(
  p: Property,
  params: {
    operation: string;
    searchQuery: string;
    region: string;
    commune: string;
    minPrice: number | null;
    maxPrice: number | null;
    minBedrooms: number | null;
    minBathrooms: number | null;
    minPrivates: number | null;
  }
): boolean {
  const { operation, searchQuery, region, commune, minPrice, maxPrice, minBedrooms, minBathrooms, minPrivates } = params;

  // Operación
  if (operation !== 'all' && p.status !== operation) return false;

  // Precio
  if (minPrice && p.price < minPrice) return false;
  if (maxPrice && p.price > maxPrice) return false;

  // Dormitorios (exacto, excepto 5+)
  if (minBedrooms !== null) {
    if (minBedrooms === 5) {
      if (p.bedrooms < 5) return false;
    } else {
      if (p.bedrooms !== minBedrooms) return false;
    }
  }

  // Baños (exacto, excepto 4+)
  if (minBathrooms !== null) {
    if (minBathrooms === 4) {
      if (p.bathrooms < 4) return false;
    } else {
      if (p.bathrooms !== minBathrooms) return false;
    }
  }

  // Privados
  if (minPrivates !== null) {
    if (minPrivates === 5) {
      if ((p.privates ?? 0) < 5) return false;
    } else {
      if ((p.privates ?? 0) !== minPrivates) return false;
    }
  }

  // Comuna
  if (commune && p.city?.toLowerCase() !== commune) return false;

  // Región (solo si no hay comuna seleccionada)
  if (!commune && region && p.state) {
    if (!p.state.toLowerCase().includes(region) && !region.includes(p.state.toLowerCase())) return false;
  }

  // Búsqueda por texto
  if (searchQuery) {
    const q = searchQuery;
    const match =
      stripDiacritics(p.title.toLowerCase()).includes(q) ||
      stripDiacritics((p.city ?? '').toLowerCase()).includes(q) ||
      stripDiacritics((p.address ?? '').toLowerCase()).includes(q) ||
      stripDiacritics((p.state ?? '').toLowerCase()).includes(q);
    if (!match) return false;
  }

  return true;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const operation = searchParams.get('operation') || 'all';
  const propertyType = searchParams.get('propertyType') || 'all';
  const searchQuery = searchParams.get('search')
    ? stripDiacritics(searchParams.get('search')!.trim().toLowerCase())
    : '';
  const region = searchParams.get('region')
    ? searchParams.get('region')!.trim().toLowerCase()
    : '';
  const commune = searchParams.get('commune')
    ? searchParams.get('commune')!.trim().toLowerCase()
    : '';
  const minPrice = searchParams.get('minPrice') ? Number(searchParams.get('minPrice')) : null;
  const maxPrice = searchParams.get('maxPrice') ? Number(searchParams.get('maxPrice')) : null;
  const minBedrooms = searchParams.get('minBedrooms') ? Number(searchParams.get('minBedrooms')) : null;
  const minBathrooms = searchParams.get('minBathrooms') ? Number(searchParams.get('minBathrooms')) : null;
  const minPrivates = searchParams.get('minPrivates') ? Number(searchParams.get('minPrivates')) : null;
  const newPropertyType = (searchParams.get('newPropertyType') as 'proyectos' | 'entrega_inmediata' | null) || null;
  const partnerId = searchParams.get('partnerId') || null;

  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const limit = Math.min(2000, Math.max(1, Number(searchParams.get('limit')) || 50));

  const baseParams = { operation, searchQuery, region, commune, minPrice, maxPrice, minBedrooms, minBathrooms, minPrivates };

  // ═══ Intentar Supabase primero ═══
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (supabaseUrl && !supabaseUrl.includes('placeholder')) {
      const { createClient } = await import('@/lib/supabase/server');
      const supabase = createClient();
      const { data, error } = await supabase.rpc('get_properties_filtered', {
        min_lng: -76.0, min_lat: -56.0, max_lng: -66.0, max_lat: -17.0,
        min_price: minPrice, max_price: maxPrice, min_bedrooms: minBedrooms,
        prop_type: propertyType === 'all' ? null : propertyType,
        search_query: searchQuery || null,
      });

      if (!error && data && data.length > 0) {
        const filtered = operation === 'all' ? data : data.filter((p: any) => p.status === operation);
        const start = (page - 1) * limit;

        // Category counts from Supabase data (base filter without propertyType)
        const categoryCounts: Record<string, number> = { all: filtered.length };
        for (const p of filtered) {
          categoryCounts[p.property_type] = (categoryCounts[p.property_type] || 0) + 1;
        }

        return NextResponse.json({
          success: true,
          data: filtered.slice(start, start + limit),
          total: filtered.length,
          page,
          totalPages: Math.ceil(filtered.length / limit),
          categoryCounts,
          operationCounts: {
            for_sale: filtered.filter((p: any) => p.status === 'for_sale').length,
            for_rent: filtered.filter((p: any) => p.status === 'for_rent').length,
          },
          source: 'supabase',
        });
      }
    }
  } catch {
    // Supabase no disponible — usar catálogo en memoria
  }

  // ═══ Filtro local del catálogo nacional ═══

  // 1. Base set: operation + location + search + price + bedrooms + bathrooms
  const base = ALL_PROPERTIES.filter((p) => baseFilter(p, baseParams));

  // 2. Category counts: derive from base set (ignore propertyType for counts)
  const categoryCounts: Record<string, number> = { all: base.length };
  const typeKeys: PropertyType[] = ['apartment', 'house', 'premium', 'parcel', 'office', 'land', 'parking', 'local', 'warehouse'];
  for (const key of typeKeys) {
    categoryCounts[key] = 0;
  }
  for (const p of base) {
    if (categoryCounts[p.property_type] !== undefined) {
      categoryCounts[p.property_type]++;
    }
  }

  // 3. Operation counts: derive from base set (ignore operation for counts)
  const operationCounts = {
    for_sale: ALL_PROPERTIES.filter((p) => {
      const { operation: _op, ...rest } = baseParams;
      return baseFilter(p, { ...rest, operation: 'for_sale' });
    }).length,
    for_rent: ALL_PROPERTIES.filter((p) => {
      const { operation: _op, ...rest } = baseParams;
      return baseFilter(p, { ...rest, operation: 'for_rent' });
    }).length,
  };

  // 4. Final result: base + propertyType + newPropertyType + partnerId filters
  const currentYear = new Date().getFullYear();
  let filtered = propertyType === 'all'
    ? base
    : base.filter((p) => p.property_type === propertyType);

  // Partner filter (for /empresas/[slug] page)
  if (partnerId) {
    filtered = filtered.filter((p) => p.partner_id === partnerId);
  }

  // newPropertyType filter: proyectos = year_built > currentYear, entrega_inmediata = year_built <= currentYear
  if (newPropertyType === 'proyectos') {
    filtered = filtered.filter((p) => p.year_built && p.year_built > currentYear);
  } else if (newPropertyType === 'entrega_inmediata') {
    filtered = filtered.filter((p) => !p.year_built || p.year_built <= currentYear);
  }

  const start = (page - 1) * limit;
  const paged = filtered.slice(start, start + limit);

  return NextResponse.json({
    success: true,
    data: paged,
    total: filtered.length,
    totalCatalog: ALL_PROPERTIES.length,
    page,
    totalPages: Math.ceil(filtered.length / limit),
    categoryCounts,
    operationCounts,
    source: 'national_catalog',
  });
}
