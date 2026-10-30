/**
 * Autómata de los registros de socios.
 *
 * El panel de Solicitudes mezcla dos fuentes. Las altas de empresa ya tenían
 * motor y correos (`lib/kyb/onboarding.ts`); los registros de corredora,
 * inmobiliaria y agente no: nacían en `Recibida` y ahí se quedaban hasta que una
 * persona los movía, con el solicitante en silencio.
 *
 * Este módulo les da el mismo comportamiento:
 *
 * 1. al recibir el registro corre `evaluateSolicitud` (RUT, correo, sitio,
 *    alcance, teléfono y duplicados);
 * 2. si pasa, el sistema lo mueve a `Aceptada`; si no, a
 *    `Pendiente_Informacion` con las preguntas concretas y un token nuevo;
 * 3. en los dos casos manda el correo al solicitante —el único aviso que tiene,
 *    porque no hay nadie del equipo en el medio—;
 * 4. cuando la persona responde por el enlace, la evaluación se repite sola y
 *    vuelve a mover y a avisar.
 *
 * Sin migración: el resultado, las preguntas y el hash del token viven en la
 * columna `payload`, que ya es JSONB (ver `REVIEW_KEYS`).
 */

import { sendEmail } from '@/lib/email/sendEmail';
import {
  buildSolicitudAcceptedEmail,
  buildSolicitudPendingEmail,
  buildSolicitudRejectedEmail,
  solicitudAnswerUrl,
} from '@/lib/email/solicitudApplicantEmail';
import { SITE_URL } from '@/lib/site';
import { assertTransition, type KybStatus } from '@/lib/kyb/status';
import { generateKybToken, hashKybToken, isKybTokenShape, kybTokenExpiry } from '@/lib/kyb/tokens';
import {
  evaluateSolicitud,
  SOLICITUD_REVIEW_KEYS as REVIEW_KEYS,
  solicitudOfferLabel,
  type SolicitudAnswer,
  type SolicitudEvaluation,
  type SolicitudQuestion,
} from './solicitudEvaluation';
import {
  findSolicitudByAnswerToken,
  getSolicitud,
  listSolicitudesForReview,
  updateSolicitudReview,
} from './solicitudesStore';
import type { Solicitud, SolicitudKind } from './solicitudes';

export interface AutopilotEmailOutcome {
  sent: boolean;
  skipped: boolean;
  error?: string;
}

export interface AutopilotResult {
  ok: boolean;
  /** Estado en el que quedó (o en el que estaba, si no había nada que hacer). */
  status?: KybStatus;
  evaluation?: SolicitudEvaluation;
  questions?: SolicitudQuestion[];
  email?: AutopilotEmailOutcome;
  /** `invalid` es una entrada mal formada (400) y `not_found` un 404. */
  code?: 'invalid' | 'not_found' | 'conflict' | 'store';
  error?: string;
}

/** ¿Este camino es un registro de socio (y no la solicitud de un propietario)? */
export function isSocioRegistro(kind: SolicitudKind | string): boolean {
  return kind === 'corredora' || kind === 'inmobiliaria' || kind === 'agente';
}

/** Estados en los que ya no hay nada que evaluar. */
function isTerminal(status: KybStatus): boolean {
  return status === 'En_Alta' || status === 'Operando' || status === 'Rechazada';
}

async function notify(
  to: string,
  built: { subject: string; text: string; html: string }
): Promise<AutopilotEmailOutcome> {
  const result = await sendEmail({ to, ...built });
  if (!result.sent && !result.skipped) {
    console.error('[solicitudes] no se pudo avisar al solicitante:', result.error);
  }
  return { sent: result.sent, skipped: result.skipped, ...(result.error ? { error: result.error } : {}) };
}

/**
 * Aplica una evaluación: mueve el estado, emite o invalida el token y avisa.
 *
 * El paso por `En_Evaluacion` no es decorativo: es el estado intermedio de la
 * máquina (`Recibida → En_Evaluacion → Aceptada | Pendiente_Informacion`) y así
 * queda registrado que la solicitud se evaluó, aunque haya durado segundos.
 */
