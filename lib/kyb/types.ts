/**
 * Tipos persistidos del onboarding KYB.
 *
 * La fila de Supabase va en snake_case y la aplicación en camelCase; el mapeo
 * vive acá para que el store y el motor compartan una sola traducción.
 */

import type { KybCoverage, KybRegistrationKind } from './application';
import type { KybPlanId } from './plans';
import type {
  KybCheck,
  KybEvaluation,
  KybManualDecision,
  KybQuestion,
  KybStatus,
  KybTokenPurpose,
} from './status';

export interface KybApplication {
  id: string;
  status: KybStatus;
  legalName: string;
  rut: string;
  website: string | null;
  domain: string | null;
  email: string;
  contactName: string;
  phone: string;
  consent: boolean;
  /** `nacional` / `regional` cuando el registro lo informa; el alta directa no. */
  coverage: KybCoverage | null;
  /** Regiones declaradas; vacío para cobertura nacional o sin dato. */
  regions: string[];
  message: string | null;
  /** Cómo se registró la empresa; `null` en el alta directa por API. */
  registrationKind: KybRegistrationKind | null;
  contactRole: string | null;
  score: number | null;
  plan: KybPlanId | null;
  panelEnabled: boolean;
  activatedAt: string | null;
  /** SHA-256 del token vigente. El valor en claro no se guarda nunca. */
  tokenHash: string | null;
  tokenPurpose: KybTokenPurpose | null;
  tokenExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KybApplicationRow {
  id: string;
  status: string;
  legal_name: string;
  rut: string;
  website: string | null;
  domain: string | null;
  email: string;
  contact_name: string;
  phone: string;
  consent: boolean;
  coverage: string | null;
  regions: string[] | null;
  message: string | null;
  registration_kind: string | null;
  contact_role: string | null;
  score: number | null;
  plan: string | null;
  panel_enabled: boolean;
  activated_at: string | null;
  token_hash: string | null;
  token_purpose: string | null;
  token_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export const KYB_COLUMNS =
  'id, status, legal_name, rut, website, domain, email, contact_name, phone, consent, coverage, regions, message, registration_kind, contact_role, score, plan, panel_enabled, activated_at, token_hash, token_purpose, token_expires_at, created_at, updated_at';

export interface KybEvaluationRecord {
  id: string;
  applicationId: string;
  statusBefore: KybStatus;
  statusAfter: KybStatus;
  evaluation: KybEvaluation;
}

export interface KybEvaluationRow {
  id: string;
  application_id: string;
  status_before: string;
  status_after: string;
  score: number;
  checks: KybCheck[];
  reasons: string[];
  created_at: string;
}

export interface KybInformationRequest {
  id: string;
  applicationId: string;
  questions: KybQuestion[];
  answers: Record<string, string>;
  requestedAt: string;
  answeredAt: string | null;
}

/**
 * Una decisión tomada por una persona del equipo.
 *
 * No es una corrida del motor: `kyb_evaluations` mide lo que encontró la
 * verificación, esto registra quién resolvió la solicitud y por qué. El panel
 * muestra las dos cosas juntas porque una decisión sin la evaluación detrás es
 * imposible de revisar.
 */
export interface KybDecision {
  id: string;
  applicationId: string;
  decision: KybManualDecision;
  statusBefore: KybStatus;
  statusAfter: KybStatus;
  /** Motivo del rechazo o comentario de la decisión; `null` si no se escribió. */
  note: string | null;
  /** Preguntas enviadas cuando la decisión fue «Pendiente_Informacion». */
  questions: KybQuestion[];
  /** Correo de la cuenta que decidió, o `dev` sin Supabase configurado. */
  decidedBy: string;
  createdAt: string;
}

export interface KybDecisionRow {
  id: string;
  application_id: string;
  decision: string;
  status_before: string;
  status_after: string;
  note: string | null;
  questions: KybQuestion[] | null;
  decided_by: string;
  created_at: string;
}

export const KYB_DECISION_COLUMNS =
  'id, application_id, decision, status_before, status_after, note, questions, decided_by, created_at';

export interface KybInformationRequestRow {
  id: string;
  application_id: string;
  questions: KybQuestion[];
  answers: { id: string; answer: string }[];
  requested_at: string;
  answered_at: string | null;
}

export type KybStatusPatch = Partial<
  Pick<
    KybApplication,
    | 'status'
    | 'score'
    | 'plan'
    | 'panelEnabled'
    | 'activatedAt'
    | 'tokenHash'
    | 'tokenPurpose'
    | 'tokenExpiresAt'
  >
>;
