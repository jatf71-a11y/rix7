'use client';

import React, { useState } from 'react';
import { Images, X, ChevronLeft, ChevronRight } from 'lucide-react';

interface PropertyGalleryProps {
  images: string[];
  title: string;
  partnerLogo?: string;
  partnerName?: string;
  showPartnerLogo?: boolean;
}

export function PropertyGallery({ images, title, partnerLogo, partnerName, showPartnerLogo }: PropertyGalleryProps) {
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);

  const fallbackImages = [
    'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1600566753376-12c8ab7fb75b?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?auto=format&fit=crop&w=800&q=80',
  ];

  const displayImages = images && images.length > 0 ? images : fallbackImages;

  const openLightbox = (index: number) => {
    setActivePhotoIndex(index);
    setIsLightboxOpen(true);
  };

  const nextPhoto = () => {
    setActivePhotoIndex((prev) => (prev + 1) % displayImages.length);
  };

  const prevPhoto = () => {
    setActivePhotoIndex((prev) => (prev - 1 + displayImages.length) % displayImages.length);
  };

  return (
    <div className="relative">
      {/* Grid en Mosaico con foto principal destacada */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2 rounded-2xl overflow-hidden max-h-[480px]">
        {/* Foto Principal Destacada (Ocupa 2 columnas y 2 filas) */}
        <div
          onClick={() => openLightbox(0)}
          className="md:col-span-2 md:row-span-2 relative aspect-[4/3] md:aspect-auto cursor-pointer group overflow-hidden bg-slate-100"
        >
          <img
            src={displayImages[0]}
            alt={`${title} - Principal`}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
          {/* Partner logo badge */}
          {showPartnerLogo && partnerLogo && (
            <div className="absolute top-3 right-3 h-9 rounded-lg overflow-hidden shadow-lg">
              <img src={partnerLogo} alt={partnerName || ''} className="h-9 object-contain" />
            </div>
          )}
        </div>

        {/* 4 Fotos Secundarias en Grid */}
        {displayImages.slice(1, 5).map((img, idx) => (
          <div
            key={idx}
            onClick={() => openLightbox(idx + 1)}
            className="relative hidden md:block aspect-[4/3] cursor-pointer group overflow-hidden bg-slate-100"
          >
            <img
              src={img}
              alt={`${title} - Foto ${idx + 2}`}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
            {/* Partner logo badge */}
            {showPartnerLogo && partnerLogo && (
              <div className="absolute top-2 right-2 h-7 rounded-lg overflow-hidden shadow-md">
                <img src={partnerLogo} alt={partnerName || ''} className="h-7 object-contain" />
              </div>
            )}

            {/* Si es la 5ta foto y hay más fotos disponibles */}
            {idx === 3 && displayImages.length > 5 && (
              <div className="absolute inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center text-white font-bold text-base">
                +{displayImages.length - 5} fotos
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Botón flotante para ver todas las fotos */}
      <button
        onClick={() => openLightbox(0)}
        className="absolute bottom-4 right-4 flex items-center gap-2 px-4 py-2 bg-white/90 hover:bg-white text-slate-900 text-xs font-bold rounded-xl shadow-lg backdrop-blur-md transition-all hover:scale-105"
      >
        <Images className="w-4 h-4 text-blue-600" />
        <span>Ver todas las {displayImages.length} fotos</span>
      </button>

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

          <div className="relative max-w-5xl max-h-[80vh] w-full flex items-center justify-center">
            <div className="relative">
              <img
                src={displayImages[activePhotoIndex]}
                alt={`${title} - ${activePhotoIndex + 1}`}
                className="max-h-[75vh] max-w-full object-contain rounded-lg shadow-2xl"
              />
              {/* Partner logo badge on lightbox */}
              {showPartnerLogo && partnerLogo && (
                <div className="absolute top-4 right-4 h-10 rounded-lg overflow-hidden shadow-xl">
                  <img src={partnerLogo} alt={partnerName || ''} className="h-10 object-contain" />
                </div>
              )}
            </div>

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
