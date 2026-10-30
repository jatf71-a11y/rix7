/**
 * Evaluación automática de los registros de socios.
 *
 * Las altas de empresa tienen su motor (`lib/kyb/engine.ts`): consulta el SII,
 * busca reputación en la web y verifica dominio y correo. Los registros de
 * corredora, inmobiliaria y agente que llegan por `/registro/*` y
 * `/publicar/agente` no tenían nada de eso: quedaban en «Recibida» hasta que
 * alguien del equipo los miraba, y el solicitante no recibía ni un correo.
 *
 * Este módulo es el motor de esos registros, con lo que se puede verificar sin
 * credenciales externas y sin inventar datos: el RUT (módulo 11), la coherencia
 * entre el correo y el sitio, el alcance declarado, el teléfono y si ya existe
 * una solicitud con el mismo RUT o correo. No promete más que eso.
 *
 * Es **puro** —sin red, sin base, sin React— porque es donde una regla mal
 * puesta se convierte en un registro aprobado sin que nadie lo mire, o en un
 * correo pidiendo un dato que la persona ya había dejado.
 *
 * Decisión: se acepta con 80 puntos o más y sin ninguna verificación en rojo.
 * Las advertencias pesan la mitad —una corredora con Gmail no es un fraude—
 * pero dejan la pregunta escrita, y cuando la persona la responde la
 * verificación pasa y el puntaje sube.
 */

import { normalizeRut } from '@/lib/utils/rut';
import type { Solicitud, SolicitudKind } from './solicitudes';

/** Los caminos de «Publicar» que son un registro de socio. */
export type SocioRegistroKind = Exclude<SolicitudKind, 'propuestas'>;

export interface SolicitudCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
  /** Peso en el puntaje; los pesos de este motor suman 100. */
  weight: number;
  /** Pregunta concreta para el solicitante cuando no pasa. */
  question?: string;
  /** Lo que respondió la persona y resolvió la advertencia. */
  clarified?: string;
  /** Datos concretos que se miraron, para que el panel explique la decisión. */
  facts?: { label: string; value: string }[];
}

export interface SolicitudQuestion {
  /** Clave estable: es la que une la respuesta con su pregunta. */
  id: string;
  question: string;
}

export interface SolicitudAnswer {
  id: string;
  answer: string;
}

export interface SolicitudEvaluation {
  score: number;
  decision: 'Aceptada' | 'Pendiente_Informacion';
  checks: SolicitudCheck[];
  questions: SolicitudQuestion[];
  /** Motivos de la decisión, en el orden en que se evaluaron. */
  reasons: string[];
  createdAt: string;
}

/** Correos de proveedores gratuitos: válidos para una persona, no para una empresa. */
const FREE_MAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'hotmail.cl',
  'outlook.com',
  'outlook.cl',
  'live.com',
  'live.cl',
  'yahoo.com',
  'yahoo.es',
  'yahoo.cl',
  'icloud.com',
  'me.com',
  'protonmail.com',
  'proton.me',
  'gmx.com',
  'mail.com',
]);

/** Umbral de aceptación automática. */
export const SOLICITUD_PASS_SCORE = 80;

/**
 * Claves del `payload` que escribe la evaluación automática.
 *
 * Viven en este módulo —puro— y no en el store porque las usa también el panel,
 * que es un componente de cliente: importar el store desde ahí arrastraría la
 * clave de servicio al bundle del navegador. La tabla no tiene columnas para
 * esto y no hizo falta una migración: `payload` ya es JSONB.
 */
export const SOLICITUD_REVIEW_KEYS = {
  evaluation: 'solicitud_evaluation',
  answers: 'solicitud_answers',
  tokenHash: 'answer_token_hash',
  tokenExpiresAt: 'answer_token_expires_at',
} as const;

/** Puntaje de una verificación: pasa entera, advierte la mitad, falla en cero. */
function checkScore(check: SolicitudCheck): number {
  if (check.status === 'pass') return check.weight;
  if (check.status === 'warn') return Math.round(check.weight / 2);
  return 0;
}

function domainOfEmail(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at === -1) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain || null;
}

/** Host de un sitio declarado, sin `www.` y sin ruta. */
function domainOfWebsite(website: unknown): string | null {
  if (typeof website !== 'string' || !website.trim()) return null;
  try {
    const url = new URL(website.trim());
    return url.hostname.replace(/^www\./i, '').toLowerCase() || null;
  } catch {
    return null;
  }
}

/** Teléfono chileno plausible: móvil de 9 dígitos que empieza en 9, o fijo de 8-9. */
function phoneLooksChilean(phone: string): boolean {
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('56')) digits = digits.slice(2);
  if (digits.length === 9 && digits.startsWith('9')) return true;
  return digits.length >= 8 && digits.length <= 9;
}

function labelOf(kind: SocioRegistroKind): string {
  return kind === 'corredora' ? 'corredora' : kind === 'inmobiliaria' ? 'inmobiliaria' : 'agente';
}

