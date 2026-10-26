/**
 * Orquestación del onboarding KYB.
 *
 * Es el único lugar que mueve el estado. Las rutas solo validan la entrada y
 * llaman acá; el motor decide, y este módulo aplica la decisión, guarda el
 * historial, emite el token y manda el correo.
 *
 * Secuencia:
 *
 *   alta → Recibida → En_Evaluacion → Aceptada → En_Alta   (token de activation)
 *                                    ↘ Pendiente_Informacion (preguntas + token)
 *                                        → respuestas → En_Evaluacion → …
 *
 * Todo se devuelve como resultado, no como excepción: una ruta necesita
 * distinguir «no se pudo guardar» (500) de «el token no vale» (403) sin leer
 * logs.
 */

import { sendEmail, type EmailResult } from '@/lib/email/sendEmail';
import {
  buildKybAcceptedEmail,
  buildKybActivatedEmail,
  buildKybEvaluatingEmail,
  buildKybPendingEmail,
  buildKybReceivedEmail,
  buildKybRejectedEmail,
} from '@/lib/email/kybEmails';
import { normalizeDecision } from './decisions';
import { SITE_URL } from '@/lib/site';
import { getKybPlan, isKybPlanId, type KybPlanId } from './plans';
import {
  createApplication,
  createInformationRequest,
  findByTokenHash,
  getApplication,
  latestInformationRequest,
  recordDecision,
  saveAnswers,
  saveEvaluation,
  tokenAllows,
  updateApplication,
} from './store';
import { generateKybToken, hashKybToken, isKybTokenShape, kybTokenExpiry } from './tokens';
import { evaluateKyb, type KybClarifications, type KybEngineDeps } from './engine';
import { normalizeKybApplication, type KybApplicationInput } from './application';
import { provisionCompanyPanel } from './provisioning';
import {
  assertTransition,
  canDecideManually,
  canEvaluate,
  type KybEvaluation,
  type KybQuestion,
  type KybStatus,
  type KybTokenPurpose,
} from './status';
import type { KybApplication } from './types';

export interface EmailOutcome {
  sent: boolean;
  skipped: boolean;
  error?: string;
}

function emailOutcome(result: EmailResult): EmailOutcome {
  return { sent: result.sent, skipped: result.skipped, ...(result.error ? { error: result.error } : {}) };
}

async function notify(
  to: string,
  built: { subject: string; html: string; text: string }
): Promise<EmailOutcome> {
  const result = await sendEmail({ to, ...built });
  if (!result.sent && !result.skipped) {
    console.error('[kyb] no se pudo enviar el correo:', result.error);
  }
  return emailOutcome(result);
}

export interface SubmitResult {
  ok: boolean;
  applicationId?: string;
  status?: KybStatus;
  score?: number;
  questions?: KybQuestion[];
  persisted?: boolean;
  email?: EmailOutcome;
  error?: string;
}

/** Alta pública: guarda, acusa recibo y evalúa en la misma corrida. */
export async function submitKybApplication(
  input: KybApplicationInput,
  options: { deps?: Partial<KybEngineDeps> } = {}
): Promise<SubmitResult> {
  const normalized = normalizeKybApplication(input);
  if (!normalized.ok) return { ok: false, error: normalized.error };

  const created = await createApplication(normalized.application);
  if (!created.ok || !created.data) {
    return { ok: false, persisted: created.persisted, error: created.error ?? 'No se pudo guardar la solicitud.' };
  }

  const received = await notify(
    created.data.email,
    buildKybReceivedEmail({
      legalName: created.data.legalName,
      contactName: created.data.contactName,
      siteUrl: SITE_URL,
    })
  );

  const evaluated = await evaluateById(created.data.id, { deps: options.deps });

  return {
    ok: evaluated.ok,
    applicationId: created.data.id,
    status: evaluated.application?.status ?? 'Recibida',
    score: evaluated.evaluation?.score,
    questions: evaluated.questions,
    persisted: created.persisted,
    email: received,
    ...(evaluated.error ? { error: evaluated.error } : {}),
  };
}

export interface EvaluateResult {
  ok: boolean;
  application?: KybApplication;
  evaluation?: KybEvaluation;
  questions?: KybQuestion[];
  email?: EmailOutcome;
  error?: string;
}

