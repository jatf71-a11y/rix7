/**
 * Persistencia del onboarding KYB.
 *
 * Escribe con la **clave de servicio**: el flujo corre en el servidor, la
 * empresa no tiene sesión y la RLS de estas tablas no tiene políticas para
 * `anon` (los datos son de empresa). Si la clave no está configurada, el store
 * cae a una copia en memoria del proceso para poder probar el flujo completo en
 * desarrollo, y lo dice (`persistent: false`) en vez de fingir que guardó.
 *
 * El respaldo vive en `globalThis` por la misma razón que en `leads` y
 * `solicitudes`: Next compila cada ruta en su propio bundle y una variable de
 * módulo no sería la misma para la ruta que escribe y la que lee.
 */

import { isServiceRoleConfigured } from '@/lib/supabase/admin';
import type { NormalizedKybApplication } from './application';
import { isKybPlanId } from './plans';
import {
  isKybManualDecision,
  isKybStatus,
  isKybTokenPurpose,
  type KybEvaluation,
  type KybQuestion,
  type KybStatus,
} from './status';
import {
  KYB_COLUMNS,
  KYB_DECISION_COLUMNS,
  type KybApplication,
  type KybApplicationRow,
  type KybDecision,
  type KybDecisionRow,
  type KybEvaluationRecord,
  type KybEvaluationRow,
  type KybInformationRequest,
  type KybInformationRequestRow,
  type KybStatusPatch,
} from './types';

export type KybSource = 'supabase' | 'memory';

export interface KybResult<T> {
  ok: boolean;
  data?: T;
  persisted: boolean;
  found?: boolean;
  error?: string;
}

interface MemoryDb {
  applications: KybApplication[];
  evaluations: KybEvaluationRecord[];
  requests: KybInformationRequest[];
  decisions: KybDecision[];
  counter: number;
}

const memory = globalThis as typeof globalThis & { __rix7Kyb?: MemoryDb };

function db(): MemoryDb {
  memory.__rix7Kyb ??= {
    applications: [],
    evaluations: [],
    requests: [],
    decisions: [],
    counter: 0,
  };
  return memory.__rix7Kyb;
}

async function serviceClient() {
  const { createServiceRoleClient } = await import('@/lib/supabase/admin');
  return createServiceRoleClient();
}

/** ¿Hay base de datos detrás? Sin clave de servicio, no. */
export function kybSource(): KybSource {
  return isServiceRoleConfigured() ? 'supabase' : 'memory';
}

export function rowToApplication(row: KybApplicationRow): KybApplication {
  return {
    id: row.id,
    status: isKybStatus(row.status) ? row.status : 'Recibida',
    legalName: row.legal_name,
    rut: row.rut,
    website: row.website,
    domain: row.domain,
    email: row.email,
    contactName: row.contact_name,
    phone: row.phone,
    consent: row.consent,
    coverage: row.coverage === 'nacional' || row.coverage === 'regional' ? row.coverage : null,
    regions: Array.isArray(row.regions) ? row.regions : [],
    message: row.message ?? null,
    registrationKind:
      row.registration_kind === 'corredora' || row.registration_kind === 'inmobiliaria'
        ? row.registration_kind
        : null,
    contactRole: row.contact_role ?? null,
    score: typeof row.score === 'number' ? row.score : null,
    plan: isKybPlanId(row.plan) ? row.plan : null,
    panelEnabled: !!row.panel_enabled,
    activatedAt: row.activated_at,
    tokenHash: row.token_hash,
    tokenPurpose: isKybTokenPurpose(row.token_purpose) ? row.token_purpose : null,
    tokenExpiresAt: row.token_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function patchToRow(patch: KybStatusPatch): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.score !== undefined) row.score = patch.score;
  if (patch.plan !== undefined) row.plan = patch.plan;
  if (patch.panelEnabled !== undefined) row.panel_enabled = patch.panelEnabled;
  if (patch.activatedAt !== undefined) row.activated_at = patch.activatedAt;
  if (patch.tokenHash !== undefined) row.token_hash = patch.tokenHash;
  if (patch.tokenPurpose !== undefined) row.token_purpose = patch.tokenPurpose;
  if (patch.tokenExpiresAt !== undefined) row.token_expires_at = patch.tokenExpiresAt;
  return row;
}

