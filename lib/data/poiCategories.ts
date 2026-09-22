/**
 * Configuración compartida de categorías de POIs — usada por la API route
 * `/api/pois` (servidor, consultas Overpass) y por `PropertyMapLeaflet`
 * (cliente, render de íconos y filtros).
 *
 * Debe vivir en un módulo neutral (sin importar Leaflet ni React) para
 * poder ejecutarse en ambos entornos.
 *
 * Cada categoría puede tener varios selectores Overpass (se unen en la
 * misma consulta). La categorización final por elemento vive en
 * `categorizePOI`, que decide a qué grupo pertenece según sus tags.
 */

/**
 * Radio caminable de referencia: 15 minutos a pie (~1,2 km).
 * Fuente única para los contadores de los chips, la descripción del sector y
 * los filtros del mapa — el fetch consulta un radio mayor (1500 m) para
 * cubrirlo con margen.
 */
export const WALKABLE_RADIUS_M = 1200;

export interface PoiCategoryConfig {
  /** Etiqueta corta para los chips de la UI */
  label: string;
  /** Descripción completa con los subtipos incluidos (tooltip) */
  description: string;
  /** Color del marcador en el mapa */
  color: string;
  /** Emoji de respaldo para popups compactos */
  emoji: string;
  /** Selectores Overpass para esta categoría (se unen en la consulta) */
  queries: string[];
}

/**
 * Elementos SVG internos (paths/círculos/líneas) del ícono de cada categoría,
 * en estilo Lucide (24×24, stroke). Basados en lucide-react v0.475.0 (ISC).
 * Los usa `poiSvgMarkup` para renderizar los marcadores del mapa en servidor
 * y cliente con exactamente el mismo dibujo que los chips de la ficha.
 */
export const POI_SVG_DEFS: Record<string, string> = {
  education:
    '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
  health:
    '<path d="M11 2v2"/><path d="M5 2v2"/><path d="M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1"/><path d="M8 15a6 6 0 0 0 12 0v-3"/><circle cx="20" cy="10" r="2"/>',
  transport:
    '<path d="M4 6 2 7"/><path d="M10 6h4"/><path d="m22 7-2-1"/><rect width="16" height="16" x="4" y="3" rx="2"/><path d="M4 11h16"/><path d="M8 15h.01"/><path d="M16 15h.01"/><path d="M6 19v2"/><path d="M18 21v-2"/>',
  shopping:
    '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  sports:
    '<path d="M14.4 14.4 9.6 9.6"/><path d="M18.657 21.485a2 2 0 1 1-2.829-2.828l-1.767 1.768a2 2 0 1 1-2.829-2.829l6.364-6.364a2 2 0 1 1 2.829 2.829l-1.768 1.767a2 2 0 1 1 2.828 2.829z"/><path d="m21.5 21.5-1.4-1.4"/><path d="M3.9 3.9 2.5 2.5"/><path d="M6.404 12.768a2 2 0 1 1-2.829-2.829l1.768-1.767a2 2 0 1 1-2.828-2.829l2.828-2.828a2 2 0 1 1 2.829 2.828l1.767-1.768a2 2 0 1 1 2.829 2.829z"/>',
  park:
    '<path d="M10 10v.2A3 3 0 0 1 8.9 16H5a3 3 0 0 1-1-5.8V10a3 3 0 0 1 6 0Z"/><path d="M7 16v6"/><path d="M13 19v3"/><path d="M12 19h8.3a1 1 0 0 0 .7-1.7L18 14h.3a1 1 0 0 0 .7-1.7L16 9h.2a1 1 0 0 0 .8-1.7L13 3l-1.4 1.5"/>',
  safety:
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  leisure:
    '<path d="m16 2-2.3 2.3a3 3 0 0 0 0 4.2l1.8 1.8a3 3 0 0 0 4.2 0L22 8"/><path d="M15 15 3.3 3.3a4.2 4.2 0 0 0 0 6l7.3 7.3c.7.7 2 .7 2.8 0L15 15Zm0 0 7 7"/><path d="m2.1 21.8 6.4-6.3"/><path d="m19 5-7 7"/>',
  services:
    '<line x1="3" x2="21" y1="22" y2="22"/><line x1="6" x2="6" y1="18" y2="11"/><line x1="10" x2="10" y1="18" y2="11"/><line x1="14" x2="14" y1="18" y2="11"/><line x1="18" x2="18" y1="18" y2="11"/><polygon points="12 2 20 7 4 7"/>',
};

