import type { Partner } from './partners';

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
}

/** Color por defecto, el mismo que usa el panel al crear una corredora. */
export const DEFAULT_PARTNER_COLOR = '#3B82F6';

/** Columnas que se piden en cada lectura. */
export const PARTNER_COLUMNS =
  'id, slug, name, logo, description, website, color, contact_phone, contact_whatsapp, contact_email, sort_order';

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

  if (updates.contact !== undefined) {
    row.contact_phone = updates.contact.phone ?? '';
    row.contact_whatsapp = updates.contact.whatsapp ?? '';
    row.contact_email = updates.contact.email ?? '';
  }

  return row;
}