async function issueToken(
  applicationId: string,
  purpose: KybTokenPurpose
): Promise<{ token: string; hash: string; expiresAt: string }> {
  const { token, hash } = generateKybToken();
  const expiresAt = kybTokenExpiry();

  await updateApplication(applicationId, {
    tokenHash: hash,
    tokenPurpose: purpose,
    tokenExpiresAt: expiresAt,
  });

  return { token, hash, expiresAt };
}

/**
 * Corre el motor sobre una solicitud y aplica la decisión.
 *
 * `clarifications` viene de una ronda de respuestas. El resultado siempre deja
 * la solicitud en `Pendiente_Informacion`, `Aceptada` (que en la misma corrida
 * pasa a `En_Alta`) o en `Recibida` si algo falló antes de evaluar.
 */
export async function evaluateById(
  id: string,
  options: { clarifications?: KybClarifications; deps?: Partial<KybEngineDeps> } = {}
): Promise<EvaluateResult> {
  const current = await getApplication(id);
  if (!current.ok || !current.data) {
    return { ok: false, error: current.error ?? 'Solicitud no encontrada.' };
  }
  const application = current.data;

  if (!canEvaluate(application.status)) {
    return { ok: false, error: `La solicitud está en «${application.status}» y no se puede evaluar.` };
  }

  const before = application.status;

  if (before !== 'En_Evaluacion') {
    const transition = assertTransition(before, 'En_Evaluacion');
    if (!transition.ok) return { ok: false, error: transition.error };
    const moved = await updateApplication(id, { status: 'En_Evaluacion' });
    if (!moved.ok) return { ok: false, error: moved.error };
  }

  let evaluation: KybEvaluation;
  try {
    evaluation = await evaluateKyb(
      {
        legalName: application.legalName,
        rut: application.rut,
        website: application.website,
        domain: application.domain,
        email: application.email,
        contactName: application.contactName,
        phone: application.phone,
        consent: true,
        coverage: application.coverage,
        regions: application.regions,
        message: application.message,
        registrationKind: application.registrationKind,
        contactRole: application.contactRole,
      },
      options.clarifications ?? {},
      options.deps
    );
  } catch (error) {
    return {
      ok: false,
      application,
      error: error instanceof Error ? error.message : 'El motor de evaluación falló.',
    };
  }

  let email: EmailOutcome | undefined;

  if (evaluation.decision === 'Aceptada') {
    const accepted = assertTransition('En_Evaluacion', 'Aceptada');
    if (!accepted.ok) return { ok: false, error: accepted.error };

    await updateApplication(id, { status: 'Aceptada', score: evaluation.score });

    const inAlta = assertTransition('Aceptada', 'En_Alta');
    if (!inAlta.ok) return { ok: false, error: inAlta.error };

    const updated = await updateApplication(id, { status: 'En_Alta', score: evaluation.score });
    if (!updated.ok || !updated.data) {
      return { ok: false, error: updated.error ?? 'No se pudo guardar el estado.' };
    }

    const { token } = await issueToken(id, 'activation');
    const refreshed = await getApplication(id);

    email = await notify(
      application.email,
      buildKybAcceptedEmail({
        legalName: application.legalName,
        contactName: application.contactName,
        token,
        siteUrl: SITE_URL,
      })
    );

    await saveEvaluation({
      applicationId: id,
      statusBefore: before,
      statusAfter: 'En_Alta',
      evaluation,
    });

    return {
      ok: true,
      application: refreshed.data ?? updated.data,
      evaluation,
      questions: [],
      email,
    };
  }

  // Pendiente de información.
  const pending = assertTransition('En_Evaluacion', 'Pendiente_Informacion');
  if (!pending.ok) return { ok: false, error: pending.error };

  await updateApplication(id, { status: 'Pendiente_Informacion', score: evaluation.score });
  await createInformationRequest(id, evaluation.questions);
  const { token } = await issueToken(id, 'answers');
  const refreshed = await getApplication(id);

  email = await notify(
    application.email,
    buildKybPendingEmail({
      legalName: application.legalName,
      contactName: application.contactName,
      questions: evaluation.questions,
      token,
      siteUrl: SITE_URL,
    })
  );

  await saveEvaluation({
    applicationId: id,
    statusBefore: before,
    statusAfter: 'Pendiente_Informacion',
    evaluation,
  });

  return {
    ok: true,
    application: refreshed.data ?? { ...application, status: 'Pendiente_Informacion' },
    evaluation,
    questions: evaluation.questions,
    email,
  };
}

