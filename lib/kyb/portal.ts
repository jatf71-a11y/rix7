/**
 * Lógica de presentación de la pantalla de alta (`/empresas/onboarding`).
 *
 * Vive fuera del componente por dos razones: el componente queda ocupado en la
 * interacción y no en decidir qué mostrar, y estas funciones se prueban solas
 * en la suite (que corre en Node, sin DOM). Nada de acá toca red ni estado.
 *
 * El token del correo identifica la solicitud y **rota en cada cambio de
 * estado**: cuando la empresa responde, el enlace que abrió deja de servir y el
 * siguiente paso viaja en un correo nuevo. Por eso la pantalla no vuelve a
 * consultar el estado con el token viejo después de responder.
 */

import { getKybPlan, isKybPlanId } from './plans';
import type { KybQuestion, KybStatus } from './status';

/** Lo que devuelve `POST /api/kyb/access`. */
export interface KybAccessView {
  status: KybStatus;
  legalName: string;
  questions: KybQuestion[];
  plan: string | null;
  panelEnabled: boolean;
  /** Solo `En_Alta` con el panel aún sin habilitar. */
  canChoosePlan: boolean;
}

export type KybPortalStage = 'questions' | 'plans' | 'active' | 'evaluating';

/** Color del distintivo de estado, compartido por la página pública y el panel. */
export const KYB_STATUS_TONES: Record<KybStatus, string> = {
  Recibida: 'border-amber-100 bg-amber-50 text-amber-700',
  En_Evaluacion: 'border-amber-100 bg-amber-50 text-amber-700',
  Pendiente_Informacion: 'border-orange-100 bg-orange-50 text-orange-700',
  Aceptada: 'border-emerald-100 bg-emerald-50 text-emerald-700',
  En_Alta: 'border-emerald-100 bg-emerald-50 text-emerald-700',
};

/**
 * Qué bloque mostrar. El panel habilitado gana sobre todo lo demás: una
 * solicitud ya activada no vuelve a pedir plan ni respuestas aunque el token
 * siga vivo para tolerar reintentos.
 */
export function portalStage(view: KybAccessView): KybPortalStage {
  if (view.panelEnabled) return 'active';
  if (view.status === 'Pendiente_Informacion') {
    return view.questions.length > 0 ? 'questions' : 'evaluating';
  }
  if (view.status === 'En_Alta' && view.canChoosePlan) return 'plans';
  return 'evaluating';
}

export interface StageCopy {
  title: string;
  body: string;
}

/**
 * Texto del bloque de espera. Depende del estado porque «recibida» y «en
 * evaluación» no significan lo mismo para quien espera: una acaba de entrar y
 * la otra ya está corriendo.
 */
export function evaluatingCopy(status: KybStatus): StageCopy {
  switch (status) {
    case 'Recibida':
      return {
        title: 'Recibimos tu solicitud',
        body: 'La verificación es automática y arranca en unos instantes. Te escribimos al correo de la empresa con el resultado.',
      };
    case 'En_Evaluacion':
      return {
        title: 'Estamos verificando tu empresa',
        body: 'Revisamos el RUT y el registro comercial, la reputación pública, el sitio web y la coherencia del correo corporativo. No necesitas hacer nada por ahora.',
      };
    case 'Pendiente_Informacion':
      return {
        title: 'Estamos preparando las preguntas',
        body: 'Te enviamos un correo con los datos que faltan y el enlace para responderlos. Cuando lo envíes, la evaluación se repite sola.',
      };
    case 'Aceptada':
    case 'En_Alta':
      return {
        title: 'Tu empresa quedó aceptada',
        body: 'Te enviamos al correo de la empresa el enlace para elegir el plan y habilitar el panel de publicaciones.',
      };
  }
}

/** Preguntas sin responder: el servidor exige al menos dos caracteres. */
export function missingAnswers(
  questions: KybQuestion[],
  values: Record<string, string>
): string[] {
  return questions
    .filter((question) => (values[question.id] ?? '').trim().length < 2)
    .map((question) => question.id);
}

/**
 * Cuerpo de `POST /api/kyb/answers`.
 *
 * Se arma desde las preguntas y no desde el estado del formulario: lo que no
 * corresponde a la ronda abierta no viaja, aunque haya quedado en memoria.
 */
export function answersPayload(
  questions: KybQuestion[],
  values: Record<string, string>
): { id: string; answer: string }[] {
  return questions.map((question) => ({
    id: question.id,
    answer: (values[question.id] ?? '').trim(),
  }));
}

/**
 * Errores de la API traducidos a lo que le sirve a la empresa.
 *
 * El servidor enumera ids faltantes («Faltan respuestas: reputation») y, cuando
 * el fallo es de infraestructura, nombra la variable que falta. Ninguna de las
 * dos cosas le dice nada a quien está completando el alta: la primera se
 * resuelve marcando los campos, la segunda escribiendo al equipo.
 */
export function friendlyAnswersError(message: string | undefined): string {
  if (!message) return 'No pudimos enviar tus respuestas. Intenta de nuevo.';
  if (/^Faltan respuestas/.test(message)) return 'Responde todas las preguntas para continuar.';
  return message;
}

export function friendlyActivationError(message: string | undefined): string {
  if (!message) return 'No pudimos habilitar el panel. Intenta de nuevo.';
  if (/SUPABASE_SERVICE_ROLE_KEY|service_role|service role/i.test(message)) {
    return 'No pudimos habilitar el panel en este momento. Responde el correo del alta y lo resolvemos.';
  }
  return message;
}

/** Nombre legible del plan guardado; `null` si no hay o no se reconoce. */
export function planName(plan: string | null | undefined): string | null {
  return isKybPlanId(plan) ? getKybPlan(plan).name : null;
}
