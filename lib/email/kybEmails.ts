/**
 * Correos del onboarding KYB.
 *
 * Uno por hito del flujo, construidos en un módulo puro para poder revisarlos
 * en un test en vez de descubrirlos en una bandeja. El de
 * «Pendiente de información» es el más importante: lleva las preguntas
 * concretas y el enlace con token para responderlas.
 *
 * Todo lo que viene de la empresa se escapa antes de entrar al HTML.
 */

import { escapeHtml } from './alertEmail';
import { formatPlanPrice, KYB_PLANS } from '@/lib/kyb/plans';
import type { KybQuestion } from '@/lib/kyb/status';

export interface BuiltKybEmail {
  subject: string;
  text: string;
  html: string;
}

/** Enlace de la pantalla de alta: el backend expone el estado con el token. */
export function kybAccessUrl(siteUrl: string, token: string): string {
  return `${siteUrl.replace(/\/+$/, '')}/empresas/onboarding?token=${encodeURIComponent(token)}`;
}

function shell({
  siteUrl,
  title,
  intro,
  body,
}: {
  siteUrl: string;
  title: string;
  intro: string;
  body: string;
}): string {
  return `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e2e8f0">
      <div style="background:#0f172a;padding:26px 24px">
        <div style="font-size:22px;font-weight:900;color:#ffffff;letter-spacing:-.02em">
          Rix<span style="color:#3b82f6">7</span>
        </div>
        <div style="color:#94a3b8;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;margin-top:6px">
          Alta de empresas
        </div>
      </div>
      <div style="padding:26px 24px 8px">
        <h1 style="margin:0 0 8px;font-size:21px;color:#0f172a">${escapeHtml(title)}</h1>
        <p style="margin:0;color:#475569;font-size:14px;line-height:1.65">${intro}</p>
      </div>
      <div style="padding:18px 24px 28px">${body}</div>
      <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 24px">
        <p style="margin:0;color:#94a3b8;font-size:11px;line-height:1.7">
          Recibes este correo porque una empresa inició su alta en Rix7.
          <br />
          <a href="${siteUrl}/legal/privacidad" style="color:#64748b">Privacidad</a>
          ·
          <a href="${siteUrl}/" style="color:#64748b">rix7.cl</a>
        </p>
      </div>
    </div>
  </body>
</html>`;
}

export function buildKybReceivedEmail({
  legalName,
  contactName,
  siteUrl,
}: {
  legalName: string;
  contactName: string;
  siteUrl: string;
}): BuiltKybEmail {
  const first = contactName.trim().split(/\s+/)[0] || '';
  const greeting = first ? `Hola ${first},` : 'Hola,';

  const text = [
    greeting,
    '',
    `Recibimos la solicitud de alta de ${legalName} en Rix7.`,
    'La evaluación es automática: verificamos el RUT y el registro comercial, la reputación',
    'pública, el sitio web y la coherencia del correo corporativo. No tienes que hacer nada',
    'por ahora; te escribimos con el resultado.',
    '',
    'Si necesitamos algún dato adicional, te lo pediremos en un solo correo con preguntas',
    'concretas y un enlace para responderlas.',
    '',
    'Rix7 — Alta de empresas',
    siteUrl,
  ].join('\n');

  return {
    subject: `Recibimos tu solicitud de alta en Rix7 (${legalName})`,
    text,
    html: shell({
      siteUrl,
      title: 'Recibimos tu solicitud',
      intro: `${escapeHtml(greeting)} recibimos la solicitud de <strong>${escapeHtml(legalName)}</strong>. La evaluación es automática y no necesitas hacer nada por ahora.`,
      body: `
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:14px 16px;color:#1e3a8a;font-size:13px;line-height:1.6">
          Verificamos el RUT y el registro comercial, la reputación pública, el sitio web y la
          coherencia del correo corporativo. Si hace falta un dato, te lo pedimos en un correo
          con preguntas concretas.
        </div>
        <p style="margin:18px 0 0;color:#64748b;font-size:12px;line-height:1.6">
          No compartas este correo: identifica el trámite de tu empresa.
        </p>`,
    }),
  };
}

