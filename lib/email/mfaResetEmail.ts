/**
 * Correo al socio cuando el equipo le quita la verificación en dos pasos.
 *
 * Lo recibe alguien que acaba de perder su aplicación de códigos: el correo no
 * lo asusta ni le pide hacer nada urgente, le dice tres cosas: qué se cambió,
 * que nada más cambió, y cómo volver a activarlo cuando tenga su teléfono.
 *
 * Incluye la salida por si el reset no era para esa persona («si no pediste
 * esto, responde este correo»): es la única señal que va a tener de que alguien
 * tocó su cuenta.
 */

import { escapeHtml } from './alertEmail';
import { shell } from './kybEmails';

export interface BuiltMfaResetEmail {
  subject: string;
  text: string;
  html: string;
}

export function buildMfaResetEmail({
  companyName,
  panelUrl,
  siteUrl,
}: {
  companyName: string;
  panelUrl: string;
  siteUrl: string;
}): BuiltMfaResetEmail {
  const text = [
    `Quitamos la verificación en dos pasos de tu cuenta de Rix7 en ${companyName}.`,
    '',
    'Lo hicimos desde el equipo de Rix7 porque ya no podías generar los códigos, por',
    'ejemplo al cambiar de teléfono o al reinstalar la aplicación.',
    '',
    'Tu cuenta sigue igual: tus publicaciones, tus usuarios y tu plan no cambian. Lo único',
    'que cambia es que, al entrar, ya no te va a pedir el código.',
    '',
    `Cuando tengas la aplicación a mano, puedes volver a activarla desde tu cuenta:\n${panelUrl}`,
    '',
    'Si no pediste esto, responde este correo y revisamos el acceso a tu cuenta.',
    '',
    'Rix7 — Cuenta de empresas',
    siteUrl,
  ].join('\n');

  return {
    subject: 'Desactivamos la verificación en dos pasos de tu cuenta de Rix7',
    text,
    html: shell({
      siteUrl,
      title: 'Verificación en dos pasos desactivada',
      intro: `Quitamos la verificación en dos pasos de tu cuenta de Rix7 en <strong>${escapeHtml(companyName)}</strong>.`,
      body: `
        <p style="margin:0 0 14px;color:#334155;font-size:14px;line-height:1.7">
          Lo hicimos desde el equipo de Rix7 porque ya no podías generar los códigos, por
          ejemplo al cambiar de teléfono o al reinstalar la aplicación.
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:13px">Qué cambió</td>
            <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;text-align:right;color:#0f172a;font-size:14px;font-weight:700">
              Ya no se te pide el código al entrar
            </td>
          </tr>
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:13px">Qué sigue igual</td>
            <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;text-align:right;color:#0f172a;font-size:14px;font-weight:700">
              Tu cuenta, tu plan y tus publicaciones
            </td>
          </tr>
        </table>
        <div style="margin:22px 0 0">
          <a href="${escapeHtml(panelUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;font-size:14px;font-weight:700;padding:12px 22px;border-radius:12px;text-decoration:none">
            Volver a activarla
          </a>
        </div>
        <p style="margin:14px 0 0;color:#64748b;font-size:12px;line-height:1.65">
          Si no pediste esto, responde este correo y revisamos el acceso a tu cuenta.
        </p>`,
    }),
  };
}
