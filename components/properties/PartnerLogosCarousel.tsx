'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { partners, Partner } from '@/lib/data/partners';
import { PartnerLogo } from '@/components/properties/PartnerLogo';
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';

interface PartnerLogosCarouselProps {
  partnerCounts?: Record<string, number>;
}

export function PartnerLogosCarousel({ partnerCounts = {} }: PartnerLogosCarouselProps) {
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

  const scroll = useCallback((direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = direction === 'left' ? -200 : 200;
    el.scrollBy({ left: amount, behavior: 'smooth' });
  }, []);

  // Duplicar logos para efecto infinite scroll
  const displayPartners = [...partners, ...partners, ...partners];

  return (
    <div className="mb-5">
      {/* Título */}
      <div className="flex items-center gap-2 mb-3 px-1">
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
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 flex items-center justify-center bg-white/90 border border-slate-200 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-blue-50 hover:border-blue-300"
        >
          <ChevronLeft className="w-4 h-4 text-slate-600" />
        </button>
        <button
          onClick={() => scroll('right')}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 flex items-center justify-center bg-white/90 border border-slate-200 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-blue-50 hover:border-blue-300"
        >
          <ChevronRight className="w-4 h-4 text-slate-600" />
        </button>

        {/* Gradient fade at edges */}
        <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-white to-transparent z-[1] pointer-events-none" />
        <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-white to-transparent z-[1] pointer-events-none" />

        {/* Scroll container */}
        <div
          ref={scrollRef}
          className="flex items-center gap-4 overflow-x-auto scrollbar-hide px-4 py-3"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {displayPartners.map((partner, idx) => (
            <Link
              key={`${partner.id}-${idx}`}
              href={`/empresas/${partner.slug}`}
              className="flex-shrink-0 relative group/logo"
              onMouseEnter={() => setHoveredId(partner.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <div
                className={`
                  flex items-center gap-3 px-5 py-3 rounded-xl border-2 transition-all duration-300
                  ${hoveredId === partner.id
                    ? 'border-blue-500 shadow-lg scale-105 bg-white'
                    : 'border-slate-100 hover:border-blue-200 bg-white hover:shadow-md'
                  }
                `}
              >
                {/* Logo */}
                <div className="h-10 min-w-[40px] flex items-center justify-center rounded-lg bg-slate-50 overflow-hidden flex-shrink-0 px-1">
                  <PartnerLogo
                    logo={partner.logo}
                    name={partner.name}
                    color={partner.color}
                    className="h-8 w-auto"
                  />
                </div>

                {/* Name + description + count */}
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-800 truncate max-w-[140px]">
                    {partner.name}
                  </p>
                  <p className="text-[10px] text-slate-400 truncate max-w-[140px]">
                    {partner.description}
                  </p>
                  {partnerCounts[partner.id] !== undefined && (
                    <p className="text-[10px] font-semibold text-blue-600 mt-0.5">
                      {partnerCounts[partner.id]} propiedades
                    </p>
                  )}
                </div>

                {/* Hover icon */}
                <ExternalLink
                  className={`w-3.5 h-3.5 flex-shrink-0 transition-all ${
                    hoveredId === partner.id
                      ? 'text-blue-500 opacity-100 translate-x-0'
                      : 'text-slate-300 opacity-0 -translate-x-2'
                  }`}
                />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