export interface DecideResult {
  ok: boolean;
  application?: KybApplication;
  status?: KybStatus;
  questions?: KybQuestion[];
  email?: EmailOutcome;
  error?: string;
  /**
   * Por qué falló, para que la ruta elija el estado HTTP sin adivinar por el
   * texto: `invalid` es una entrada mal armada (400), `conflict` es un estado
   * que no admite la decisión (409) y `not_found` no existe (404).
   */
  code?: 'invalid' | 'conflict' | 'not_found' | 'store';
}

/**
 * Decisión manual del equipo sobre una solicitud ya evaluada.
 *
 * Aprobar, pedir información o rechazar: las tres hacen lo mismo que haría el
 * motor en su rama correspondiente —mover el estado, emitir el token que
 * corresponda, mandar el correo— con una diferencia: acá queda registrado
 * **quién** decidió y con qué motivo. Sin ese registro, un alta aprobada a mano
 * es indistinguible de una que pasó sola.
 *
 * `Aceptada` sigue el mismo camino de dos pasos que la aprobación automática
 * (`Aceptada` → `En_Alta`, que es el estado desde el que la empresa elige plan),
 * y `Rechazada` deja la solicitud sin token: el enlace que tuviera la empresa
 * deja de servir en el mismo movimiento.
 *
 * Pedir información sobre una solicitud **ya** pendiente no mueve el estado:
 * abre otra ronda con las preguntas del equipo y emite un token nuevo. Es el
 * caso normal en producción, porque el motor decide en la misma corrida del
 * alta y ninguna solicitud queda detenida en `En_Evaluacion`.
 */
export async function decideApplication({
  id,
  decision,
  note,
  questions,
  decidedBy,
}: {
  id: string;
  decision: unknown;
  note?: unknown;
  questions?: unknown;
  decidedBy: string;
}): Promise<DecideResult> {
  const current = await getApplication(id);
  if (!current.ok || !current.data) {
    return {
      ok: false,
      code: current.found === false ? 'not_found' : 'store',
      error: current.error ?? 'Solicitud no encontrada.',
    };
  }
  const application = current.data;

  const validated = normalizeDecision({ decision, note, questions });
  if (!validated.ok) return { ok: false, code: 'invalid', error: validated.error };
  const chosen = validated.data;

  // La tabla de transiciones es la que manda: si el estado no admite esta
  // decisión, el panel tiene un dato viejo y hay que recargarlo. La excepción es
  // volver a pedir información sobre algo que ya está pendiente: no mueve el
  // estado, así que `canDecideManually` lo admite y acá no hay transición.
  if (!canDecideManually(application.status, chosen.decision)) {
    const transition = assertTransition(application.status, chosen.decision);
    if (!transition.ok) return { ok: false, code: 'conflict', error: transition.error };
  }

  const before = application.status;
  let email: EmailOutcome | undefined;
  let after: KybStatus = chosen.decision;

  if (chosen.decision === 'Rechazada') {
    const updated = await updateApplication(id, {
      status: 'Rechazada',
      // El token muere con la solicitud: si la empresa tenía el enlace de
      // respuestas abierto, deja de servir.
      tokenHash: null,
      tokenPurpose: null,
      tokenExpiresAt: null,
    });
    if (!updated.ok) {
      return { ok: false, code: 'store', error: updated.error ?? 'No se pudo guardar el estado.' };
    }

    email = await notify(
      application.email,
      buildKybRejectedEmail({
        legalName: application.legalName,
        contactName: application.contactName,
        reason: chosen.note ?? '',
        siteUrl: SITE_URL,
      })
    );
  } else if (chosen.decision === 'Aceptada') {
    await updateApplication(id, { status: 'Aceptada' });

    const inAlta = assertTransition('Aceptada', 'En_Alta');
    if (!inAlta.ok) return { ok: false, code: 'conflict', error: inAlta.error };

    const updated = await updateApplication(id, { status: 'En_Alta' });
    if (!updated.ok) {
      return { ok: false, code: 'store', error: updated.error ?? 'No se pudo guardar el estado.' };
    }
    after = 'En_Alta';

    const { token } = await issueToken(id, 'activation');
    email = await notify(
      application.email,
      buildKybAcceptedEmail({
        legalName: application.legalName,
        contactName: application.contactName,
        token,
        siteUrl: SITE_URL,
      })
    );
  } else {
    // Si ya estaba pendiente, el estado no se toca: se abre otra ronda con las
    // preguntas del equipo y se emite un token nuevo. La ronda anterior, si
    // quedó abierta, deja de importar: su token se reemplaza en el mismo
    // movimiento y `latestInformationRequest` devuelve esta.
    if (application.status !== 'Pendiente_Informacion') {
      const updated = await updateApplication(id, { status: 'Pendiente_Informacion' });
      if (!updated.ok) {
        return { ok: false, code: 'store', error: updated.error ?? 'No se pudo guardar el estado.' };
      }
    }

    await createInformationRequest(id, chosen.questions);
    const { token } = await issueToken(id, 'answers');

    email = await notify(
      application.email,
      buildKybPendingEmail({
        legalName: application.legalName,
        contactName: application.contactName,
        questions: chosen.questions,
        token,
        siteUrl: SITE_URL,
      })
    );
  }

  const refreshed = await getApplication(id);

  // El historial se escribe al final: si el estado no se movió, no queda una
  // decisión registrada que nunca ocurrió. Si el registro falla, la decisión
  // igual está hecha y se informa (`decisionPersisted`).
  const recorded = await recordDecision({
    applicationId: id,
    decision: chosen.decision,
    statusBefore: before,
    statusAfter: after,
    note: chosen.note,
    questions: chosen.questions,
    decidedBy,
  });

  return {
    ok: true,
    application: refreshed.data ?? application,
    status: after,
    questions: chosen.questions,
    email,
    ...(recorded.ok ? {} : { error: `La decisión se aplicó, pero no se pudo registrar en el historial: ${recorded.error}` }),
  };
}