export async function createApplication(
  input: NormalizedKybApplication
): Promise<KybResult<KybApplication>> {
  const now = new Date().toISOString();

  if (kybSource() === 'memory') {
    const store = db();
    store.counter += 1;
    const application: KybApplication = {
      id: `kyb-memoria-${store.counter}`,
      status: 'Recibida',
      legalName: input.legalName,
      rut: input.rut,
      website: input.website,
      domain: input.domain,
      email: input.email,
      contactName: input.contactName,
      phone: input.phone,
      consent: input.consent,
      coverage: input.coverage,
      regions: input.regions,
      message: input.message,
      registrationKind: input.registrationKind,
      contactRole: input.contactRole,
      score: null,
      plan: null,
      panelEnabled: false,
      activatedAt: null,
      tokenHash: null,
      tokenPurpose: null,
      tokenExpiresAt: null,
      createdAt: now,
      updatedAt: now,
    };
    store.applications = [application, ...store.applications];
    return { ok: true, data: application, persisted: false };
  }

  try {
    const supabase = await serviceClient();
    const id = crypto.randomUUID();
    const { data, error } = await supabase
      .from('kyb_applications')
      .insert({
        id,
        status: 'Recibida',
        legal_name: input.legalName,
        rut: input.rut,
        website: input.website,
        domain: input.domain,
        email: input.email,
        contact_name: input.contactName,
        phone: input.phone,
        consent: input.consent,
        coverage: input.coverage,
        regions: input.regions,
        message: input.message,
        registration_kind: input.registrationKind,
        contact_role: input.contactRole,
      })
      .select(KYB_COLUMNS)
      .single();

    if (error || !data) {
      return {
        ok: false,
        persisted: true,
        error: error?.message ?? 'No se pudo guardar la solicitud.',
      };
    }

    return { ok: true, data: rowToApplication(data as KybApplicationRow), persisted: true };
  } catch (error) {
    return { ok: false, persisted: true, error: messageOf(error) };
  }
}

export async function getApplication(id: string): Promise<KybResult<KybApplication>> {
  if (kybSource() === 'memory') {
    const found = db().applications.find((application) => application.id === id);
    return found
      ? { ok: true, data: found, persisted: false, found: true }
      : { ok: false, persisted: false, found: false, error: 'Solicitud no encontrada.' };
  }

  try {
    const supabase = await serviceClient();
    const { data, error } = await supabase
      .from('kyb_applications')
      .select(KYB_COLUMNS)
      .eq('id', id)
      .maybeSingle();

    if (error) return { ok: false, persisted: true, error: error.message };
    if (!data) {
      return { ok: false, persisted: true, found: false, error: 'Solicitud no encontrada.' };
    }
    return { ok: true, data: rowToApplication(data as KybApplicationRow), persisted: true, found: true };
  } catch (error) {
    return { ok: false, persisted: true, error: messageOf(error) };
  }
}

/** Resuelve la solicitud por el hash del token del correo (sin guardar el token). */
export async function findByTokenHash(hash: string): Promise<KybResult<KybApplication>> {
  if (!hash) return { ok: false, persisted: kybSource() === 'supabase', found: false, error: 'Token inválido.' };

  if (kybSource() === 'memory') {
    const found = db().applications.find((application) => application.tokenHash === hash);
    return found
      ? { ok: true, data: found, persisted: false, found: true }
      : { ok: false, persisted: false, found: false, error: 'Token inválido.' };
  }

  try {
    const supabase = await serviceClient();
    const { data, error } = await supabase
      .from('kyb_applications')
      .select(KYB_COLUMNS)
      .eq('token_hash', hash)
      .maybeSingle();

    if (error) return { ok: false, persisted: true, error: error.message };
    if (!data) {
      return { ok: false, persisted: true, found: false, error: 'Token inválido.' };
    }
    return { ok: true, data: rowToApplication(data as KybApplicationRow), persisted: true, found: true };
  } catch (error) {
    return { ok: false, persisted: true, error: messageOf(error) };
  }
}

