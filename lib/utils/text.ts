/**
 * Normaliza diacríticos (tildes, eñes, etc.) para búsqueda sin acentos.
 * Ej: "Pucon" matchea "Pucón", "curacautin" matchea "Curacautín"
 */
export const stripDiacritics = (s: string): string =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
