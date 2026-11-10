/**
 * Propuesta comercial del alta de empresas.
 *
 * Entre «calificada» y «alta» hay una decisión de plata: el plan, el alta
 * inicial y la mensualidad. Antes esa conversación vivía en una llamada y el
 * estado saltaba directo a «elige tu plan»; ahora se envía una propuesta con
 * números, el candidato la acepta o la rechaza desde su enlace, y el alta recién
 * arranca cuando dijo que sí.
 *
 * Lo que se guarda es un **historial** y no una propuesta sola: si el candidato
 * pide otros números, la anterior no se borra, queda con su fecha y su
 * resultado. Eso es lo que permite responder «¿qué le ofrecimos en octubre?» sin
 * depender de la memoria de quien negoció.
 *
 * La propuesta decide **solo el plan**: alta inicial, mensualidad y, si lo
 * quiere, el plan de captación de leads. El **CCA** —la suma de publicaciones del
 * socio en UF— no se firma acá: es una determinación que se resuelve después del
 * alta, cuando el socio ya tiene publicaciones que sumar (`lib/kyb/cca.ts`).
 * Cobrarlo en la propuesta obligaba a estimar en UF algo que todavía no existe.
 *
 * El módulo es puro: los montos de partida salen de `planPricing` (lo que el
 * equipo definió en Planes) y el plan del catálogo de `plans`. Nada de red ni de
 * base acá.
 */

import type { KybRegistrationKind } from './application';
import type { PartnerKind } from '@/lib/data/partners';
import { KYB_PLANS, getKybPlan, isKybPlanId, type KybPlanId } from './plans';
import {
  DEFAULT_PLAN_PRICING,
  MAX_PRICE_CLP,
  planPrice,
  type PlanPricingConfig,
} from './planPricing';
import { isKybProposalDecision, type KybProposalDecision } from './status';

/** Tope de la nota que viaja en el correo: más que esto no se lee. */
export const KYB_PROPOSAL_NOTE_MAX = 800;

export interface KybProposal {
  planId: KybPlanId;
  /** Cobro único del alta, en pesos. */
  altaClp: number;
  /** Mensualidad, en pesos. */
  monthlyClp: number;
  note: string | null;
  sentAt: string;
  /** Cuándo la respondió el candidato; `null` mientras está pendiente. */
  decidedAt: string | null;
  decision: KybProposalDecision | null;
  /**
   * Lo que el candidato definió al aceptar, más allá del plan.
   *
   * Hoy es una sola cosa: si contrata o no el plan de captación de leads. El
   * campo se conserva como objeto —y no como un booleano suelto— porque las
   * propuestas aceptadas antes de este cambio guardaban además el CCA, y esas
   * filas tienen que seguir leyéndose. `null` mientras la propuesta está
   * pendiente o si se envió antes de que existiera este paso.
   */
  commercial: KybCommercialTerms | null;
}

/**
 * Condiciones comerciales aceptadas por el candidato.
 *
 * Solo la captación: el CCA dejó de firmarse en la propuesta y pasó a
 * determinarse después del alta, con las publicaciones reales del socio
 * (`lib/kyb/cca.ts`). Las filas viejas que traen `ccaUf`/`ccaPct` se siguen
 * leyendo; los campos se ignoran en vez de rechazar la propuesta.
 */
export interface KybCommercialTerms {
  captacion: boolean;
  acceptedAt: string;
}

/**
 * Perfil de precio que le corresponde a cada camino de registro.
 *
 * El alta directa por API no trae `registration_kind`, así que cae en el perfil
 * más chico: una propuesta con precios de corredora para alguien que no declaró
 * serlo sería un cobro de más, y el equipo siempre puede corregir los montos a
 * mano antes de enviarla.
 */
export function profileForRegistration(kind: KybRegistrationKind | null): PartnerKind {
  if (kind === 'corredora') return 'corredora';
  if (kind === 'inmobiliaria') return 'inmobiliaria';
  return 'agente';
}

/**
 * Montos de partida de la propuesta, según el plan que se está ofreciendo.
 *
 * Antes salían del perfil del registro; ahora el candidato elige plan en el
 * correo de calificación y lo que se le propone es lo que cuesta ese plan en
 * **Planes**. El perfil sigue mandando en la captación de leads, que es otro
 * producto.
 */
export function defaultProposalAmounts(
  planId: KybPlanId,
  config: PlanPricingConfig = DEFAULT_PLAN_PRICING
): { altaClp: number; monthlyClp: number } {
  const price = planPrice(config, planId);
  return {
    altaClp: price?.altaInicialClp ?? 0,
    monthlyClp: price?.mensualBaseClp ?? 0,
  };
}

/**
 * Plan del catálogo que le corresponde a cada perfil.
 *
 * Es el que la propuesta propone de partida y el que el correo de calificación
 * anuncia con sus usuarios incluidos. El equipo puede enviar otro plan;
 * esto es el punto de partida, no una regla.
 */
