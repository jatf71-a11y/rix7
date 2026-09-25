/**
 * Configuración central del sitio.
 * La URL canónica de producción; puede sobreescribirse con NEXT_PUBLIC_SITE_URL
 * (útil para previews o entornos staging).
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || 'https://rix7.cl';

export const SITE_NAME = 'Rix7';
export const SITE_DESCRIPTION =
  'Plataforma inmobiliaria moderna para todo Chile con mapa MapLibre GL JS, selector de monedas ($, UF, US$), calculadora de dividendo y catálogo en tiempo real.';