export interface AnswerResult {
  ok: boolean;
  status?: KybStatus;
  score?: number;
  questions?: KybQuestion[];
  email?: EmailOutcome;
  error?: string;
}

/** Responde la ronda abierta y re-evalúa. El token es el del correo. */
export async function answerKybQuestions({
  token,
  answers,
  deps,
}: {
  token: unknown;
  answers: unknown;
  deps?: Partial<KybEngineDeps>;
}): Promise<AnswerResult> {
  if (!isKybTokenShape(token)) return { ok: false, error: 'El enlace no es válido.' };

  const found = await findByTokenHash(hashKybToken(token));
  if (!found.ok || !found.data) {
    return { ok: false, error: 'El enlace no es válido o ya expiró.' };
  }
  const application = found.data;

  if (!tokenAllows(application, 'answers')) {
    return { ok: false, error: 'El enlace ya no sirve para responder: la solicitud cambió de estado.' };
  }

  const request = await latestInformationRequest(application.id);
  if (!request || request.answeredAt) {
    return { ok: false, error: 'No hay preguntas abiertas para esta solicitud.' };
  }

  const submitted = new Map<string, string>();
  if (Array.isArray(answers)) {
    for (const entry of answers) {
      if (!entry || typeof entry !== 'object') continue;
      const { id, answer } = entry as { id?: unknown; answer?: unknown };
      if (typeof id !== 'string' || typeof answer !== 'string') continue;
      submitted.set(id, answer.trim());
    }
  }

  const missing = request.questions.filter((question) => {
    const answer = submitted.get(question.id);
    return !answer || answer.length < 2;
  });
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Faltan respuestas: ${missing.map((question) => question.id).join(', ')}.`,
    };
  }

  const payload = request.questions.map((question) => ({
    id: question.id,
    answer: (submitted.get(question.id) ?? '').slice(0, 2000),
  }));

  const saved = await saveAnswers(application.id, payload);
  if (!saved.ok) return { ok: false, error: saved.error ?? 'No se pudieron guardar las respuestas.' };

  const evaluating = await notify(
    application.email,
    buildKybEvaluatingEmail({ legalName: application.legalName, siteUrl: SITE_URL })
  );

  const clarifications: KybClarifications = Object.fromEntries(
    payload.map(({ id, answer }) => [id, answer])
  );

  const result = await evaluateById(application.id, { clarifications, deps });

  return {
    ok: result.ok,
    status: result.application?.status,
    score: result.evaluation?.score,
    questions: result.questions,
    email: result.email ?? evaluating,
    ...(result.error ? { error: result.error } : {}),
  };
}

/** Lo que ve quien abre el enlace del correo. */
export async function kybStatusByToken(token: unknown): Promise<{
  ok: boolean;
  status?: KybStatus;
  legalName?: string;
  questions?: KybQuestion[];
  plan?: string | null;
  panelEnabled?: boolean;
  error?: string;
}> {
  if (!isKybTokenShape(token)) return { ok: false, error: 'El enlace no es válido.' };

  const found = await findByTokenHash(hashKybToken(token));
  if (!found.ok || !found.data) return { ok: false, error: 'El enlace no es válido o ya expiró.' };
  const application = found.data;

  if (!application.tokenPurpose || !application.tokenExpiresAt) {
    return { ok: false, error: 'Este enlace ya fue usado. Si necesitas otra cosa, escríbenos.' };
  }
  if (Date.parse(application.tokenExpiresAt) <= Date.now()) {
    return { ok: false, error: 'El enlace expiró.' };
  }

  let questions: KybQuestion[] | undefined;
  if (application.status === 'Pendiente_Informacion') {
    const request = await latestInformationRequest(application.id);
    questions = request?.questions ?? [];
  }

  return {
    ok: true,
    status: application.status,
    legalName: application.legalName,
    questions,
    plan: application.plan,
    panelEnabled: application.panelEnabled,
  };
}

export interface ActivateResult {
  ok: boolean;
  already?: boolean;
  status?: KybStatus;
  plan?: KybPlanId;
  panel?: { enabled: boolean; partnerId?: string; account?: string };
  email?: EmailOutcome;
  error?: string;
}

/**
 * Elige plan y habilita el panel.
 *
 * Es idempotente: repetir la petición con el mismo token y plan no vuelve a
 * crear la ficha ni la cuenta, y devuelve `already: true`.
 */
export async function activateKybPlan({
  token,
  plan,
}: {
  token: unknown;
  plan: unknown;
}): Promise<ActivateResult> {
  if (!isKybTokenShape(token)) return { ok: false, error: 'El enlace no es válido.' };
  if (!isKybPlanId(plan)) return { ok: false, error: 'El plan indicado no existe.' };

  const found = await findByTokenHash(hashKybToken(token));
  if (!found.ok || !found.data) return { ok: false, error: 'El enlace no es válido o ya expiró.' };
  const application = found.data;

  if (application.panelEnabled) {
    return {
      ok: true,
      already: true,
      status: application.status,
      plan: application.plan ?? plan,
      panel: { enabled: true },
    };
  }

  if (!tokenAllows(application, 'activation')) {
    return { ok: false, error: 'El enlace no sirve para activar: la solicitud aún no está aceptada.' };
  }

  const provision = await provisionCompanyPanel(application);
  if (!provision.ok) {
    return { ok: false, error: provision.error ?? 'No se pudo habilitar el panel.' };
  }

  const updated = await updateApplication(application.id, {
    plan,
    panelEnabled: true,
    activatedAt: new Date().toISOString(),
    status: 'En_Alta',
    // El token se conserva hasta su vencimiento para tolerar reintentos de red:
    // una segunda activación no vuelve a crear nada y responde `already`. No
    // habilita nada nuevo porque `panel_enabled` ya está en true.
  });

  if (!updated.ok || !updated.data) {
    return { ok: false, error: updated.error ?? 'No se pudo guardar la activación.' };
  }

  const planData = getKybPlan(plan);
  const email = await notify(
    application.email,
    buildKybActivatedEmail({
      legalName: application.legalName,
      planName: planData.name,
      panelUrl: `${SITE_URL}/socio`,
      magicLink: provision.magicLink,
      siteUrl: SITE_URL,
    })
  );

  return {
    ok: true,
    already: false,
    status: 'En_Alta',
    plan,
    panel: {
      enabled: true,
      partnerId: provision.partnerId,
      account: provision.account,
    },
    email,
  };
}