/**
 * Genera el SVG del ícono para un marcador de mapa.
 * Neutral de entorno (string plano, sin JSX) para servir y cliente.
 */
export function poiSvgMarkup(category: string, color: string, size = 12): string {
  const def = POI_SVG_DEFS[category];
  if (!def) return '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" ` +
    `fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${def}</svg>`
  );
}

/** Etiquetas en español de los subtipos OSM, para los popups del mapa. */
const POI_TYPE_LABELS: Record<string, string> = {
  school: 'Colegio',
  kindergarten: 'Jardín infantil',
  university: 'Universidad',
  college: 'Instituto',
  clinic: 'Clínica',
  hospital: 'Hospital',
  pharmacy: 'Farmacia',
  doctors: 'Centro médico',
  station: 'Estación',
  halt: 'Estación menor',
  subway_entrance: 'Boca de Metro',
  bus_stop: 'Paradero',
  motorway_junction: 'Acceso a autopista',
  supermarket: 'Supermercado',
  convenience: 'Minimarket',
  mall: 'Mall',
  department_store: 'Tienda por departamento',
  bakery: 'Panadería',
  greengrocer: 'Verdulería',
  marketplace: 'Feria libre',
  fitness_centre: 'Gimnasio',
  sports_centre: 'Centro deportivo',
  stadium: 'Estadio',
  sports_club: 'Club deportivo',
  park: 'Parque',
  garden: 'Jardín',
  dog_park: 'Plaza de mascotas',
  police: 'Comisaría de Carabineros',
  fire_station: 'Cuartel de Bomberos',
  // Subtipos de seguridad que OSM rara vez marca con `amenity`: se derivan
  // del nombre o del operador (PDI, seguridad municipal)
  pdi: 'PDI',
  municipal_security: 'Seguridad Ciudadana municipal',
  restaurant: 'Restaurante',
  cafe: 'Cafetería',
  fast_food: 'Comida rápida',
  food_court: 'Patio de comida',
  arts_centre: 'Centro cultural',
  community_centre: 'Centro comunitario',
  bank: 'Banco',
  atm: 'Cajero automático',
  townhall: 'Municipalidad',
  courthouse: 'Tribunales de justicia',
  post_office: 'Sucursal de correos',
  government: 'Institución pública',
  notary: 'Notaría',
  financial: 'Oficina financiera',
};

/**
 * Plurales de los subtipos, para las descripciones del sector
 * ("3 colegios, 4 jardines infantiles y 1 universidad").
 *
 * Van explícitos porque en español el plural no siempre se forma agregando
 * una letra al final de la etiqueta — en "Cajero automático" pluraliza el
 * sustantivo, no el adjetivo.
 */
const POI_TYPE_PLURALS: Record<string, string> = {
  school: 'colegios',
  kindergarten: 'jardines infantiles',
  university: 'universidades',
  college: 'institutos',
  clinic: 'clínicas',
  hospital: 'hospitales',
  pharmacy: 'farmacias',
  doctors: 'centros médicos',
  station: 'estaciones',
  halt: 'estaciones menores',
  subway_entrance: 'bocas de Metro',
  bus_stop: 'paraderos',
  motorway_junction: 'accesos a autopista',
  supermarket: 'supermercados',
  convenience: 'minimarkets',
  mall: 'malls',
  department_store: 'tiendas por departamento',
  bakery: 'panaderías',
  greengrocer: 'verdulerías',
  marketplace: 'ferias libres',
  fitness_centre: 'gimnasios',
  sports_centre: 'centros deportivos',
  stadium: 'estadios',
  sports_club: 'clubes deportivos',
  park: 'parques',
  garden: 'jardines',
  dog_park: 'plazas de mascotas',
  police: 'comisarías de Carabineros',
  fire_station: 'cuarteles de bomberos',
  pdi: 'unidades de la PDI',
  municipal_security: 'centros de seguridad ciudadana',
  restaurant: 'restaurantes',
  cafe: 'cafeterías',
  fast_food: 'locales de comida rápida',
  food_court: 'patios de comida',
  arts_centre: 'centros culturales',
  community_centre: 'centros comunitarios',
  bank: 'bancos',
  atm: 'cajeros automáticos',
  townhall: 'municipalidades',
  courthouse: 'tribunales de justicia',
  post_office: 'sucursales de correos',
  government: 'instituciones públicas',
  notary: 'notarías',
  financial: 'oficinas financieras',
};

