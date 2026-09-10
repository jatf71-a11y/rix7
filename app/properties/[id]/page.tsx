'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
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
  SearchX,
  Loader2,
} from 'lucide-react';
import { Property } from '@/lib/types/property';
import { getPartnerById } from '@/lib/data/partners';

export default function PropertyDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [property, setProperty] = useState<Property | null>(null);
  const [notFound, setNotFound] = useState(false);
  const { currency } = useCurrency();

  // ═══ Fetch de la propiedad desde la API (Supabase → fallback catálogo) ═══
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setProperty(null);
    setNotFound(false);

    fetch(`/api/properties/${id}`)
      .then(async (r) => {
        const result = await r.json();
        if (cancelled) return;
        if (r.ok && result.success && result.data) {
          setProperty(result.data);
        } else {
          setNotFound(true);
        }
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  // ═══ Estado: Propiedad no encontrada ═══
  if (notFound) {
    return (
      <div className="bg-slate-50 min-h-screen flex items-center justify-center">
        <div className="text-center px-4">
          <SearchX className="w-16 h-16 text-slate-300 mx-auto mb-4" />
          <h1 className="text-xl font-black text-slate-900">Propiedad no encontrada</h1>
          <p className="text-slate-500 text-sm mt-2 max-w-md mx-auto">
            Esta propiedad ya no está disponible o la dirección es incorrecta.
          </p>
          <Link
            href="/"
            className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Volver a la búsqueda
          </Link>
        </div>
      </div>
    );
  }

  // ═══ Estado: Cargando (skeleton) ═══
  if (!property) {
    return (
      <div className="bg-slate-50 min-h-screen pb-16">
        <div className="bg-white border-b border-slate-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
            <div className="h-5 w-44 bg-slate-200 rounded animate-pulse" />
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
          <div className="aspect-[16/7] w-full bg-slate-200 rounded-2xl animate-pulse" />
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mt-8">
            <div className="lg:col-span-8 space-y-6">
              <div className="bg-white rounded-2xl border border-slate-200 p-8 space-y-4">
                <div className="h-4 w-24 bg-slate-100 rounded animate-pulse" />
                <div className="h-9 w-2/3 bg-slate-200 rounded animate-pulse" />
                <div className="h-4 w-1/2 bg-slate-100 rounded animate-pulse" />
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 p-8 space-y-3">
                <div className="h-4 w-40 bg-slate-200 rounded animate-pulse" />
                <div className="h-3 w-full bg-slate-100 rounded animate-pulse" />
                <div className="h-3 w-5/6 bg-slate-100 rounded animate-pulse" />
              </div>
            </div>
            <div className="lg:col-span-4">
              <div className="bg-white rounded-2xl border border-slate-200 p-6 h-96 animate-pulse" />
            </div>
          </div>
        </div>
        <div className="fixed inset-0 flex items-center justify-center pointer-events-none">
          <span className="inline-flex items-center gap-2 text-xs font-semibold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-full shadow-sm">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Cargando propiedad...
          </span>
        </div>
      </div>
    );
  }

  const partner = property.partner_id ? getPartnerById(property.partner_id) : undefined;
  const isNewProp = property.created_at
    ? Date.now() - new Date(property.created_at).getTime() < 7 * 24 * 60 * 60 * 1000
    : false;
  const showLogo = partner && (property.featured || isNewProp);
  const isRent = property.status === 'for_rent';
  const pricePerSqm = property.area_sqm > 0 ? Math.round(property.price / property.area_sqm) : 0;

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
          partnerColor={partner?.color}
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
                  {property.address}, {property.city}{property.state ? ` (${property.state})` : ''}
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
            {property.features && property.features.length > 0 && (
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
            )}

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