export function buildKybPendingEmail({
  legalName,
  contactName,
  questions,
  token,
  siteUrl,
}: {
  legalName: string;
  contactName: string;
  questions: KybQuestion[];
  token: string;
  siteUrl: string;
}): BuiltKybEmail {
  const link = kybAccessUrl(siteUrl, token);
  const first = contactName.trim().split(/\s+/)[0] || '';
  const greeting = first ? `Hola ${first},` : 'Hola,';

  const listText = questions.map((question, index) => `${index + 1}. ${question.question}`).join('\n');
  const text = [
    greeting,
    '',
    `Para continuar con el alta de ${legalName} necesitamos que aclares lo siguiente:`,
    '',
    listText,
    '',
    'Responde en este enlace (vale 7 días):',
    link,
    '',
    'Cuando envíes tus respuestas, la evaluación se repite automáticamente.',
    '',
    'Rix7 — Alta de empresas',
    siteUrl,
  ].join('\n');

  const listHtml = questions
    .map(
      (question, index) => `
        <li style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.6">
          <strong style="color:#0f172a">${index + 1}.</strong> ${escapeHtml(question.question)}
        </li>`
    )
    .join('');

  return {
    subject: `Falta información para el alta de ${legalName} en Rix7`,
    text,
    html: shell({
      siteUrl,
      title: 'Necesitamos algunos datos',
      intro: `${escapeHtml(greeting)} para continuar con el alta de <strong>${escapeHtml(legalName)}</strong> necesitamos que aclares estos puntos.`,
      body: `
        <ul style="margin:0;padding-left:20px">${listHtml}</ul>
        <div style="margin:22px 0 0">
          <a href="${link}" style="display:inline-block;background:#2563eb;color:#ffffff;font-size:14px;font-weight:700;padding:12px 22px;border-radius:12px;text-decoration:none">
            Responder ahora
          </a>
        </div>
        <p style="margin:14px 0 0;color:#64748b;font-size:12px;line-height:1.6">
          El enlace vale 7 días. Cuando envíes tus respuestas, la evaluación se repite
          automáticamente y te contamos el resultado.
        </p>`,
    }),
  };
}

