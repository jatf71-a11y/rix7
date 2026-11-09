/**
 * Orquestación del onboarding KYB.
 *
 * Es el único lugar que mueve el estado. Las rutas solo validan la entrada y
 * llaman acá; el motor decide, y este módulo aplica la decisión, guarda el
 * historial, emite el token y manda el correo.
 *
 * Secuencia:
 *
 *   alta → Recibida → En_Evaluacion → Aceptada → Calificado   (token de activation)
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
  buildKybCaptacionEmail,
  buildKybEvaluatingEmail,
  buildKybPendingEmail,
  buildKybProposalEmail,
  buildKybQualifiedEmail,
  buildKybReceivedEmail,
  buildKybRejectedEmail,
  buildKybReminderEmail,
  kybAccessUrl,
  kybProposalUrl,
} from '@/lib/email/kybEmails';
import { normalizeDecision } from './decisions';
import { DEBT_REPORT_QUESTION_ID, debtReportKindFor, withDebtReport } from './debtReport';
import { isDebtReportFromOwner } from './documents';
import {
  altaPlanSummary,
  latestProposal,
  normalizeCommercial,
  normalizeProposal,
  profileForRegistration,
  proposalPlanName,
  subscriptionTerms,
  type AltaPlanSummary,
  type KybCommercialTerms,
  type KybProposal,
} from './proposal';
import { captacionMonthlyFor, profileLabel, type LeadBracket } from './planPricing';
import { SITE_URL } from '@/lib/site';
import { findApplicantDuplicate, type ApplicantDuplicate } from '@/lib/data/applicantDuplicates';
import { listSolicitudesForReview } from '@/lib/data/solicitudesStore';
import { getKybPlan, isKybPlanId, type KybPlanId } from './plans';
import {
  createApplication,
  createInformationRequest,
  findByTokenHash,
  getApplication,
  latestInformationRequest,
  listApplications,
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
import { readPlanPricing } from '@/lib/data/planPricingStore';
import { syncPartnerCca } from '@/lib/data/ccaLedger';
import {
  assertTransition,
  canDecideManually,
  canEvaluate,
  KYB_STATUS_LABELS,
  isKybProposalDecision,
  type KybEvaluation,
  type KybProposalDecision,
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

/**
 * Correo del paso **Calificado**: perfil de socio y condiciones de la suscripción.
 *
 * Se exporta porque también lo manda el puente registro→alta: un registro de
 * corredora que se aprueba crea su alta ya en `Calificado`, y esa persona tiene
 * que recibir sus condiciones igual que una empresa que llegó por el formulario.
 * Los montos se leen de **Planes** en cada envío, no del código.
 */
export async function notifyQualifiedForApplication(
  application: KybApplication
): Promise<EmailOutcome> {
  const pricing = await readPlanPricing();

  return notify(
    application.email,
    buildKybQualifiedEmail({
      legalName: application.legalName,
      contactName: application.contactName,
      siteUrl: SITE_URL,
      terms: subscriptionTerms(application.registrationKind, pricing.config),
    })
  );
}

export interface SubmitResult {
  ok: boolean;
  applicationId?: string;
  status?: KybStatus;
  score?: number;
  questions?: KybQuestion[];
  persisted?: boolean;
  email?: EmailOutcome;
  /** Ya había un registro con el mismo RUT o correo (no impide el alta). */
  duplicate?: ApplicantDuplicate | null;
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

  // ¿Ya hay otra ficha con este RUT o correo? No se rechaza el alta —puede ser
  // una corrección o un caso legítimo— pero el solicitante se entera y el panel
  // ve que hay dos. Se ignora la fila recién creada, que coincide consigo misma.
  let duplicate: ApplicantDuplicate | null = null;
  try {
    const [applications, solicitudes] = await Promise.all([
      listApplications(),
      listSolicitudesForReview(),
    ]);
    duplicate = findApplicantDuplicate({
      rut: created.data.rut,
      email: created.data.email,
      applications: applications.data?.applications ?? [],
      solicitudes,
      ignoreIds: [created.data.id],
    });
  } catch (error) {
    // La ficha ya está guardada: no poder comprobar duplicados no la tumba.
    console.error('[kyb] no se pudo comprobar si el solicitante ya existía:', error);
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
    duplicate,
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
 * pasa a `Calificado`) o en `Recibida` si algo falló antes de evaluar.
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
        // Las declaraciones del registro viajan al motor. Sin ellas se le
        // vuelve a preguntar por un sitio (o un correo) que la empresa ya
        // contestó, y la respuesta guardada no cambia la evaluación.
        hasWebsite: application.hasWebsite,
        hasCompanyEmail: application.hasCompanyEmail,
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

