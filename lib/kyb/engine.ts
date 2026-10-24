/**
 * Motor de evaluación KYB.
 *
 * Corre una batería de verificaciones sobre la solicitud y decide entre
 * `Aceptada` y `Pendiente_Informacion`. No escribe nada: recibe datos (y, si
 * las hay, las respuestas anteriores de la empresa), consulta los adaptadores y
 * devuelve el puntaje, el detalle y las preguntas.
 *
 * Reglas de decisión:
 *
 * - Se acepta solo si **ninguna** verificación falla, no quedan preguntas
 *   abiertas y el puntaje llega a 75.
 * - Todo lo demás termina en `Pendiente_Informacion`, con una pregunta por cada
 *   verificación que no pasó. No existe un estado de rechazo: la empresa siempre
 *   tiene la posibilidad de aclarar, que es lo que pide el flujo.
 *
 * Las respuestas a una ronda anterior no se descartan: una explicación válida
 * sube una verificación un escalón (fallo → advertencia, advertencia → pasa),
 * salvo en las fiscales, que se vuelven a consultar al registro y no se arreglan
 * con texto.
 */

import { isValidRut } from '@/lib/utils/rut';
import {
  domainsMatch,
  emailDomain,
  isFreeEmailDomain,
  normalizeDomain,
  type NormalizedKybApplication,
} from './application';
import { defaultReputationAdapter, type ReputationAdapter } from './adapters/reputation';
import { defaultTaxAdapter, type TaxAdapter } from './adapters/tax';
import type { KybCheck, KybEvaluation, KybQuestion } from './status';

export interface KybEngineDeps {
  tax: TaxAdapter;
  reputation: ReputationAdapter;
}

/** Respuestas acumuladas: `check.id` → texto que contestó la empresa. */
export type KybClarifications = Record<string, string>;

/** Hosts gratuitos: no invalidan, pero pesan como sitio poco institucional. */
const FREE_HOSTING = [
  'wixsite.com',
  'wordpress.com',
  'blogspot.com',
  'github.io',
  'webflow.io',
  'squarespace.com',
  'weebly.com',
  'myshopify.com',
];

const MIN_CLARIFICATION_LENGTH = 8;

/** Peso de cada verificación. Suma 100 para que el puntaje sea comparable. */
const WEIGHTS = {
  taxRut: 20,
  taxRegistry: 25,
  reputation: 20,
  domainWeb: 15,
  emailCorporate: 10,
  emailDomainMatch: 10,
} as const;

function isFreeHosting(domain: string | null): boolean {
  if (!domain) return false;
  return FREE_HOSTING.some((host) => domain === host || domain.endsWith(`.${host}`));
}

/**
 * Aplica una aclaración a una verificación que no pasó.
 *
 * Solo sube un escalón y solo si el texto tiene contenido suficiente: un «si»
 * no resuelve nada, y dejar que cualquier respuesta convierta un fallo en verde
 * haría que la pregunta no sirviera de nada. Las verificaciones fiscales quedan
 * fuera porque su fuente es el registro, no la palabra de la empresa.
 */
function applyClarification(check: KybCheck, clarification: string | undefined): KybCheck {
  if (!clarification) return check;
  if (check.status === 'pass') return check;
  if (check.id.startsWith('tax_')) return check;
  if (clarification.trim().length < MIN_CLARIFICATION_LENGTH) return check;

  const upgraded: KybCheck['status'] = check.status === 'fail' ? 'warn' : 'pass';
  return {
    ...check,
    status: upgraded,
    detail: `${check.detail} La empresa respondió: «${clarification.trim().slice(0, 240)}»`,
    ...(upgraded === 'pass' ? { question: undefined } : {}),
  };
}

function scoreOf(checks: KybCheck[]): number {
  const total = checks.reduce((sum, check) => {
    if (check.status === 'pass') return sum + check.weight;
    if (check.status === 'warn') return sum + check.weight / 2;
    return sum;
  }, 0);

  return Math.max(0, Math.min(100, Math.round(total)));
}

