'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { PropertyGallery } from '@/components/properties/PropertyGallery';
import { MortgageCalculator } from '@/components/properties/MortgageCalculator';
import { ContactAgentForm } from '@/components/properties/ContactAgentForm';

// ═══ Leaflet se carga dinámicamente (solo cliente) ═══
const PropertyMapLeaflet = dynamic(() => import('@/components/map/PropertyMapLeaflet'), {
  ssr: false,
  loading: () => (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-6 pb-3">
        <div className="h-5 w-40 bg-slate-200 rounded animate-pulse" />
        <div className="h-3 w-60 bg-slate-100 rounded animate-pulse mt-2" />
      </div>
      <div className="h-72 sm:h-96 bg-slate-100 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
      </div>
    </div>
  ),
});
import { useCurrency } from '@/components/currency/CurrencyProvider';
import { useAuth } from '@/components/auth/AuthProvider';
import { useFavorites } from '@/components/auth/FavoritesProvider';
import { CurrencySelector } from '@/components/currency/CurrencySelector';
import { formatArea, getPropertyTypeLabel, getStatusLabel } from '@/lib/utils/formatters';
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
  Loader2,
  MessageCircle,
  Copy,
} from 'lucide-react';
import { Property } from '@/lib/types/property';
import type { Partner } from '@/lib/data/partners';

interface PropertyDetailClientProps {
  property: Property;
  /** Corredora resuelta por el servidor (vive en Supabase, no en el bundle). */
  partner?: Partner;
}

/**
 * Ficha de la propiedad (interactiva).
 *
 * Recibe la propiedad ya resuelta por el server component que la renderiza
 * (`app/properties/[id]/page.tsx`), así que el HTML inicial llega con los
 * datos y no hay un segundo viaje del navegador a `/api/properties/[id]`.
 */
export function PropertyDetailClient({ property, partner }: PropertyDetailClientProps) {
  const [copyOk, setCopyOk] = useState(false);
  const { format } = useCurrency();

  // ═══ Favoritos: en la cuenta, no en este navegador ═══
  // El estado y la persistencia los maneja `FavoritesProvider`, para que la
  // misma marca se vea en el celular y en el computador.
  const { isFavorite, toggle: toggleFavorite, source, isLoading: favoritesLoading } = useFavorites();
  const isFavorited = isFavorite(property.id);
  // Entrar es lo que hace que un favorito siga a la persona: se ofrece justo
  // cuando acaba de guardar uno, que es cuando le importa.
  const { openAuthModal } = useAuth();

  const isNewProp = property.created_at
    ? Date.now() - new Date(property.created_at).getTime() < 7 * 24 * 60 * 60 * 1000
    : false;
  const showLogo = partner && (property.featured || isNewProp);
  const isRent = property.status === 'for_rent';
  const pricePerSqm = property.area_sqm > 0 ? Math.round(property.price / property.area_sqm) : 0;

  // ═══ Compartir (WhatsApp + enlace copiado) ═══
  //
  // Se comparte la **landing** (`/compartir/[id]`), no la URL actual: es la
  // página pensada para quien recibe el enlace sin conocer la propiedad —
  // resume fotos, precio, entorno y corredora, y no publica la dirección
  // exacta ni los datos de contacto directos.
  const sharePath = `/compartir/${property.id}`;
  const shareUrl =
    typeof window !== 'undefined' ? `${window.location.origin}${sharePath}` : sharePath;
  const shareText = `${property.title} en ${property.city} | Rix7`;

  const shareWhatsApp = () => {
    const text = encodeURIComponent(`${shareText}\n${shareUrl}`);
    window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyOk(true);
      setTimeout(() => setCopyOk(false), 2000);
    } catch {}
  };

  const handleNativeShare = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: property.title, text: shareText, url: shareUrl });
      } else {
        copyLink();
      }
    } catch {}
  };

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

          <div className="flex items-center gap-2">
            <CurrencySelector />
            {/* Botón WhatsApp */}
            <button
              onClick={shareWhatsApp}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-200 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 transition-colors"
              title="Compartir por WhatsApp"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">WhatsApp</span>
            </button>
            {/* Botón Copiar enlace */}
            <button
              onClick={copyLink}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              title="Copiar enlace"
            >
              <Copy className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{copyOk ? '¡Copiado!' : 'Copiar'}</span>
            </button>
            {/* Botón Compartir nativo */}
            <button
              onClick={handleNativeShare}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              title="Compartir"
            >
              <Share2 className="w-3.5 h-3.5" />
            </button>
            {/* Botón Favorito: se guarda en la cuenta si hay sesión */}
            <button
              onClick={() => toggleFavorite(property.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                isFavorited
                  ? 'bg-red-50 border-red-200 text-red-600'
                  : 'border-slate-200 text-slate-700 hover:text-red-500 hover:bg-slate-50'
              }`}
              title={
                isFavorited
                  ? 'Quitar de favoritos'
                  : source === 'account'
                    ? 'Guardar en favoritos (queda en tu cuenta)'
                    : 'Guardar en favoritos de este dispositivo'
              }
              disabled={favoritesLoading}
            >
              <Heart className={`w-3.5 h-3.5 ${isFavorited ? 'fill-current' : ''}`} />
              <span className="hidden sm:inline">{isFavorited ? 'Guardado' : 'Guardar'}</span>
            </button>
            {/* Sin sesión el favorito queda en este navegador: se dice, y se
                ofrece el paso que lo hace viajar (en pantallas grandes, para no
                apretar la barra en móvil). */}
            {source === 'device' && isFavorited && (
              <button
                type="button"
                onClick={() =>
                  openAuthModal(
                    'Entra con tu correo para que este favorito te siga en todos tus dispositivos.'
                  )
                }
                className="hidden lg:inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-md hover:bg-amber-100 transition-colors"
              >
                Solo en este navegador · Entra para guardarlo en tu cuenta
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
        {/* Título de la propiedad (mismo formato que las cards de resultados) */}
        <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight mb-3">
          {property.title}
        </h1>

        {/* Galería: carrusel de fotos + video */}
        <PropertyGallery
          images={property.images}
          title={property.title}
          partnerLogo={partner?.logo}
          partnerName={partner?.name}
          partnerColor={partner?.color}
          showPartnerLogo={!!showLogo}
          videoUrl={property.video_url}
          videoPoster={property.video_poster}
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
                {/* Precio (visualmente idéntico; el h1 de la página es el título de la propiedad) */}
                <div className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight">
                  {format(property.price, isRent)}
                </div>
                <span className="text-sm font-semibold text-slate-500">
                  {format(pricePerSqm)} / m²
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

            {/* Mapa Interactivo con POIs del Sector */}
            <PropertyMapLeaflet
              lat={property.lat}
              lng={property.lng}
              title={property.title}
              address={property.address}
              city={property.city}
            />

            {/* Calculadora de Dividendo Hipotecario */}
            {!isRent && <MortgageCalculator propertyPrice={property.price} />}
          </div>

          {/* Columna Derecha (Formulario de Contacto al Agente) */}
          <div className="lg:col-span-4">
            <ContactAgentForm property={property} partner={partner} />
          </div>
        </div>
      </div>
    </div>
  );
}