export const DEFAULT_PLAN_BY_PROFILE: Record<PartnerKind, KybPlanId> = {
  agente: 'basico',
  corredora: 'profesional',
  inmobiliaria: 'premium',
};

export function defaultPlanForProfile(profile: PartnerKind): KybPlanId {
  return DEFAULT_PLAN_BY_PROFILE[profile] ?? 'profesional';
}

/**
 * Un plan ofrecido en el correo de calificación y en su pantalla de elección.
 *
 * Es el catálogo (`plans.ts`) con los montos de **Planes**. El precio vive en la
 * configuración del equipo y no en el código: cambiar cuánto cuesta un plan no
 * puede depender de un deploy. **Ningún plan trae cupo de publicaciones**: el
 * CCA se factura sobre la cartera.
 */
export interface PlanOption {
  planId: KybPlanId;
  planName: string;
  altaClp: number;
  monthlyClp: number;
  usuariosIncluidos: number;
  features: readonly string[];
  /** El que corresponde al perfil del registro, para señalarlo como sugerido. */
  recommended: boolean;
}

/** Los tres planes con sus precios vigentes, en el orden del catálogo. */
export function planOptions(
  kind: KybRegistrationKind | null,
  config: PlanPricingConfig = DEFAULT_PLAN_PRICING
): PlanOption[] {
  const recommended = defaultPlanForProfile(profileForRegistration(kind));

  return KYB_PLANS.map((catalog) => {
    const price = planPrice(config, catalog.id);
    return {
      planId: catalog.id,
      planName: catalog.name,
      altaClp: price?.altaInicialClp ?? 0,
      monthlyClp: price?.mensualBaseClp ?? 0,
      usuariosIncluidos: price?.usuariosIncluidos ?? catalog.users,
      features: catalog.features,
      recommended: catalog.id === recommended,
    };
  });
}

/**
 * Lo que el candidato define al aceptar la propuesta.
 *
 * Aceptar no es solo decir que sí al plan: el CCA es un costo aparte —la suma de
 * las publicaciones del socio, en UF, traducida a pesos— y la captación de leads
 * es otro producto. Las dos decisiones se toman acá, cuando ya tiene los números
 * en la mano, y no en una llamada que no deja rastro.
 *
 * El CCA estimado es lo que el socio declara hoy; cuando cargue sus propiedades
 * el sistema lo recalcula solo, así que es una estimación y no un compromiso.
 */
export interface NormalizedCommercial {
  captacion: boolean;
}

/**
 * Valida las decisiones comerciales del paso de propuesta.
 *
 * Aceptar es decir que sí al plan y, si quiere, a la captación de leads. No hay
 * nada más que exigir: el CCA ya no se firma acá, y pedirlo obligaba a declarar
 * un stock que el socio todavía no tiene cargado.
 */
export function normalizeCommercial(input: {
  captacion?: unknown;
}): { ok: true; data: NormalizedCommercial } | { ok: false; error: string } {
  if (input.captacion !== undefined && typeof input.captacion !== 'boolean') {
    return { ok: false, error: 'La respuesta sobre el plan de captación no es válida.' };
  }

  return { ok: true, data: { captacion: input.captacion === true } };
}

export interface NormalizedProposal {
  planId: KybPlanId;
  altaClp: number;
  monthlyClp: number;
  note: string | null;
}

export type ProposalValidation =
  | { ok: true; data: NormalizedProposal }
  | { ok: false; error: string };

function amount(value: unknown, label: string): number | string {
  if (value === undefined || value === null || value === '') {
    return `${label} es obligatorio.`;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    return `${label} tiene que ser un entero en pesos.`;
  }
  if (parsed > MAX_PRICE_CLP) return `${label} está fuera del rango razonable.`;
  return parsed;
}

/**
 * Valida lo que manda el panel al enviar una propuesta.
 *
 * Los montos son obligatorios a propósito: enviar una propuesta con el alta en
 * $0 porque el campo venía vacío es un error comercial que se descubre cuando el
 * cliente ya aceptó.
 */
export function normalizeProposal(
  input: { plan?: unknown; altaClp?: unknown; monthlyClp?: unknown; note?: unknown },
  config: PlanPricingConfig = DEFAULT_PLAN_PRICING
): ProposalValidation {
  if (!isKybPlanId(input.plan)) {
    return { ok: false, error: 'Elige uno de los planes del catálogo.' };
  }
  const planId = input.plan;

  const defaults = defaultProposalAmounts(planId, config);

  const alta = input.altaClp === undefined ? defaults.altaClp : amount(input.altaClp, 'El alta inicial');
  if (typeof alta === 'string') return { ok: false, error: alta };

  const monthly =
    input.monthlyClp === undefined ? defaults.monthlyClp : amount(input.monthlyClp, 'La mensualidad');
  if (typeof monthly === 'string') return { ok: false, error: monthly };

  const note = typeof input.note === 'string' ? input.note.trim() : '';
  if (note.length > KYB_PROPOSAL_NOTE_MAX) {
    return { ok: false, error: `La nota no puede superar los ${KYB_PROPOSAL_NOTE_MAX} caracteres.` };
  }

  return {
    ok: true,
    data: { planId, altaClp: alta, monthlyClp: monthly, note: note || null },
  };
}

