import { isPartnerKind, type Partner, type PartnerKind } from './partners';

/**
 * Traducción entre la fila de `public.partners` y el `Partner` que consume la
 * app.
 *
 * Vive en un módulo puro (sin Supabase, sin React) para poder probar el mapeo
 * completo sin una base de datos: aquí es donde se pierden o se conservan los
 * datos de contacto, que es justo lo que no queremos romper.
 */

/** Fila de `public.partners` tal como la devuelve Supabase. */
export interface PartnerRow {
  id: string;
  slug: string;
  name: string;
  logo: string | null;
  description: string | null;
  website: string | null;
  color: string | null;
  contact_phone: string | null;
  contact_whatsapp: string | null;
  contact_email: string | null;
  sort_order?: number | null;
  /** Categoría del socio: corredora, inmobiliaria o agente (NULL = sin clasificar). */
  kind?: string | null;
  /** Feed XML para agregadores (#14): activo o no. */
  feed_enabled?: boolean | null;
  /** Hash SHA-256 del token del feed. NUNCA se expone: si se filtrara la tabla,
   *  el hash no sirve para autenticar (el feed compara hashes). */
  feed_token_hash?: string | null;
}

/** Columnas que se escriben en la tabla (sin las de auditoría). */
export interface PartnerWriteRow {
  id: string;
  slug: string;
  name: string;
  logo: string;
  description: string;
  website: string | null;
  color: string;
  contact_phone: string;
  contact_whatsapp: string;
  contact_email: string;
  sort_order: number;
  /** Categoría del socio; NULL solo para fichas históricas sin clasificar. */
  kind: PartnerKind | null;
  /** Feed XML para agregadores (#14): activo o no (el hash va aparte). */
  feed_enabled: boolean;
}

/** Color por defecto, el mismo que usa el panel al crear una corredora. */
export const DEFAULT_PARTNER_COLOR = '#3B82F6';

/** Columnas que se piden en cada lectura. */
export const PARTNER_COLUMNS =
  'id, slug, name, logo, description, website, color, contact_phone, contact_whatsapp, contact_email, sort_order, kind, feed_enabled, feed_token_hash';

/** Fila de la base → objeto de la app. Los nulos se normalizan, no se propagan. */
export function rowToPartner(row: PartnerRow): Partner {
  return {
    id: row.id,
    // El slug es la URL; si faltara, el id es un respaldo razonable.
    slug: row.slug || row.id,
    name: row.name,
    logo: row.logo ?? '',
    description: row.description ?? '',
    website: row.website ?? undefined,
    color: row.color || DEFAULT_PARTNER_COLOR,
  contact: {
    phone: row.contact_phone ?? '',
    whatsapp: row.contact_whatsapp ?? '',
    email: row.contact_email ?? '',
  },
  // Una categoría desconocida no se propaga: se muestra «Sin clasificar».
  kind: isPartnerKind(row.kind) ? row.kind : null,
  // Estado del feed: sí. El hash del token no viaja jamás al cliente.
  feedEnabled: row.feed_enabled ?? false,
};
}

/** Objeto de la app → fila para insertar. */
export function partnerToRow(partner: Partner, sortOrder = 0): PartnerWriteRow {
  return {
    id: partner.id,
    slug: partner.slug || partner.id,
    name: partner.name,
    logo: partner.logo ?? '',
    description: partner.description ?? '',
    // Cadena vacía → NULL: la columna es opcional y así no se guarda ruido.
    website: partner.website || null,
    color: partner.color || DEFAULT_PARTNER_COLOR,
    contact_phone: partner.contact?.phone ?? '',
    contact_whatsapp: partner.contact?.whatsapp ?? '',
    contact_email: partner.contact?.email ?? '',
    sort_order: sortOrder,
    kind: partner.kind ?? null,
    feed_enabled: partner.feedEnabled ?? false,
  };
}

/**
 * Parche para una edición parcial.
 *
 * Solo incluye las claves realmente presentes: así una edición que cambia el
 * nombre no borra los teléfonos de la corredora (que es el error clásico de
 * mandar el objeto completo armado con campos vacíos).
 */
export function partnerPatchToRow(updates: Partial<Partner>): Partial<PartnerWriteRow> {
  const row: Partial<PartnerWriteRow> = {};

  if (updates.slug !== undefined) row.slug = updates.slug;
  if (updates.name !== undefined) row.name = updates.name;
  if (updates.logo !== undefined) row.logo = updates.logo;
  if (updates.description !== undefined) row.description = updates.description;
  // Cadena vacía → NULL: borrar el sitio web desde el panel lo deja sin valor,
  // no con una cadena vacía guardada.
  if (updates.website !== undefined) row.website = updates.website || null;
  if (updates.color !== undefined) row.color = updates.color || DEFAULT_PARTNER_COLOR;
  // `null` limpia la categoría a propósito (dejar sin clasificar una ficha).
  if (updates.kind !== undefined) row.kind = updates.kind ?? null;

  if (updates.contact !== undefined) {
    row.contact_phone = updates.contact.phone ?? '';
    row.contact_whatsapp = updates.contact.whatsapp ?? '';
    row.contact_email = updates.contact.email ?? '';
  }

  // El estado del feed sí se edita desde el panel; el hash del token no pasa
  // por acá — se escribe solo desde la ruta de feed, que es quien lo calcula.
  if (updates.feedEnabled !== undefined) row.feed_enabled = updates.feedEnabled;

  return row;
}
