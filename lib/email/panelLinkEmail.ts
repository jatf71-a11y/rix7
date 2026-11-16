/**
 * Correo con el enlace propio del panel de un socio.
 *
 * Hasta acá el equipo copiaba la URL y la mandaba a mano (o abría su cliente de
 * correo con un `mailto:`), así que el aviso salía desde la casilla de quien
 * atendía, con el formato de su cliente y sin quedar registrado en ningún lado.
 * Este correo lo manda el servidor con la plantilla de Rix7, al correo de
 * contacto de la ficha.
 *
 * No es un correo de trámite —nadie perdió el acceso—, así que no pide nada
 * urgente: dice cuál es la dirección de esa corredora y con qué cuenta se entra.
 */

import { escapeHtml } from './alertEmail';
import { shell } from './kybEmails';

export interface BuiltPanelLinkEmail {
  subject: string;
  text: string;
  html: string;
}

export function buildPanelLinkEmail({
  companyName,
  panelUrl,
  siteUrl,
}: {
  companyName: string;
  panelUrl: string;
  siteUrl: string;
}): BuiltPanelLinkEmail {
  const text = [
    `Este es el enlace directo a tu panel de ${companyName} en Rix7:`,
    '',
    panelUrl,
    '',
    'Entra con la cuenta que vinculamos a tu corredora. Desde ahí publicas propiedades,',
    'ves los contactos que llegan y administras tu cuenta.',
    '',
    'Guarda el enlace en favoritos: no hace falta pasar por el botón del portal.',
    '',
    'Rix7 — Cuenta de empresas',
    siteUrl,
  ].join('\n');

  return {
    subject: `Tu panel de ${companyName} en Rix7`,
    text,
    html: shell({
      siteUrl,
      title: 'Tu panel en Rix7',
      intro: `Este es el enlace directo a tu panel de <strong>${escapeHtml(companyName)}</strong>.`,
      body: `
        <p style="margin:0 0 14px;color:#334155;font-size:14px;line-height:1.7">
          Entra con la cuenta que vinculamos a tu corredora. Desde ahí publicas propiedades,
          ves los contactos que llegan y administras tu cuenta.
        </p>
        <div style="margin:22px 0 0">
          <a href="${escapeHtml(panelUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;font-size:14px;font-weight:700;padding:12px 22px;border-radius:12px;text-decoration:none">
            Abrir mi panel
          </a>
        </div>
        <p style="margin:16px 0 0;color:#64748b;font-size:12px;line-height:1.65">
          Si el botón no abre, copia esta dirección en tu navegador:<br>
          <span style="color:#334155">${escapeHtml(panelUrl)}</span>
        </p>
        <p style="margin:12px 0 0;color:#64748b;font-size:12px;line-height:1.65">
          Guarda el enlace en favoritos: no hace falta pasar por el botón del portal.
        </p>`,
    }),
  };
}