/**
 * Singulares que no se leen bien al derivarlos de la etiqueta del marcador
 * (siglas y etiquetas que necesitan una palabra de apoyo).
 */
const POI_TYPE_SINGULARS: Record<string, string> = {
  pdi: 'unidad de la PDI',
  municipal_security: 'centro de seguridad ciudadana',
  government: 'institución pública',
  atm: 'cajero automático',
};

/**
 * Etiqueta singular del subtipo para textos descriptivos ("1 unidad de la PDI").
 */
export function poiTypeLabelSingular(type: string): string {
  if (!type) return '';
  return POI_TYPE_SINGULARS[type] || poiTypeLabel(type).toLowerCase();
}

/**
 * Etiqueta plural del subtipo para textos descriptivos.
 * Subtipos sin plural explícito se pluralizan con una regla simple
 * (vocal + "s", "z" → "ces", consonante + "es").
 */
export function poiTypeLabelPlural(type: string): string {
  if (!type) return '';
  if (POI_TYPE_PLURALS[type]) return POI_TYPE_PLURALS[type];

  const label = poiTypeLabel(type).toLowerCase();
  if (!label) return '';
  // Pluraliza solo la última palabra del label
  const words = label.split(' ');
  const last = words[words.length - 1];
  const plural = /[aeiouáéíóú]$/.test(last)
    ? `${last}s`
    : /z$/.test(last)
      ? `${last.slice(0, -1)}ces`
      : `${last}es`;
  return [...words.slice(0, -1), plural].join(' ');
}

/**
 * Importancia del subtipo para escalar el marcador: los servicios mayores
 * (estaciones de metro, hospitales, universidades) destacan sobre los
 * menores (paraderos, farmacias, jardines infantiles).
 *   2 = mayor (27px) · 1 = normal (23px) · 0 = menor (19px)
 */
const POI_TYPE_IMPORTANCE: Record<string, number> = {
  // Transporte: metro/tren > paradero
  station: 2,
  halt: 1,
  subway_entrance: 2,
  bus_stop: 0,
  motorway_junction: 0,
  // Salud: hospital/clínica > centro médico > farmacia
  hospital: 2,
  clinic: 1,
  doctors: 1,
  pharmacy: 0,
  // Educación: universidad > instituto/colegio > jardín
  university: 2,
  college: 1,
  school: 1,
  kindergarten: 0,
  // Comercio: mall/supermercado > tienda por departamento > resto
  mall: 2,
  department_store: 1,
  supermarket: 1,
  convenience: 0,
  bakery: 0,
  greengrocer: 0,
  marketplace: 1,
  // Deportes: estadio > resto
  stadium: 2,
  fitness_centre: 0,
  sports_centre: 0,
  sports_club: 0,
  // Áreas verdes: parque > plaza/jardín de bolsillo
  park: 2,
  garden: 0,
  dog_park: 0,
  // Seguridad: comisaría/cuartel > PDI > seguridad ciudadana municipal
  police: 1,
  fire_station: 1,
  pdi: 1,
  municipal_security: 0,
  // Servicios: banco/municipalidad > cajero
  bank: 1,
  townhall: 2,
  courthouse: 2,
  atm: 0,
  post_office: 0,
  notary: 0,
  financial: 0,
  government: 0,
  // Ocio: restaurante > cafetería/fast food
  restaurant: 1,
  cafe: 0,
  fast_food: 0,
  food_court: 1,
  arts_centre: 1,
  community_centre: 0,
};

/** Nivel de importancia (2 mayor, 1 normal, 0 menor) del subtipo OSM. */
export function poiImportance(type: string): number {
  return POI_TYPE_IMPORTANCE[type] ?? 1;
}

/** Tamaño del marcador (px) según el nivel de importancia. */
export function poiMarkerSize(type: string): number {
  return [19, 23, 27][poiImportance(type)] ?? 23;
}

/** Etiqueta humana del subtipo OSM; humaniza el valor crudo si no está mapeado. */
export function poiTypeLabel(type: string): string {
  if (!type) return '';
  return (
    POI_TYPE_LABELS[type] ||
    type.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
  );
}

