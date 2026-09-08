'use client';

import React from 'react';
import Link from 'next/link';
import { PropertyGallery } from '@/components/properties/PropertyGallery';
import { MortgageCalculator } from '@/components/properties/MortgageCalculator';
import { ContactAgentForm } from '@/components/properties/ContactAgentForm';
import { useCurrency } from '@/components/currency/CurrencyProvider';
import { CurrencySelector } from '@/components/currency/CurrencySelector';
import { formatPrice, formatArea, getPropertyTypeLabel, getStatusLabel } from '@/lib/utils/formatters';
import {
  Bed,
  Bath,
  Maximize2,
  Car,
  MapPin,
  ChevronLeft,
  Share2,
  Heart,
  CheckCircle,
} from 'lucide-react';
import { Property } from '@/lib/types/property';
import { getPartnerById } from '@/lib/data/partners';

const CHILE_PROPERTIES_MAP: Record<string, Property> = {
  'scl-casa-la-reina': {
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
  'scl-premium-vitacura': {
    id: 'scl-premium-vitacura',
    title: 'Exclusiva Propiedad Premium con Terraza Panorámica y Vista a la Cordillera',
    description: `Impresionante residencia Premium en Nueva Costanera con vista completamente despejada a la Cordillera de los Andes y al Parque Bicentenario.

La propiedad destaca por sus terminaciones de lujo, finos pisos de madera de ingeniería, techos altos de 2.90 metros y una gran terraza privada con quincho integrado de acero inoxidable.

La cocina es de diseño italiano con cubierta de cuarzo Silestone e isla central, totalmente equipada con electrodomésticos empotrados. Cuenta con 3 dormitorios en suite, destacando el master bedroom con walk-in closet doble y sala de baño con hidromasaje.

Incluye 3 estacionamientos subterráneos, 1 bodega grande, climatización centralizada frío/calor, persianas automatizadas y seguridad 24 horas con circuito cerrado de televisión.`,
    price: 890000000,
    property_type: 'premium',
    status: 'for_sale',
    bedrooms: 3,
    bathrooms: 3.5,
    area_sqm: 240.0,
    parking_spots: 3,
    year_built: 2022,
    address: 'Av. Nueva Costanera 3900',
    city: 'Vitacura',
    state: 'Región Metropolitana',
    zip_code: '7630000',
    images: [
      'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1600566753376-12c8ab7fb75b?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=80',
    ],
    features: [
      'Terraza privada con quincho techado',
      'Ascensor directo al departamento',
      'Termopanel acústico Low-E en todos los ventanales',
      '3 Estacionamientos subterráneos',
      'Bodega amplia con repisas',
      'Conserjería y seguridad 24/7',
      'Gimnasio y piscina comunitaria',
    ],
    lat: -33.3980,
    lng: -70.5980,
    agent_name: 'Camila Undurraga',
    agent_email: 'camila.undurraga@rix7.cl',
    agent_phone: '+56 9 8765 4321',
    agent_avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=256&q=80',
  },
  'inm-depto-concepcion': {
    id: 'inm-depto-concepcion',
    title: 'Departamento Amoblado Entrega Inmediata en Concepción',
    description: 'Departamento totalmente amoblado y listo para habitar.',
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
    partner_id: 'catedral',
  },
  'inm-casa-la-serena': {
    id: 'inm-casa-la-serena',
    title: 'Casa Entrega Inmediata con Piscina en La Serena',
    description: 'Casa de 3 dormitorios con piscina, quincho y jardín.',
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
    partner_id: 'catedral',
  },
  'scl-casa-la-dehesa': {
    id: 'scl-casa-la-dehesa',
    title: 'Casa Mediterránea con Piscina y Gran Jardín en La Dehesa',
    description: `Espectacular casa mediterránea construida en hormigón armado a la vista, emplazada en condominio consolidado de alta seguridad en El Huinganal, Lo Barnechea.

Diseñada con amplios espacios conectados visualmente con el jardín. Cuenta con living y comedor separados con doble altura, cocina con comedor de diario integrado, family room, 5 dormitorios (principal en suite con terraza privada) y 5 baños.

En el exterior cuenta con piscina temperada por paneles solares, quincho gourmet con horno de leña, baño exterior y un jardín con riego automático y añosos árboles.`,
    price: 1250000000,
    property_type: 'house',
    status: 'for_sale',
    bedrooms: 5,
    bathrooms: 5.0,
    area_sqm: 480.0,
    parking_spots: 4,
    year_built: 2021,
    address: 'Camino El Huinganal 4500',
    city: 'Lo Barnechea',
    state: 'Región Metropolitana',
    zip_code: '7690000',
    images: [
      'https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1600573472592-401b489a3cdc?auto=format&fit=crop&w=800&q=80',
    ],
    features: [
      'Piscina temperada solar',
      'Jardín consolidado 1.200 m²',
      'Quincho gourmet con horno de leña',
      'Calefacción central por losa radiante',
      'Condominio cerrado con control de acceso estricto',
    ],
    lat: -33.3450,
    lng: -70.5280,
    agent_name: 'Ignacio Valdés',
    agent_email: 'ignacio.valdes@rix7.cl',
    agent_phone: '+56 9 7654 3210',
    agent_avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=256&q=80',
  },
  'rent-scl-depto-providencia': {
    id: 'rent-scl-depto-providencia',
    title: 'Moderno Departamento Amoblado en Pocuro / Providencia',
    description: 'Excelente departamento totalmente amoblado y equipado con vista arbolada a ciclovía Pocuro. Cocina integrada de concepto abierto con mesón de granito, terraza con parrilla a gas, dormitorio en suite, estacionamiento subterráneo y bodega.',
    price: 850000,
    property_type: 'apartment',
    status: 'for_rent',
    bedrooms: 2,
    bathrooms: 2.0,
    area_sqm: 85.0,
    parking_spots: 1,
    year_built: 2021,
    address: 'Av. Pocuro 2250',
    city: 'Providencia',
    state: 'Región Metropolitana',
    zip_code: '7500000',
    images: [
      'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=80',
    ],
    features: ['Completamente amoblado', 'Estacionamiento y bodega', 'Frente a ciclovía Pocuro', 'Gimnasio y piscina', 'Seguridad 24/7'],
    lat: -33.4380,
    lng: -70.6080,
    agent_name: 'Camila Undurraga',
    agent_email: 'camila.undurraga@rix7.cl',
    agent_phone: '+56 9 8765 4321',
    agent_avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=256&q=80',
  },
};

function getProperty(id: string): Property {
  return (
    CHILE_PROPERTIES_MAP[id] || {
      id,
      title: 'Propiedad Exclusiva en Santiago Oriente',
      description: 'Hermosa propiedad ubicada en sector de alta plusvalía y conectividad. Excelentes terminaciones, amplios espacios luminosos y cercanía a colegios, centros comerciales y transporte.',
      price: 380000000,
      property_type: 'apartment',
      status: 'for_sale',
      bedrooms: 3,
      bathrooms: 2,
      area_sqm: 115,
      parking_spots: 2,
      year_built: 2021,
      address: 'Av. Apoquindo 4800',
      city: 'Las Condes',
      state: 'Región Metropolitana',
      zip_code: '7550000',
      images: [
        'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=80',
        'https://images.unsplash.com/photo-1600566753376-12c8ab7fb75b?auto=format&fit=crop&w=800&q=80',
      ],
      features: ['Estacionamiento subterráneo', 'Bodega', 'Piscina', 'Gimnasio', 'Conserjería 24 hrs'],
      lat: -33.412,
      lng: -70.58,
      agent_name: 'Matías Larraín',
      agent_email: 'matias.larrain@rix7.cl',
      agent_phone: '+56 9 9123 4567',
      agent_avatar: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&w=256&q=80',
    }
  );
}

export default function PropertyDetailPage({ params }: { params: { id: string } }) {
  const property = getProperty(params.id);
  const partner = property.partner_id ? getPartnerById(property.partner_id) : undefined;
  const isNewProp = property.created_at ? (Date.now() - new Date(property.created_at).getTime()) < 7 * 24 * 60 * 60 * 1000 : false;
  const showLogo = partner && (property.featured || isNewProp);
  const { currency } = useCurrency();
  const isRent = property.status === 'for_rent';
  const pricePerSqm = Math.round(property.price / property.area_sqm);

  return (
    <div className="bg-slate-50 min-h-screen pb-16">
      {/* Barra Superior con Navegación, Selector de Moneda y Acciones */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-blue-600 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Volver a la búsqueda</span>
          </Link>

          <div className="flex items-center gap-3">
            <CurrencySelector />
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
              <Share2 className="w-3.5 h-3.5" />
              <span>Compartir</span>
            </button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:text-red-500 hover:bg-slate-50 transition-colors">
              <Heart className="w-3.5 h-3.5" />
              <span>Guardar</span>
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
        {/* Galería Mosaico de Imágenes */}
        <PropertyGallery
          images={property.images}
          title={property.title}
          partnerLogo={partner?.logo}
          partnerName={partner?.name}
          showPartnerLogo={!!showLogo}
        />

        {/* Contenedor Principal: Información a la Izquierda y Contacto Fijo a la Derecha */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mt-8">
          {/* Columna Izquierda (Detalles, Specs, Descripción, Crédito Hipotecario) */}
          <div className="lg:col-span-8 space-y-8">
            {/* Encabezado y Precio con Moneda Activa */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-sm">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className={`px-3 py-1 text-xs font-bold rounded-lg border ${
                  isRent
                    ? 'bg-blue-50 text-blue-700 border-blue-200'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                }`}>
                  {getStatusLabel(property.status)}
                </span>
                <span className="px-3 py-1 bg-slate-100 text-slate-700 text-xs font-bold rounded-lg border border-slate-200">
                  {getPropertyTypeLabel(property.property_type)}
                </span>
              </div>

              <div className="flex flex-wrap items-baseline justify-between gap-4">
                <h1 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight">
                  {formatPrice(property.price, currency, 'es-CL', isRent)}
                </h1>
                <span className="text-sm font-semibold text-slate-500">
                  {formatPrice(pricePerSqm, currency, 'es-CL')} / m²
                </span>
              </div>

              <p className="flex items-center gap-1.5 text-sm text-slate-600 font-medium mt-2">
                <MapPin className="w-4 h-4 text-slate-400 flex-shrink-0" />
                <span>
                  {property.address}, {property.city} ({property.state})
                </span>
              </p>

              {/* Grid de Especificaciones Clave */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-6 border-t border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                    <Bed className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-xs text-slate-500 uppercase font-semibold">Dormitorios</span>
                    <div className="text-base font-bold text-slate-900">{property.bedrooms} dorm.</div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                    <Bath className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-xs text-slate-500 uppercase font-semibold">Baños</span>
                    <div className="text-base font-bold text-slate-900">{property.bathrooms} baños</div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                    <Maximize2 className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-xs text-slate-500 uppercase font-semibold">Superficie</span>
                    <div className="text-base font-bold text-slate-900">{formatArea(property.area_sqm)}</div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                    <Car className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-xs text-slate-500 uppercase font-semibold">Estacionamiento</span>
                    <div className="text-base font-bold text-slate-900">
                      {property.parking_spots > 0 ? `${property.parking_spots} estac.` : 'Sin estac.'}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Descripción Completa */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-sm">
              <h2 className="text-xl font-bold text-slate-900 mb-4">Acerca de esta propiedad</h2>
              <div className="text-slate-700 text-sm leading-relaxed whitespace-pre-line">
                {property.description}
              </div>
            </div>

            {/* Comodidades y Características */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-sm">
              <h2 className="text-xl font-bold text-slate-900 mb-4">Equipamiento y Terminaciones</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {property.features.map((feature, i) => (
                  <div key={i} className="flex items-center gap-2.5 text-sm text-slate-700">
                    <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                    <span>{feature}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Calculadora de Dividendo Hipotecario */}
            {!isRent && <MortgageCalculator propertyPrice={property.price} />}
          </div>

          {/* Columna Derecha (Formulario de Contacto al Agente) */}
          <div className="lg:col-span-4">
            <ContactAgentForm property={property} />
          </div>
        </div>
      </div>
    </div>
  );
}
