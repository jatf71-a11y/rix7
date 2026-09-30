import { escapeHtml } from './alertEmail';

/**
 * Correo de alerta de Sentry → correo (plan fase 3, 1.4).
 *
 * La regla en el dashboard de Sentry decide cuándo avisar; este módulo solo
 * arma el correo que llega al equipo. Módulo puro: lo prueba
 * `sentryAlertEmail.test.ts` y la ruta webhook lo consume.
 *
 * Diseño del correo:
 * - Asunto con severidad y evento (lo primero que se ve en una bandeja); el id
 *   del evento se acorta a 8 caracteres, suficiente para distinguir.
 * - Enlace profundo al issue en Sentry — el correo avisa, el triage pasa allí.
 * - Sin PII: el SDK ya envía `sendDefaultPii: false` en servidor. Todo lo que
 *   viene del webhook pasa por `escapeHtml` antes de entrar al HTML.
 */

/** Estructura mínima que la ruta extrae del payload del webhook. */
export interface SentryAlertPayload {
  /** Acción del webhook: `issue`, `error`, `critical`, … */
  action: string;
  project: string;
  environment: string;
  level: string;
  title: string;
  culprit?: string;
  /** UUID del evento, para el enlace profundo. */
  eventId?: string;
  /** Timestamp ISO del evento, si Sentry lo manda. */
  datetime?: string;
  /** URL del issue en sentry.io (el propio webhook la manda). */
  issueUrl?: string;
  /** Primera entrada del stack, si viene. */
  firstStackFrame?: string;
}

/** Severidades que despiertan a alguien; el resto queda en el dashboard. */
export const ALERT_WORTHY_LEVELS = new Set(['fatal', 'error']);

/**
 * ¿Este webhook merece correo? La regla del dashboard filtra antes; acá es la
 * defensa en profundidad del receptor: si algo se cuela con severidad menor,
 * no despierta a nadie.
 */
export function isAlertWorthy(payload: Pick<SentryAlertPayload, 'level'>): boolean {
  return ALERT_WORTHY_LEVELS.has((payload.level || 'error').toLowerCase());
}

export interface BuiltSentryEmail {
  subject: string;
  text: string;
  html: string;
}

/** Arma el correo de alerta. No envía: para eso está `sendEmail`. */
export function buildSentryAlertEmail(payload: SentryAlertPayload): BuiltSentryEmail {
  const level = (payload.level || 'error').toUpperCase();
  const env = payload.environment || 'production';
  const shortEvent = payload.eventId ? payload.eventId.slice(0, 8) : undefined;
  const subject = `[Sentry:${level}] ${env} · ${payload.title}${shortEvent ? ` (${shortEvent})` : ''}`;

  const issueUrl = payload.issueUrl || 'https://sentry.io';
  const lines: Array<string | undefined> = [
    payload.culprit ? `Módulo: ${payload.culprit}` : undefined,
    payload.firstStackFrame ? `Origen: ${payload.firstStackFrame}` : undefined,
    payload.datetime ? `Cuándo: ${payload.datetime}` : undefined,
  ];

  const text = [
    `Alerta de ${level} en ${env} (proyecto ${payload.project})`,
    '',
    payload.title,
    payload.action ? `Evento: ${payload.action}` : '',
    '',
    ...lines.filter((line): line is string => !!line),
    '',
    `Detalle y triage: ${issueUrl}`,
    '',
    '— Rix7 · aviso automático de Sentry',
  ]
    .filter((line) => line !== '')
    .join('\n');

  const html = [
    `<h2 style="margin:0 0 8px;color:#b91c1c;">${escapeHtml(level)} en ${escapeHtml(env)}</h2>`,
    `<p style="margin:0 0 12px;font-size:15px;"><strong>${escapeHtml(payload.title)}</strong></p>`,
    payload.culprit ? `<p style="margin:0 0 4px;color:#475569;">Módulo: ${escapeHtml(payload.culprit)}</p>` : '',
    payload.firstStackFrame ? `<p style="margin:0 0 4px;color:#475569;">Origen: <code>${escapeHtml(payload.firstStackFrame)}</code></p>` : '',
    payload.datetime ? `<p style="margin:0 0 12px;color:#475569;">Cuándo: ${escapeHtml(payload.datetime)}</p>` : '',
    `<p style="margin:16px 0 0;"><a href="${escapeHtml(issueUrl)}" style="background:#1d4ed8;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Abrir en Sentry</a></p>`,
    `<p style="margin:20px 0 0;color:#94a3b8;font-size:12px;">Aviso automático de Sentry · proyecto ${escapeHtml(payload.project)}${shortEvent ? ` · evento ${escapeHtml(shortEvent)}` : ''}</p>`,
  ]
    .filter(Boolean)
    .join('');

  return { subject, text, html };
}