/** Nombre del plan en el catálogo, para correo, panel y página pública. */
export function proposalPlanName(planId: KybPlanId): string {
  return getKybPlan(planId).name;
}

function parseOne(value: unknown): KybProposal | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!isKybPlanId(raw.planId)) return null;

  const decision = isKybProposalDecision(raw.decision) ? raw.decision : null;

  return {
    planId: raw.planId,
    altaClp: typeof raw.altaClp === 'number' && Number.isFinite(raw.altaClp) ? raw.altaClp : 0,
    monthlyClp:
      typeof raw.monthlyClp === 'number' && Number.isFinite(raw.monthlyClp) ? raw.monthlyClp : 0,
    note: typeof raw.note === 'string' && raw.note ? raw.note : null,
    sentAt: typeof raw.sentAt === 'string' ? raw.sentAt : '',
    decidedAt: typeof raw.decidedAt === 'string' ? raw.decidedAt : null,
    decision,
    commercial: parseCommercial(raw.commercial),
  };
}

function parseCommercial(value: unknown): KybCommercialTerms | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  // Dos generaciones de filas: las que se aceptaron con el CCA (`ccaAccepted`)
  // y las de ahora, que solo guardan la captación. Las viejas no se descartan:
  // perderían la fecha en que el candidato dijo que sí.
  const known = typeof raw.captacion === 'boolean' || typeof raw.ccaAccepted === 'boolean';
  if (!known) return null;

  return {
    captacion: raw.captacion === true,
    acceptedAt: typeof raw.acceptedAt === 'string' ? raw.acceptedAt : '',
  };
}

/**
 * Lee la columna `proposal`.
 *
 * Acepta un objeto suelto o un arreglo, y descarta lo que no tenga forma de
 * propuesta en vez de romper la ficha: una fila editada a mano en Supabase no
 * puede dejar el panel sin abrir.
 */
export function readProposals(value: unknown): KybProposal[] {
  if (Array.isArray(value)) {
    return value.map(parseOne).filter((item): item is KybProposal => item !== null);
  }
  const single = parseOne(value);
  return single ? [single] : [];
}

/** La propuesta vigente: la última enviada, pendiente o ya respondida. */
export function latestProposal(value: unknown): KybProposal | null {
  const all = readProposals(value);
  return all.length > 0 ? all[all.length - 1] : null;
}

/**
 * Lo que la empresa ve y confirma en el paso de plan del alta.
 *
 * El precio **no** puede salir del catálogo del código: la lista de planes de
 * `plans.ts` tiene precios de partida que no son los que el equipo definió en
 * **Planes**, y mostrar uno y cobrar otro es la peor forma de descubrir un
 * desajuste. Los montos vienen de la propuesta que el candidato ya aceptó —cuyo
 * valor inicial sale de Planes, según el perfil— y, si la solicitud llegó al
 * alta sin propuesta, de los precios configurados para su perfil.
 *
 * El plan del alta tampoco se elige de nuevo: lo fijó la propuesta. Cambiarlo
 * acá invalidaría los números que el candidato aceptó.
 */
export interface AltaPlanSummary {
  planId: KybPlanId;
  planName: string;
  /** Cobro único del alta, en pesos. */
  altaClp: number;
  /** Mensualidad, en pesos. */
  monthlyClp: number;
  usuariosIncluidos: number;
  /** De dónde salieron los montos, para poder explicarlo en la pantalla. */
  source: 'propuesta' | 'planes';
}

export function altaPlanSummary({
  plan,
  proposal,
  config = DEFAULT_PLAN_PRICING,
}: {
  plan: KybPlanId | null;
  proposal: KybProposal | null;
  config?: PlanPricingConfig;
}): AltaPlanSummary {
  const planId = proposal?.planId ?? plan ?? 'profesional';
  const catalog = getKybPlan(planId);
  const price = planPrice(config, planId);
  const defaults = defaultProposalAmounts(planId, config);

  return {
    planId,
    planName: catalog.name,
    altaClp: proposal ? proposal.altaClp : defaults.altaClp,
    monthlyClp: proposal ? proposal.monthlyClp : defaults.monthlyClp,
    usuariosIncluidos: price?.usuariosIncluidos ?? catalog.users,
    source: proposal ? 'propuesta' : 'planes',
  };
}
