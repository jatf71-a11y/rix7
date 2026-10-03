'use client';

import React, { useState } from 'react';

interface PartnerLogoProps {
  logo?: string;
  name: string;
  color: string;
  /** Tailwind classes for sizing, e.g. "h-8 w-auto max-w-[120px]" */
  className?: string;
  /**
   * El nombre ya se muestra como texto al lado (p. ej. la cabecera de la página
   * de compartir): el logo es decorativo y su `alt` no debe repetir ese texto, o
   * axe marca `image-redundant-alt`. Con `true` se oculta a lectores de pantalla.
   */
  decorative?: boolean;
}

/**
 * Resilient partner logo renderer.
 * Tries the given logo image (local /logos/* asset preferred) and, if it
 * fails to load, falls back to a branded letter avatar (brand color +
 * first letter) instead of showing a broken image.
 */
export function PartnerLogo({
  logo,
  name,
  color,
  className = '',
  decorative = false,
}: PartnerLogoProps) {
  const [failed, setFailed] = useState(false);

  if (!logo || failed) {
    return (
      <div
        role={decorative ? undefined : 'img'}
        aria-label={decorative ? undefined : name}
        aria-hidden={decorative || undefined}
        title={decorative ? undefined : name}
        className={`flex items-center justify-center rounded-lg text-white font-bold leading-none select-none ${className}`}
        style={{ backgroundColor: color }}
      >
        {name.charAt(0)}
      </div>
    );
  }

  return (
    <img
      src={logo}
      alt={decorative ? '' : name}
      title={decorative ? undefined : name}
      className={`object-contain ${className}`}
      onError={() => setFailed(true)}
    />
  );
}
