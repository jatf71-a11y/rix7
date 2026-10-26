/**
 * Decisiones manuales del alta de empresas.
 *
 * El motor decide solo, pero hay casos en los que la decisión no puede ser
 * automática: un fraude que solo se ve leyendo la ficha, una empresa que
 * responde a medias, un trámite que el equipo quiere aprobar por su cuenta. Acá
 * vive la validación de esa decisión —qué se puede pedir en cada estado, qué es
 * obligatorio en cada caso— sin tocar red ni base: el flujo la aplica después.
 *
 * Las reglas que importan:
 *
 * - **Rechazar exige motivo.** Un rechazo sin explicación deja a la empresa sin
 *   nada que corregir y al equipo sin por qué defenderlo seis meses después.
 * - **Pedir información exige preguntas.** El correo de «Pendiente_Informacion»
 *   se arma con ellas: una decisión sin preguntas mandaría un correo vacío y
 *   dejaría el enlace sin ronda abierta que responder.
 * - **No se decide sobre lo que ya terminó.** `En_Alta` y `Rechazada` son
 *   terminales; `Aceptada` ya tiene su salto a `En_Alta` reservado.
 */

import {
  canTransition,
  isKybManualDecision,
  KYB_MANUAL_DECISIONS,
  KYB_STATUS_LABELS,
  type KybManualDecision,
  type KybQuestion,
  type KybStatus,
} from './status';

/** Tope del motivo/comentario: entra en el correo y en el historial. */
export const KYB_DECISION_NOTE_MAX = 1000;

/** Preguntas por ronda. Más que esto no se responde por correo. */
export const KYB_DECISION_QUESTIONS_MAX = 5;

/** Un motivo de una palabra no explica nada; el mínimo es una frase. */
const NOTE_MIN = 10;

/** Igual criterio para cada pregunta. */
const QUESTION_MIN = 10;

/** Qué decisiones ofrece el panel para una solicitud en este estado. */
export function decisionsFor(status: KybStatus): KybManualDecision[] {
  return KYB_MANUAL_DECISIONS.filter((decision) => canTransition(status, decision));
}

/** Texto del botón, con el verbo en imperativo. */
export const KYB_DECISION_LABELS: Record<KybManualDecision, string> = {
  Aceptada: 'Aprobar',
  Pendiente_Informacion: 'Pedir información',
  Rechazada: 'Rechazar',
};

/**
 * Por qué no se puede decidir, para mostrarlo en el panel.
 *
 * Se devuelve el motivo y no un booleano porque el panel tiene que explicar por
 * qué los botones están apagados: «esta solicitud ya quedó rechazada» es
 * accionable; unos botones grises, no.
 */
export function whyCannotDecide(status: KybStatus): string | null {
  if (decisionsFor(status).length > 0) return null;
  if (status === 'En_Alta') {
    return 'La solicitud está en alta: el flujo terminó y no se vuelve a decidir.';
  }
  if (status === 'Rechazada') return 'La solicitud ya quedó rechazada.';
  if (status === 'Aceptada') {
    return 'La solicitud está aceptada: el alta sigue con la empresa al elegir plan.';
  }
  return `La solicitud está en «${KYB_STATUS_LABELS[status]}» y todavía no tiene evaluación para decidir.`;
}

export interface KybDecisionRequest {
  decision: unknown;
  note?: unknown;
  questions?: unknown;
}

export interface NormalizedDecision {
  decision: KybManualDecision;
  /** Motivo/comentario listo para guardar; `null` si no se escribió. */
  note: string | null;
  /** Preguntas normalizadas (solo para «Pendiente_Informacion»). */
  questions: KybQuestion[];
}

export type DecisionValidation =
  | { ok: true; data: NormalizedDecision }
  | { ok: false; error: string };

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Valida y normaliza lo que mandó el panel.
 *
 * Los ids de las preguntas escritas a mano son posicionales (`manual_1`…): la
 * empresa las responde por id y el historial guarda ese id, así que tienen que
 * ser estables dentro de la ronda. El motor usa sus propios ids (`domain_web`,
 * etc.) y ambos conviven sin problema porque la ronda se responde entera.
 */
export function normalizeDecision(input: KybDecisionRequest): DecisionValidation {
  const raw = input.decision;
  if (!isKybManualDecision(raw)) {
    return { ok: false, error: 'La decisión no es válida.' };
  }
  const decision: KybManualDecision = raw;

  const note = cleanText(input.note);
  if (note.length > KYB_DECISION_NOTE_MAX) {
    return {
      ok: false,
      error: `El motivo no puede superar los ${KYB_DECISION_NOTE_MAX} caracteres.`,
    };
  }

  if (decision === 'Rechazada') {
    if (note.length < NOTE_MIN) {
      return { ok: false, error: 'Explica el motivo del rechazo: la empresa lo recibe por correo.' };
    }
    return { ok: true, data: { decision, note, questions: [] } };
  }

  if (decision === 'Pendiente_Informacion') {
    const raw = Array.isArray(input.questions) ? input.questions : [];
    const texts = raw.map(cleanText).filter((text) => text.length > 0);

    if (texts.length === 0) {
      return { ok: false, error: 'Escribe al menos una pregunta para la empresa.' };
    }
    if (texts.length > KYB_DECISION_QUESTIONS_MAX) {
      return {
        ok: false,
        error: `Máximo ${KYB_DECISION_QUESTIONS_MAX} preguntas por ronda.`,
      };
    }
    const short = texts.find((text) => text.length < QUESTION_MIN);
    if (short) {
      return { ok: false, error: 'Cada pregunta necesita al menos una frase completa.' };
    }

    return {
      ok: true,
      data: {
        decision,
        note: note || null,
        questions: texts.map((text, index) => ({
          id: `manual_${index + 1}`,
          question: text.slice(0, 300),
        })),
      },
    };
  }

  // Aceptada: el comentario es opcional.
  return { ok: true, data: { decision, note: note || null, questions: [] } };
}
