/**
 * Título y descripción de la **tarjeta de vista previa** (Open Graph) de un
 * enlace compartido.
 *
 * Es lo único que ve quien recibe el enlace por WhatsApp, correo o Telegram
 * antes de hacer clic: un enlace suelto no vende nada, y por eso el texto se
 * arma acá en vez de reutilizar la descripción cruda de la propiedad.
 *
 * Tres reglas que justifican que esto sea un módulo puro con tests:
 *
 * 1. **El precio encabeza.** Es el dato que decide si alguien abre el enlace, y
 *    no se recorta nunca: si el título no cabe, se sacrifican palabras del
 *    tipo o del número de dormitorios, no el precio.
 * 2. **Nada que permita saltarse a la corredora.** Igual que la landing, la
 *    tarjeta viaja por chats ajenos: se filtran la dirección, los teléfonos y
 *    los correos aunque vengan dentro del texto de la corredora.
 * 3. **Se corta por palabra.** El corte a 200 caracteres de la descripción cae
 *    donde caiga; acá se busca el último espacio para que no aparezca una
 *    palabra partida al compartir.
 */

import { formatPrice, getPropertyTypeLabel } from './formatters';

/** Límite práctico antes de que WhatsApp y otros recorten el título. */
export const SHARE_TITLE_MAX = 70;

/** Límite que respetan las tarjetas de vista previa grandes. */
export const SHARE_DESCRIPTION_MAX = 200;

/** Singular de cada tipo: el título habla de *una* propiedad, no de una lista. */
const TYPE_SINGULAR: Record<string, string> = {
  apartment: 'Departamento',
  house: 'Casa',
  premium: 'Departamento',
  penthouse: 'Penthouse',
  parcel: 'Parcela',
  office: 'Oficina',
  land: 'Terreno',
  parking: 'Estacionamiento',
  local: 'Local',
  warehouse: 'Bodega',
};

export interface ShareMetaInput {
  title?: string;
  description?: string;
  property_type?: string;
  status?: string;
  price: number;
  bedrooms?: number;
  bathrooms?: number;
  area_sqm?: number;
  city?: string;
  state?: string;
  /** Se redacta si aparece en el texto: la tarjeta no publica la ubicación exacta. */
  address?: string;
  features?: string[];
}

export interface ShareMeta {
  title: string;
  description: string;
}

/**
 * Quita de un texto los datos que no deben viajar en un enlace compartido:
 * la dirección exacta, correos y teléfonos chilenos.
 */
export function redactSensitive(text: string, secrets: (string | undefined)[] = []): string {
  let out = text;
  for (const secret of secrets) {
    const value = secret?.trim();
    if (value && value.length > 3) out = out.split(value).join('');
  }

  return out
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '')
    .replace(/(?:\+?56)?\s?9\s?\d{4}\s?\d{4}/g, '')
    .replace(/\b(?:piso|depto|dpto|oficina)\s*\d+\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;])/g, '$1')
    .trim();
}

/**
 * Corta en el último espacio antes del límite, para no partir palabras. Si el
 * primer tramo es una sola palabra larguísima, se corta duro antes que dejarlo
 * pasar del límite.
 */
export function truncateAtWord(text: string, max: number): string {
  const clean = text.trim();
  if (clean.length <= max) return clean;

  // Si el corte cae justo entre palabras (el carácter siguiente ya es un
  // espacio), la palabra que termina en el límite entra completa.
  const boundary = clean[max] === ' ' ? max : clean.lastIndexOf(' ', max);
  if (boundary <= 0) return clean.slice(0, max).trimEnd();

  return clean.slice(0, boundary).replace(/[\s,;:.·-]+$/, '').trim();
}

/** Primera oración de un texto, con su punto final. */
function firstSentence(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  // El terminador se conserva: si no, la oración queda pegada a la que sigue
  // ("...Torre Marco Polo Fotos, entorno...").
  const end = clean.search(/[.!?](\s|$)/);
  return (end === -1 ? clean : clean.slice(0, end + 1)).trim();
}

function typeSingular(type?: string): string {
  if (!type) return 'Propiedad';
  return TYPE_SINGULAR[type] || getPropertyTypeLabel(type).replace(/s$/, '');
}

