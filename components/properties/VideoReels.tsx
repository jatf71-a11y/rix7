'use client';

import React from 'react';
import { Clapperboard } from 'lucide-react';

interface VideoReelsProps {
  videoUrl: string;
}

/**
 * Ventana de video incrustada al lado de la galería de fotos.
 * Se reproduce automáticamente en silencio (muted) — el usuario
 * puede activar el audio con los controles nativos del reproductor.
 */
export function VideoReels({ videoUrl }: VideoReelsProps) {
  return (
    <div className="relative h-full min-h-[260px] w-full overflow-hidden rounded-2xl bg-slate-900 shadow-sm">
      {/* Etiqueta */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm px-2.5 py-1 rounded-full pointer-events-none">
        <Clapperboard className="w-3 h-3 text-white" />
        <span className="text-white text-[10px] font-bold uppercase tracking-wider">Video</span>
      </div>

      {/* Video — muted por defecto, controles nativos para activar audio */}
      <video
        src={videoUrl}
        autoPlay
        muted
        loop
        playsInline
        controls
        preload="metadata"
        className="absolute inset-0 w-full h-full object-cover"
        aria-label="Video de la propiedad"
      />
    </div>
  );
}