export async function updateApplication(
  id: string,
  patch: KybStatusPatch
): Promise<KybResult<KybApplication>> {
  const now = new Date().toISOString();

  if (kybSource() === 'memory') {
    const store = db();
    const index = store.applications.findIndex((application) => application.id === id);
    if (index === -1) {
      return { ok: false, persisted: false, found: false, error: 'Solicitud no encontrada.' };
    }
    const updated: KybApplication = {
      ...store.applications[index],
      ...patch,
      updatedAt: now,
    };
    store.applications[index] = updated;
    return { ok: true, data: updated, persisted: false, found: true };
  }

  try {
    const supabase = await serviceClient();
    const { data, error } = await supabase
      .from('kyb_applications')
      .update({ ...patchToRow(patch), updated_at: now })
      .eq('id', id)
      .select(KYB_COLUMNS)
      .maybeSingle();

    if (error) return { ok: false, persisted: true, error: error.message };
    if (!data) {
      return { ok: false, persisted: true, found: false, error: 'Solicitud no encontrada.' };
    }
    return { ok: true, data: rowToApplication(data as KybApplicationRow), persisted: true, found: true };
  } catch (error) {
    return { ok: false, persisted: true, error: messageOf(error) };
  }
}

export async function listApplications(limit = 200): Promise<
  KybResult<{ applications: KybApplication[]; source: KybSource }>
> {
  if (kybSource() === 'memory') {
    return {
      ok: true,
      persisted: false,
      data: { applications: db().applications.slice(0, limit), source: 'memory' },
    };
  }

  try {
    const supabase = await serviceClient();
    const { data, error } = await supabase
      .from('kyb_applications')
      .select(KYB_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) return { ok: false, persisted: true, error: error.message };

    return {
      ok: true,
      persisted: true,
      data: {
        applications: (data as KybApplicationRow[]).map(rowToApplication),
        source: 'supabase',
      },
    };
  } catch (error) {
    return { ok: false, persisted: true, error: messageOf(error) };
  }
}

export async function saveEvaluation(
  record: Omit<KybEvaluationRecord, 'id'>
): Promise<KybResult<KybEvaluationRecord>> {
  const id = crypto.randomUUID();
  const stored: KybEvaluationRecord = { id, ...record };

  if (kybSource() === 'memory') {
    db().evaluations = [stored, ...db().evaluations];
    return { ok: true, data: stored, persisted: false };
  }

  try {
    const supabase = await serviceClient();
    const { error } = await supabase.from('kyb_evaluations').insert({
      id,
      application_id: record.applicationId,
      status_before: record.statusBefore,
      status_after: record.statusAfter,
      score: record.evaluation.score,
      checks: record.evaluation.checks,
      reasons: record.evaluation.reasons,
    });

    if (error) return { ok: false, persisted: true, error: error.message };
    return { ok: true, data: stored, persisted: true };
  } catch (error) {
    return { ok: false, persisted: true, error: messageOf(error) };
  }
}