/**
 * Título: precio primero, después especificación y comuna.
 *
 * Se prueban variantes en orden de importancia y gana la primera que entra en
 * el límite. Así una comuna de nombre largo ("San Pedro de la Paz") no empuja
 * al precio ni pierde la ubicación: pierde la palabra "Departamento".
 */
export function buildShareTitle(input: ShareMetaInput): string {
  const isRent = input.status === 'for_rent';
  const price = formatPrice(input.price, 'CLP', 'es-CL', isRent).trim();
  const place = input.city?.trim();
  const beds = input.bedrooms && input.bedrooms > 0 ? `${input.bedrooms} dormitorios` : '';
  const type = typeSingular(input.property_type);

  const variants = [
    [price, [type, beds].filter(Boolean).join(' '), place],
    [price, beds, place],
    [price, place],
    [price],
  ]
    .map((parts) => parts.filter(Boolean).join(' · '))
    .filter(Boolean);

  return variants.find((v) => v.length <= SHARE_TITLE_MAX) || variants[variants.length - 1];
}

/**
 * Descripción: especificación, gancho y quién entrega el resto.
 *
 * El gancho es la primera oración de la descripción de la corredora —lo que ella
 * escribió para vender— y si no hay, sus tres primeros atributos. La última
 * línea nombra a la corredora: es el CTA dentro del propio chat.
 */
export function buildShareDescription(input: ShareMetaInput, partnerName?: string): string {
  const secrets = [input.address];

  const specParts: string[] = [];
  const specs: string[] = [];
  if (input.bedrooms && input.bedrooms > 0) specs.push(`${input.bedrooms} dormitorios`);
  if (input.bathrooms && input.bathrooms > 0) specs.push(`${input.bathrooms} baños`);
  if (input.area_sqm && input.area_sqm > 0) specs.push(`${input.area_sqm} m²`);

  const type = typeSingular(input.property_type);
  const place = input.city?.trim();
  if (specs.length) {
    specParts.push(`${type} de ${specs.join(', ')}${place ? ` en ${place}` : ''}.`);
  } else if (place) {
    specParts.push(`${type} en ${place}.`);
  }

  const hook = firstSentence(redactSensitive(input.description || '', secrets));
  const features = (input.features || [])
    .slice(0, 3)
    .map((f) => redactSensitive(f, secrets))
    .filter(Boolean)
    .join(', ');

  const closing = partnerName
    ? `Fotos, entorno y datos completos con ${redactSensitive(partnerName, secrets)}.`
    : 'Fotos, entorno y datos completos en el enlace.';

  const blocks = [specParts.join(' '), hook || features, closing].filter(Boolean);
  return truncateAtWord(blocks.join(' '), SHARE_DESCRIPTION_MAX);
}

/**
 * Especificación corta, sin precio ni tipo, para la **tarjeta gráfica**: es la
 * línea que acompaña al precio en grande ("2 dormitorios · 2 baños · 95 m² ·
 * Las Condes").
 *
 * La comuna se omite si el título ya la nombra: en la tarjeta van una debajo del
 * otro y repetirla a dos renglones de distancia se lee como un error.
 */
export function buildShareFacts(input: ShareMetaInput): string {
  const facts: string[] = [];
  if (input.bedrooms && input.bedrooms > 0) {
    facts.push(`${input.bedrooms} ${input.bedrooms === 1 ? 'dormitorio' : 'dormitorios'}`);
  }
  if (input.bathrooms && input.bathrooms > 0) {
    facts.push(`${input.bathrooms} ${input.bathrooms === 1 ? 'baño' : 'baños'}`);
  }
  if (input.area_sqm && input.area_sqm > 0) facts.push(`${input.area_sqm} m²`);

  const city = input.city?.trim();
  if (city && !(input.title || '').toLowerCase().includes(city.toLowerCase())) facts.push(city);

  return facts.join(' · ');
}

/** Título y descripción listos para `generateMetadata`. */
export function buildShareMeta(input: ShareMetaInput, partnerName?: string): ShareMeta {
  return {
    title: buildShareTitle(input),
    description: buildShareDescription(input, partnerName),
  };
}
