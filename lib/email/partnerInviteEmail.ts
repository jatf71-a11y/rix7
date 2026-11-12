/**
 * Correo de invitación a la cuenta de un socio.
 *
 * Lo recibe alguien que **no** pidió nada: no hizo el alta ni eligió el plan, y
 * probablemente no conoce Rix7. Por eso el correo dice tres cosas concretas y
 * nada más: quién lo invita, a qué empresa entra y qué puede hacer ahí. El
 * enlace es de un solo uso y personal.
 *
 * El rol se escribe en palabras («administra la cuenta» / «publica
 * propiedades»): el rol técnico no le dice nada a quien recibe el correo.
 */

import { escapeHtml } from './alertEmail';
import { shell } from './kybEmails';

export interface BuiltPartnerInviteEmail {
  subject: string;
  text: string;
  html: string;
}

export function buildPartnerInviteEmail({
  companyName,
  roleLabel,
  usersIncluded,
  panelUrl,
  magicLink,
  siteUrl,
}: {
  companyName: string;
  /** Cómo se llama el rol en la pantalla: «Administra la cuenta», «Publica propiedades». */
  roleLabel: string;
  /** Usuarios que incluye el plan, para que se entienda el marco de la cuenta. */
  usersIncluded: number;
  panelUrl: string;
  magicLink?: string;
  siteUrl: string;
}): BuiltPartnerInviteEmail {
  const accessLine = magicLink
    ? `Entra directo con este enlace de un solo uso:\n${magicLink}`
    : `Entra con este correo desde ${panelUrl}`;

  const text = [
    `${companyName} te sumó a su cuenta de Rix7.`,
    '',
    `Tu rol: ${roleLabel}.`,
    `La cuenta incluye ${usersIncluded} ${usersIncluded === 1 ? 'usuario' : 'usuarios'}.`,
    '',
    'Rix7 es el portal donde la empresa publica y administra sus propiedades. Desde el',
    'panel ves las publicaciones de la empresa, los contactos que recibe y —si tu rol lo',
    'permite— los usuarios de la cuenta.',
    '',
    accessLine,
    '',
    'El enlace es personal: no lo reenvíes. Si no esperabas esta invitación, ignora este',
    'correo: sin entrar, la cuenta no queda activa.',
    '',
    'Rix7 — Cuenta de empresas',
    siteUrl,
  ].join('\n');

  const ctaHref = magicLink || panelUrl;

  return {
    subject: `${companyName} te invitó a su cuenta de Rix7`,
    text,
    html: shell({
      siteUrl,
      title: 'Te sumaron a una cuenta de Rix7',
      intro: `<strong>${escapeHtml(companyName)}</strong> te invitó a su cuenta en Rix7.`,
      body: `
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:13px">Tu rol</td>
            <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;text-align:right;color:#0f172a;font-size:14px;font-weight:700">
              ${escapeHtml(roleLabel)}
            </td>
          </tr>
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:13px">Usuarios del plan</td>
            <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;text-align:right;color:#0f172a;font-size:14px;font-weight:700">
              ${escapeHtml(String(usersIncluded))}
            </td>
          </tr>
        </table>
        <div style="margin:22px 0 0">
          <a href="${escapeHtml(ctaHref)}" style="display:inline-block;background:#2563eb;color:#ffffff;font-size:14px;font-weight:700;padding:12px 22px;border-radius:12px;text-decoration:none">
            Entrar al panel
          </a>
        </div>
        <p style="margin:14px 0 0;color:#64748b;font-size:12px;line-height:1.65">
          El enlace es personal: no lo reenvíes. Si no esperabas esta invitación, ignora este
          correo: sin entrar, la cuenta no queda activa.
        </p>`,
    }),
  };
}