export const POI_CATEGORIES: Record<string, PoiCategoryConfig> = {
  education: {
    label: 'Educación',
    description: 'Colegios, jardines infantiles, universidades e institutos',
    color: '#3b82f6',
    emoji: '🎓',
    queries: ['["amenity"~"school|kindergarten|university|college"]'],
  },
  health: {
    label: 'Salud',
    description: 'Clínicas, hospitales, centros médicos y farmacias',
    color: '#ef4444',
    emoji: '🏥',
    queries: ['["amenity"~"clinic|hospital|pharmacy|doctors"]'],
  },
  transport: {
    label: 'Transporte',
    description: 'Estaciones de Metro, paraderos Red, accesos a autopistas y red de ciclovías',
    color: '#f59e0b',
    emoji: '🚌',
    queries: [
      '["railway"~"station|halt"]',
      '["railway"="subway_entrance"]',
      '["highway"="bus_stop"]',
      '["highway"="motorway_junction"]',
    ],
  },
  shopping: {
    label: 'Comercio',
    description: 'Supermercados, malls y shopping centers, strip centers, ferias libres, panaderías y minimarkets',
    color: '#14b8a6',
    emoji: '🛒',
    queries: [
      '["shop"~"supermarket|convenience|mall|department_store|bakery|greengrocer"]',
      '["amenity"="marketplace"]',
    ],
  },
  sports: {
    label: 'Deportes',
    description: 'Gimnasios, estadios y clubes deportivos',
    color: '#f97316',
    emoji: '⚽',
    queries: ['["leisure"~"fitness_centre|sports_centre|stadium|sports_club"]'],
  },
  park: {
    label: 'Áreas Verdes',
    description: 'Parques, plazas y zonas para mascotas',
    color: '#22c55e',
    emoji: '🌳',
    queries: ['["leisure"~"park|garden|dog_park"]', '["place"="square"]'],
  },
  safety: {
    label: 'Seguridad',
    description: 'Comisarías de Carabineros, cuarteles de bomberos, PDI y seguridad ciudadana',
    color: '#6366f1',
    emoji: '🚔',
    queries: [
      '["amenity"~"police|fire_station"]',
      // Comisarías, tenencias, PDI y seguridad municipal que OSM mapea sin
      // `amenity` (o como polígono del edificio) — se detectan por nombre
      '["name"~"Carabinero|Comisar|Subcomisar|Tenencia|Retén|Bomberos|Policía de Investigaciones|PDI|Seguridad Ciudadana|Paz Ciudadana",i]',
      '["operator"~"Carabineros|Bomberos|Policía de Investigaciones|Seguridad Ciudadana",i]',
    ],
  },
  leisure: {
    label: 'Ocio',
    description: 'Restaurantes, cafeterías, polos gastronómicos y centros culturales',
    color: '#ec4899',
    emoji: '🍽️',
    queries: ['["amenity"~"restaurant|cafe|fast_food|food_court|arts_centre|community_centre"]'],
  },
  services: {
    label: 'Servicios',
    description: 'Bancos, cajeros automáticos, notarías, Registro Civil, municipalidades e instituciones del estado',
    color: '#8b5cf6',
    emoji: '🏛️',
    queries: [
      '["amenity"~"bank|atm|townhall|courthouse|post_office"]',
      '["office"~"government|notary|financial"]',
    ],
  },
};

/**
 * Subtipo de seguridad y emergencias de un elemento OSM.
 *
 * `amenity=police|fire_station` no cubre a la PDI ni a los centros de
 * seguridad ciudadana municipal (Paz Ciudadana, inspectores), que en OSM
 * suelen venir como `office=government` o directamente sin tag de tipo, con
 * la institución solo en `name`/`operator`. También cubre el caso frecuente
 * de comisarías y cuarteles mapeados como polígono del edificio.
 */