export async function latestEvaluation(
  applicationId: string
): Promise<KybResult<KybEvaluation>> {
  if (kybSource() === 'memory') {
    const found = db().evaluations.find((record) => record.applicationId === applicationId);
    return found
      ? { ok: true, data: found.evaluation, persisted: false, found: true }
      : { ok: false, persisted: false, found: false, error: 'Sin evaluaciones.' };
  }

  try {
    const supabase = await serviceClient();
    const { data, error } = await supabase
      .from('kyb_evaluations')
      .select('id, application_id, status_before, status_after, score, checks, reasons, created_at')
      .eq('application_id', applicationId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return { ok: false, persisted: true, error: error.message };
    if (!data) return { ok: false, persisted: true, found: false, error: 'Sin evaluaciones.' };

    const row = data as KybEvaluationRow;
    const checks = Array.isArray(row.checks) ? row.checks : [];
    return {
      ok: true,
      persisted: true,
      found: true,
      data: {
        score: row.score,
        decision: row.status_after === 'Aceptada' || row.status_after === 'En_Alta'
          ? 'Aceptada'
          : 'Pendiente_Informacion',
        checks,
        // La pregunta viaja dentro de la verificación que no pasó; se reconstruye
        // acá para que el panel muestre lo mismo que vio la empresa sin guardar
        // dos veces el mismo texto.
        questions: checks
          .filter((check) => check.status !== 'pass' && !!check.question)
          .map((check) => ({ id: check.id, question: check.question as string })),
        reasons: Array.isArray(row.reasons) ? row.reasons : [],
        createdAt: row.created_at,
      },
    };
  } catch (error) {
    return { ok: false, persisted: true, error: messageOf(error) };
  }
}

/**
 * Guarda una decisión del equipo.
 *
 * Se escribe **después** de mover el estado: si el movimiento falla, no queda
 * un historial que diga que alguien decidió algo que nunca pasó. El autor viaja
 * como texto (correo de la cuenta de administración) y no como FK.
 */
export async function recordDecision(
  record: Omit<KybDecision, 'id' | 'createdAt'>
): Promise<KybResult<KybDecision>> {
  const stored: KybDecision = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...record,
  };

  if (kybSource() === 'memory') {
    db().decisions = [stored, ...db().decisions];
    return { ok: true, data: stored, persisted: false };
  }

  try {
    const supabase = await serviceClient();
    const { error } = await supabase.from('kyb_decisions').insert({
      id: stored.id,
      application_id: stored.applicationId,
      decision: stored.decision,
      status_before: stored.statusBefore,
      status_after: stored.statusAfter,
      note: stored.note,
      questions: stored.questions,
      decided_by: stored.decidedBy,
      created_at: stored.createdAt,
    });
    if (error) return { ok: false, persisted: true, error: error.message };
    return { ok: true, data: stored, persisted: true };
  } catch (error) {
    return { ok: false, persisted: true, error: messageOf(error) };
  }
}

/**
 * Historial de decisiones de una solicitud, de la más reciente a la más vieja.
 *
 * Devuelve `[]` si la tabla no responde: el panel puede mostrar la evaluación
 * sin el historial, y perder la pantalla entera por un historial vacío sería
 * peor que mostrarla incompleta.
 */
export async function listDecisions(applicationId: string, limit = 20): Promise<KybDecision[]> {
  if (kybSource() === 'memory') {
    return db()
      .decisions.filter((decision) => decision.applicationId === applicationId)
      .slice(0, limit);
  }

  try {
    const supabase = await serviceClient();
    const { data, error } = await supabase
      .from('kyb_decisions')
      .select(KYB_DECISION_COLUMNS)
      .eq('application_id', applicationId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !data) return [];
    return (data as KybDecisionRow[])
      .map(rowToDecision)
      .filter((decision): decision is KybDecision => decision !== null);
  } catch {
    return [];
  }
}

function rowToDecision(row: KybDecisionRow): KybDecision | null {
  // Una fila con una decisión que el código no conoce no se muestra: el panel
  // no puede ofrecer acciones sobre algo que no entiende.
  if (!isKybManualDecision(row.decision)) return null;

  return {
    id: row.id,
    applicationId: row.application_id,
    decision: row.decision,
    statusBefore: isKybStatus(row.status_before) ? row.status_before : 'Recibida',
    statusAfter: isKybStatus(row.status_after) ? row.status_after : 'Recibida',
    note: row.note,
    questions: Array.isArray(row.questions) ? row.questions : [],
    decidedBy: row.decided_by,
    createdAt: row.created_at,
  };
}

export async function createInformationRequest(
  applicationId: string,
  questions: KybQuestion[]
): Promise<KybResult<KybInformationRequest>> {
  const request: KybInformationRequest = {
    id: crypto.randomUUID(),
    applicationId,
    questions,
    answers: {},
    requestedAt: new Date().toISOString(),
    answeredAt: null,
  };

  if (kybSource() === 'memory') {
    db().requests = [request, ...db().requests];
    return { ok: true, data: request, persisted: false };
  }

  try {
    const supabase = await serviceClient();
    const { error } = await supabase.from('kyb_information_requests').insert({
      id: request.id,
      application_id: applicationId,
      questions,
    });
    if (error) return { ok: false, persisted: true, error: error.message };
    return { ok: true, data: request, persisted: true };
  } catch (error) {
    return { ok: false, persisted: true, error: messageOf(error) };
  }
}

