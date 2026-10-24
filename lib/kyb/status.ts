/**
 * Tipos y máquina de estados del onboarding KYB.
 *
 * El flujo tiene cinco estados y un único camino permitido entre ellos; el
 * motor de evaluación es el que decide si una solicitud avanza a `Aceptada` o
 * vuelve a la empresa con preguntas. `En_Alta` es terminal: la empresa ya tiene
 * su token, elige plan y su panel queda habilitado.
 *
 * Este módulo es puro (sin Supabase, sin red): la tabla de transiciones se
 * prueba sola y es la que impide que una ruta mueva una solicitud a un estado
 * imposible.
 */

export const KYB_STATUSES = [
  'Recibida',
  'En_Evaluacion',
  'Pendiente_Informacion',
  'Aceptada',
  'En_Alta',
] as const;

export type KybStatus = (typeof KYB_STATUSES)[number];

export const KYB_STATUS_LABELS: Record<KybStatus, string> = {
  Recibida: 'Recibida',
  En_Evaluacion: 'En evaluación',
  Pendiente_Informacion: 'Pendiente de información',
  Aceptada: 'Aceptada',
  En_Alta: 'En alta',
};

/** Estado del que no se sale: la empresa ya tiene panel y plan. */
export const KYB_TERMINAL_STATUS: KybStatus = 'En_Alta';

const TRANSITIONS: Record<KybStatus, readonly KybStatus[]> = {
  Recibida: ['En_Evaluacion'],
  En_Evaluacion: ['Aceptada', 'Pendiente_Informacion'],
  // Volver a evaluar después de las respuestas es el único camino de salida.
  Pendiente_Informacion: ['En_Evaluacion'],
  // El alta genera el token y deja la solicitud en manos de la empresa.
  Aceptada: ['En_Alta'],
  En_Alta: [],
};

export function isKybStatus(value: unknown): value is KybStatus {
  return typeof value === 'string' && (KYB_STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: KybStatus, to: KybStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Valida una transición y devuelve el motivo cuando no corresponde.
 *
 * Se devuelve un mensaje y no un booleano porque quien llama lo muestra en la
 * API: «no se puede pasar de Aceptada a En_Evaluacion» es accionable; `false`,
 * no.
 */
export function assertTransition(
  from: KybStatus,
  to: KybStatus
): { ok: true } | { ok: false; error: string } {
  if (from === to) {
    return { ok: false, error: `La solicitud ya está en «${KYB_STATUS_LABELS[from]}».` };
  }
  if (!canTransition(from, to)) {
    return {
      ok: false,
      error: `No se puede pasar de «${KYB_STATUS_LABELS[from]}» a «${KYB_STATUS_LABELS[to]}».`,
    };
  }
  return { ok: true };
}

/** ¿La solicitud admite una nueva corrida del motor? */
export function canEvaluate(status: KybStatus): boolean {
  return (
    status === 'Recibida' ||
    status === 'En_Evaluacion' ||
    status === 'Pendiente_Informacion'
  );
}

export type KybTokenPurpose = 'answers' | 'activation';

export function isKybTokenPurpose(value: unknown): value is KybTokenPurpose {
  return value === 'answers' || value === 'activation';
}

/** Verificación individual del motor. */
export interface KybCheck {
  /** Identificador estable: es la clave con la que llega la respuesta. */
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
  /** Peso en el puntaje; los pesos del motor suman 100. */
  weight: number;
  /** Pregunta concreta para la empresa cuando no pasa. */
  question?: string;
}

export interface KybQuestion {
  id: string;
  question: string;
}

export type KybDecision = Extract<KybStatus, 'Aceptada' | 'Pendiente_Informacion'>;

export interface KybEvaluation {
  score: number;
  decision: KybDecision;
  checks: KybCheck[];
  questions: KybQuestion[];
  /** Motivos de la decisión, en el orden en que se evaluaron. */
  reasons: string[];
  createdAt: string;
}