export function safetySubtypeFromTags(tags: Record<string, string>): string | null {
  const name = `${tags.name || ''} ${tags['name:es'] || ''} ${tags.operator || ''} ${tags.official_name || ''}`;

  const isPdi = /polic[ií]a\s+de\s+investigaciones|\bPDI\b/i.test(name);
  const isMunicipal =
    /seguridad\s+ciudadana|paz\s+ciudadana|inspecci[oó]n\s+municipal|seguridad\s+municipal|direcci[oó]n\s+de\s+seguridad/i.test(name);
  // `\b` para no capturar a "Jardín Infantil Entreteniños" (contiene "reten")
  const isFire = /\bbomberos?\b|\bbombas?\b|cuerpo\s+de\s+bomberos/i.test(name);
  const isPolice =
    /carabinero|comisar[ií]a|subcomisar[ií]a|\btenencia\b|\bret[eé]n\b|prefectura|polic[ií]a/i.test(name);

  if (tags.amenity === 'fire_station') return isPdi ? 'pdi' : 'fire_station';
  if (tags.amenity === 'police') {
    if (isPdi) return 'pdi';
    if (isMunicipal) return 'municipal_security';
    return 'police';
  }

  // Sin tag de tipo de seguridad nos apoyamos en el nombre/operador, pero solo
  // si el elemento no pertenece claramente a otra categoría — si no, un
  // "Restaurante La Comisaría" o una "Panadería La Tenencia" caerían acá.
  // `highway`/`railway`: un paradero o estación llamados "Bomberos" o
  // "Carabineros" (muy comunes, se nombran por el hito cercano) son transporte
  if (tags.shop || tags.leisure || tags.tourism || tags.craft || tags.healthcare) return null;
  if (tags.highway || tags.railway) return null;
  if (tags.amenity) return null;
  if (tags.office && !['government', 'police', 'security'].includes(tags.office)) return null;

  if (isPdi) return 'pdi';
  if (isMunicipal) return 'municipal_security';
  if (isFire) return 'fire_station';
  if (isPolice) return 'police';
  return null;
}

/**
 * Subtipo visible del POI ("school", "bus_stop", "pdi"...).
 * Usa el tag de tipo de OSM y, si no existe, el subtipo derivado de seguridad.
 * Lo usan la API route y el generador de snapshot para popups y tamaños.
 */
export function derivePoiType(tags: Record<string, string>): string {
  return (
    tags.amenity ||
    tags.shop ||
    tags.leisure ||
    tags.railway ||
    tags.highway ||
    // Antes de `office`: una PDI o un centro de seguridad ciudadana suelen
    // venir como office=government, pero "PDI" describe mucho mejor el lugar
    safetySubtypeFromTags(tags) ||
    tags.office ||
    ''
  );
}

/**
 * Categoriza un elemento de Overpass según sus tags de OSM.
 * Neutral de entorno: la usa la API route en el servidor.
 */
export function categorizePOI(tags: Record<string, string>): string | null {
  // Educación
  if (['school', 'kindergarten', 'university', 'college'].includes(tags.amenity)) return 'education';

  // Salud
  if (['clinic', 'hospital', 'pharmacy', 'doctors'].includes(tags.amenity)) return 'health';

  // Transporte (metro, tren, paraderos y accesos a autopistas; las ciclovías
  // son vías, no POIs puntuales, por eso no aparecen como marcador)
  if (['station', 'halt', 'subway_entrance'].includes(tags.railway)) return 'transport';
  if (['bus_stop', 'motorway_junction'].includes(tags.highway)) return 'transport';

  // Comercio
  if (['supermarket', 'convenience', 'mall', 'department_store', 'bakery', 'greengrocer'].includes(tags.shop)) return 'shopping';
  if (tags.amenity === 'marketplace') return 'shopping';

  // Deportes
  if (['fitness_centre', 'sports_centre', 'stadium', 'sports_club'].includes(tags.leisure)) return 'sports';

  // Áreas verdes
  if (['park', 'garden', 'dog_park'].includes(tags.leisure)) return 'park';
  if (tags.place === 'square') return 'park';

  // Seguridad y emergencias (incluye lo derivado por nombre/operador)
  if (safetySubtypeFromTags(tags)) return 'safety';

  // Ocio
  if (['restaurant', 'cafe', 'fast_food', 'food_court', 'arts_centre', 'community_centre'].includes(tags.amenity)) return 'leisure';

  // Servicios financieros y públicos
  if (['bank', 'atm', 'townhall', 'courthouse', 'post_office'].includes(tags.amenity)) return 'services';
  if (['government', 'notary', 'financial'].includes(tags.office)) return 'services';

  return null;
}