export async function evaluateKyb(
  application: NormalizedKybApplication,
  clarifications: KybClarifications = {},
  deps?: Partial<KybEngineDeps>
): Promise<KybEvaluation> {
  const tax = deps?.tax ?? defaultTaxAdapter();
  const reputation = deps?.reputation ?? defaultReputationAdapter();

  const checks: KybCheck[] = [];
  const reasons: string[] = [];

  const normalizedSite = application.website ? normalizeDomain(application.website) : null;
  const mailDomain = emailDomain(application.email);

  // ── 1. RUT: formato y dígito verificador ────────────────────────────────
  // Ya se validó al normalizar la solicitud, pero el motor no confía en su
  // entrada: si llega un RUT inválido por otra vía, es un fallo, no un supuesto.
  const rutIsValid = isValidRut(application.rut);
  checks.push({
    id: 'tax_rut',
    label: 'RUT válido',
    status: rutIsValid ? 'pass' : 'fail',
    detail: rutIsValid
      ? `El RUT ${application.rut} tiene dígito verificador correcto.`
      : 'El RUT no tiene un dígito verificador válido.',
    weight: WEIGHTS.taxRut,
    question: rutIsValid
      ? undefined
      : 'Confirma el RUT de la empresa con su dígito verificador (por ejemplo 76.123.456-0).',
  });

  // ── 2. Registro comercial (SII o simulación) ────────────────────────────
  try {
    const taxResult = await tax.verify({
      rut: application.rut,
      legalName: application.legalName,
    });

    const problems: string[] = [];
    if (!taxResult.exists) problems.push('el RUT no figura en el registro');
    if (taxResult.exists && !taxResult.active) problems.push('la empresa no está activa');
    if (taxResult.exists && !taxResult.nameMatches) {
      problems.push('la razón social no coincide con la registrada');
    }

    const ok = problems.length === 0;
    checks.push({
      id: 'tax_registry',
      label: 'Registro comercial',
      status: ok ? 'pass' : 'fail',
      detail: ok
        ? `Registro ${taxResult.source === 'sii' ? 'del SII' : 'simulado'}: ${application.legalName} activa.`
        : `Registro ${taxResult.source === 'sii' ? 'del SII' : 'simulado'}: ${problems.join(', ')}.`,
      weight: WEIGHTS.taxRegistry,
      question: ok
        ? undefined
        : `No pudimos validar el registro de ${application.legalName} con el RUT ${application.rut}. ¿Confirmas la razón social exacta, el RUT y el giro con el que está inscrita?`,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'error inesperado';
    checks.push({
      id: 'tax_registry',
      label: 'Registro comercial',
      status: 'fail',
      detail: `No se pudo consultar el registro: ${detail}`,
      weight: WEIGHTS.taxRegistry,
      question:
        'No pudimos consultar el registro comercial en este momento. ¿Nos confirmas la razón social, el RUT y el giro inscrito para reintentar la verificación?',
    });
    reasons.push('La verificación fiscal no concluyó; se pidió confirmación.');
  }

  // ── 3. Reputación pública ───────────────────────────────────────────────
  try {
    const reputationResult = await reputation.check({
      legalName: application.legalName,
      rut: application.rut,
      domain: normalizedSite,
    });

    if (reputationResult.fraudFlags.length > 0) {
      checks.push({
        id: 'reputation',
        label: 'Reputación web',
        status: 'fail',
        detail: `Señales de fraude: ${reputationResult.fraudFlags.join(' ')}`,
        weight: WEIGHTS.reputation,
        question:
          'Encontramos menciones públicas que reportan problemas de fraude o impagos asociados a tu empresa. ¿Puedes entregar antecedentes que expliquen esas menciones?',
      });
    } else if (reputationResult.negativeReviews >= 3) {
      checks.push({
        id: 'reputation',
        label: 'Reputación web',
        status: 'warn',
        detail: `${reputationResult.negativeReviews} reseñas negativas públicas y ninguna señal de fraude.`,
        weight: WEIGHTS.reputation,
        question: `Encontramos ${reputationResult.negativeReviews} reseñas negativas de clientes. ¿Qué medidas tomó la empresa para resolverlas?`,
      });
    } else {
      checks.push({
        id: 'reputation',
        label: 'Reputación web',
        status: 'pass',
        detail:
          reputationResult.negativeReviews > 0
            ? `Sin señales de fraude; ${reputationResult.negativeReviews} reseña(s) negativa(s) aislada(s).`
            : 'Sin señales de fraude ni reseñas negativas relevantes.',
        weight: WEIGHTS.reputation,
      });
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'error inesperado';
    checks.push({
      id: 'reputation',
      label: 'Reputación web',
      status: 'warn',
      detail: `No se pudo completar la búsqueda de reputación: ${detail}`,
      weight: WEIGHTS.reputation,
      question:
        'No pudimos revisar la reputación pública de la empresa. ¿Nos indicas sus perfiles oficiales (sitio, redes o directorios) para verificarlos?',
    });
    reasons.push('La búsqueda de reputación no concluyó.');
  }

  // ── 4. Sitio web ────────────────────────────────────────────────────────
  if (!normalizedSite) {
    checks.push({
      id: 'domain_web',
      label: 'Sitio web',
      status: 'warn',
      detail: 'La solicitud no informa un sitio web.',
      weight: WEIGHTS.domainWeb,
      question:
        'No informaste un sitio web. ¿Cuál es el dominio oficial de la empresa donde podamos verificar su actividad?',
    });
  } else if (isFreeHosting(normalizedSite)) {
    checks.push({
      id: 'domain_web',
      label: 'Sitio web',
      status: 'warn',
      detail: `El sitio usa un alojamiento gratuito (${normalizedSite}).`,
      weight: WEIGHTS.domainWeb,
      question: `El sitio de la empresa está alojado en un servicio gratuito (${normalizedSite}). ¿Tiene un dominio propio? Si es así, indícalo.`,
    });
  } else {
    checks.push({
      id: 'domain_web',
      label: 'Sitio web',
      status: 'pass',
      detail: `Dominio propio: ${normalizedSite}.`,
      weight: WEIGHTS.domainWeb,
    });
  }

  // ── 5. Correo corporativo ───────────────────────────────────────────────
  if (isFreeEmailDomain(mailDomain)) {
    checks.push({
      id: 'email_corporate',
      label: 'Correo corporativo',
      status: 'warn',
      detail: `El contacto usa un correo personal (${mailDomain}).`,
      weight: WEIGHTS.emailCorporate,
      question:
        'El correo de contacto es de un proveedor personal. ¿Cuál es el correo corporativo con el dominio de la empresa?',
    });
  } else {
    checks.push({
      id: 'email_corporate',
      label: 'Correo corporativo',
      status: 'pass',
      detail: `El contacto usa un dominio propio (${mailDomain}).`,
      weight: WEIGHTS.emailCorporate,
    });
  }

  // ── 6. Coincidencia entre correo y sitio ────────────────────────────────
  if (!normalizedSite) {
    checks.push({
      id: 'email_domain_match',
      label: 'Correo y sitio coinciden',
      status: 'warn',
      detail: 'Sin sitio web no hay dominio contra el cual comparar el correo.',
      weight: WEIGHTS.emailDomainMatch,
      question:
        'Sin sitio web no podemos comprobar que el correo pertenezca a la empresa. ¿Puedes indicar el dominio corporativo?',
    });
  } else if (domainsMatch(mailDomain, normalizedSite)) {
    checks.push({
      id: 'email_domain_match',
      label: 'Correo y sitio coinciden',
      status: 'pass',
      detail: `El correo (${mailDomain}) pertenece al dominio del sitio (${normalizedSite}).`,
      weight: WEIGHTS.emailDomainMatch,
    });
  } else {
    checks.push({
      id: 'email_domain_match',
      label: 'Correo y sitio coinciden',
      status: 'fail',
      detail: `El correo (${mailDomain ?? 'sin dominio'}) no pertenece al dominio del sitio (${normalizedSite}).`,
      weight: WEIGHTS.emailDomainMatch,
      question: `El correo de contacto no pertenece al dominio ${normalizedSite}. ¿Por qué la empresa usa un correo de otro dominio y cuál es el correo corporativo oficial?`,
    });
  }

  const resolved = checks.map((check) => applyClarification(check, clarifications[check.id]));
  const score = scoreOf(resolved);
  const questions: KybQuestion[] = resolved
    .filter((check) => check.status !== 'pass' && check.question)
    .map((check) => ({ id: check.id, question: check.question as string }));

  const hasFailure = resolved.some((check) => check.status === 'fail');
  const decision: KybEvaluation['decision'] =
    !hasFailure && questions.length === 0 && score >= 75 ? 'Aceptada' : 'Pendiente_Informacion';

  if (decision === 'Aceptada') {
    reasons.push(
      `Las seis verificaciones pasaron o quedaron resueltas; puntaje ${score}/100.`
    );
  } else {
    reasons.push(
      hasFailure
        ? `Hay verificaciones con fallo; puntaje ${score}/100.`
        : `Quedan ${questions.length} verificación(es) por aclarar; puntaje ${score}/100.`
    );
    if (questions.length === 0) {
      reasons.push('El puntaje no alcanza el mínimo de 75 para el alta automática.');
    }
  }

  return {
    score,
    decision,
    checks: resolved,
    questions,
    reasons,
    createdAt: new Date().toISOString(),
  };
}

export const KYB_SCORE_THRESHOLD = 75;
