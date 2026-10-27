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
 * Cada verificación viaja con `evidence.source`: de dónde salió el dato (el
 * registro del SII, una búsqueda real, la simulación local o lo que declaró la
 * empresa). El motor decide igual, pero el panel necesita poder decir por qué
 * advierte algo y si el dato es una comprobación externa o solo una relectura de
 * la solicitud.
 *
 * Las respuestas a una ronda anterior no se descartan: una explicación válida
 * sube una verificación un escalón (fallo → advertencia, advertencia → pasa),
 * salvo en las fiscales, que se vuelven a consultar al registro y no se arreglan
 * con texto.
 *
 * El tamaño de la empresa se mide por **dotación** —los trabajadores que informa
 * el registro—: ese número decide el tramo. Las ventas aproximadas del último
 * ejercicio cerrado que publica el registro viajan al lado como referencia de la
 * escala, y **no se le piden a la empresa**: cuando el registro no las publica, el
 * panel dice «sin dato» y la verificación sigue dependiendo de la dotación.
 *
 * Cada verificación viaja además con sus `facts`: los datos concretos que miró
 * (el registro consultado, las reseñas contadas, el umbral, el dominio de cada
 * lado). El detalle explica la conclusión; los hechos permiten discutirla.
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
import {
  defaultTaxAdapter,
  type TaxAdapter,
  type TaxVerification,
} from './adapters/tax';
import type { KybCheck, KybCheckFact, KybEvaluation, KybQuestion } from './status';

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

/** Reseñas negativas que convierten la reputación en advertencia. */
const NEGATIVE_REVIEWS_THRESHOLD = 3;

/** Puntaje mínimo desde el que el motor acepta sin intervención del equipo. */
const KYB_SCORE_THRESHOLD = 75;

/**
 * Peso de cada verificación. Suma 100 para que el puntaje sea comparable.
 *
 * Al sumar la séptima verificación, los pesos de las seis originales se
 * reescalaron (×0,9): la proporción con la que el motor venía decidiendo no
 * cambia.
 */
const WEIGHTS = {
  taxRut: 18,
  taxRegistry: 22,
  reputation: 18,
  domainWeb: 14,
  emailCorporate: 9,
  emailDomainMatch: 9,
  companySize: 10,
} as const;

export type KybSizeBandId = 'micro' | 'pequena' | 'mediana' | 'grande';

export interface KybSizeBand {
  id: KybSizeBandId;
  label: string;
}

/**
 * Tramo de tamaño por dotación: micro 1-9, pequeña 10-49, mediana 50-199 y
 * grande 200 o más trabajadores.
 *
 * Son los tramos de la Ley 20.416 por número de trabajadores —no los de ventas—,
 * que es justamente lo que el motor puede leer del registro sin pedirle a la
 * empresa su nivel de facturación.
 */
/**
 * Referencia de facturación: «≈ $612 millones al año (ejercicio 2025)», o
 * «sin dato en el registro».
 *
 * Nunca se estima: la cifra sale de las ventas que publica el registro. El
 * tramo lo sigue decidiendo la dotación, así que este número acompaña al tamaño
 * en vez de definirlo.
 */
/** Lo que se muestra cuando el registro no publica ventas del ejercicio. */
const NO_REVENUE = 'sin dato en el registro';

