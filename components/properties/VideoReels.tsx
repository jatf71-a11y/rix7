'use client';

import React, { useEffect, useState } from 'react';
import { Clapperboard } from 'lucide-react';

interface VideoReelsProps {
  videoUrl: string;
  /** Fotograma de portada: se pinta antes de que el video tenga datos,
   *  así no se ve el recuadro oscuro mientras carga. */
  posterUrl?: string;
}

/**
 * Ventana de video incrustada al lado de la galería de fotos.
 * Se reproduce automáticamente en silencio (muted) — el usuario
 * puede activar el audio con los controles nativos del reproductor.
 *
 * La reproducción se activa recién cuando la página terminó de cargar: un video
 * con `autoPlay` compite por ancho de banda con la foto principal de la galería,
 * que es el elemento LCP de la ficha.
 *
 * El `poster` cubre ese intervalo: el contenedor ya no queda negro, se ve un
 * fotograma del propio video hasta que empieza la reproducción.
 */
export function VideoReels({ videoUrl, posterUrl }: VideoReelsProps) {
  const [shouldAutoPlay, setShouldAutoPlay] = useState(false);

  useEffect(() => {
    const start = () => setShouldAutoPlay(true);
    if (document.readyState === 'complete') {
      start();
      return;
    }
    window.addEventListener('load', start, { once: true });
    return () => window.removeEventListener('load', start);
  }, []);

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
        poster={posterUrl}
        autoPlay={shouldAutoPlay}
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