async function applyEvaluation(
  solicitud: Solicitud,
  evaluation: SolicitudEvaluation,
  options: { email: boolean }
): Promise<AutopilotResult> {
  const accepted = evaluation.decision === 'Aceptada';
  const target: KybStatus = accepted ? 'Aceptada' : 'Pendiente_Informacion';

  let status = solicitud.status;
  if (status !== 'En_Evaluacion') {
    const step = assertTransition(status, 'En_Evaluacion');
    if (!step.ok) {
      return { ok: false, code: 'conflict', status, evaluation, error: step.error };
    }
    const moved = await updateSolicitudReview(solicitud.id, { status: 'En_Evaluacion' });
    if (!moved.ok) {
      return { ok: false, code: 'store', status, evaluation, error: moved.error };
    }
    status = 'En_Evaluacion';
  }

  const final = assertTransition(status, target);
  if (!final.ok) {
    return { ok: false, code: 'conflict', status, evaluation, error: final.error };
  }

  // El token se emite solo si hay preguntas. Al aceptar se invalida el de la
  // ronda anterior: un enlace viejo no puede seguir abriendo el formulario.
  const token = accepted ? null : generateKybToken();
  const stored = await updateSolicitudReview(solicitud.id, {
    status: target,
    evaluation,
    ...(token
      ? {
          answerTokenHash: token.hash,
          answerTokenExpiresAt: kybTokenExpiry(),
        }
      : {
          // `null` y no `''`: así el hash deja de existir y la búsqueda por
          // token no puede encontrar esta fila.
          answerTokenHash: null,
        }),
  });

  if (!stored.ok) {
    return { ok: false, code: 'store', status, evaluation, error: stored.error };
  }

  let email: AutopilotEmailOutcome | undefined;
  if (options.email) {
    const offerLabel = solicitudOfferLabel(solicitud.kind);
    if (accepted) {
      email = await notify(
        solicitud.email,
        buildSolicitudAcceptedEmail({ name: solicitud.name, offerLabel, siteUrl: SITE_URL })
      );
    } else if (token) {
      email = await notify(
        solicitud.email,
        buildSolicitudPendingEmail({
          name: solicitud.name,
          offerLabel,
          questions: evaluation.questions,
          link: solicitudAnswerUrl(SITE_URL, token.token),
          siteUrl: SITE_URL,
        })
      );
    }
  }

  return {
    ok: true,
    status: target,
    evaluation,
    questions: evaluation.questions,
    ...(email ? { email } : {}),
  };
}

/**
 * Corre el autómata sobre una solicitud ya guardada.
 *
 * `existing` permite pasar el listado que el llamador ya tiene a mano; si no
 * llega, se leen las solicitudes guardadas para detectar un RUT o un correo
 * repetido. `email:false` sirve para re-evaluar sin volver a escribirle a la
 * persona (por ejemplo, desde un proceso que ya le avisó).
 */
export async function autopilotSolicitud(
  solicitud: Solicitud,
  options: { existing?: readonly Solicitud[]; email?: boolean } = {}
): Promise<AutopilotResult> {
  if (!isSocioRegistro(solicitud.kind)) {
    return { ok: false, code: 'invalid', error: 'Esta solicitud no es un registro de socio.' };
  }
  if (isTerminal(solicitud.status)) {
    return { ok: false, code: 'conflict', status: solicitud.status, error: `La solicitud está en «${solicitud.status}» y no se evalúa.` };
  }

  const existing = options.existing ?? (await listSolicitudesForReview());
  const clarifications = clarificationsFromAnswers(solicitud);

  const evaluation = evaluateSolicitud(solicitud, { existing, clarifications });
  return applyEvaluation(solicitud, evaluation, { email: options.email !== false });
}

/** Re-evaluación pedida desde el panel: siempre vuelve a escribir el resultado. */
export async function reEvaluateSolicitud(id: string): Promise<AutopilotResult> {
  const solicitud = await getSolicitud(id);
  if (!solicitud) return { ok: false, code: 'not_found', error: 'No encontramos esa solicitud.' };
  return autopilotSolicitud(solicitud);
}

/** Respuestas acumuladas de las rondas anteriores, como aclaraciones. */
function clarificationsFromAnswers(solicitud: Solicitud): Record<string, string> {
  const rounds = solicitud.payload[REVIEW_KEYS.answers];
  if (!Array.isArray(rounds)) return {};

  const map: Record<string, string> = {};
  for (const round of rounds) {
    if (!round || typeof round !== 'object' || Array.isArray(round)) continue;
    const item = round as { id?: unknown; answer?: unknown };
    if (typeof item.id === 'string' && typeof item.answer === 'string' && item.answer.trim()) {
      map[item.id] = item.answer.trim();
    }
  }
  return map;
}

/**
 * Respuestas de una ronda, validadas contra las preguntas de la evaluación.
 *
 * Se compara contra las preguntas guardadas y no contra las que mande el
 * navegador: si una respuesta no corresponde a una pregunta de esta ronda, se
 * descarta en vez de guardarla, para que el `payload` no acumule texto libre.
 */