  // La ronda que se guarda, se manda y se responde incluye el informe de deudas
  // de la CMF: el motor decide con sus verificaciones, pero a quien queda
  // pendiente se le pide el documento del perfil además de las aclaraciones. Se
  // agrega acá —y no en el motor— para que la evaluación guardada y la ronda
  // sean exactamente lo que ve la empresa.
  if (evaluation.decision === 'Pendiente_Informacion') {
    evaluation = {
      ...evaluation,
      questions: withDebtReport(
        evaluation.questions,
        debtReportKindFor(application.registrationKind)
      ),
    };
  }

  let email: EmailOutcome | undefined;

  if (evaluation.decision === 'Aceptada') {
    const accepted = assertTransition('En_Evaluacion', 'Aceptada');
    if (!accepted.ok) return { ok: false, error: accepted.error };

    await updateApplication(id, { status: 'Aceptada', score: evaluation.score });

    const inAlta = assertTransition('Aceptada', 'Calificado');
    if (!inAlta.ok) return { ok: false, error: inAlta.error };

    const updated = await updateApplication(id, { status: 'Calificado', score: evaluation.score });
    if (!updated.ok || !updated.data) {
      return { ok: false, error: updated.error ?? 'No se pudo guardar el estado.' };
    }

    // Aprobada no emite token: lo que sigue es la propuesta comercial, y el
    // enlace de la propuesta sale cuando el equipo la envía. Antes acá se emitía
    // el token de activación y el candidato pasaba directo a elegir plan.
    const refreshed = await getApplication(id);

    email = await notifyQualifiedForApplication(application);

    await saveEvaluation({
      applicationId: id,
      statusBefore: before,
      statusAfter: 'Calificado',
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
 * (`Aceptada` → `Calificado`, que es el estado desde el que la empresa elige plan),
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
  // Lo que se le pide a la empresa. Pedir información suma el informe de deudas
  // del perfil; aprobar o rechazar no le pide nada.
  let askedQuestions: KybQuestion[] = chosen.questions;

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

    const inAlta = assertTransition('Aceptada', 'Calificado');
    if (!inAlta.ok) return { ok: false, code: 'conflict', error: inAlta.error };

    // La ronda de preguntas se cierra con la aprobación: el token de respuestas
    // deja de servir en el mismo movimiento, así el enlace del correo anterior no
    // sigue abierto sobre una solicitud que ya no espera nada.
    const updated = await updateApplication(id, {
      status: 'Calificado',
      tokenHash: null,
      tokenPurpose: null,
      tokenExpiresAt: null,
    });
    if (!updated.ok) {
      return { ok: false, code: 'store', error: updated.error ?? 'No se pudo guardar el estado.' };
    }
    after = 'Calificado';

    // Igual que en el camino automático: aprobar no emite token. El enlace lo
    // manda el equipo con la propuesta comercial, que es el paso que sigue y el
    // que lleva los números. El correo de calificación sí lleva las condiciones
    // del perfil, porque es la primera vez que la persona ve la plata.
    email = await notifyQualifiedForApplication(application);
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

    // El pedido de información siempre lleva el informe de deudas del perfil:
    // es lo que el equipo necesita para decidir y lo que la empresa puede
    // adjuntar en el mismo enlace del correo.
    askedQuestions = withDebtReport(
      chosen.questions,
      debtReportKindFor(application.registrationKind)
    );

    await createInformationRequest(id, askedQuestions);
    const { token } = await issueToken(id, 'answers');

    email = await notify(
      application.email,
      buildKybPendingEmail({
        legalName: application.legalName,
        contactName: application.contactName,
        questions: askedQuestions,
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
    questions: askedQuestions,
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

  // La pregunta del informe no se contesta con texto: la respuesta tiene que ser
  // el id de un PDF subido con este mismo token. Sin esta comprobación la ronda
  // se cerraría con un documento que no existe y la decisión quedaría sin el
  // respaldo que el equipo necesita.
  const reportId = submitted.get(DEBT_REPORT_QUESTION_ID);
  if (reportId && !(await isDebtReportFromOwner('alta', application.id, reportId))) {
    return {
      ok: false,
      error: 'El informe de deudas no se terminó de subir. Súbelo de nuevo desde el enlace.',
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
  /**
   * El plan que la empresa confirma en el paso de plan, con los montos de su
   * propuesta (o, sin propuesta, los de **Planes** para su perfil).
   *
   * Se arma solo en `Alta` con el panel pendiente: es la única pantalla que
   * muestra precios, y leer la configuración para todas las demás etapas sería
   * una consulta a la base en cada apertura del enlace.
   */
  planSummary?: AltaPlanSummary | null;
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

  let planSummary: AltaPlanSummary | null = null;
  if (application.status === 'Alta' && !application.panelEnabled) {
    const pricing = await readPlanPricing();
    planSummary = altaPlanSummary({
      plan: isKybPlanId(application.plan) ? application.plan : null,
      proposal: latestProposal(application.proposal),
      kind: application.registrationKind,
      config: pricing.config,
    });
  }

  return {
    ok: true,
    status: application.status,
    legalName: application.legalName,
    questions,
    plan: application.plan,
    panelEnabled: application.panelEnabled,
    planSummary,
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
 *
 * Al terminar deja la solicitud en `Operando`, no en `Calificado`: el alta ya se
 * cerró —la empresa está inscrita, eligió su plan y tiene su panel habilitado—
 * y es lo que el pipeline muestra como cliente activo. No hay cobro en línea
 * todavía: el plan elegido es lo que el sistema puede saber, y el cobro se
 * confirma fuera.
 */
export async function activateKybPlan({
  token,
  plan,
  ccaAccepted,
}: {
  token: unknown;
  plan: unknown;
  /** El solicitante aprobó el cobro del CCA en esta misma pantalla. */
  ccaAccepted?: unknown;
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

  // El CCA es un cargo mensual que depende de las publicaciones del socio: el
  // alta no se cierra sin que lo haya aprobado. Se exige solo acá (no en la
  // forma) para que un reintento de una alta ya autorizada siga funcionando.
  if (ccaAccepted !== true) {
    return {
      ok: false,
      error:
        'Falta autorizar el cobro del CCA: es un cargo mensual sobre tus publicaciones y el alta no se puede cerrar sin tu aprobación.',
    };
  }

  const provision = await provisionCompanyPanel(application);
  if (!provision.ok) {
    return { ok: false, error: provision.error ?? 'No se pudo habilitar el panel.' };
  }

  const updated = await updateApplication(application.id, {
    plan,
    panelEnabled: true,
    activatedAt: new Date().toISOString(),
    // La autorización del CCA queda fechada en la solicitud: es la prueba de que
    // el cobro se aprobó antes de la primera factura. Si ya estaba (reintento),
    // se conserva la fecha original.
    ccaAuthorizedAt: application.ccaAuthorizedAt ?? new Date().toISOString(),
    // `Alta`, no `Operando`: el plan elegido todavía no está pagado. La solicitud
    // pasa a operando cuando la cobranza registra el pago del período; si se
    // marcara acá, un cliente sin pagar aparecería como activo en el pipeline.
    status: 'Alta',
    // El socio que acaba de nacer: sin este vínculo la cobranza no sabría qué
    // alta corresponde a cada socio, y el pago no podría moverlo a `Operando`.
    partnerId: provision.partnerId ?? null,
    // El token se conserva hasta su vencimiento para tolerar reintentos de red:
    // una segunda activación no vuelve a crear nada y responde `already`. No
    // habilita nada nuevo porque `panel_enabled` ya está en true.
  });

  if (!updated.ok || !updated.data) {
    return { ok: false, error: updated.error ?? 'No se pudo guardar la activación.' };
  }

  // Línea base de la cuenta corriente del CCA. Un socio recién creado no tiene
  // cartera, así que el primer movimiento es de $0 y no manda correo: sirve para
  // que el primer cambio de monto tenga contra qué compararse. Se registra sin
  // poder tumbar el alta: la activación ya está guardada.
  if (provision.partnerId) {
    const cca = await syncPartnerCca(provision.partnerId, { reason: 'alta' });
    if (!cca.ok) console.error('[kyb] no se pudo abrir la cuenta corriente del CCA:', cca.error);
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
    status: 'Alta',
    plan,
    panel: {
      enabled: true,
      partnerId: provision.partnerId,
      account: provision.account,
    },
    email,
  };
}

export interface ProposalSendResult {
  ok: boolean;
  status?: KybStatus;
  proposal?: KybProposal;
  email?: EmailOutcome;
  error?: string;
  code?: 'not_found' | 'invalid' | 'conflict' | 'database';
}

/**
 * Envía la propuesta comercial de una solicitud calificada.
 *
 * El estado se mueve a `Propuesta_Comercial` en la misma escritura que guarda la
 * propuesta: si el correo falla, el equipo ve la propuesta enviada y puede
 * reenviarla; lo que no puede pasar es que el candidato reciba un enlace a una
 * solicitud que sigue «calificada», porque ese token no abriría nada.
 */
export async function sendKybProposal({
  id,
  plan,
  altaClp,
  monthlyClp,
  note,
}: {
  id: string;
  plan: unknown;
  altaClp?: unknown;
  monthlyClp?: unknown;
  note?: unknown;
}): Promise<ProposalSendResult> {
  const found = await getApplication(id);
  if (!found.ok || !found.data) {
    return { ok: false, code: 'not_found', error: 'Solicitud no encontrada.' };
  }
  const application = found.data;

  if (application.status !== 'Calificado') {
    return {
      ok: false,
      code: 'conflict',
      error: `Solo se envía una propuesta a una solicitud calificada. Esta está en «${
        KYB_STATUS_LABELS[application.status]
      }».`,
    };
  }

  const validation = normalizeProposal(
    { plan, altaClp, monthlyClp, note },
    application.registrationKind
  );
  if (!validation.ok) return { ok: false, code: 'invalid', error: validation.error };
  const data = validation.data;

  const transition = assertTransition('Calificado', 'Propuesta_Comercial');
  if (!transition.ok) return { ok: false, code: 'conflict', error: transition.error };

  const proposal: KybProposal = {
    planId: data.planId,
    altaClp: data.altaClp,
    monthlyClp: data.monthlyClp,
    note: data.note,
    sentAt: new Date().toISOString(),
    decidedAt: null,
    decision: null,
    // Las condiciones (CCA y captación) se completan al aceptar, no al enviar.
    commercial: null,
  };

  const updated = await updateApplication(id, {
    status: 'Propuesta_Comercial',
    plan: data.planId,
    proposal: [...application.proposal, proposal],
  });
  if (!updated.ok || !updated.data) {
    return { ok: false, code: 'database', error: updated.error ?? 'No se pudo guardar la propuesta.' };
  }

  const { token } = await issueToken(id, 'proposal');

  const email = await notify(
    application.email,
    buildKybProposalEmail({
      legalName: application.legalName,
      contactName: application.contactName,
      planName: proposalPlanName(data.planId),
      altaClp: data.altaClp,
      monthlyClp: data.monthlyClp,
      note: data.note,
      token,
      siteUrl: SITE_URL,
    })
  );

  return { ok: true, status: 'Propuesta_Comercial', proposal, email };
}

export interface ProposalView {
  ok: boolean;
  legalName?: string;
  status?: KybStatus;
  proposal?: KybProposal;
  /** Perfil de socio del registro, para nombrarlo en la pantalla. */
  profileLabel?: string;
  /** Suscripción Captación Activa del perfil, en pesos por mes. */
  captacionMonthlyClp?: number;
  /** Tramos de acceso a leads, para explicar el plan de captación. */
  captacion?: { ventas: LeadBracket[]; arriendos: LeadBracket[] };
  error?: string;
}

/**
 * Lo que se puede mostrar de una propuesta con su token, sin exponer nada más.
 *
 * Además de la propuesta lleva el perfil y los precios del plan de captación,
 * porque la decisión que se toma en esa pantalla incluye ese producto: el
 * candidato tiene que ver cuánto cuesta cada pieza antes de decir que sí. El CCA
 * no aparece: se resuelve después del alta, desde el panel del socio.
 */
export async function kybProposalByToken(token: unknown): Promise<ProposalView> {
  if (!isKybTokenShape(token)) return { ok: false, error: 'El enlace no es válido.' };

  const found = await findByTokenHash(hashKybToken(token));
  if (!found.ok || !found.data) return { ok: false, error: 'El enlace no es válido o ya expiró.' };
  const application = found.data;
  const proposal = latestProposal(application.proposal);

  if (!proposal) return { ok: false, error: 'Este enlace no tiene una propuesta asociada.' };
  if (application.tokenPurpose !== 'proposal' || !application.tokenExpiresAt) {
    return { ok: false, error: 'Este enlace ya fue usado. Escríbenos y te enviamos otro.' };
  }
  if (Date.parse(application.tokenExpiresAt) <= Date.now()) {
    return { ok: false, error: 'El enlace expiró. Escríbenos y te enviamos uno nuevo.' };
  }

  const pricing = await readPlanPricing();
  const profile = profileForRegistration(application.registrationKind);

  return {
    ok: true,
    legalName: application.legalName,
    status: application.status,
    proposal,
    profileLabel: profileLabel(profile),
    captacionMonthlyClp: captacionMonthlyFor(pricing.config, profile),
    captacion: {
      ventas: pricing.config.captacion.ventas,
      arriendos: pricing.config.captacion.arriendos,
    },
  };
}

export interface ProposalDecisionResult {
  ok: boolean;
  already?: boolean;
  status?: KybStatus;
  decision?: KybProposalDecision;
  email?: EmailOutcome;
  error?: string;
}

/**
 * El candidato acepta o rechaza la propuesta.
 *
 * Aceptar no habilita nada por sí solo: mueve a `Alta` y emite el token de
 * activación para que elija plan. Operando sigue estando detrás del pago.
 */
export async function decideKybProposal({
  token,
  decision,
  captacion,
}: {
  token: unknown;
  decision: unknown;
  /**
   * La única decisión que acompaña al «de acuerdo».
   *
   * Aceptar la propuesta es aceptar el plan y elegir si se contrata la captación
   * de leads. El CCA quedó afuera a propósito: se determina después del alta,
   * con las publicaciones que el socio ya tiene cargadas.
   */
  captacion?: unknown;
}): Promise<ProposalDecisionResult> {
  if (!isKybTokenShape(token)) return { ok: false, error: 'El enlace no es válido.' };
  if (!isKybProposalDecision(decision)) return { ok: false, error: 'La decisión no es válida.' };

  const found = await findByTokenHash(hashKybToken(token));
  if (!found.ok || !found.data) return { ok: false, error: 'El enlace no es válido o ya expiró.' };
  const application = found.data;

  const current = latestProposal(application.proposal);
  if (!current) return { ok: false, error: 'Este enlace no tiene una propuesta asociada.' };

  // Idempotencia: un doble clic o un reintento de red no vuelve a mover nada y
  // devuelve la decisión que ya estaba tomada.
  if (current.decision) {
    return {
      ok: true,
      already: true,
      status: application.status,
      decision: current.decision,
    };
  }

  if (!tokenAllows(application, 'proposal')) {
    return { ok: false, error: 'Esta propuesta ya no está disponible.' };
  }

  // Las condiciones comerciales solo se validan al aceptar: rechazar no obliga a
  // decidir nada sobre la captación.
  const now = new Date().toISOString();
  let commercial: KybCommercialTerms | null = null;
  if (decision === 'aceptada') {
    const validated = normalizeCommercial({ captacion });
    if (!validated.ok) return { ok: false, error: validated.error };

    commercial = { ...validated.data, acceptedAt: now };
  }

  const decided: KybProposal = {
    ...current,
    decidedAt: now,
    decision,
    commercial,
  };
  const history = [...application.proposal.slice(0, -1), decided];

  if (decision === 'rechazada') {
    const transition = assertTransition('Propuesta_Comercial', 'Rechazada');
    if (!transition.ok) return { ok: false, error: transition.error };

    const updated = await updateApplication(application.id, {
      status: 'Rechazada',
      proposal: history,
    });
    if (!updated.ok) return { ok: false, error: updated.error ?? 'No se pudo guardar la decisión.' };

    const email = await notify(
      application.email,
      buildKybRejectedEmail({
        legalName: application.legalName,
        contactName: application.contactName,
        reason:
          'La propuesta comercial no fue aceptada. Si quieres que revisemos los números, responde este correo y lo vemos juntos.',
        siteUrl: SITE_URL,
      })
    );

    return { ok: true, status: 'Rechazada', decision, email };
  }

  const transition = assertTransition('Propuesta_Comercial', 'Alta');
  if (!transition.ok) return { ok: false, error: transition.error };

  const updated = await updateApplication(application.id, {
    status: 'Alta',
    proposal: history,
  });
  if (!updated.ok) return { ok: false, error: updated.error ?? 'No se pudo guardar la decisión.' };

  // El alta ya puede ejecutarse: se emite el token con el que confirma el plan.
  const { token: activationToken } = await issueToken(application.id, 'activation');

  // El correo lleva los mismos números que la pantalla del alta: los de la
  // propuesta aceptada, que salieron de **Planes**. El catálogo del código ya no
  // tiene precios que puedan contradecirlos.
  const pricing = await readPlanPricing();
  const planSummary = altaPlanSummary({
    plan: decided.planId,
    proposal: decided,
    kind: application.registrationKind,
    config: pricing.config,
  });

  // La captación, si la tomó, se cobra aparte de la mensualidad: el precio sale
  // de **Planes** para el perfil del socio.
  const captacionMonthlyClp = commercial?.captacion
    ? captacionMonthlyFor(pricing.config, profileForRegistration(application.registrationKind))
    : null;

  const email = await notify(
    application.email,
    buildKybAcceptedEmail({
      legalName: application.legalName,
      contactName: application.contactName,
      token: activationToken,
      siteUrl: SITE_URL,
      plan: planSummary,
      // La captación, si la tomó, viaja con el correo para que la confirmación
      // diga todo lo que se contrató. El CCA no: se determina más adelante.
      captacionMonthlyClp,
    })
  );

  // El plan de captación se explica en su propio correo: es el producto que más
  // se malentiende y el que genera la factura del mes siguiente.
  if (commercial?.captacion) {
    await notify(
      application.email,
      buildKybCaptacionEmail({
        legalName: application.legalName,
        contactName: application.contactName,
        siteUrl: SITE_URL,
        profileLabel: profileLabel(profileForRegistration(application.registrationKind)),
        monthlyClp: captacionMonthlyClp ?? 0,
        ventas: pricing.config.captacion.ventas,
        arriendos: pricing.config.captacion.arriendos,
      })
    );
  }

  return { ok: true, status: 'Alta', decision, email };
}

export interface ResendKybResult {
  ok: boolean;
  status?: KybStatus;
  email?: EmailOutcome;
  error?: string;
  code?: 'not_found' | 'conflict' | 'store';
}

/**
 * Reenvía el enlace del paso en el que está detenida un alta.
 *
 * El token en claro no se guarda, así que no se puede reenviar «el mismo»
 * enlace: se emite uno nuevo para el paso vigente y el anterior deja de servir.
 * Es lo que necesita quien escribe «no me llegó» o «lo abrí tarde», y también lo
 * que usa el job de solicitudes detenidas para insistir sin inventar otro
 * mecanismo.
 *
 * `reminder` cambia el correo, no el enlace: el recordatorio dice en qué paso
 * está la empresa y cuánto falta para el cierre, en vez de repetir el asunto del
 * primer aviso.
 */
export async function resendKybLink(
  id: string,
  options: { reminder?: boolean; closingInDays?: number } = {}
): Promise<ResendKybResult> {
  const found = await getApplication(id);
  if (!found.ok || !found.data) {
    return { ok: false, code: 'not_found', error: 'Solicitud no encontrada.' };
  }
  const application = found.data;

  if (application.panelEnabled) {
    return {
      ok: false,
      code: 'conflict',
      status: application.status,
      error: 'El alta ya está completa: no hay un enlace pendiente que reenviar.',
    };
  }

  if (application.status === 'Pendiente_Informacion') {
    const request = await latestInformationRequest(id);
    const questions = request?.questions ?? [];
    if (questions.length === 0) {
      return {
        ok: false,
        code: 'conflict',
        status: application.status,
        error: 'Esta solicitud no tiene preguntas guardadas. Usa «Pedir información» para abrir una ronda.',
      };
    }

    const { token } = await issueToken(id, 'answers');
    const built = options.reminder
      ? buildKybReminderEmail({
          legalName: application.legalName,
          contactName: application.contactName,
          step: 'answers',
          link: kybAccessUrl(SITE_URL, token),
          siteUrl: SITE_URL,
          closingInDays: options.closingInDays,
        })
      : buildKybPendingEmail({
          legalName: application.legalName,
          contactName: application.contactName,
          questions,
          token,
          siteUrl: SITE_URL,
        });

    const email = await notify(application.email, built);
    return { ok: true, status: application.status, email };
  }

  if (application.status === 'Propuesta_Comercial') {
    const proposal = latestProposal(application.proposal);
    if (!proposal) {
      return {
        ok: false,
        code: 'conflict',
        status: application.status,
        error: 'Esta solicitud no tiene una propuesta guardada.',
      };
    }

    const { token } = await issueToken(id, 'proposal');
    const built = options.reminder
      ? buildKybReminderEmail({
          legalName: application.legalName,
          contactName: application.contactName,
          step: 'proposal',
          link: kybProposalUrl(SITE_URL, token),
          siteUrl: SITE_URL,
          closingInDays: options.closingInDays,
        })
      : buildKybProposalEmail({
          legalName: application.legalName,
          contactName: application.contactName,
          planName: proposalPlanName(proposal.planId),
          altaClp: proposal.altaClp,
          monthlyClp: proposal.monthlyClp,
          note: proposal.note,
          token,
          siteUrl: SITE_URL,
        });

    const email = await notify(application.email, built);
    return { ok: true, status: application.status, email };
  }

  if (application.status === 'Alta' && application.plan) {
    const pricing = await readPlanPricing();
    const planSummary = altaPlanSummary({
      plan: application.plan,
      proposal: latestProposal(application.proposal),
      kind: application.registrationKind,
      config: pricing.config,
    });

    const { token } = await issueToken(id, 'activation');
    const built = options.reminder
      ? buildKybReminderEmail({
          legalName: application.legalName,
          contactName: application.contactName,
          step: 'activation',
          link: kybAccessUrl(SITE_URL, token),
          siteUrl: SITE_URL,
        })
      : buildKybAcceptedEmail({
          legalName: application.legalName,
          contactName: application.contactName,
          token,
          siteUrl: SITE_URL,
          plan: planSummary,
        });

    const email = await notify(application.email, built);
    return { ok: true, status: application.status, email };
  }

  return {
    ok: false,
    code: 'conflict',
    status: application.status,
    error: `La solicitud está en «${KYB_STATUS_LABELS[application.status]}» y no tiene un enlace pendiente para reenviar.`,
  };
}
