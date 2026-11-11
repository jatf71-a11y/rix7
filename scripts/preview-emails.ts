/**
 * Vista previa local de los correos al solicitante.
 *
 * Usa los constructores reales —no copias del texto— así que lo que se revisa es
 * exactamente lo que se envía: el asunto, el marcador «Etapa N de 7», la barra y
 * el cuerpo. Escribe un HTML autocontenido (cada correo en un iframe con
 * `srcdoc`) para abrirlo sin servidor ni sesión de administración.
 *
 *     npx vite-node -c vitest.config.ts scripts/preview-emails.ts
 *
 * El config de vitest es el que resuelve el alias `@/` que usan las plantillas;
 * esbuild se probó y no lo resuelve con este tsconfig.
 *
 * Es una herramienta de revisión: no se importa desde la app.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { sendEmail } from '../lib/email/sendEmail';

import {
  buildSolicitudAcceptedEmail,
  buildSolicitudEvaluatingEmail,
  buildSolicitudPendingEmail,
  buildSolicitudReceivedEmail,
  buildSolicitudRejectedEmail,
} from '../lib/email/solicitudApplicantEmail';
import {
  buildKybActivatedEmail,
  buildKybProposalEmail,
  buildKybQualifiedEmail,
  buildKybRejectedEmail,
  buildKybReminderEmail,
} from '../lib/email/kybEmails';

const siteUrl = 'https://rix7.cl';
const name = 'María Soto';
const offerLabel = 'tu registro de Corredora';
const legalName = 'Catedral Propiedades SpA';
const contactName = 'Ana Torres';
const answerLink = `${siteUrl}/socios/responder/token-de-ejemplo`;
const altaLink = `${siteUrl}/empresas/onboarding?token=token-de-ejemplo`;

const questions = [
  { id: 'email', question: '¿Cuál es el correo corporativo de la empresa?' },
  { id: 'debt_report', question: 'Adjunta el «Informe de Deudas de Personas Jurídicas» de la CMF.' },
];

const received = buildSolicitudReceivedEmail({ name, offerLabel, siteUrl });
const evaluating = buildSolicitudEvaluatingEmail({ name, offerLabel, siteUrl });
const pending = buildSolicitudPendingEmail({
  name,
  offerLabel,
  questions,
  link: answerLink,
  siteUrl,
});
const accepted = buildSolicitudAcceptedEmail({ name, offerLabel, siteUrl });
const qualified = buildKybQualifiedEmail({
  legalName,
  contactName,
  siteUrl,
  profileLabel: 'Inmobiliaria',
  plans: [
    {
      planId: 'basico',
      planName: 'Básico',
      altaClp: 29990,
      monthlyClp: 19990,
      usuariosIncluidos: 1,
      features: [],
      recommended: false,
    },
    {
      planId: 'profesional',
      planName: 'Profesional',
      altaClp: 49990,
      monthlyClp: 39990,
      usuariosIncluidos: 5,
      features: [],
      recommended: true,
    },
    {
      planId: 'premium',
      planName: 'Premium',
      altaClp: 79990,
      monthlyClp: 59990,
      usuariosIncluidos: 15,
      features: [],
      recommended: false,
    },
  ],
  captacionMonthlyClp: 19990,
  planUrl: `${siteUrl}/empresas/plan?token=token-de-ejemplo`,
});
const proposal = buildKybProposalEmail({
  legalName,
  contactName,
  planName: 'Profesional',
  altaClp: 49990,
  monthlyClp: 39990,
  note: 'Incluye 5 usuarios y el panel de publicaciones.',
  token: 'a'.repeat(43),
  siteUrl,
});
const activated = buildKybActivatedEmail({
  legalName,
  planName: 'Profesional',
  panelUrl: `${siteUrl}/socio`,
  magicLink: 'https://auth.example.com/verify?token=ejemplo',
  siteUrl,
});

const solicitudReminder = buildSolicitudPendingEmail({
  name,
  offerLabel,
  questions,
  link: answerLink,
  siteUrl,
  reminder: true,
});
const reminderAnswers = buildKybReminderEmail({
  legalName,
  contactName,
  step: 'answers',
  link: altaLink,
  siteUrl,
  closingInDays: 3,
});
const reminderProposal = buildKybReminderEmail({
  legalName,
  contactName,
  step: 'proposal',
  link: `${siteUrl}/empresas/propuesta?token=token-de-ejemplo`,
  siteUrl,
  closingInDays: 3,
});
const reminderActivation = buildKybReminderEmail({
  legalName,
  contactName,
  step: 'activation',
  link: `${siteUrl}/empresas/plan?token=token-de-ejemplo`,
  siteUrl,
  closingInDays: 3,
});

const solicitudRejected = buildSolicitudRejectedEmail({
  name,
  offerLabel,
  reason: 'El RUT no coincide con el nombre de la empresa.',
  siteUrl,
});
const kybRejected = buildKybRejectedEmail({
  legalName,
  contactName,
  reason: 'El informe de deudas muestra deuda castigada vigente.',
  siteUrl,
});

interface PreviewEmail {
  title: string;
  note: string;
  email: { subject: string; text: string; html: string };
}

const stageEmails: PreviewEmail[] = [
  { title: 'Etapa 1 de 7 · Recibida', note: 'Marcador: Etapa 1 de 7 · Recibida', email: received },
  { title: 'Etapa 2 de 7 · Evaluando', note: 'Marcador: Etapa 2 de 7 · Evaluando', email: evaluating },
  {
    title: 'Etapa 3 de 7 · Pendiente de información',
    note: 'Marcador: Etapa 3 de 7 · Pendiente de información',
    email: pending,
  },
  { title: 'Etapa 4 de 7 · Aceptada', note: 'Marcador: Etapa 4 de 7 · Aceptada', email: accepted },
  { title: 'Etapa 5 de 7 · Calificado', note: 'Marcador: Etapa 5 de 7 · Calificado', email: qualified },
  {
    title: 'Etapa 6 de 7 · Propuesta comercial',
    note: 'Marcador: Etapa 6 de 7 · Propuesta comercial',
    email: proposal,
  },
  { title: 'Etapa 7 de 7 · Alta', note: 'Marcador: Etapa 7 de 7 · Alta', email: activated },
];

const reminderEmails: PreviewEmail[] = [
  {
    title: 'Recordatorio · registro (etapa 3)',
    note: 'Marcador: Etapa 3 de 7 · Pendiente de información',
    email: solicitudReminder,
  },
  {
    title: 'Recordatorio · alta, respuestas (etapa 3)',
    note: 'Marcador: Etapa 3 de 7 · Pendiente de información',
    email: reminderAnswers,
  },
  {
    title: 'Recordatorio · alta, propuesta (etapa 6)',
    note: 'Marcador: Etapa 6 de 7 · Propuesta comercial',
    email: reminderProposal,
  },
  {
    title: 'Recordatorio · alta, activación (etapa 7)',
    note: 'Marcador: Etapa 7 de 7 · Alta',
    email: reminderActivation,
  },
];

const rejectionEmails: PreviewEmail[] = [
  {
    title: 'Rechazo · registro',
    note: 'Sin marcador: el trámite salió de las siete etapas.',
    email: solicitudRejected,
  },
  {
    title: 'Rechazo · alta',
    note: 'Sin marcador: el trámite salió de las siete etapas.',
    email: kybRejected,
  },
];

const attr = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const textHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const card = ({ title, note, email }: PreviewEmail) => `
    <section class="card">
      <header>
        <div class="stage">
          <span class="label">${textHtml(title)}</span>
        </div>
        <p class="subject">${textHtml(email.subject)}</p>
        <p class="marker">${textHtml(note)}</p>
      </header>
      <div class="panes">
        <div class="pane">
          <p class="pane-title">HTML</p>
          <iframe title="${attr(title)}" sandbox="" loading="lazy" srcdoc="${attr(email.html)}"></iframe>
        </div>
        <div class="pane">
          <p class="pane-title">Texto plano</p>
          <pre>${textHtml(email.text)}</pre>
        </div>
      </div>
    </section>`;

const section = (title: string, intro: string, emails: PreviewEmail[]) => `
    <h2>${textHtml(title)}</h2>
    <p class="section-intro">${textHtml(intro)}</p>
    ${emails.map(card).join('')}`;

const page = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Correos al solicitante · marcador de etapa</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 28px 20px 60px; background: #f1f5f9; color: #0f172a;
      font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
    }
    .wrap { max-width: 1180px; margin: 0 auto; }
    h1 { margin: 0 0 6px; font-size: 22px; letter-spacing: -.02em; }
    h2 { margin: 34px 0 4px; font-size: 15px; letter-spacing: -.01em; }
    .intro { margin: 0 0 22px; max-width: 70ch; color: #475569; font-size: 13px; line-height: 1.6; }
    .section-intro { margin: 0 0 14px; max-width: 70ch; color: #64748b; font-size: 12px; line-height: 1.6; }
    .card {
      margin: 0 0 20px; background: #fff; border: 1px solid #e2e8f0; border-radius: 14px;
      overflow: hidden; box-shadow: 0 1px 2px rgba(15, 23, 42, .04);
    }
    header { padding: 14px 18px; border-bottom: 1px solid #e2e8f0; background: #f8fafc; }
    .stage { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
    .label { font-size: 15px; font-weight: 800; }
    .subject { margin: 8px 0 0; font-size: 13px; color: #334155; }
    .marker { margin: 4px 0 0; font-size: 11px; color: #64748b; }
    code { font-size: 11px; background: #eef2f7; padding: 1px 5px; border-radius: 4px; }
    .panes { display: grid; gap: 14px; padding: 14px 18px 18px; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); }
    @media (max-width: 900px) { .panes { grid-template-columns: minmax(0, 1fr); } }
    .pane-title {
      margin: 0 0 6px; font-size: 10px; font-weight: 800; letter-spacing: .1em;
      text-transform: uppercase; color: #94a3b8;
    }
    iframe { width: 100%; height: 760px; border: 1px solid #e2e8f0; border-radius: 10px; background: #f8fafc; }
    pre {
      margin: 0; height: 760px; overflow: auto; padding: 14px; background: #0f172a; color: #e2e8f0;
      border-radius: 10px; font-size: 11px; line-height: 1.6; white-space: pre-wrap; word-break: break-word;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Correos al solicitante · marcador de etapa</h1>
    <p class="intro">
      Generado con los constructores reales de <code>lib/email/</code> y datos de ejemplo.
      Cada tarjeta muestra el correo en HTML y en texto plano, con la línea «Etapa N de 7 · …»
      y la barra de siete casillas que encabeza el cuerpo. Los recordatorios heredan la etapa
      que están esperando; los rechazos no llevan marcador porque salen del trámite.
    </p>
    ${section(
      'Las siete etapas',
      'Un correo por etapa, del acuse de recibo al panel habilitado.',
      stageEmails
    )}
    ${section(
      'Recordatorios',
      'Segundos avisos: el enlace anterior puede haber vencido y el marcador muestra el paso detenido.',
      reminderEmails
    )}
    ${section(
      'Rechazos',
      'Cierran el trámite: no hay paso de los siete que marcar, así que no llevan barra.',
      rejectionEmails
    )}
  </div>
</body>
</html>
`;

const target = resolve(process.cwd(), 'preview-correos-solicitante.html');
writeFileSync(target, page, 'utf8');
console.log(`Vista previa escrita en ${target}`);

/** Carga un .env sin imprimir valores: solo lo necesita el envío. */
function loadEnv(file: string): void {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, raw] = match;
    process.env[key] ??= raw.trim().replace(/^["']|["']$/g, '');
  }
}