/** Resuelve una verificación que la persona aclaró por el enlace del correo. */
function applyClarification(
  check: SolicitudCheck,
  clarifications: Record<string, string>
): SolicitudCheck {
  const answer = clarifications[check.id]?.trim();
  if (!answer || check.status === 'pass') return check;
  return {
    ...check,
    status: 'pass',
    detail: `${check.detail} La persona aclaró: «${answer}».`,
    clarified: answer,
    question: undefined,
  };
}

/**
 * Evalúa un registro de socio.
 *
 * `existing` son las otras solicitudes ya guardadas: sin ellas no se puede
 * detectar un RUT repetido, que es el caso que más veces termina en dos
 * registros para la misma persona.
 */
export function evaluateSolicitud(
  solicitud: Solicitud,
  options: {
    existing?: readonly Solicitud[];
    clarifications?: Record<string, string>;
    now?: Date;
  } = {}
): SolicitudEvaluation {
  const kind = solicitud.kind as SocioRegistroKind;
  const isAgent = kind === 'agente';
  const clarifications = options.clarifications ?? {};
  const existing = options.existing ?? [];
  const payload = solicitud.payload;

  const offerLabel = isAgent
    ? 'tu registro de profesional independiente'
    : `el registro de ${labelOf(kind)}`;
  const checks: SolicitudCheck[] = [];

  // ── 1. RUT ────────────────────────────────────────────────────────────────
  const rut = typeof payload.rut === 'string' ? payload.rut : '';
  const normalizedRut = normalizeRut(rut);
  checks.push({
    id: 'rut',
    label: isAgent ? 'RUT de la persona' : 'RUT de la empresa',
    status: normalizedRut ? 'pass' : 'fail',
    detail: normalizedRut
      ? `El RUT ${normalizedRut} pasó la validación de dígito verificador.`
      : 'El RUT no tiene un dígito verificador válido.',
    weight: 20,
    question: normalizedRut
      ? undefined
      : 'El RUT que dejaste no pasó la validación del dígito verificador. ¿Nos confirmas el RUT correcto?',
    facts: [{ label: 'RUT informado', value: rut || 'sin dato' }],
  });

  // ── 2. Correo ─────────────────────────────────────────────────────────────
  const email = solicitud.email.toLowerCase();
  const emailDomain = domainOfEmail(email);
  const freeMail = emailDomain ? FREE_MAIL_DOMAINS.has(emailDomain) : false;
  checks.push({
    id: 'correo',
    label: 'Correo de contacto',
    // Un agente es una persona: su Gmail es un correo real. Una empresa que
    // atiende desde un Gmail no tiene canal corporativo que verificar.
    status: !freeMail || isAgent ? 'pass' : 'warn',
    detail: freeMail
      ? isAgent
        ? 'Es un correo personal, que es lo esperable en un profesional independiente.'
        : `El correo es de un proveedor gratuito (${emailDomain}).`
      : `El correo usa el dominio ${emailDomain}.`,
    weight: 20,
    question:
      freeMail && !isAgent
        ? 'El correo que dejaste es de un proveedor gratuito. ¿Cuál es el correo corporativo de la empresa?'
        : undefined,
    facts: [{ label: 'Dominio del correo', value: emailDomain ?? 'sin dato' }],
  });

  // ── 3. Sitio web ──────────────────────────────────────────────────────────
  const siteDomain = domainOfWebsite(payload.website);
  const website = typeof payload.website === 'string' ? payload.website.trim() : '';
  const mismatched = !!siteDomain && !!emailDomain && siteDomain !== emailDomain;

  if (website) {
    checks.push({
      id: 'sitio',
      label: 'Sitio web',
      status: mismatched ? 'warn' : 'pass',
      detail: mismatched
        ? `El sitio es ${siteDomain} y el correo ${emailDomain}: son dominios distintos.`
        : `El sitio declarado es ${siteDomain}.`,
      weight: 25,
      question: mismatched
        ? 'El sitio web y el correo son de dominios distintos. ¿Nos confirmas cuál es el sitio oficial de la empresa?'
        : undefined,
      facts: [
        { label: 'Sitio', value: website },
        { label: 'Dominio del sitio', value: siteDomain ?? 'sin dato' },
      ],
    });
  } else if (isAgent) {
    // El profesional independiente no necesita sitio: su canal es el teléfono.
    checks.push({
      id: 'sitio',
      label: 'Sitio web',
      status: 'pass',
      detail:
        'No declaró sitio web; no es un requisito para un profesional independiente.',
      weight: 25,
    });
  } else {
    checks.push({
      id: 'sitio',
      label: 'Sitio web',
      status: 'warn',
      detail: 'No declaró sitio web, así que no hay presencia que contrastar con el correo.',
      weight: 25,
      question: 'No declaraste un sitio web. ¿Cuál es la dirección del sitio de la empresa?',
    });
  }

  // ── 4. Alcance ────────────────────────────────────────────────────────────
  const coverage = payload.coverage;
  const regions = Array.isArray(payload.regions)
    ? payload.regions.filter((region): region is string => typeof region === 'string')
    : [];
  const coverageBroken = coverage !== 'nacional' && coverage !== 'regional';
  const regionalEmpty = coverage === 'regional' && regions.length === 0;

  checks.push({
    id: 'cobertura',
    label: 'Alcance geográfico',
    status: coverageBroken || regionalEmpty ? 'fail' : 'pass',
    detail: coverageBroken
      ? 'No indicó si trabaja en todo Chile o solo en algunas regiones.'
      : regionalEmpty
        ? 'Declaró alcance regional pero no eligió ninguna región.'
        : coverage === 'nacional'
          ? 'Trabaja en todo Chile.'
          : `Trabaja en ${regions.length} ${regions.length === 1 ? 'región' : 'regiones'}: ${regions.join(', ')}.`,
    weight: 15,
    question:
      coverageBroken || regionalEmpty
        ? '¿Trabajas en todo Chile o solo en algunas regiones? Si es regional, ¿cuáles?'
        : undefined,
    facts: [
      { label: 'Alcance', value: coverage === 'nacional' ? 'Nacional' : 'Regional' },
      ...(regions.length > 0 ? [{ label: 'Regiones', value: regions.join(', ') }] : []),
    ],
  });

  // ── 5. Teléfono ───────────────────────────────────────────────────────────
  const phoneOk = phoneLooksChilean(solicitud.phone);
  checks.push({
    id: 'contacto',
    label: 'Teléfono',
    status: phoneOk ? 'pass' : 'warn',
    detail: phoneOk
      ? 'El teléfono tiene forma de número chileno.'
      : 'El teléfono no parece un número chileno completo.',
    weight: 10,
    question: phoneOk
      ? undefined
      : 'El teléfono que dejaste no parece completo. ¿Nos confirmas un número con el que podamos llamarte?',
    facts: [{ label: 'Teléfono', value: solicitud.phone }],
  });

  // ── 6. Duplicados ─────────────────────────────────────────────────────────
  // Se compara el RUT **canónico** contra el de la otra fila: uno puede estar
  // guardado con puntos y el otro sin ellos, y es la misma empresa.
  const sameRut = (other: Solicitud): boolean => {
    if (!normalizedRut || typeof other.payload.rut !== 'string') return false;
    return normalizeRut(other.payload.rut) === normalizedRut;
  };

  const duplicate = existing.find(
    (other) =>
      other.id !== solicitud.id &&
      (sameRut(other) || other.email.toLowerCase() === email)
  );
  checks.push({
    id: 'duplicado',
    label: 'Solicitudes previas',
    // En rojo y no en amarillo: dos registros para la misma persona no se
    // aceptan sin preguntar si es una corrección o un alta nueva.
    status: duplicate ? 'fail' : 'pass',
    detail: duplicate
      ? `Ya hay una solicitud con ${sameRut(duplicate) ? 'este RUT' : 'este correo'} (ref. ${duplicate.id}).`
      : 'No hay otra solicitud con el mismo RUT ni el mismo correo.',
    weight: 10,
    question: duplicate
      ? 'Ya tenemos una solicitud con tus mismos datos. ¿Es una corrección de esa solicitud o un registro nuevo?'
      : undefined,
    facts: duplicate ? [{ label: 'Solicitud previa', value: duplicate.id }] : [],
  });

  const clarified = checks.map((check) => applyClarification(check, clarifications));
  const score = clarified.reduce((total, check) => total + checkScore(check), 0);
  const failed = clarified.filter((check) => check.status === 'fail');
  const accepted = score >= SOLICITUD_PASS_SCORE && failed.length === 0;

  // Solo se pregunta lo que bloquea. Una advertencia que no bajó el puntaje
  // suficiente no genera un correo: pedir un dato que no cambia la decisión
  // enseña a ignorar los correos.
  const questions: SolicitudQuestion[] = accepted
    ? []
    : clarified
        .filter((check) => check.status !== 'pass' && check.question)
        .map((check) => ({ id: check.id, question: check.question as string }));

  const reasons: string[] = [];
  for (const check of clarified) {
    if (check.status === 'pass') continue;
    reasons.push(`${check.label}: ${check.detail}`);
  }
  if (accepted) reasons.push(`Puntaje ${score}/100: cumple el mínimo para continuar.`);
  else if (failed.length > 0) reasons.push(`No puede aceptarse: ${failed.length} verificación(es) en rojo.`);
  else reasons.push(`Puntaje ${score}/100: por debajo de ${SOLICITUD_PASS_SCORE}, se pide información.`);

  return {
    score,
    decision: accepted ? 'Aceptada' : 'Pendiente_Informacion',
    checks: clarified,
    questions,
    reasons,
    createdAt: (options.now ?? new Date()).toISOString(),
  };
}

/** Texto del camino para los correos: «tu registro de corredora». */
export function solicitudOfferLabel(kind: SolicitudKind): string {
  if (kind === 'propuestas') return 'tu solicitud';
  return `tu registro de ${labelOf(kind)}`;
}