export async function latestInformationRequest(
  applicationId: string
): Promise<KybInformationRequest | null> {
  if (kybSource() === 'memory') {
    return db().requests.find((request) => request.applicationId === applicationId) ?? null;
  }

  try {
    const supabase = await serviceClient();
    const { data, error } = await supabase
      .from('kyb_information_requests')
      .select('id, application_id, questions, answers, requested_at, answered_at')
      .eq('application_id', applicationId)
      .order('requested_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return rowToInformationRequest(data as KybInformationRequestRow);
  } catch {
    return null;
  }
}

function rowToInformationRequest(row: KybInformationRequestRow): KybInformationRequest {
  const answers: Record<string, string> = {};
  if (Array.isArray(row.answers)) {
    for (const entry of row.answers) {
      if (entry && typeof entry.id === 'string' && typeof entry.answer === 'string') {
        answers[entry.id] = entry.answer;
      }
    }
  }

  return {
    id: row.id,
    applicationId: row.application_id,
    questions: Array.isArray(row.questions) ? row.questions : [],
    answers,
    requestedAt: row.requested_at,
    answeredAt: row.answered_at,
  };
}

/** Guarda las respuestas de la empresa en la ronda abierta y la cierra. */
export async function saveAnswers(
  applicationId: string,
  answers: { id: string; answer: string }[]
): Promise<KybResult<KybInformationRequest>> {
  const answeredAt = new Date().toISOString();

  if (kybSource() === 'memory') {
    const store = db();
    const index = store.requests.findIndex(
      (request) => request.applicationId === applicationId && !request.answeredAt
    );
    if (index === -1) {
      return { ok: false, persisted: false, found: false, error: 'No hay una ronda de preguntas abierta.' };
    }
    const updated: KybInformationRequest = {
      ...store.requests[index],
      answers: Object.fromEntries(answers.map(({ id, answer }) => [id, answer])),
      answeredAt,
    };
    store.requests[index] = updated;
    return { ok: true, data: updated, persisted: false, found: true };
  }

  try {
    const supabase = await serviceClient();
    const { data: open, error: findError } = await supabase
      .from('kyb_information_requests')
      .select('id')
      .eq('application_id', applicationId)
      .is('answered_at', null)
      .order('requested_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findError) return { ok: false, persisted: true, error: findError.message };
    if (!open) {
      return { ok: false, persisted: true, found: false, error: 'No hay una ronda de preguntas abierta.' };
    }

    const { data, error } = await supabase
      .from('kyb_information_requests')
      .update({ answers, answered_at: answeredAt })
      .eq('id', (open as { id: string }).id)
      .select('id, application_id, questions, answers, requested_at, answered_at')
      .maybeSingle();

    if (error) return { ok: false, persisted: true, error: error.message };
    if (!data) {
      return { ok: false, persisted: true, found: false, error: 'No hay una ronda de preguntas abierta.' };
    }
    return {
      ok: true,
      data: rowToInformationRequest(data as KybInformationRequestRow),
      persisted: true,
      found: true,
    };
  } catch (error) {
    return { ok: false, persisted: true, error: messageOf(error) };
  }
}

/** Estado en el que debe estar una solicitud para cada token. */
export function tokenAllows(application: KybApplication, purpose: 'answers' | 'activation'): boolean {
  if (!application.tokenPurpose || application.tokenPurpose !== purpose) return false;
  if (!application.tokenExpiresAt) return false;
  if (Date.parse(application.tokenExpiresAt) <= Date.now()) return false;
  if (purpose === 'answers') return application.status === 'Pendiente_Informacion';
  return application.status === 'En_Alta' || application.status === 'Aceptada';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Error inesperado en la base de datos.';
}