function revenueLabel(registry: TaxVerification | null): string {
  if (!registry || registry.revenueClp === null) return NO_REVENUE;
  const millions = Math.round(registry.revenueClp / 1_000_000);
  const amount = `$${new Intl.NumberFormat('es-CL').format(millions)} millones`;
  return registry.revenueYear
    ? `≈ ${amount} al año (ejercicio ${registry.revenueYear})`
    : `≈ ${amount} al año`;
}
export function kybSizeBand(workers: number): KybSizeBand {
  if (workers >= 200) return { id: 'grande', label: 'empresa grande (200 o más trabajadores)' };
  if (workers >= 50) return { id: 'mediana', label: 'empresa mediana (50 a 199 trabajadores)' };
  if (workers >= 10) return { id: 'pequena', label: 'pequeña empresa (10 a 49 trabajadores)' };
  return { id: 'micro', label: 'microempresa (1 a 9 trabajadores)' };
}

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
  const answered = clarification.trim().slice(0, 240);
  return {
    ...check,
    status: upgraded,
    detail: `${check.detail} La empresa respondió: «${answered}»`,
    facts: [...(check.facts ?? []), { label: 'Respuesta de la empresa', value: answered }],
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
    // Solo formato: el RUT viene de la solicitud y se valida con su dígito
    // verificador, no contra el registro (eso es la verificación siguiente).
    evidence: { source: 'declared' },
    facts: [
      { label: 'RUT revisado', value: application.rut },
      { label: 'Dígito verificador', value: rutIsValid ? 'correcto' : 'no válido' },
    ],
    question: rutIsValid
      ? undefined
      : 'Confirma el RUT de la empresa con su dígito verificador (por ejemplo 76.123.456-0).',
  });

  // El registro se consulta una sola vez y su resultado lo usan dos
  // verificaciones: el registro comercial y el tamaño de la empresa (dotación).
  let registry: TaxVerification | null = null;
  let registryError: string | null = null;

  // ── 2. Registro comercial (SII o simulación) ────────────────────────────
  try {
    const taxResult = await tax.verify({
      rut: application.rut,
      legalName: application.legalName,
    });
    registry = taxResult;

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
      evidence: { source: taxResult.source },
      facts: [
        {
          label: 'Registro consultado',
          value: taxResult.source === 'sii' ? 'SII' : 'simulación local',
        },
        { label: 'Figura en el registro', value: taxResult.exists ? 'sí' : 'no' },
        {
          label: 'Situación',
          value: !taxResult.exists ? 'sin registro' : taxResult.active ? 'activa' : 'no activa',
        },
        { label: 'Razón social registrada', value: taxResult.businessName ?? 'sin dato' },
        { label: 'Giro', value: taxResult.activity ?? 'sin dato' },
      ],
      question: ok
        ? undefined
        : `No pudimos validar el registro de ${application.legalName} con el RUT ${application.rut}. ¿Confirmas la razón social exacta, el RUT y el giro con el que está inscrita?`,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'error inesperado';
    registryError = detail;
    checks.push({
      id: 'tax_registry',
      label: 'Registro comercial',
      status: 'fail',
      detail: `No se pudo consultar el registro: ${detail}`,
      weight: WEIGHTS.taxRegistry,
      evidence: { source: tax.source },
      facts: [
        { label: 'Registro consultado', value: tax.source === 'sii' ? 'SII' : 'simulación local' },
        { label: 'Resultado', value: 'no respondió' },
      ],
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

    // El sustento de la advertencia: qué se buscó y qué se contó. Va en las
    // cuatro ramas porque el equipo necesita el mismo dato tanto para discutir
    // una advertencia como para confiar en un «sin señales».
    const reputationFacts: KybCheckFact[] = [
      {
        label: 'Qué se buscó',
        value: [application.legalName, application.rut, normalizedSite]
          .filter(Boolean)
          .join(' · '),
      },
      { label: 'Reseñas negativas', value: String(reputationResult.negativeReviews) },
      // El motivo, cuando la fuente lo trae: «3 reseñas negativas» no dice si son
      // por demoras o por cobros, y sin eso la aclaración que se le pide a la
      // empresa queda a ciegas. Si la búsqueda no discrimina el motivo, se dice
      // que no hay detalle en vez de rellenarlo.
      {
        label: 'Motivo de las reseñas',
        value:
          reputationResult.negativeTopics.length > 0
            ? reputationResult.negativeTopics.join(' · ')
            : reputationResult.negativeReviews > 0
              ? 'sin detalle en la fuente consultada'
              : 'sin reseñas negativas',
      },
      {
        label: 'Señales de fraude',
        value: reputationResult.fraudFlags.length > 0 ? reputationResult.fraudFlags.join(' ') : 'ninguna',
      },
    ];

    if (reputationResult.fraudFlags.length > 0) {
      checks.push({
        id: 'reputation',
        label: 'Reputación web',
        status: 'fail',
        detail: `Señales de fraude: ${reputationResult.fraudFlags.join(' ')}`,
        weight: WEIGHTS.reputation,
        evidence: { source: reputationResult.source, mentions: reputationResult.mentions },
        facts: reputationFacts,
        question:
          'Encontramos menciones públicas que reportan problemas de fraude o impagos asociados a tu empresa. ¿Puedes entregar antecedentes que expliquen esas menciones?',
      });
    } else if (reputationResult.negativeReviews >= NEGATIVE_REVIEWS_THRESHOLD) {
      checks.push({
        id: 'reputation',
        label: 'Reputación web',
        status: 'warn',
        detail: `${reputationResult.negativeReviews} reseñas negativas públicas y ninguna señal de fraude.`,
        weight: WEIGHTS.reputation,
        evidence: { source: reputationResult.source, mentions: reputationResult.mentions },
        facts: [
          ...reputationFacts,
          {
            label: 'Umbral de advertencia',
            value: `${NEGATIVE_REVIEWS_THRESHOLD} reseñas negativas o más`,
          },
        ],
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
        evidence: { source: reputationResult.source, mentions: reputationResult.mentions },
        facts: reputationFacts,
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
      evidence: { source: reputation.source },
      facts: [
        {
          label: 'Qué se buscó',
          value: [application.legalName, application.rut, normalizedSite]
            .filter(Boolean)
            .join(' · '),
        },
        { label: 'Resultado', value: 'no respondió' },
      ],
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
      evidence: { source: 'declared' },
      facts: [{ label: 'Sitio informado', value: 'ninguno' }],
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
      evidence: { source: 'declared' },
      facts: [
        { label: 'Sitio informado', value: normalizedSite },
        { label: 'Alojamiento', value: 'gratuito: no es un dominio propio' },
      ],
      question: `El sitio de la empresa está alojado en un servicio gratuito (${normalizedSite}). ¿Tiene un dominio propio? Si es así, indícalo.`,
    });
  } else {
    checks.push({
      id: 'domain_web',
      label: 'Sitio web',
      status: 'pass',
      detail: `Dominio propio: ${normalizedSite}.`,
      weight: WEIGHTS.domainWeb,
      evidence: { source: 'declared' },
      facts: [
        { label: 'Sitio informado', value: normalizedSite },
        { label: 'Alojamiento', value: 'dominio propio' },
      ],
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
      evidence: { source: 'declared' },
      facts: [
        { label: 'Dominio del correo', value: mailDomain ?? 'sin dominio' },
        { label: 'Tipo', value: 'proveedor personal' },
      ],
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
      evidence: { source: 'declared' },
      facts: [
        { label: 'Dominio del correo', value: mailDomain ?? 'sin dominio' },
        { label: 'Tipo', value: 'propio' },
      ],
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
      evidence: { source: 'declared' },
      facts: [
        { label: 'Dominio del correo', value: mailDomain ?? 'sin dominio' },
        { label: 'Dominio del sitio', value: 'ninguno' },
      ],
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
      evidence: { source: 'declared' },
      facts: [
        { label: 'Dominio del correo', value: mailDomain ?? 'sin dominio' },
        { label: 'Dominio del sitio', value: normalizedSite },
        { label: 'Coinciden', value: 'sí' },
      ],
    });
  } else {
    checks.push({
      id: 'email_domain_match',
      label: 'Correo y sitio coinciden',
      status: 'fail',
      detail: `El correo (${mailDomain ?? 'sin dominio'}) no pertenece al dominio del sitio (${normalizedSite}).`,
      weight: WEIGHTS.emailDomainMatch,
      evidence: { source: 'declared' },
      facts: [
        { label: 'Dominio del correo', value: mailDomain ?? 'sin dominio' },
        { label: 'Dominio del sitio', value: normalizedSite },
        { label: 'Coinciden', value: 'no' },
      ],
      question: `El correo de contacto no pertenece al dominio ${normalizedSite}. ¿Por qué la empresa usa un correo de otro dominio y cuál es el correo corporativo oficial?`,
    });
  }

  // ── 7. Tamaño de la empresa (dotación del registro) ─────────────────────
  // El tramo se calcula por número de trabajadores: es lo que el registro
  // publica y no depende de que la empresa declare su nivel de facturación. Las
  // ventas aproximadas del último ejercicio se muestran al lado, como referencia
  // de la escala: no deciden el tramo y, si el registro no las trae, se dice que
  // no hay dato en vez de pedírselas a la empresa.
  const sizeFacts = (revenue: string): KybCheckFact[] => [
    { label: 'Cómo se mide el tramo', value: 'dotación de trabajadores (Ley 20.416)' },
    { label: 'Facturación aproximada', value: revenue },
  ];

  if (!registry) {
    checks.push({
      id: 'company_size',
      label: 'Tamaño de la empresa',
      status: 'warn',
      detail: `No se pudo consultar la dotación: ${registryError ?? 'sin respuesta del registro'}`,
      weight: WEIGHTS.companySize,
      evidence: { source: tax.source },
      facts: [
        { label: 'Registro consultado', value: tax.source === 'sii' ? 'SII' : 'simulación local' },
        { label: 'Resultado', value: 'no respondió' },
        ...sizeFacts(revenueLabel(registry)),
      ],
      question:
        'No pudimos leer en el registro cuántas personas trabajan en la empresa. ¿Cuál es su dotación actual (número de trabajadores)?',
    });
  } else if (registry.workers === null) {
    checks.push({
      id: 'company_size',
      label: 'Tamaño de la empresa',
      status: 'warn',
      detail:
        'El registro no informa la dotación de la empresa.' +
        (registry.revenueClp === null
          ? ''
          : ` Sus ventas del último ejercicio fueron ${revenueLabel(registry)}.`),
      weight: WEIGHTS.companySize,
      evidence: { source: registry.source },
      facts: [
        { label: 'Dotación informada', value: 'sin dato' },
        ...sizeFacts(revenueLabel(registry)),
      ],
      question:
        'El registro público no informa cuántas personas trabajan en la empresa. ¿Cuál es su dotación actual (número de trabajadores)?',
    });
  } else if (registry.workers === 0) {
    checks.push({
      id: 'company_size',
      label: 'Tamaño de la empresa',
      status: 'warn',
      detail: 'El registro informa 0 trabajadores con la empresa activa.',
      weight: WEIGHTS.companySize,
      evidence: { source: registry.source },
      facts: [
        { label: 'Dotación informada', value: '0 trabajadores' },
        ...sizeFacts(revenueLabel(registry)),
      ],
      question:
        'El registro informa la empresa activa sin trabajadores. ¿Cuántas personas trabajan hoy en ella, contando a los socios que la operan?',
    });
  } else {
    const band = kybSizeBand(registry.workers);
    checks.push({
      id: 'company_size',
      label: 'Tamaño de la empresa',
      status: 'pass',
      detail:
        `El registro informa ${registry.workers} trabajador(es): ${band.label}` +
        (revenueLabel(registry) === NO_REVENUE
          ? ''
          : `, con facturación aproximada de ${revenueLabel(registry)}`) +
        '.',
      weight: WEIGHTS.companySize,
      evidence: { source: registry.source },
      facts: [
        { label: 'Dotación informada', value: `${registry.workers} trabajadores` },
        { label: 'Tramo', value: band.label },
        ...sizeFacts(revenueLabel(registry)),
      ],
      // La empresa puede corregir la dotación si el registro está atrasado; por
      // eso la clave no empieza con `tax_`, que es lo que la vuelve intocable.
    });
  }

  const resolved = checks.map((check) => applyClarification(check, clarifications[check.id]));
  const score = scoreOf(resolved);
  const questions: KybQuestion[] = resolved
    .filter((check) => check.status !== 'pass' && check.question)
    .map((check) => ({ id: check.id, question: check.question as string }));

  const hasFailure = resolved.some((check) => check.status === 'fail');
  const decision: KybEvaluation['decision'] =
    !hasFailure && questions.length === 0 && score >= KYB_SCORE_THRESHOLD
      ? 'Aceptada'
      : 'Pendiente_Informacion';

  if (decision === 'Aceptada') {
    reasons.push(
      `Las siete verificaciones pasaron o quedaron resueltas; puntaje ${score}/100.`
    );
  } else {
    reasons.push(
      hasFailure
        ? `Hay verificaciones con fallo; puntaje ${score}/100.`
        : `Quedan ${questions.length} verificación(es) por aclarar; puntaje ${score}/100.`
    );
    if (questions.length === 0) {
      reasons.push(
        `El puntaje no alcanza el mínimo de ${KYB_SCORE_THRESHOLD} para el alta automática.`
      );
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
