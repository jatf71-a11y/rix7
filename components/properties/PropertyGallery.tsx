'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { Images, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { PartnerLogo } from '@/components/properties/PartnerLogo';
import { VideoReels } from '@/components/properties/VideoReels';

interface PropertyGalleryProps {
  images: string[];
  title: string;
  partnerLogo?: string;
  partnerName?: string;
  partnerColor?: string;
  showPartnerLogo?: boolean;
  videoUrl?: string;
  videoPoster?: string;
}

export function PropertyGallery({ images, title, partnerLogo, partnerName, partnerColor = '#64748b', showPartnerLogo, videoUrl, videoPoster }: PropertyGalleryProps) {
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  /** Foto que queda debajo mientras la nueva se pinta (null = ninguna). */
  const [previousPhotoIndex, setPreviousPhotoIndex] = useState<number | null>(null);

  const fallbackImages = [
    'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1600566753376-12c8ab7fb75b?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?auto=format&fit=crop&w=800&q=80',
  ];

  const displayImages = images && images.length > 0 ? images : fallbackImages;

  // `sizes` debe reflejar el ancho real que ocupa la foto: con video comparte la
  // fila con la ventana de video (2/3), sin video ocupa todo el ancho. Es lo que
  // evita que el móvil descargue una imagen pensada para escritorio.
  const photoSizes = videoUrl
    ? '(max-width: 767px) 100vw, (max-width: 1280px) 66vw, 860px'
    : '(max-width: 767px) 100vw, (max-width: 1280px) 100vw, 1280px';

  const openLightbox = (index: number) => {
    setActivePhotoIndex(index);
    setIsLightboxOpen(true);
  };

  const goToPhoto = (next: number) => {
    const target = (next + displayImages.length) % displayImages.length;
    if (target === activePhotoIndex) return;
    setPreviousPhotoIndex(activePhotoIndex);
    setActivePhotoIndex(target);
  };

  const nextPhoto = () => goToPhoto(activePhotoIndex + 1);
  const prevPhoto = () => goToPhoto(activePhotoIndex - 1);

  // La foto anterior se mantiene montada debajo de la activa: mientras la nueva
  // se descarga y decodifica, se sigue viendo la anterior en vez de un recuadro
  // vacío. No depende de `onLoad`, que puede no dispararse si la imagen ya está
  // en caché, así que no hay carrera posible.
  const showPreviousLayer = previousPhotoIndex !== null && previousPhotoIndex !== activePhotoIndex;

  return (
    <div className="relative">
      {/* Grid: fotos (2/3) + video (1/3) cuando hay video; solo fotos si no */}
      <div className={`grid grid-cols-1 gap-2 rounded-2xl overflow-hidden ${videoUrl ? 'md:grid-cols-3' : 'md:grid-cols-4'}`}>
        {/* Carrusel de fotos: una a la vez, conserva el mismo recuadro que el mosaico anterior */}
        <div
          onClick={() => openLightbox(activePhotoIndex)}
          className={`${videoUrl ? 'md:col-span-2' : 'md:col-span-4'} relative aspect-[4/3] md:aspect-auto md:h-[480px] cursor-pointer group overflow-hidden rounded-2xl bg-slate-100`}
        >
          {/* Capa inferior: la foto anterior, visible mientras la nueva se pinta */}
          {showPreviousLayer && (
            <Image
              src={displayImages[previousPhotoIndex]}
              alt=""
              aria-hidden="true"
              fill
              sizes={photoSizes}
              className="object-cover"
            />
          )}

          {/* Foto activa: única imagen que se descarga al abrir la ficha (la
              primera va con prioridad alta por ser el elemento LCP) */}
          <Image
            key={displayImages[activePhotoIndex]}
            src={displayImages[activePhotoIndex]}
            alt={`${title} - Foto ${activePhotoIndex + 1}`}
            fill
            sizes={photoSizes}
            // La primera foto es el elemento LCP de la ficha: se precarga y tiene
            // prioridad alta. Las demás se cargan al navegar, no en el primer render.
            priority={activePhotoIndex === 0}
            className="object-cover"
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors pointer-events-none" />

          {/* Controles de navegación (no propagan el clic al lightbox) */}
          {displayImages.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); prevPhoto(); }}
                className="absolute left-3 top-1/2 -translate-y-1/2 p-2.5 text-slate-900 bg-white/90 hover:bg-white rounded-full shadow-lg backdrop-blur-md transition-all hover:scale-110 z-10"
                aria-label="Foto anterior"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); nextPhoto(); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-2.5 text-slate-900 bg-white/90 hover:bg-white rounded-full shadow-lg backdrop-blur-md transition-all hover:scale-110 z-10"
                aria-label="Foto siguiente"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </>
          )}

          {/* Contador de posición */}
          <div className="absolute bottom-3 left-3 px-2.5 py-1 bg-black/60 backdrop-blur-sm text-white text-[11px] font-bold rounded-full pointer-events-none">
            {activePhotoIndex + 1} / {displayImages.length}
          </div>

          {/* Partner logo badge */}
          {showPartnerLogo && partnerLogo && (
            <div className="absolute top-3 right-3 h-8 pointer-events-none">
              <PartnerLogo logo={partnerLogo} name={partnerName || ''} color={partnerColor} className="h-full w-auto min-w-[20px]" />
            </div>
          )}
        </div>

        {/* Ventana de video (solo si la propiedad tiene video) */}
        {videoUrl && (
          <div className="md:col-span-1 min-h-[260px] md:min-h-0">
            <VideoReels videoUrl={videoUrl} posterUrl={videoPoster} />
          </div>
        )}
      </div>

      {/* Botón flotante: Ver todas las fotos (abre lightbox en la foto actual) */}
      <div className="absolute bottom-4 right-4 flex items-center gap-2">
        <button
          onClick={() => openLightbox(activePhotoIndex)}
          className="flex items-center gap-2 px-4 py-2 bg-white/90 hover:bg-white text-slate-900 text-xs font-bold rounded-xl shadow-lg backdrop-blur-md transition-all hover:scale-105"
        >
          <Images className="w-4 h-4 text-blue-600" />
          <span>Ver todas las {displayImages.length} fotos</span>
        </button>
      </div>

      {/* Lightbox Modal de Pantalla Completa */}
      {isLightboxOpen && (
        <div className="fixed inset-0 z-[10000] bg-black/95 flex flex-col items-center justify-center p-4">
          <button
            onClick={() => setIsLightboxOpen(false)}
            className="absolute top-6 right-6 p-3 text-white/70 hover:text-white bg-white/10 hover:bg-white/20 rounded-full transition-colors"
            aria-label="Cerrar galería"
          >
            <X className="w-6 h-6" />
          </button>

          <div className="relative w-full max-w-5xl h-[75vh]">
            <Image
              src={displayImages[activePhotoIndex]}
              alt={`${title} - ${activePhotoIndex + 1}`}
              fill
              sizes="(max-width: 1024px) 100vw, 1024px"
              className="object-contain"
            />
            {/* Partner logo badge on lightbox */}
            {showPartnerLogo && partnerLogo && (
              <div className="absolute top-4 right-4 h-9">
                <PartnerLogo logo={partnerLogo} name={partnerName || ''} color={partnerColor} className="h-full w-auto min-w-[24px]" />
              </div>
            )}

            {displayImages.length > 1 && (
              <>
                <button
                  onClick={prevPhoto}
                  className="absolute left-2 top-1/2 -translate-y-1/2 p-3 text-white bg-black/50 hover:bg-black/80 rounded-full backdrop-blur-md transition-all"
                  aria-label="Foto anterior"
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>
                <button
                  onClick={nextPhoto}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-3 text-white bg-black/50 hover:bg-black/80 rounded-full backdrop-blur-md transition-all"
                  aria-label="Foto siguiente"
                >
                  <ChevronRight className="w-6 h-6" />
                </button>
              </>
            )}
          </div>

          <div className="text-white/80 text-sm font-medium mt-4">
            {activePhotoIndex + 1} de {displayImages.length}
          </div>
        </div>
      )}
    </div>
  );
}
