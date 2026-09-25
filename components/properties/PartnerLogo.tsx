'use client';

import React, { useState } from 'react';

interface PartnerLogoProps {
  logo?: string;
  name: string;
  color: string;
  /** Tailwind classes for sizing, e.g. "h-8 w-auto max-w-[120px]" */
  className?: string;
}

/**
 * Resilient partner logo renderer.
 * Tries the given logo image (local /logos/* asset preferred) and, if it
 * fails to load, falls back to a branded letter avatar (brand color +
 * first letter) instead of showing a broken image.
 */
export function PartnerLogo({ logo, name, color, className = '' }: PartnerLogoProps) {
  const [failed, setFailed] = useState(false);

  if (!logo || failed) {
    return (
      <div
        role="img"
        aria-label={name}
        title={name}
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
      alt={name}
      title={name}
      className={`object-contain ${className}`}
      onError={() => setFailed(true)}
    />
  );
}