function readFlag(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

/** Nunca imprime la casilla completa: alcanza con saber a dónde fue. */
function mask(email: string): string {
  const [local, domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

/**
 * `--send 1,3 [--to casilla]` manda esos correos reales con `sendEmail`, el
 * mismo camino que producción, para revisar el marcador en un cliente de
 * verdad. Sin `--to` usa `SMOKE_EMAIL`, que es la casilla de las pruebas del
 * repo. Requiere `RESEND_API_KEY`.
 */
const sendTargets = readFlag('--send');

/**
 * `tsconfig` compila con `target: es5`, donde no hay `await` de nivel superior:
 * el envío va dentro de una función y se lanza al final.
 */
async function sendPreview(): Promise<void> {
  if (!sendTargets) return;

  // La copia de `.env.vercel.local` puede tener una clave vieja; el pull de
  // desarrollo va primero para que gane la vigente.
  loadEnv('.tmp/email-env');
  loadEnv('.env.local');
  loadEnv('.env.vercel.local');

  const to = readFlag('--to') ?? process.env.SMOKE_EMAIL ?? '';
  const steps = sendTargets
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((step) => Number.isInteger(step) && step >= 1 && step <= 7);

  if (!to) {
    console.error('Falta la casilla: pasá --to o definí SMOKE_EMAIL.');
    process.exitCode = 1;
  } else if (steps.length === 0) {
    console.error('--send espera una lista de etapas, por ejemplo --send 1,3.');
    process.exitCode = 1;
  } else {
    const from = process.env.ALERTS_FROM_EMAIL ?? 'Rix7 <avisos@rix7.cl>';
    console.log(`\nEnviando a ${mask(to)} desde ${from}`);

    for (const step of steps) {
      const entry = stageEmails[step - 1];
      const result = await sendEmail({
        to,
        subject: entry.email.subject,
        html: entry.email.html,
        text: entry.email.text,
      });
      const state = result.sent ? 'enviado' : result.skipped ? 'omitido' : 'falló';
      console.log(
        `  ${state} · etapa ${step} · ${entry.email.subject}${result.error ? ` · ${result.error}` : ''}`
      );
      if (!result.sent) process.exitCode = 1;
    }
  }
}

if (sendTargets) void sendPreview();
