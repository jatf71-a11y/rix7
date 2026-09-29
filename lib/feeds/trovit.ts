import type { Property, PropertyType } from '@/lib/types/property';

/**
 * Feed XML de propiedades en formato **Trovit** (hallazgo #14).
 *
 * Trovit/Mitula es el estándar de facto de los agregadores en LatAm y España:
 * la corredora registra la URL del feed en el portal y este la rastrea 1–2
 * veces al día. Es un formato de export simple: el mapeo completo desde
 * `Property` está en `mapToTrovitType` y en `buildTrovitFeed`, y por eso puede
 * probarse entero sin red ni base.
 *
 * Referencia de campos usados (del formato público de Trovit Real Estate):
 * `id, url, title, type, content, price (@period), address, city, region,
 * postcode, latitude, longitude, floor_area (@unit), rooms, bathrooms,
 * parking, date (DD/MM/AAAA), pictures/picture/picture_url`.
 *
 * El contacto que viaja es el de la **corredora** (decisión de la evaluación:
 * publicar el contacto de cada agente en un agregador lo decide ella, no el
 * portal). Lo inyecta la ruta desde el partner, no este módulo.
 */

/** Tipos que acepta el agregador. `all` no es un tipo real de propiedad. */
const TROVIT_TYPE: Partial<Record<PropertyType, string>> = {
  apartment: 'flat',
  house: 'house',
  // «Premium» es una casa destacada del catálogo Rix7; para un agregador es una casa.
  premium: 'house',
  parcel: 'land',
  land: 'land',
  office: 'office',
  local: 'commercial',
  warehouse: 'warehouse',
  parking: 'garage',
};

export function mapToTrovitType(type: PropertyType): string | null {
  return TROVIT_TYPE[type] ?? null;
}

/** Trovit exige DD/MM/AAAA — no ISO, aunque el resto del portal use ISO. */
export function formatTrovitDate(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getUTCFullYear()}`;
}

/** Escapa texto para nodos y atributos XML. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Envuelve texto en CDATA. La única secuencia que rompe un CDATA es `]]>`, así
 * que se parte en dos bloques — el truco canónico (`]]]]><![CDATA[>`).
 */
function cdata(value: string): string {
  return `<![CDATA[${value.replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`;
}

export interface TrovitFeedInput {
  properties: Property[];
  /** Base de las URLs de ficha; viene de `SITE_URL` en producción. */
  siteUrl: string;
  /** Datos de la corredora dueña del feed. */
  agency: {
    name: string;
    phone?: string;
    email?: string;
    whatsapp?: string;
  };
}

const CDATA_BREAK = /]]>/g;

function adXml(property: Property, siteUrl: string): string {
  const type = mapToTrovitType(property.property_type);
  // Sin tipo mapeable (p. ej. `all`) el anuncio no se puede clasificar: se omite
  // en vez de adivinar.
  if (!type) return '';

  const url = `${siteUrl}/properties/${encodeURIComponent(property.id)}`;
  const isRent = property.status === 'for_rent';
  const price = Math.round(property.price);
  const lines: string[] = [];

  lines.push('<ad>');
  lines.push(`  <id>${escapeXml(property.id)}</id>`);
  lines.push(`  <url>${escapeXml(url)}</url>`);
  lines.push(`  <title>${cdata(property.title)}</title>`);
  lines.push(`  <type>${type}</type>`);
  // `content` es la descripción que indexa el portal: CDATA con la original.
  lines.push(`  <content>${cdata(property.description ?? '')}</content>`);
  // Arriendo lleva `period="month"`; venta no lleva periodo.
  lines.push(
    isRent ? `  <price period="month">${price}</price>` : `  <price>${price}</price>`
  );
  lines.push(`  <property_type>${type}</property_type>`);
  lines.push(`  <address>${cdata(property.address)}</address>`);
  lines.push(`  <city>${cdata(property.city)}</city>`);
  if (property.state) lines.push(`  <region>${cdata(property.state)}</region>`);
  if (property.zip_code) lines.push(`  <postcode>${escapeXml(property.zip_code)}</postcode>`);
  lines.push(`  <latitude>${property.lat}</latitude>`);
  lines.push(`  <longitude>${property.lng}</longitude>`);
  if (property.area_sqm > 0) {
    lines.push(`  <floor_area unit="m²">${property.area_sqm}</floor_area>`);
  }
  if (property.bedrooms > 0) lines.push(`  <rooms>${property.bedrooms}</rooms>`);
  if (property.bathrooms > 0) lines.push(`  <bathrooms>${property.bathrooms}</bathrooms>`);
  if (property.parking_spots > 0) lines.push(`  <parking>${property.parking_spots}</parking>`);
  if (property.created_at) {
    const date = formatTrovitDate(property.created_at);
    if (date) lines.push(`  <date>${date}</date>`);
  }

  const pictures = (property.images ?? []).filter(Boolean).slice(0, 20);
  if (pictures.length > 0) {
    lines.push('  <pictures>');
    pictures.forEach((image, index) => {
      lines.push('    <picture>');
      lines.push(`      <picture_url>${escapeXml(image)}</picture_url>`);
      lines.push(`      <picture_title>${cdata(`${property.title} — foto ${index + 1}`)}</picture_title>`);
      lines.push('    </picture>');
    });
    lines.push('  </pictures>');
  }

  // El video de la ficha, si lo hay: los agregadores lo listan como multimedia.
  if (property.video_url) {
    lines.push('  <multimedia>');
    lines.push(`    <video_url>${escapeXml(property.video_url)}</video_url>`);
    lines.push('  </multimedia>');
  }

  return `${lines.join('\n')}\n</ad>`;
}

/** Feed completo. Los vendidos no viajan: el agregador no los lista. */
export function buildTrovitFeed({ properties, siteUrl, agency }: TrovitFeedInput): string {
  const publishable = properties.filter(
    (property) => property.status !== 'sold' && mapToTrovitType(property.property_type)
  );

  const ads = publishable.map((property) => adXml(property, siteUrl)).filter(Boolean);

  const header = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<trovit>',
    `  <!-- Feed de ${agency.name} vía Rix7 — generado ${new Date().toISOString()} -->`,
  ].join('\n');

  const footer = '</trovit>';
  return [header, ...ads, footer].join('\n');
}

/** Reexport para la ruta: mantiene un solo lugar que sabe partir CDATA. */
export { CDATA_BREAK };
