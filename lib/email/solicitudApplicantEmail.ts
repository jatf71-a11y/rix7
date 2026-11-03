/**
 * Correos al solicitante de un registro profesional.
 *
 * Hasta ahora estos registros solo avisaban **al equipo** (`solicitudEmail.ts`):
 * la persona dejaba sus datos y no volvía a saber nada hasta que alguien la
 * llamaba. Como el registro ahora se evalúa solo, el correo es la única forma
 * que tiene de enterarse del resultado y, cuando falta un dato, de responderlo.
 *
 * Módulo puro (sin red ni base): lo único que vale la pena revisar en un test es
 * el correo que va a leer una persona —qué dice el asunto, si lleva las
 * preguntas concretas y el enlace— y que un nombre con `<` no rompa el HTML.
 *
 * El acuse de recibo va dentro del correo del resultado, no en uno aparte: los
 * dos salen con segundos de diferencia y dos mensajes seguidos se leen como
 * ruido, no como información.
 */

import { escapeHtml } from './alertEmail';

export interface BuiltSolicitudApplicantEmail {
  subject: string;
  text: string;
  html: string;
}

/** Página pública donde se responden las preguntas del registro. */
export function solicitudAnswerUrl(siteUrl: string, token: string): string {
  return `${siteUrl.replace(/\/+$/, '')}/socios/responder/${encodeURIComponent(token)}`;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || '';
}

function greeting(name: string): string {
  const first = firstName(name);
  return first ? `Hola ${first},` : 'Hola,';
}

