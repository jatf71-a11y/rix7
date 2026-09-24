'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { partners as catalogPartners, type Partner } from '@/lib/data/partners';
import { PartnerLogo } from '@/components/properties/PartnerLogo';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PartnerLogosCarouselProps {
  partnerCounts?: Record<string, number>;
}

export function PartnerLogosCarousel({ partnerCounts = {} }: PartnerLogosCarouselProps) {
  // Arranca con el catálogo del código (cero parpadeo: el carrusel se pinta en
  // el primer render) y se reemplaza por lo que hay en Supabase cuando llega,
  // para que una edición del panel se vea sin volver a desplegar.
  const [partnerList, setPartnerList] = useState<Partner[]>(catalogPartners);
  const [isPaused, setIsPaused] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number | null>(null);
  const scrollSpeed = useRef(0.5); // px per frame

  // Auto-scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const scroll = () => {
      if (!isPaused && el) {
        el.scrollLeft += scrollSpeed.current;
        // Reset scroll when reaching the end (seamless loop)
        if (el.scrollLeft >= el.scrollWidth - el.clientWidth) {
          el.scrollLeft = 0;
        }
      }
      animFrameRef.current = requestAnimationFrame(scroll);
    };

    animFrameRef.current = requestAnimationFrame(scroll);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isPaused]);

  useEffect(() => {
    let alive = true;

    fetch('/api/partners')
      .then((r) => r.json())
      .then((result) => {
        if (alive && result?.success && Array.isArray(result.data) && result.data.length > 0) {
          setPartnerList(result.data);
        }
      })
      .catch(() => {
        // Sin red se queda con el catálogo: el carrusel nunca queda vacío.
      });

    return () => {
      alive = false;
    };
  }, []);

  const scroll = useCallback((direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = direction === 'left' ? -200 : 200;
    el.scrollBy({ left: amount, behavior: 'smooth' });
  }, []);

  // Duplicar logos para efecto infinite scroll
  const displayPartners = [...partnerList, ...partnerList, ...partnerList];

  return (
    <div className="mb-4">
      {/* Título */}
      <div className="flex items-center gap-2 mb-2 px-1">
        <div className="h-px flex-1 bg-gradient-to-r from-blue-200 to-transparent" />
        <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
          Nuestros Socios Estratégicos
        </span>
        <div className="h-px flex-1 bg-gradient-to-l from-blue-200 to-transparent" />
      </div>

      {/* Carousel container */}
      <div
        className="relative group"
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => {
          setIsPaused(false);
          setHoveredId(null);
        }}
      >
        {/* Flechas de navegación */}
        <button
          onClick={() => scroll('left')}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-7 h-7 flex items-center justify-center bg-white/90 border border-slate-200 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-blue-50 hover:border-blue-300"
        >
          <ChevronLeft className="w-3.5 h-3.5 text-slate-600" />
        </button>
        <button
          onClick={() => scroll('right')}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-7 h-7 flex items-center justify-center bg-white/90 border border-slate-200 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-blue-50 hover:border-blue-300"
        >
          <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
        </button>

        {/* Gradient fade at edges */}
        <div className="absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-white to-transparent z-[1] pointer-events-none" />
        <div className="absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-white to-transparent z-[1] pointer-events-none" />

        {/* Scroll container */}
        <div
          ref={scrollRef}
          className="flex items-stretch gap-2 overflow-x-auto scrollbar-hide px-2 py-2"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {displayPartners.map((partner, idx) => (
            <Link
              key={`${partner.id}-${idx}`}
              href={`/empresas/${partner.slug}`}
              title={`${partner.name} · ${partner.description}`}
              className={`relative flex-shrink-0 w-[86px] h-[86px] flex flex-col items-center justify-center gap-1.5 p-2 rounded-xl border transition-all duration-200 ${
                hoveredId === partner.id
                  ? 'border-blue-400 bg-blue-50 shadow-md -translate-y-0.5'
                  : 'border-slate-200 bg-white hover:border-blue-200 hover:bg-slate-50'
              }`}
              onMouseEnter={() => setHoveredId(partner.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              {/* Logo, tipo icono */}
              <span className="w-9 h-9 rounded-lg bg-white border border-slate-100 flex items-center justify-center overflow-hidden flex-shrink-0 p-1 text-[12px]">
                <PartnerLogo
                  logo={partner.logo}
                  name={partner.name}
                  color={partner.color}
                  className="h-full w-full"
                />
              </span>

              {/* Nombre */}
              <span className="w-full text-[10px] font-bold text-slate-700 text-center leading-tight line-clamp-2">
                {partner.name}
              </span>

              {/* Contador de propiedades */}
              {partnerCounts[partner.id] !== undefined && (
                <span
                  className="absolute top-1 right-1 text-[9px] font-extrabold text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded-full leading-none"
                  title={`${partnerCounts[partner.id]} propiedades`}
                >
                  {partnerCounts[partner.id]}
                </span>
              )}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
