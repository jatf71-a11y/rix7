/**
 * Normaliza diacríticos (tildes, eñes, etc.) para búsqueda sin acentos.
 * Ej: "Pucon" matchea "Pucón", "curacautin" matchea "Curacautín"
 */
export const stripDiacritics = (s: string): string =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * Normaliza texto para comparar/buscar: minúsculas y sin diacríticos.
 * Centraliza el criterio que antes se repetía en cada buscador.
 */
export const normalizeForSearch = (s: string): string =>
  stripDiacritics(s.toLowerCase());

/**
 * Convierte un texto en slug URL-safe: minúsculas, sin tildes y con guiones.
 * Compartido por la UI de admin y la API de socios para que generen el mismo id.
 */
export const slugify = (s: string): string =>
  stripDiacritics(s.toLowerCase())
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