function shell({
  title,
  intro,
  body,
  siteUrl,
}: {
  title: string;
  intro: string;
  body: string;
  siteUrl: string;
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
          Registro profesional
        </div>
      </div>
      <div style="padding:26px 24px 8px">
        <h1 style="margin:0 0 8px;font-size:21px;color:#0f172a">${escapeHtml(title)}</h1>
        <p style="margin:0;color:#475569;font-size:14px;line-height:1.65">${intro}</p>
      </div>
      <div style="padding:18px 24px 28px">${body}</div>
      <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 24px">
        <p style="margin:0;color:#94a3b8;font-size:11px;line-height:1.7">
          Recibes este correo porque dejaste tus datos en el registro profesional de Rix7.
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
 * Acuse de recibo del registro, con la evaluación ya en curso.
 *
 * Cubre los dos primeros pasos del flujo —**Recibida** y **En evaluación**— en un
 * solo mensaje. El autómata evalúa en la misma petición del formulario, así que
 * dos correos con segundos de diferencia se leerían como ruido: acá está lo que
 * cada paso tiene que informar, que la solicitud fue recibida, que se va a
 * evaluar y con qué datos (los que entregó la persona y los que Rix7 verifica
 * por su cuenta).
 */
export function buildSolicitudReceivedEmail({
  name,
  offerLabel,
  siteUrl,
}: {
  name: string;
  offerLabel: string;
  siteUrl: string;
}): BuiltSolicitudApplicantEmail {
  const hello = greeting(name);

  const text = [
    hello,
    '',
    `Recibimos ${offerLabel} en Rix7 y ya está en evaluación.`,
    'La evaluación es automática y no tienes que hacer nada por ahora: te escribimos con el',
    'resultado.',
    '',
    'Qué miramos, con los datos que nos entregaste: el RUT y el registro comercial, el correo',
    'y el sitio web, el alcance y las regiones donde trabajas.',
    '',
    'Y con los datos que conseguimos por nuestra cuenta: la actividad y el tamaño de la',
    'empresa, la reputación pública y las menciones en la web, y si el correo pertenece al',
    'dominio del sitio.',
    '',
    'Si falta algún dato, te lo pedimos en un correo con preguntas concretas y un enlace para',
    'responderlas.',
    '',
    'Rix7 — Registro profesional',
    siteUrl,
  ].join('\n');

  return {
    subject: `Recibimos tu registro en Rix7 y ya está en evaluación`,
    text,
    html: shell({
      siteUrl,
      title: 'Recibimos tu registro',
      intro: `${escapeHtml(hello)} recibimos ${escapeHtml(offerLabel)} y ya está <strong>en evaluación</strong>. La evaluación es automática y no tienes que hacer nada por ahora.`,
      body: `
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:14px 16px;color:#1e3a8a;font-size:13px;line-height:1.65">
          <strong style="display:block;margin-bottom:6px">Con los datos que nos entregaste</strong>
          El RUT y el registro comercial, el correo y el sitio web, el alcance y las regiones donde
          trabajas.
          <strong style="display:block;margin:12px 0 6px">Con los datos que conseguimos por nuestra cuenta</strong>
          La actividad y el tamaño de la empresa, la reputación pública y las menciones en la web, y
          si el correo pertenece al dominio del sitio.
        </div>
        <p style="margin:18px 0 0;color:#64748b;font-size:12px;line-height:1.6">
          Si falta algún dato, te lo pedimos en un correo con preguntas concretas y un enlace para
          responderlas. Después te contamos el resultado por este mismo correo.
        </p>`,
    }),
  };
}

/**
 * «Necesitamos que aclares estos puntos».
 *
 * Es el correo que reemplaza a la llamada del equipo: lleva las preguntas
 * exactas que fallaron en la evaluación, en el mismo orden, y un enlace con
 * token para responderlas. Sin ese enlace, pedir información volvería a dejar el
 * registro esperando a una persona.
 */
export function buildSolicitudPendingEmail({
  name,
  offerLabel,
  questions,
  link,
  siteUrl,
  reminder = false,
}: {
  name: string;
  offerLabel: string;
  questions: { id: string; question: string }[];
  link: string;
  siteUrl: string;
  /**
   * Segundo aviso: el primero no obtuvo respuesta. Cambia el asunto y el
   * arranque —repetir «falta un dato» como si fuera la primera vez confunde—
   * pero el enlace es nuevo y las preguntas son las mismas.
   */
  reminder?: boolean;
}): BuiltSolicitudApplicantEmail {
  const hello = greeting(name);
  const listText = questions.map((question, index) => `${index + 1}. ${question.question}`).join('\n');

  const text = [
    hello,
    '',
    reminder
      ? `Te escribimos de nuevo por ${offerLabel} en Rix7: la evaluación quedó esperando estos datos.`
      : `Recibimos ${offerLabel} en Rix7 y lo evaluamos automáticamente.`,
    'Para continuar necesitamos que aclares lo siguiente:',
    '',
    listText,
    '',
    'Responde en este enlace (vale 7 días):',
    link,
    '',
    'Cuando envíes tus respuestas, la evaluación se repite automáticamente y te contamos el resultado.',
    '',
    'Rix7 — Registro profesional',
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
    subject: reminder
      ? 'Tu registro en Rix7 sigue esperando un dato'
      : 'Falta un dato para tu registro en Rix7',
    text,
    html: shell({
      siteUrl,
      title: reminder ? 'Seguimos esperando estos datos' : 'Necesitamos algunos datos',
      intro: reminder
        ? `${escapeHtml(hello)} te escribimos de nuevo porque la evaluación de ${escapeHtml(offerLabel)} quedó esperando estos puntos. El enlace anterior puede haber vencido; este es nuevo.`
        : `${escapeHtml(hello)} recibimos ${escapeHtml(offerLabel)} y lo evaluamos automáticamente. Para continuar necesitamos que aclares estos puntos.`,
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

/** Registro aceptado: qué sigue, sin prometer un panel que todavía no existe. */
export function buildSolicitudAcceptedEmail({
  name,
  offerLabel,
  siteUrl,
}: {
  name: string;
  offerLabel: string;
  siteUrl: string;
}): BuiltSolicitudApplicantEmail {
  const hello = greeting(name);

  const text = [
    hello,
    '',
    `Tu registro en Rix7 quedó aceptado: ${offerLabel} pasó la evaluación automática.`,
    'Lo que sigue es la propuesta comercial: te enviamos el plan y los precios a este',
    'correo. Cuando la aceptes, eliges el plan y habilitas tu panel de publicaciones.',
    '',
    'Si necesitas corregir algún dato, responde este correo.',
    '',
    'Rix7 — Registro profesional',
    siteUrl,
  ].join('\n');

  return {
    subject: 'Tu registro en Rix7 quedó aceptado',
    text,
    html: shell({
      siteUrl,
      title: '¡Registro aceptado!',
      intro: `${escapeHtml(hello)} ${escapeHtml(offerLabel)} pasó la evaluación automática y quedó <strong>aceptado</strong>.`,
      body: `
        <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;padding:14px 16px;color:#065f46;font-size:13px;line-height:1.65">
          Lo que sigue es la propuesta comercial: te enviamos el plan y los precios a este
          correo. Cuando la aceptes, eliges el plan y habilitas tu panel de publicaciones.
        </div>
        <p style="margin:18px 0 0;color:#64748b;font-size:12px;line-height:1.6">
          Si necesitas corregir algún dato, responde este correo.
        </p>`,
    }),
  };
}

/**
 * Rechazo.
 *
 * Lo decide una persona, así que el motivo va escrito tal cual: sin él, quien lo
 * recibe no tiene nada que corregir ni forma de discutirlo. La invitación a
 * responder no es cortesía — un rechazo por un dato mal leído se arregla así, sin
 * volver a empezar.
 */
export function buildSolicitudRejectedEmail({
  name,
  offerLabel,
  reason,
  siteUrl,
}: {
  name: string;
  offerLabel: string;
  reason: string;
  siteUrl: string;
}): BuiltSolicitudApplicantEmail {
  const hello = greeting(name);

  const text = [
    hello,
    '',
    `Revisamos ${offerLabel} en Rix7 y, por ahora, no podemos darle curso.`,
    '',
    'Motivo:',
    reason,
    '',
    'Si crees que hay un error o tienes antecedentes que no consideramos, responde este',
    'correo y lo revisamos.',
    '',
    'Rix7 — Registro profesional',
    siteUrl,
  ].join('\n');

  return {
    subject: 'Sobre tu registro en Rix7',
    text,
    html: shell({
      siteUrl,
      title: 'No pudimos continuar con tu registro',
      intro: `${escapeHtml(hello)} revisamos ${escapeHtml(offerLabel)} y, por ahora, no podemos darle curso.`,
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