export function buildKybAcceptedEmail({
  legalName,
  contactName,
  token,
  siteUrl,
}: {
  legalName: string;
  contactName: string;
  token: string;
  siteUrl: string;
}): BuiltKybEmail {
  const link = kybAccessUrl(siteUrl, token);
  const first = contactName.trim().split(/\s+/)[0] || '';
  const greeting = first ? `Hola ${first},` : 'Hola,';

  const plansText = KYB_PLANS.map(
    (plan) =>
      `• ${plan.name} — ${formatPlanPrice(plan.priceClp)}/mes · ${plan.listings} publicaciones · ${plan.users} usuario(s)`
  ).join('\n');

  const text = [
    greeting,
    '',
    `La solicitud de ${legalName} quedó aceptada.`,
    'Elige el plan con el que quieres operar en este enlace (vale 7 días):',
    link,
    '',
    'Planes disponibles:',
    plansText,
    '',
    'Al confirmar el plan creamos el acceso al panel de publicaciones y te enviamos el enlace',
    'para entrar.',
    '',
    'Rix7 — Alta de empresas',
    siteUrl,
  ].join('\n');

  const plansHtml = KYB_PLANS.map(
    (plan) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #e2e8f0">
          <div style="color:#0f172a;font-size:14px;font-weight:700">${escapeHtml(plan.name)}</div>
          <div style="color:#64748b;font-size:12px">${plan.listings} publicaciones · ${plan.users} usuario(s)</div>
        </td>
        <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;text-align:right;color:#0f172a;font-size:14px;font-weight:700;white-space:nowrap">
          ${escapeHtml(formatPlanPrice(plan.priceClp))}<span style="color:#94a3b8;font-size:11px;font-weight:400">/mes</span>
        </td>
      </tr>`
  ).join('');

  return {
    subject: `Tu empresa fue aceptada: elige tu plan en Rix7 (${legalName})`,
    text,
    html: shell({
      siteUrl,
      title: '¡Solicitud aceptada!',
      intro: `${escapeHtml(greeting)} <strong>${escapeHtml(legalName)}</strong> quedó aceptada en la verificación. Elige el plan con el que quieres operar.`,
      body: `
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">${plansHtml}</table>
        <div style="margin:22px 0 0">
          <a href="${link}" style="display:inline-block;background:#2563eb;color:#ffffff;font-size:14px;font-weight:700;padding:12px 22px;border-radius:12px;text-decoration:none">
            Elegir plan y activar mi panel
          </a>
        </div>
        <p style="margin:14px 0 0;color:#64748b;font-size:12px;line-height:1.6">
          El enlace vale 7 días. Al confirmar el plan habilitamos el acceso al panel de
          publicaciones de tu empresa.
        </p>`,
    }),
  };
}

export function buildKybEvaluatingEmail({
  legalName,
  siteUrl,
}: {
  legalName: string;
  siteUrl: string;
}): BuiltKybEmail {
  return {
    subject: `Estamos reevaluando la solicitud de ${legalName}`,
    text: `Recibimos las respuestas de ${legalName}. La evaluación se está repitiendo automáticamente y te escribimos con el resultado.\n\nRix7 — Alta de empresas\n${siteUrl}`,
    html: shell({
      siteUrl,
      title: 'Recibimos tus respuestas',
      intro: `La evaluación de <strong>${escapeHtml(legalName)}</strong> se está repitiendo con la información que enviaste. Te escribimos con el resultado.`,
      body: '',
    }),
  };
}

export function buildKybActivatedEmail({
  legalName,
  planName,
  panelUrl,
  magicLink,
  siteUrl,
}: {
  legalName: string;
  planName: string;
  panelUrl: string;
  magicLink?: string;
  siteUrl: string;
}): BuiltKybEmail {
  const accessLine = magicLink
    ? `Entra directo con este enlace de un solo uso:\n${magicLink}`
    : `Entra con el correo de la empresa desde ${panelUrl}`;

  const text = [
    `El alta de ${legalName} quedó completa con el plan ${planName}.`,
    '',
    'Tu panel de publicaciones ya está habilitado:',
    panelUrl,
    '',
    accessLine,
    '',
    'Desde el panel puedes publicar propiedades, editar tus fichas y ver los contactos que',
    'recibes. El enlace de acceso es personal: no lo reenvíes.',
    '',
    'Rix7 — Alta de empresas',
    siteUrl,
  ].join('\n');

  const ctaHref = magicLink || panelUrl;

  return {
    subject: `Tu panel de Rix7 está habilitado (${legalName})`,
    text,
    html: shell({
      siteUrl,
      title: 'Tu panel está listo',
      intro: `El alta de <strong>${escapeHtml(legalName)}</strong> quedó completa con el plan <strong>${escapeHtml(planName)}</strong>.`,
      body: `
        <div style="margin:0 0 20px">
          <a href="${escapeHtml(ctaHref)}" style="display:inline-block;background:#2563eb;color:#ffffff;font-size:14px;font-weight:700;padding:12px 22px;border-radius:12px;text-decoration:none">
            Entrar al panel
          </a>
        </div>
        <p style="margin:0;color:#475569;font-size:13px;line-height:1.65">
          Desde el panel puedes publicar propiedades, editar tus fichas y ver los contactos que
          recibes. El enlace es personal: no lo reenvíes.
        </p>`,
    }),
  };
}