export function normalizeAnswers(
  questions: readonly SolicitudQuestion[],
  input: readonly { id?: unknown; answer?: unknown }[]
): { ok: true; answers: SolicitudAnswer[] } | { ok: false; error: string } {
  const byId = new Map(questions.map((question) => [question.id, question]));
  const answers: SolicitudAnswer[] = [];

  for (const item of input) {
    const id = typeof item.id === 'string' ? item.id : '';
    const question = byId.get(id);
    if (!question) return { ok: false, error: 'Una de las preguntas no corresponde a este registro.' };

    const answer = typeof item.answer === 'string' ? item.answer.trim() : '';
    if (!answer) return { ok: false, error: 'Responde todas las preguntas para continuar.' };
    if (answer.length > 2000) return { ok: false, error: 'Una respuesta es demasiado larga.' };

    answers.push({ id, answer });
  }

  if (answers.length !== questions.length) {
    return { ok: false, error: 'Responde todas las preguntas para continuar.' };
  }

  return { ok: true, answers };
}

/**
 * Envío de respuestas desde el enlace del correo: vuelve a evaluar y avisa.
 *
 * El token es la única credencial que tiene la persona. Si no existe, no es de
 * esta ronda o venció, el resultado es el mismo mensaje: no se distingue «no
 * existe» de «vencido» porque los dos casos significan «pide un enlace nuevo».
 */
export async function submitSolicitudAnswers(
  token: unknown,
  input: readonly { id?: unknown; answer?: unknown }[]
): Promise<AutopilotResult> {
  if (!isKybTokenShape(token)) {
    return { ok: false, code: 'invalid', error: 'El enlace no es válido. Solicita uno nuevo.' };
  }

  const solicitud = await findSolicitudByAnswerToken(hashKybToken(token));
  if (!solicitud) {
    return { ok: false, code: 'not_found', error: 'El enlace no es válido o ya se usó. Solicita uno nuevo.' };
  }
  if (solicitud.status !== 'Pendiente_Informacion') {
    return {
      ok: false,
      code: 'conflict',
      error: 'Esta solicitud ya no espera respuestas. Si necesitas corregir algo, responde el último correo.',
    };
  }

  const expiresAt = solicitud.payload[REVIEW_KEYS.tokenExpiresAt];
  if (typeof expiresAt === 'string' && Date.parse(expiresAt) < Date.now()) {
    return { ok: false, code: 'conflict', error: 'El enlace venció. Responde el correo para pedir uno nuevo.' };
  }

  const evaluation = solicitud.payload[REVIEW_KEYS.evaluation] as SolicitudEvaluation | undefined;
  const questions = Array.isArray(evaluation?.questions) ? evaluation.questions : [];
  if (questions.length === 0) {
    return { ok: false, code: 'conflict', error: 'Este registro no tiene preguntas pendientes.' };
  }

  const normalized = normalizeAnswers(questions, input);
  if (!normalized.ok) return { ok: false, code: 'invalid', error: normalized.error };

  const stored = await updateSolicitudReview(solicitud.id, { answers: normalized.answers });
  if (!stored.ok || !stored.solicitud) {
    return { ok: false, code: 'store', error: stored.error ?? 'No se pudieron guardar las respuestas.' };
  }

  // Se vuelve a evaluar con las respuestas ya guardadas: `clarificationsFromAnswers`
  // las toma del `payload`, así que no hay dos caminos de lectura.
  return autopilotSolicitud(stored.solicitud, { email: true });
}

/**
 * Aviso cuando el equipo mueve el estado a mano.
 *
 * El panel conserva el selector para casos puntuales (una excepción aprobada, un
 * registro que no debe seguir). Si esa decisión humana no manda correo, el
 * solicitante vuelve a quedar sin saber qué pasó, que es justo lo que este
 * cambio viene a cerrar. Aprobar y rechazar avisan; los estados intermedios, no.
 */
export async function notifyManualDecision(
  solicitud: Solicitud,
  status: KybStatus,
  note?: string
): Promise<AutopilotEmailOutcome | null> {
  if (!isSocioRegistro(solicitud.kind)) return null;

  const offerLabel = solicitudOfferLabel(solicitud.kind);
  if (status === 'Aceptada' || status === 'En_Alta') {
    return notify(
      solicitud.email,
      buildSolicitudAcceptedEmail({ name: solicitud.name, offerLabel, siteUrl: SITE_URL })
    );
  }

  if (status === 'Rechazada') {
    return notify(
      solicitud.email,
      buildSolicitudRejectedEmail({
        name: solicitud.name,
        offerLabel,
        reason:
          note?.trim() ||
          'La revisión del equipo no permitió continuar con el registro. Si tienes antecedentes que no consideramos, responde este correo.',
        siteUrl: SITE_URL,
      })
    );
  }

  return null;
}
