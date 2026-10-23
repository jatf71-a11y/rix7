/**
 * Correo interno: «entró una solicitud nueva de corredora, inmobiliaria o
 * agente».
 *
 * El formulario de «Publicar» no promete un correo al equipo, pero hasta ahora
 * una solicitud solo existía si alguien abría `/admin/solicitudes`: el panel la
 * mostraba, nadie se enteraba. Este módulo arma ese aviso para que la bandeja
 * del equipo sea el disparador y el panel el lugar de trabajo.
 *
 * Es un módulo puro (sin red ni base) porque lo único que vale la pena revisar
 * en un test es el correo que el equipo va a leer: qué dice el asunto, qué
 * datos trae y que un nombre con `<` no rompa el HTML.
 *
 * Reglas:
 * - Solo los tres registros (corredora, inmobiliaria, agente). Una solicitud de
 *   propietario llega igual al panel y no manda correo, porque no es un alta de
 *   cuenta: es una propiedad que busca corredora.
 * - Todo lo que escribió la persona pasa por `escapeHtml` antes del HTML.
 * - El enlace es al panel, no a la ficha pública: el aviso es para el equipo y
 *   la solicitud no tiene una página pública.
 */

import { escapeHtml } from './alertEmail';
import {
  SOLICITUD_COVERAGE_LABELS,
  isSolicitudCoverage,
  type NormalizedSolicitud,
  type SolicitudKind,
} from '@/lib/data/solicitudes';

/** Título corto del camino, para el asunto del correo. */
const KIND_SUBJECT: Record<Exclude<SolicitudKind, 'propuestas'>, string> = {
  corredora: 'Corredora',
  inmobiliaria: 'Inmobiliaria',
  agente: 'Agente independiente',
};

/** Los tres caminos que avisan al equipo; `propuestas` queda fuera. */
export type NotifiableSolicitud = NormalizedSolicitud & {
  kind: Exclude<SolicitudKind, 'propuestas'>;
};

export interface SolicitudEmailInput {
  /** Solicitud ya validada y guardada (sin id/estado: eso lo pone la base). */
  solicitud: NotifiableSolicitud;
  /** Folio devuelto por el alta; `null` si el entorno no lo devolvió. */
  id: string | null;
  siteUrl: string;
}

export interface BuiltSolicitudEmail {
  subject: string;
  text: string;
  html: string;
}

/** Campos legibles del aviso, en el orden en que se leen. */
function detailLines(solicitud: NormalizedSolicitud): [string, string][] {
  const { payload } = solicitud;
  const lines: [string, string][] = [];

  if (solicitud.company) lines.push(['Empresa', solicitud.company]);
  if (payload.rut) lines.push(['RUT', String(payload.rut)]);
  if (payload.role) lines.push(['Cargo', String(payload.role)]);

  const coverage = isSolicitudCoverage(payload.coverage)
    ? SOLICITUD_COVERAGE_LABELS[payload.coverage]
    : null;
  if (coverage) lines.push(['Alcance', coverage]);

  if (payload.coverage === 'regional' && Array.isArray(payload.regions)) {
    const regions = payload.regions.filter(
      (region): region is string => typeof region === 'string'
    );
    if (regions.length > 0) lines.push(['Regiones', regions.join(', ')]);
  }

  lines.push(['Correo', solicitud.email]);
  lines.push(['Teléfono', solicitud.phone]);
  if (payload.website) lines.push(['Sitio web', String(payload.website)]);
  return lines;
}

/**
 * ¿Este camino manda aviso al equipo? La solicitud de propietario también es
 * un alta del formulario, pero no crea una cuenta ni hay que acreditarla.
 */
export function notifyOnSolicitud(
  solicitud: NormalizedSolicitud
): solicitud is NotifiableSolicitud {
  return solicitud.kind !== 'propuestas';
}

export function buildSolicitudEmail({
  solicitud,
  id,
  siteUrl,
}: SolicitudEmailInput): BuiltSolicitudEmail {
  const kindLabel = KIND_SUBJECT[solicitud.kind];

  const who = solicitud.company || solicitud.name;
  const subject = `Nueva solicitud · ${kindLabel} · ${who}`;
  const lines = detailLines(solicitud);
  const panelUrl = `${siteUrl}/admin/solicitudes`;

  const text = [
    `Entró una solicitud nueva de ${kindLabel.toLowerCase()}.`,
    '',
    ...lines.map(([label, value]) => `${label}: ${value}`),
    ...(solicitud.message ? ['', 'Mensaje:', solicitud.message] : []),
    ...(id ? ['', `Folio: ${id}`] : []),
    '',
    `Revisarla en el panel: ${panelUrl}`,
    '(El panel pide sesión de administrador.)',
    '',
    'Rix7 — Portal inmobiliario',
  ].join('\n');

  const rowsHtml = lines
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:12px;width:110px;vertical-align:top">${escapeHtml(label)}</td>
          <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:14px;font-weight:600">${escapeHtml(value)}</td>
        </tr>`
    )
    .join('');

  const messageHtml = solicitud.message
    ? `
      <div style="margin-top:20px">
        <div style="color:#64748b;font-size:12px;margin-bottom:4px">Mensaje</div>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;color:#334155;font-size:13px;line-height:1.6;white-space:pre-wrap">${escapeHtml(solicitud.message)}</div>
      </div>`
    : '';

  const html = `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0">
      <div style="padding:24px 24px 8px">
        <div style="font-size:13px;font-weight:800;letter-spacing:.08em;color:#1d4ed8;text-transform:uppercase">Rix7</div>
        <h1 style="margin:8px 0 4px;font-size:20px;color:#0f172a">Nueva solicitud de ${escapeHtml(kindLabel.toLowerCase())}</h1>
        <p style="margin:0;color:#475569;font-size:14px">
          ${escapeHtml(solicitud.name)} dejó sus datos en el formulario de registro.
        </p>
      </div>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="padding:8px 24px">
        ${rowsHtml}
      </table>
      <div style="padding:0 24px">${messageHtml}</div>
      <div style="padding:20px 24px 24px">
        <a href="${panelUrl}"
           style="display:inline-block;background:#1d4ed8;color:#ffffff;font-size:13px;font-weight:700;padding:10px 18px;border-radius:10px;text-decoration:none">
          Revisar en el panel
        </a>
        <p style="margin:16px 0 0;color:#94a3b8;font-size:11px;line-height:1.6">
          ${id ? `Folio ${escapeHtml(id)}. ` : ''}Este aviso se envía solo por los registros de corredora,
          inmobiliaria y agente; las solicitudes de propietario quedan en el panel sin correo.
        </p>
      </div>
    </div>
  </body>
</html>`;

  return { subject, text, html };
}
