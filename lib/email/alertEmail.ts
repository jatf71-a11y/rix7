import type { Property } from '@/lib/types/property';
import { formatArea, getPropertyTypeLabel } from '@/lib/utils/formatters';
import { formatClp } from '@/lib/data/savedSearches';

/**
 * Correo de aviso: "aparecieron estas propiedades que encajan con lo que buscas".
 *
 * Se construye acá, en un módulo puro, porque es lo único de esta función que el
 * usuario ve de verdad: vale la pena poder revisarlo en un test en vez de
 * descubrirlo en la bandeja de entrada.
 */

export interface AlertEmailInput {
  /** Etiqueta de la búsqueda guardada. */
  label: string;
  properties: Property[];
  /** Nombre de la persona, si lo tenemos. */
  recipientName?: string | null;
  /** Base para armar los enlaces absolutos. */
  siteUrl: string;
}

export interface BuiltEmail {
  subject: string;
  text: string;
  html: string;
}

/** Escapa lo que venga del catálogo antes de meterlo en HTML. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function operationWord(property: Property): string {
  return property.status === 'for_rent' ? 'arriendo' : 'venta';
}

function priceLine(property: Property): string {
  const suffix = property.status === 'for_rent' ? ' /mes' : '';
  return `${formatClp(property.price)}${suffix}`;
}

function detailsLine(property: Property): string {
  const parts: string[] = [];
  if (property.bedrooms > 0) parts.push(`${property.bedrooms} dorm.`);
  if (property.bathrooms > 0) parts.push(`${property.bathrooms} baños`);
  if (property.area_sqm > 0) parts.push(formatArea(property.area_sqm));
  parts.push(getPropertyTypeLabel(property.property_type));
  return parts.join(' · ');
}

export function buildAlertEmail({
  label,
  properties,
  recipientName,
  siteUrl,
}: AlertEmailInput): BuiltEmail {
  const count = properties.length;
  const noun = count === 1 ? 'propiedad nueva' : 'propiedades nuevas';
  const subject =
    count === 1
      ? `1 ${noun} para tu búsqueda: ${label}`
      : `${count} ${noun} para tu búsqueda: ${label}`;

  const greeting = recipientName ? `Hola ${recipientName},` : 'Hola,';

  const text = [
    greeting,
    '',
    `Aparecieron ${count} ${noun} que coinciden con tu búsqueda guardada:`,
    `«${label}»`,
    '',
    ...properties.map((p) =>
      [
        `• ${p.title}`,
        `  ${p.address}, ${p.city}`,
        `  ${priceLine(p)} · ${detailsLine(p)}`,
        `  ${siteUrl}/properties/${p.id}`,
      ].join('\n')
    ),
    '',
    'Puedes borrar esta búsqueda desde «Búsquedas guardadas», en el buscador de Rix7, y dejarás de recibir este aviso.',
    '',
    'Rix7 — Portal inmobiliario inteligente',
  ].join('\n');

  const itemsHtml = properties
    .map(
      (p) => `
        <tr>
          <td style="padding:16px 0;border-bottom:1px solid #e2e8f0">
            <a href="${siteUrl}/properties/${encodeURIComponent(p.id)}"
               style="color:#1d4ed8;font-size:16px;font-weight:700;text-decoration:none">
              ${escapeHtml(p.title)}
            </a>
            <div style="color:#475569;font-size:13px;margin-top:4px">
              ${escapeHtml(`${p.address}, ${p.city}`)}
            </div>
            <div style="color:#0f172a;font-size:15px;font-weight:700;margin-top:6px">
              ${escapeHtml(priceLine(p))}
              <span style="color:#64748b;font-size:12px;font-weight:500">
                · ${escapeHtml(detailsLine(p))}
              </span>
            </div>
            <div style="margin-top:8px">
              <a href="${siteUrl}/properties/${encodeURIComponent(p.id)}"
                 style="color:#1d4ed8;font-size:12px;font-weight:600;text-decoration:none">
                Ver la propiedad →
              </a>
            </div>
          </td>
        </tr>`
    )
    .join('');

  const html = `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0">
      <div style="padding:24px 24px 8px">
        <div style="font-size:13px;font-weight:800;letter-spacing:.08em;color:#1d4ed8;text-transform:uppercase">Rix7</div>
        <h1 style="margin:8px 0 4px;font-size:20px;color:#0f172a">
          ${count === 1 ? '1 propiedad nueva' : `${count} propiedades nuevas`} para ti
        </h1>
        <p style="margin:0;color:#475569;font-size:14px">
          ${escapeHtml(greeting)} aparecieron propiedades que coinciden con tu búsqueda guardada
          <strong>«${escapeHtml(label)}»</strong>.
        </p>
      </div>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="padding:0 24px">
        ${itemsHtml}
      </table>
      <div style="padding:16px 24px 24px">
        <a href="${siteUrl}/"
           style="display:inline-block;background:#1d4ed8;color:#ffffff;font-size:13px;font-weight:700;padding:10px 18px;border-radius:10px;text-decoration:none">
          Buscar en Rix7
        </a>
        <p style="margin:16px 0 0;color:#94a3b8;font-size:11px;line-height:1.6">
          Recibes este correo porque guardaste esta búsqueda en Rix7. Puedes borrarla
          desde «Búsquedas guardadas», en el buscador, y dejarás de recibir el aviso.
        </p>
      </div>
    </div>
  </body>
</html>`;

  return { subject, text, html };
}
