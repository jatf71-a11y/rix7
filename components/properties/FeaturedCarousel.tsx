'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Property } from '@/lib/types/property';
import { useCurrency } from '@/components/currency/CurrencyProvider';
import { formatArea, getPropertyTypeLabel, getStatusLabel } from '@/lib/utils/formatters';
import { MapPin, Bed, Bath, Maximize2, ChevronRight } from 'lucide-react';

interface FeaturedCarouselProps {
  properties: Property[];
}

// Fisher-Yates shuffle
function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function FeaturedCarousel({ properties }: FeaturedCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [mounted, setMounted] = useState(false);
  const { format } = useCurrency();

  useEffect(() => { setMounted(true); }, []);

  // Nuevas (created_at dentro de 7 días) primero, luego las demás
  const featured = useMemo(() => {
    if (!mounted || properties.length === 0) return [];
    const now = Date.now();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const newProps = properties.filter((p) => p.created_at && (now - new Date(p.created_at).getTime()) < weekMs);
    const others = properties.filter((p) => !p.created_at || (now - new Date(p.created_at).getTime()) >= weekMs);
    const pool = [...shuffleArray(newProps), ...shuffleArray(others)];
    return pool.slice(0, 6);
  }, [properties, mounted]);

  // Auto-advance con progreso
  useEffect(() => {
    if (featured.length === 0) return;
    setProgress(0);
    const duration = 3000; // 3 segundos por slide
    const interval = 50; // update cada 50ms
    let elapsed = 0;

    const timer = setInterval(() => {
      elapsed += interval;
      setProgress((elapsed / duration) * 100);
      if (elapsed >= duration) {
        setCurrentIndex((prev) => (prev + 1) % featured.length);
        elapsed = 0;
      }
    }, interval);

    return () => clearInterval(timer);
  }, [currentIndex, featured.length]);

  const goTo = useCallback((idx: number) => {
    setCurrentIndex(idx);
    setProgress(0);
  }, []);

  if (!mounted || featured.length === 0) return null;

  const current = featured[currentIndex];
  const isRent = current.status === 'for_rent';
  const isNew = current.created_at ? (Date.now() - new Date(current.created_at).getTime()) < 7 * 24 * 60 * 60 * 1000 : false;

  return (
    <div className="mb-5">
      {/* Título sutil */}
      <div className="flex items-center gap-2 mb-3 px-1">
        <div className="h-px flex-1 bg-gradient-to-r from-blue-200 to-transparent" />
        <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Propiedades Nuevas y Destacadas</span>
        <div className="h-px flex-1 bg-gradient-to-l from-blue-200 to-transparent" />
      </div>

      {/* Card grande — una sola propiedad */}
      <Link
        href={`/properties/${current.id}`}
        className="group block relative bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-2xl hover:border-blue-300 transition-all duration-500"
      >
        {/* Imagen principal */}
        <div className="relative aspect-[21/9] overflow-hidden">
          <img
            key={current.id}
            src={current.images?.[0] || 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1400&q=80'}
            alt={current.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
          />

          {/* Overlay gradiente */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

          {/* Badges superiores */}
          <div className="absolute top-4 left-4 flex items-center gap-2">
            <span className={`px-3 py-1 text-[11px] font-bold rounded-lg backdrop-blur-sm ${
              isRent ? 'bg-emerald-600/90 text-white' : 'bg-blue-600/90 text-white'
            }`}>
              {getStatusLabel(current.status)}
            </span>
            <span className="px-3 py-1 text-[11px] font-bold bg-white/90 text-slate-700 rounded-lg backdrop-blur-sm">
              {getPropertyTypeLabel(current.property_type)}
            </span>
            {isNew && (
              <span className="px-3 py-1 text-[11px] font-bold uppercase tracking-wider bg-red-600 text-white rounded-lg backdrop-blur-sm animate-pulse">
                Nueva
              </span>
            )}
            {current.featured && (
              <span className="px-3 py-1 text-[11px] font-bold uppercase tracking-wider                bg-red-600 text-white rounded-lg backdrop-blur-sm">
                Destacada
              </span>
            )}
          </div>



          {/* Contenido sobre la imagen */}
          <div className="absolute bottom-0 left-0 right-0 p-5">
            <div className="flex items-end justify-between gap-4">
              <div className="flex-1 min-w-0">
                <h3 className="text-xl font-black text-white drop-shadow-lg truncate group-hover:text-blue-300 transition-colors">
                  {current.title}
                </h3>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <MapPin className="w-3.5 h-3.5 text-blue-300 flex-shrink-0" />
                  <span className="text-sm text-white/80 truncate">{current.address}, {current.city}</span>
                </div>
                {/* Specs */}
                <div className="flex items-center gap-4 mt-2.5">
                  {current.bedrooms > 0 && (
                    <div className="flex items-center gap-1 text-sm text-white/90">
                      <Bed className="w-4 h-4 text-blue-300" />
                      <span className="font-semibold">{current.bedrooms}</span>
                    </div>
                  )}
                  {current.bathrooms > 0 && (
                    <div className="flex items-center gap-1 text-sm text-white/90">
                      <Bath className="w-4 h-4 text-blue-300" />
                      <span className="font-semibold">{current.bathrooms}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1 text-sm text-white/90">
                    <Maximize2 className="w-4 h-4 text-blue-300" />
                    <span className="font-semibold">{formatArea(current.area_sqm)}</span>
                  </div>
                </div>
              </div>

              {/* Precio grande */}
              <div className="text-right flex-shrink-0">
                <div className="text-2xl font-black text-white drop-shadow-lg">
                  {format(current.price, isRent)}
                </div>
                <div className="flex items-center gap-1.5 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="text-xs font-semibold text-blue-300">Ver detalle</span>
                  <ChevronRight className="w-4 h-4 text-blue-300 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </Link>

      {/* Barra de progreso + dots */}
      <div className="flex items-center gap-3 mt-3 px-1">
        {featured.map((_, idx) => (
          <button
            key={idx}
            onClick={() => goTo(idx)}
            className="relative flex-1 h-1 rounded-full bg-slate-200 overflow-hidden group"
          >
            <div
              className="absolute inset-y-0 left-0 bg-blue-600 rounded-full transition-none"
              style={{
                width: idx === currentIndex ? `${progress}%` : idx < currentIndex ? '100%' : '0%',
              }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
