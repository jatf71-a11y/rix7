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
import { formatPlanPrice } from '@/lib/kyb/plans';
import type { AltaPlanSummary, SubscriptionTerms } from '@/lib/kyb/proposal';
import type { LeadBracket } from '@/lib/kyb/planPricing';
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

/** Enlace de la propuesta comercial: se acepta o se rechaza ahí. */
export function kybProposalUrl(siteUrl: string, token: string): string {
  return `${siteUrl.replace(/\/+$/, '')}/empresas/propuesta?token=${encodeURIComponent(token)}`;
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

/**
 * Acuse de recibo **y** aviso de que la evaluación ya arrancó.
 *
 * Cubre los dos primeros pasos del flujo en un solo mensaje: acusar recibo y
 * decir que se está evaluando llegan con segundos de diferencia —el motor corre
 * en la misma petición del alta—, así que dos correos seguidos se leerían como
 * ruido. El contenido de los dos pasos está: que la solicitud fue recibida, que
 * se va a evaluar, y con qué datos (los que entregó la empresa y los que Rix7
 * consigue por su cuenta).
 */
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
    'La evaluación es automática y ya está en curso. No tienes que hacer nada por ahora:',
    'te escribimos con el resultado.',
    '',
    'Qué miramos, con los datos que nos entregaste:',
    '- el RUT y el registro comercial,',
    '- el sitio web y el correo corporativo,',
    '- el alcance y las regiones donde trabajas.',
    '',
    'Y con los datos que conseguimos por nuestra cuenta:',
    '- la actividad y la dotación de la empresa en el SII,',
    '- la reputación pública y las menciones en la web,',
    '- si el correo pertenece al dominio del sitio.',
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
      intro: `${escapeHtml(greeting)} recibimos la solicitud de <strong>${escapeHtml(legalName)}</strong> y ya está en evaluación. La evaluación es automática y no necesitas hacer nada por ahora.`,
      body: `
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:14px 16px;color:#1e3a8a;font-size:13px;line-height:1.6">
          <strong style="display:block;margin-bottom:6px">Con los datos que nos entregaste</strong>
          El RUT y el registro comercial, el sitio web, el correo corporativo, el alcance y las
          regiones donde trabajas.
          <strong style="display:block;margin:12px 0 6px">Con los datos que conseguimos por nuestra cuenta</strong>
          La actividad y la dotación de la empresa en el SII, la reputación pública y las menciones
          en la web, y si el correo pertenece al dominio del sitio.
        </div>
        <p style="margin:18px 0 0;color:#64748b;font-size:12px;line-height:1.6">
          Si hace falta un dato, te lo pedimos en un correo con preguntas concretas y un enlace para
          responderlas. No compartas este correo: identifica el trámite de tu empresa.
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
  plan,
  commercial = null,
}: {
  legalName: string;
  contactName: string;
  token: string;
  siteUrl: string;
  /**
   * El plan de la propuesta aceptada, con los montos que el candidato ya vio.
   *
   * Antes este correo listaba los tres planes del catálogo con precios escritos
   * en el código: los mismos números que el panel había dejado de usar. El
   * correo tiene que decir lo mismo que la pantalla del alta.
   */
  plan: AltaPlanSummary;
  /**
   * Las condiciones que el candidato aceptó además del plan (CCA y captación).
   *
   * Es el correo del paso **Alta**: lo que se confirma tiene que ser todo lo que
   * se definió en la propuesta, no solo la mensualidad. El CCA va en UF porque es
   * lo que el socio declaró; el monto en pesos depende de la UF del día.
   */
  commercial?: { ccaUf: number; ccaPct: number; captacionMonthlyClp: number | null } | null;
}): BuiltKybEmail {
  const link = kybAccessUrl(siteUrl, token);
  const first = contactName.trim().split(/\s+/)[0] || '';
  const greeting = first ? `Hola ${first},` : 'Hola,';
  const monthly = formatPlanPrice(plan.monthlyClp);
  const alta = formatPlanPrice(plan.altaClp);

  const text = [
    greeting,
    '',
    `La solicitud de ${legalName} quedó aceptada.`,
    'Confirma el plan en este enlace (vale 7 días):',
    link,
    '',
    `Plan ${plan.planName} — ${monthly}/mes`,
    `Alta inicial: ${alta}`,
    `${plan.usuariosIncluidos} usuario(s) y ${plan.listings} publicaciones activas.`,
    ...commercialTextLines(commercial),
    '',
    'Al confirmar el plan creamos el acceso al panel de publicaciones y te enviamos el enlace',
    'para entrar. El alta queda cerrada cuando se registra el pago del período.',
    '',
    'Rix7 — Alta de empresas',
    siteUrl,
  ].join('\n');

  return {
    subject: `Tu empresa fue aceptada: confirma tu plan en Rix7 (${legalName})`,
    text,
    html: shell({
      siteUrl,
      title: '¡Solicitud aceptada!',
      intro: `${escapeHtml(greeting)} <strong>${escapeHtml(legalName)}</strong> quedó aceptada en la verificación. Confirma el plan de tu propuesta.`,
      body: `
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid #e2e8f0">
              <div style="color:#0f172a;font-size:14px;font-weight:700">${escapeHtml(plan.planName)}</div>
              <div style="color:#64748b;font-size:12px">${plan.listings} publicaciones · ${plan.usuariosIncluidos} usuario(s) · alta ${escapeHtml(alta)}</div>
            </td>
            <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;text-align:right;color:#0f172a;font-size:14px;font-weight:700;white-space:nowrap">
              ${escapeHtml(monthly)}<span style="color:#94a3b8;font-size:11px;font-weight:400">/mes</span>
            </td>
          </tr>
        </table>
        ${commercialHtml(commercial)}
        <div style="margin:22px 0 0">
          <a href="${link}" style="display:inline-block;background:#2563eb;color:#ffffff;font-size:14px;font-weight:700;padding:12px 22px;border-radius:12px;text-decoration:none">
            Confirmar plan y activar mi panel
          </a>
        </div>
        <p style="margin:14px 0 0;color:#64748b;font-size:12px;line-height:1.6">
          El enlace vale 7 días. Al confirmar el plan habilitamos el acceso al panel de
          publicaciones de tu empresa; el alta queda cerrada cuando se registra el pago.
        </p>`,
    }),
  };
}

/** Líneas de texto con el CCA y la captación aceptados; vacío si no hay nada. */
function commercialTextLines(
  commercial: { ccaUf: number; ccaPct: number; captacionMonthlyClp: number | null } | null
): string[] {
  if (!commercial) return [];
  return [
    '',
    `CCA estimado: UF ${formatCcaNumber(commercial.ccaUf)} (${commercial.ccaPct}% del valor base).`,
    'El monto en pesos se calcula con la UF del día: cuando cargues tus propiedades el sistema lo',
    'recalcula solo.',
    ...(commercial.captacionMonthlyClp !== null
      ? [`Captación de leads: ${formatPlanPrice(commercial.captacionMonthlyClp)} al mes.`]
      : []),
  ];
}

/** Bloque HTML con las mismas condiciones. */
function commercialHtml(
  commercial: { ccaUf: number; ccaPct: number; captacionMonthlyClp: number | null } | null
): string {
  if (!commercial) return '';

  const captacion =
    commercial.captacionMonthlyClp !== null
      ? `<p style="margin:4px 0 0;color:#475569;font-size:12px">Captación de leads: <strong>${escapeHtml(formatPlanPrice(commercial.captacionMonthlyClp))} /mes</strong></p>`
      : '';

  return `<div style="margin:16px 0 0;padding:12px 14px;background:#f8fafc;border-radius:12px;color:#475569;font-size:12px;line-height:1.65">
          <p style="margin:0">
            <strong style="color:#0f172a">CCA estimado:</strong> UF ${escapeHtml(formatCcaNumber(commercial.ccaUf))}
            (${escapeHtml(String(commercial.ccaPct))}% del valor base). El monto en pesos se calcula
            con la UF del día y se recalcula cuando cargues tus propiedades.
          </p>
          ${captacion}
        </div>`;
}

/** CCA en UF con separador de miles, sin decimales innecesarios. */
function formatCcaNumber(value: number): string {
  return new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(
    Number.isFinite(value) ? value : 0
  );
}

/**
 * Rechazo del alta.
 *
 * Es el único correo del flujo que cierra la puerta, así que lleva el motivo
 * escrito por el equipo tal cual: sin él, la empresa no tiene nada que corregir
 * ni forma de discutirlo. La invitación a responder el correo no es cortesía —
 * un rechazo por un dato mal leído se arregla así, sin volver a empezar.
 */
export function buildKybRejectedEmail({
  legalName,
  contactName,
  reason,
  siteUrl,
}: {
  legalName: string;
  contactName: string;
  reason: string;
  siteUrl: string;
}): BuiltKybEmail {
  const first = contactName.trim().split(/\s+/)[0] || '';
  const greeting = first ? `Hola ${first},` : 'Hola,';

  const text = [
    greeting,
    '',
    `Revisamos la solicitud de ${legalName} y, por ahora, no podemos darle curso.`,
    '',
    'Motivo:',
    reason,
    '',
    'Si crees que hay un error o tienes antecedentes que no consideramos, responde este',
    'correo y lo revisamos.',
    '',
    'Rix7 — Alta de empresas',
    siteUrl,
  ].join('\n');

  return {
    subject: `Sobre el alta de ${legalName} en Rix7`,
    text,
    html: shell({
      siteUrl,
      title: 'No pudimos continuar con el alta',
      intro: `${escapeHtml(greeting)} revisamos la solicitud de <strong>${escapeHtml(legalName)}</strong> y, por ahora, no podemos darle curso.`,
      body: `
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:14px 16px;color:#7f1d1d;font-size:13px;line-height:1.65">
          <strong style="display:block;margin-bottom:4px">Motivo</strong>
          ${escapeHtml(reason)}
        </div>
        <p style="margin:18px 0 0;color:#64748b;font-size:12px;line-height:1.6">
          Si crees que hay un error o tienes antecedentes que no consideramos, responde este
          correo y lo revisamos.
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

/**
 * «Aceptada y calificada»: el correo del paso **Calificado**.
 *
 * Cubre los pasos 4 y 5 del flujo, que ocurren en la misma corrida: la solicitud
 * quedó aceptada **y** calificada. Lleva la calificación en función de lo que se
 * verificó, el perfil de socio que le corresponde (profesional independiente,
 * corredora o inmobiliaria) y las condiciones completas de la suscripción —alta,
 * mensualidad, usuarios y publicaciones— con los montos de **Planes**.
 *
 * Se pide un «De acuerdo» explícito porque es la primera vez que la persona ve la
 * plata: la propuesta con el enlace de aceptación llega a continuación, y sin ese
 * sí no se mueve nada.
 */
export function buildKybQualifiedEmail({
  legalName,
  contactName,
  siteUrl,
  terms,
}: {
  legalName: string;
  contactName: string;
  siteUrl: string;
  /** Perfil de socio y condiciones de la suscripción, con los montos de Planes. */
  terms: SubscriptionTerms;
}): BuiltKybEmail {
  const first = contactName.trim().split(/\s+/)[0] || '';
  const greeting = first ? `Hola ${first},` : 'Hola,';
  const alta = formatPlanPrice(terms.altaClp);
  const monthly = formatPlanPrice(terms.monthlyClp);
  const captacion = formatPlanPrice(terms.captacionMonthlyClp);

  const text = [
    greeting,
    '',
    `La solicitud de ${legalName} quedó aceptada y calificada: pasó la verificación de`,
    'identidad, registro comercial y reputación.',
    '',
    `Perfil de socio: ${terms.profileLabel}`,
    '',
    'Condiciones de tu suscripción:',
    `- Plan ${terms.planName}: ${terms.listings} publicaciones activas.`,
    `- Alta inicial: ${alta} (pago único).`,
    `- Mensualidad: ${monthly} por mes.`,
    `- Usuarios incluidos en el panel: ${terms.usuariosIncluidos}.`,
    '',
    `Aparte de la suscripción, el CCA se cobra según la suma de tus publicaciones en UF,`,
    'y puedes contratar la captación de leads por ',
    `${captacion} al mes.`,
    '',
    'El paso siguiente es la propuesta comercial con el enlace para responder. Si estás de',
    'acuerdo con estas condiciones, responde ese correo con «De acuerdo» y seguimos con el',
    'alta.',
    '',
    'Rix7 — Alta de empresas',
    siteUrl,
  ].join('\n');

  const row = (label: string, value: string) => `
          <tr>
            <td style="padding:9px 0;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:13px">${escapeHtml(label)}</td>
            <td style="padding:9px 0;border-bottom:1px solid #e2e8f0;text-align:right;color:#0f172a;font-size:13px;font-weight:700;white-space:nowrap">${escapeHtml(value)}</td>
          </tr>`;

  return {
    subject: `Tu empresa quedó calificada: estas son tus condiciones (${legalName})`,
    text,
    html: shell({
      siteUrl,
      title: 'Tu empresa quedó calificada',
      intro: `${escapeHtml(greeting)} <strong>${escapeHtml(legalName)}</strong> quedó aceptada y pasó la verificación de identidad y reputación. Este es el perfil y la suscripción que te corresponden.`,
      body: `
        <p style="margin:0 0 14px;color:#0f172a;font-size:13px;line-height:1.65">
          Perfil de socio: <strong>${escapeHtml(terms.profileLabel)}</strong>
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          ${row('Plan', terms.planName)}
          ${row('Publicaciones activas', String(terms.listings))}
          ${row('Usuarios incluidos', String(terms.usuariosIncluidos))}
          ${row('Alta inicial (pago único)', alta)}
          ${row('Mensualidad', `${monthly} /mes`)}
          ${row('Captación de leads (opcional)', `${captacion} /mes`)}
        </table>
        <p style="margin:14px 0 0;color:#475569;font-size:13px;line-height:1.65">
          Aparte de la suscripción, el <strong>CCA</strong> se cobra según la suma de tus
          publicaciones en UF, y en la propuesta eliges si contratas la captación de leads.
        </p>
        <p style="margin:14px 0 0;color:#64748b;font-size:12px;line-height:1.6">
          Te enviamos la propuesta comercial con el enlace para responder en los próximos días.
          Si estás de acuerdo con estas condiciones, responde con «De acuerdo» y seguimos con el alta.
        </p>`,
    }),
  };
}

/**
 * El plan de captación, explicado.
 *
 * Se manda cuando el socio lo acepta, porque es el producto que más se malentiende:
 * no es «publicar más», es pagar por recibir leads. El correo separa las tres
 * piezas (suscripción mensual, acceso a leads de venta y acceso a leads de
 * arriendo) y muestra la tabla de precios con los tramos vigentes, para que no
 * haya una factura sorpresa.
 */
export function buildKybCaptacionEmail({
  legalName,
  contactName,
  siteUrl,
  profileLabel,
  monthlyClp,
  ventas,
  arriendos,
}: {
  legalName: string;
  contactName: string;
  siteUrl: string;
  profileLabel: string;
  monthlyClp: number;
  ventas: readonly LeadBracket[];
  arriendos: readonly LeadBracket[];
}): BuiltKybEmail {
  const first = contactName.trim().split(/\s+/)[0] || '';
  const greeting = first ? `Hola ${first},` : 'Hola,';

  const ventasLines = ventas.map(
    (bracket) =>
      `- ${ventasRange(bracket)}: ${formatPlanPrice(bracket.priceClp)} por lead`
  );
  const arriendosLines = arriendos.map(
    (bracket) => `- ${arriendosRange(bracket)}: ${formatPlanPrice(bracket.priceClp)} por lead`
  );

  const text = [
    greeting,
    '',
    `Activamos el plan de captación de ${legalName}. Tiene tres componentes:`,
    '',
    `1. Suscripción Captación Activa — perfil ${profileLabel}:`,
    `   ${formatPlanPrice(monthlyClp)} al mes. Es lo que te mantiene en el reparto de leads.`,
    '2. Acceso a leads de ventas — según el valor de la propiedad, en UF:',
    ...ventasLines,
    '3. Acceso a leads de arriendos — según el canon mensual:',
    ...arriendosLines,
    '',
    'El acceso se cobra por lead que decidas tomar, no por lead que te ofrezcamos: la',
    'suscripción te habilita, el consumo se paga aparte.',
    '',
    'Puedes pausar la captación cuando quieras escribiéndonos; la suscripción de',
    'publicaciones sigue igual.',
    '',
    'Rix7 — Alta de empresas',
    siteUrl,
  ].join('\n');

  const bracketRows = (brackets: readonly LeadBracket[], format: (b: LeadBracket) => string) =>
    brackets
      .map(
        (bracket) => `
        <tr>
          <td style="padding:7px 0;border-bottom:1px solid #e2e8f0;color:#475569;font-size:12px">${escapeHtml(format(bracket))}</td>
          <td style="padding:7px 0;border-bottom:1px solid #e2e8f0;text-align:right;color:#0f172a;font-size:12px;font-weight:700;white-space:nowrap">${escapeHtml(formatPlanPrice(bracket.priceClp))}</td>
        </tr>`
      )
      .join('');

  return {
    subject: `Cómo funciona el plan de captación de Rix7 (${legalName})`,
    text,
    html: shell({
      siteUrl,
      title: 'Tu plan de captación, en detalle',
      intro: `${escapeHtml(greeting)} activamos la captación de <strong>${escapeHtml(legalName)}</strong>. Tiene tres componentes y así se cobra cada uno.`,
      body: `
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:14px 16px;color:#1e3a8a;font-size:13px;line-height:1.6">
          <strong style="display:block;margin-bottom:4px">Suscripción Captación Activa · ${escapeHtml(profileLabel)}</strong>
          ${escapeHtml(formatPlanPrice(monthlyClp))} al mes. Te mantiene activo en el reparto de leads.
        </div>
        <p style="margin:18px 0 6px;color:#0f172a;font-size:13px;font-weight:700">Acceso a leads de ventas</p>
        <p style="margin:0 0 4px;color:#64748b;font-size:11px">Según el valor de la propiedad, en UF.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          ${bracketRows(ventas, ventasRange)}
        </table>
        <p style="margin:18px 0 6px;color:#0f172a;font-size:13px;font-weight:700">Acceso a leads de arriendos</p>
        <p style="margin:0 0 4px;color:#64748b;font-size:11px">Según el canon mensual del arriendo.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          ${bracketRows(arriendos, arriendosRange)}
        </table>
        <p style="margin:16px 0 0;color:#64748b;font-size:12px;line-height:1.6">
          El acceso se cobra por lead que decidas tomar, no por lead que te ofrezcamos. Puedes
          pausar la captación cuando quieras: la suscripción de publicaciones sigue igual.
        </p>`,
    }),
  };
}

/**
 * Rango de un tramo de venta, en UF.
 *
 * El último tramo empieza en el valor siguiente al corte anterior (40.001), y
 * decirlo así («más de UF 40.001») se lee peor que el corte mismo: se muestra
 * «más de UF 40.000», que es lo que dice la tabla de precios.
 */
function ventasRange(bracket: LeadBracket): string {
  const from = `UF ${bracket.from.toLocaleString('es-CL')}`;
  if (bracket.to !== null) {
    return `${from} – UF ${bracket.to.toLocaleString('es-CL')}`;
  }
  return bracket.from > 0
    ? `Más de UF ${(bracket.from - 1).toLocaleString('es-CL')}`
    : 'Cualquier valor';
}

/** Rango de un tramo de arriendo, en pesos de canon. */
function arriendosRange(bracket: LeadBracket): string {
  const from = formatPlanPrice(bracket.from);
  if (bracket.to !== null) return `${from} – ${formatPlanPrice(bracket.to)}`;
  return bracket.from > 0 ? `Más de ${formatPlanPrice(bracket.from - 1)}` : 'Cualquier canon';
}

/**
 * La propuesta comercial.
 *
 * Lleva los números concretos (alta inicial y mensualidad) y un enlace de un
 * solo uso para aceptarla o rechazarla. Es el correo que convierte una empresa
 * calificada en un alta: sin el enlace, la decisión queda en una llamada que no
 * deja rastro.
 */
export function buildKybProposalEmail({
  legalName,
  contactName,
  planName,
  altaClp,
  monthlyClp,
  note,
  token,
  siteUrl,
}: {
  legalName: string;
  contactName: string;
  planName: string;
  altaClp: number;
  monthlyClp: number;
  note: string | null;
  token: string;
  siteUrl: string;
}): BuiltKybEmail {
  const link = kybProposalUrl(siteUrl, token);
  const first = contactName.trim().split(/\s+/)[0] || '';
  const greeting = first ? `Hola ${first},` : 'Hola,';

  const text = [
    greeting,
    '',
    `Preparamos la propuesta comercial para ${legalName}.`,
    '',
    `Plan: ${planName}`,
    `Alta inicial: ${formatPlanPrice(altaClp)}`,
    `Mensualidad: ${formatPlanPrice(monthlyClp)}`,
    ...(note ? ['', note] : []),
    '',
    'Para aceptarla y seguir con el alta, entra a este enlace (vale 7 días):',
    link,
    '',
    'En el enlace también eliges el CCA —con tu estimación en UF— y si contratas el plan de',
    'captación de leads, que te explicamos aparte si lo tomas.',
    '',
    'Si los números no te sirven, desde el mismo enlace nos lo dices.',
    '',
    'Rix7 — Alta de empresas',
    siteUrl,
  ].join('\n');

  return {
    subject: `Tu propuesta comercial de Rix7 (${legalName})`,
    text,
    html: shell({
      siteUrl,
      title: 'Tu propuesta comercial',
      intro: `${escapeHtml(greeting)} preparamos la propuesta para <strong>${escapeHtml(legalName)}</strong>.`,
      body: `
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:14px;font-weight:700">
              ${escapeHtml(planName)}
            </td>
          </tr>
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:13px">Alta inicial</td>
            <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;text-align:right;color:#0f172a;font-size:14px;font-weight:700;white-space:nowrap">
              ${escapeHtml(formatPlanPrice(altaClp))}
            </td>
          </tr>
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:13px">Mensualidad</td>
            <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;text-align:right;color:#0f172a;font-size:14px;font-weight:700;white-space:nowrap">
              ${escapeHtml(formatPlanPrice(monthlyClp))}<span style="color:#94a3b8;font-size:11px;font-weight:400">/mes</span>
            </td>
          </tr>
        </table>
        ${note ? `<div style="margin:16px 0 0;padding:14px 16px;background:#f8fafc;border-radius:12px;color:#475569;font-size:13px;line-height:1.6">${escapeHtml(note)}</div>` : ''}
        <div style="margin:22px 0 0">
          <a href="${link}" style="display:inline-block;background:#2563eb;color:#ffffff;font-size:14px;font-weight:700;padding:12px 22px;border-radius:12px;text-decoration:none">
            Ver y responder la propuesta
          </a>
        </div>
        <p style="margin:14px 0 0;color:#64748b;font-size:12px;line-height:1.6">
          El enlace vale 7 días. Al aceptar, seguimos con el alta y te enviamos el acceso al panel.
        </p>`,
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

/**
 * Recordatorio de un alta detenida.
 *
 * No repite el correo del hito: el primero ya se leyó (o se perdió) y volver a
 * mandar el mismo asunto se lee como un error del sistema. Este dice en qué paso
 * está la empresa, que el enlace anterior puede haber vencido y cuánto falta
 * para que el alta se cierre por falta de respuesta.
 *
 * Lo dispara el job de solicitudes detenidas (`lib/data/socioNudges.ts`), no una
 * persona: por eso el tono es informativo y no reclama nada.
 */
export function buildKybReminderEmail({
  legalName,
  contactName,
  step,
  link,
  siteUrl,
  closingInDays,
}: {
  legalName: string;
  contactName: string;
  step: 'answers' | 'proposal' | 'activation';
  link: string;
  siteUrl: string;
  /** Días que faltan para el cierre automático; se omite si no aplica. */
  closingInDays?: number;
}): BuiltKybEmail {
  const first = contactName.trim().split(/\s+/)[0] || '';
  const greeting = first ? `Hola ${first},` : 'Hola,';

  const copy = {
    answers: {
      title: 'Seguimos esperando los datos',
      body: `la evaluación del alta de ${legalName} quedó detenida esperando las aclaraciones que te pedimos.`,
      cta: 'Responder ahora',
      subject: `Seguimos esperando los datos del alta de ${legalName}`,
    },
    proposal: {
      title: 'Tu propuesta sigue abierta',
      body: `la propuesta comercial de ${legalName} —plan y precios— está esperando tu respuesta.`,
      cta: 'Ver la propuesta',
      subject: `Tu propuesta de alta en Rix7 sigue abierta`,
    },
    activation: {
      title: 'Tu plan está a un paso',
      body: `aceptaste la propuesta de ${legalName}; falta confirmar el plan para habilitar el panel.`,
      cta: 'Elegir mi plan',
      subject: `Falta confirmar el plan de ${legalName} en Rix7`,
    },
  }[step];

  const closing =
    typeof closingInDays === 'number' && closingInDays > 0
      ? `Si no tenemos respuesta en ${closingInDays} días, cerramos el trámite y puedes volver a iniciarlo cuando quieras.`
      : 'Si necesitas ayuda, responde este correo.';

  const text = [
    greeting,
    '',
    `Te escribimos de nuevo porque ${copy.body}`,
    '',
    'El enlace anterior puede haber vencido: este es nuevo y vale 7 días.',
    'Responde acá:',
    link,
    '',
    closing,
    '',
    'Rix7 — Alta de empresas',
    siteUrl,
  ].join('\n');

  return {
    subject: copy.subject,
    text,
    html: shell({
      siteUrl,
      title: copy.title,
      intro: `${escapeHtml(greeting)} te escribimos de nuevo porque ${escapeHtml(copy.body)}`,
      body: `
        <div style="margin:0 0 20px">
          <a href="${link}" style="display:inline-block;background:#2563eb;color:#ffffff;font-size:14px;font-weight:700;padding:12px 22px;border-radius:12px;text-decoration:none">
            ${copy.cta}
          </a>
        </div>
        <p style="margin:0;color:#475569;font-size:13px;line-height:1.65">
          El enlace anterior puede haber vencido: este es nuevo y vale 7 días.
        </p>
        <p style="margin:12px 0 0;color:#64748b;font-size:12px;line-height:1.6">
          ${escapeHtml(closing)}
        </p>`,
    }),
  };
}
