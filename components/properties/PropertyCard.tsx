'use client';

import React, { useState, useRef, useEffect, memo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Property } from '@/lib/types/property';
import { useCurrency } from '@/components/currency/CurrencyProvider';
import { formatArea, getPropertyTypeLabel, getStatusLabel } from '@/lib/utils/formatters';
import { Bed, Bath, Maximize2, Heart, ChevronLeft, ChevronRight, MapPin, LampDesk } from 'lucide-react';

interface PropertyCardProps {
  property: Property;
  isHovered?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

function PropertyCardComponent({ property, isHovered, onMouseEnter, onMouseLeave }: PropertyCardProps) {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [isFavorited, setIsFavorited] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const { format } = useCurrency();

  const isRent = property.status === 'for_rent';
  const isNew = property.created_at ? (Date.now() - new Date(property.created_at).getTime()) < 7 * 24 * 60 * 60 * 1000 : false;

  const images = property.images && property.images.length > 0
    ? property.images
    : ['https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=800&q=80'];

  // IntersectionObserver: cargar imagen solo cuando entra al viewport
  const observerRef = useRef<IntersectionObserver | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isInView, setIsInView] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    observerRef.current = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observerRef.current?.disconnect();
        }
      },
      { rootMargin: '200px' } // Empezar a cargar 200px antes de visible
    );
    observerRef.current.observe(el);
    return () => observerRef.current?.disconnect();
  }, []);

  const nextImage = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setCurrentImageIndex((prev) => (prev + 1) % images.length);
  };

  const prevImage = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length);
  };

  const toggleFavorite = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsFavorited(!isFavorited);
  };

  return (
    <div
      ref={containerRef}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`group relative bg-white rounded-2xl overflow-hidden border transition-all duration-200 ${
        isHovered
          ? 'border-blue-500 shadow-xl ring-2 ring-blue-blue-500/20 -translate-y-1'
          : 'border-slate-200 hover:border-slate-300 shadow-sm hover:shadow-md'
      }`}
    >
      <Link href={`/properties/${property.id}`} className="block">
        {/* Contenedor de Imagen con Lazy Loading + Fade-in */}
        <div className="relative aspect-[16/10] w-full overflow-hidden bg-slate-100">
          {isInView && (
            <Image
              src={images[currentImageIndex]}
              alt={property.title}
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              onLoad={() => setImageLoaded(true)}
              className={`object-cover group-hover:scale-105 transition-all duration-500 ${
                imageLoaded ? 'opacity-100' : 'opacity-0'
              }`}
            />
          )}
          {!imageLoaded && (
            <div className="absolute inset-0 bg-gradient-to-br from-slate-100 to-slate-200 animate-pulse" />
          )}

          {/* Gradiente sutil */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-60" />

          {/* Badges superiores */}
          <div className="absolute top-3 left-3 flex items-center gap-1.5 flex-wrap">
            <span className={`px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider rounded-lg shadow-sm ${
              isRent
                ? 'bg-blue-600 text-white'
                : 'bg-emerald-600 text-white'
            }`}>
              {getStatusLabel(property.status)}
            </span>
            <span className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider bg-white/90 backdrop-blur-md text-slate-900 rounded-lg shadow-sm">
              {getPropertyTypeLabel(property.property_type)}
            </span>
            {isNew && (
              <span className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider bg-red-600 text-white rounded-lg shadow-sm animate-pulse">
                Nueva
              </span>
            )}
            {property.featured && (
              <span className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider                bg-red-600 text-white rounded-lg shadow-sm">
                Destacada
              </span>
            )}
          </div>

          {/* Botón de Favorito */}
          <button
            onClick={toggleFavorite}
            className={`absolute top-3 right-3 p-2 rounded-full backdrop-blur-md transition-all ${
              isFavorited
                ? 'bg-red-500 text-white'
                : 'bg-black/30 hover:bg-black/50 text-white'
            }`}
            aria-label="Guardar propiedad"
          >
            <Heart className={`w-4 h-4 ${isFavorited ? 'fill-current' : ''}`} />
          </button>

          {/* Controles del Carrusel si hay múltiples imágenes */}
          {images.length > 1 && (
            <div className="opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={prevImage}
                className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/40 hover:bg-black/70 text-white backdrop-blur-sm transition-all"
                aria-label="Imagen anterior"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={nextImage}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/40 hover:bg-black/70 text-white backdrop-blur-sm transition-all"
                aria-label="Siguiente imagen"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              {/* Indicadores de puntos */}
              <div className="absolute bottom-2 left-1/2 -translate-y-1/2 -translate-x-1/2 flex gap-1">
                {images.map((_, i) => (
                  <span
                    key={i}
                    className={`w-1.5 h-1.5 rounded-full transition-all ${
                      i === currentImageIndex ? 'bg-white w-3' : 'bg-white/50'
                    }`}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Información Principal de la Propiedad con Moneda Reactiva */}
        <div className="p-4 sm:p-5">
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-extrabold text-slate-900 tracking-tight">
              {format(property.price, isRent)}
            </span>
          </div>

          {/* Especificaciones clave */}
          <div className="flex items-center gap-4 mt-2.5 text-sm text-slate-600 font-medium">
            {property.bedrooms > 0 && (
              <span className="flex items-center gap-1.5">
                <Bed className="w-4 h-4 text-slate-400" />
                <strong className="text-slate-900">{property.bedrooms}</strong> dorm.
              </span>
            )}
            {property.bathrooms > 0 && (
              <span className="flex items-center gap-1.5">
                <Bath className="w-4 h-4 text-slate-400" />
                <strong className="text-slate-900">{property.bathrooms}</strong> bñ
              </span>
            )}
            {(property.privates ?? 0) > 0 && (
              <span className="flex items-center gap-1.5">
                <LampDesk className="w-4 h-4 text-slate-400" />
                <strong className="text-slate-900">{property.privates}</strong> priv.
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <Maximize2 className="w-4 h-4 text-slate-400" />
              <strong className="text-slate-900">{formatArea(property.area_sqm)}</strong>
            </span>
          </div>

          {/* Título */}
          <h3 className="mt-3 text-sm font-semibold text-slate-800 line-clamp-1 group-hover:text-blue-600 transition-colors">
            {property.title}
          </h3>

          {/* Dirección */}
          <p className="mt-1 text-xs text-slate-500 line-clamp-1 flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
            <span>{property.address}, {property.city}</span>
          </p>

          {/* Breve descripción */}
          {property.description && (
            <p className="mt-1.5 text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
              {property.description.slice(0, 120)}{property.description.length > 120 ? '...' : ''}
            </p>
          )}

          {/* Características destacadas */}
          {property.features && property.features.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {property.features.slice(0, 3).map((f, i) => (
                <span key={i} className="px-2 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-600 rounded-full">
                  {f}
                </span>
              ))}
            </div>
          )}
        </div>
      </Link>
    </div>
  );
}

export const PropertyCard = memo(PropertyCardComponent);
