/**
 * Precios de los planes por perfil de socio, y el CCA.
 *
 * El precio dejó de ser un número en el código: el panel tiene la sección
 * **Planes** (`/admin/planes`) donde el equipo define, para cada perfil, cuánto
 * se cobra al dar de alta, cuánto por mes y cuántos usuarios incluye la cuenta.
 * Eso es una decisión de negocio y cambia sin un deploy.
 *
 * Los tres perfiles son los mismos con los que se reparte el trabajo en el
 * panel, y el orden va de menor a mayor compromiso: profesional independiente,
 * corredora, inmobiliaria.
 *
 * ## CCA
 *
 * El CCA es la **suma de la cartera de un socio, en UF**: el volumen de
 * propiedades que publica. Es una determinación que se resuelve después del alta
 * —no un servicio que se contrate ni un cobro por publicación— y depende de
 * cuánto stock maneja cada socio, así que no es un precio de catálogo y no se
 * guarda con los precios: se calcula (`lib/kyb/cca.ts`).
 * La fórmula que definió el equipo es
 *
 *   $CCA = CCA × valor de la UF ÷ 1.000.000 × %CCA
 *
 * El divisor —el **factor**— y el resultado **son pesos**: un socio cuyo CCA
 * suma 100.000 UF gasta `100.000 × 40.000 ÷ 1.000.000 = $4.000` con el %CCA de
 * partida, que es 100 y deja la fórmula en su forma original.
 *
 * Ese `÷ 1.000.000` no es una constante intocable: es el factor con el que se
 * traduce el CCA a pesos y el equipo lo ajusta desde el panel con **%CCA**, un
 * porcentaje que se guarda con los precios. La regla es directa:
 *
 * - `%CCA = 100` → el factor es 1.000.000 y el monto es el de siempre.
 * - `%CCA = 50` → el factor sube a 2.000.000 y se cobra la mitad.
 * - `%CCA = 200` → el factor baja a 500.000 y se cobra el doble.
 *
 * O sea que el porcentaje **es** el precio relativo: más % es más plata, y el
 * factor equivalente (`ccaFactor`) se muestra en el panel para que no haya que
 * hacer la cuenta mentalmente.
 *
 * El valor de partida es `100`: deja el factor en 1.000.000 y el monto es el
 * valor de la cartera en pesos (CCA en UF × valor de la UF), sin ajuste. La
 * cuenta vive en `ccaAmountClp` para que la pantalla y cualquier pieza futura
 * usen la misma y no dos copias que se despeguen.
 *
 * El módulo es puro (sin React, sin red, sin base): acá está lo que hay que
 * poder probar, y la pantalla solo dibuja lo que esto calcula.
 */

import { PARTNER_KIND_LABELS, type PartnerKind } from '@/lib/data/partners';
import { KYB_PLAN_IDS, getKybPlan, isKybPlanId, type KybPlanId } from './plans';

/** Clave con la que la configuración se guarda en `plan_settings`. */
export const PLAN_PRICING_KEY = 'planes';

/**
 * Versión del formato. Subió a 2 cuando el precio pasó de ser «por plan» a
 * «por perfil» (alta inicial, mensual y usuarios), y a 5 cuando el %CCA de
 * partida volvió a 100, y a 6 cuando la suscripción volvió a tener precio por plan
 * (básico, profesional, premium), que es lo que la empresa elige. Una fila guardada con otra versión se descarta y
 * vuelven los valores de partida, en vez de leerse con la forma equivocada.
 */
export const PLAN_PRICING_VERSION = 6 as const;

/** Lo que se cobra por un perfil de socio. */
export interface ProfilePlan {
  profile: PartnerKind;
  /** Cobro único al habilitar la cuenta, en pesos. */
  altaInicialClp: number;
  /** Mensualidad base, en pesos, sin IVA. */
  mensualBaseClp: number;
  /** Usuarios con acceso al panel que entran en la mensualidad. */
  usuariosIncluidos: number;
}

/**
 * Lo que se cobra por un plan del catálogo: básico, profesional o premium.
 *
 * Es el precio que la empresa ve en el correo de calificación y con el que se
 * arma su propuesta al elegir. Se separó del perfil porque la elección es del
 * candidato: una corredora puede quedarse en Básico y pagar lo que cuesta Básico,
 * sin que su tipo de empresa le fije el precio.
 */
export interface PlanPrice {
  plan: KybPlanId;
  /** Cobro único del alta, en pesos. */
  altaInicialClp: number;
  /** Mensualidad, en pesos, sin IVA. */
  mensualBaseClp: number;
  /** Usuarios con acceso al panel que entran en la mensualidad. */
  usuariosIncluidos: number;
}

/**
 * Suscripción al plan de captación de un perfil.
 *
 * Es el otro producto del portal: no se paga por publicar, se paga por recibir
 * leads. Va en paralelo a los planes de suscripción (alta, mensualidad y
 * usuarios) y no los reemplaza: un socio puede tener uno, el otro o los dos.
 */
export interface CaptacionMonthly {
  profile: PartnerKind;
  /** Suscripción Captación Activa, en pesos por mes. */
  monthlyClp: number;
}

/**
 * Un tramo de acceso a leads.
 *
 * `from`/`to` están en la unidad de la tabla: **UF** para ventas y **pesos**
 * para arriendos. Los dos extremos son inclusivos y solo el último tramo no
 * tiene tope (`to: null`), así que cualquier lead cae en exactamente un tramo.
 */
export interface LeadBracket {
  from: number;
  to: number | null;
  /** Lo que se cobra al socio por acceder a un lead de este tramo. */
  priceClp: number;
}

export interface CaptacionPlans {
  monthly: CaptacionMonthly[];
  /** Acceso a un lead de venta según el valor de la propiedad, en UF. */
  ventas: LeadBracket[];
  /** Acceso a un lead de arriendo según el canon mensual, en pesos. */
  arriendos: LeadBracket[];
}

export interface PlanPricingConfig {
  version: typeof PLAN_PRICING_VERSION;
  /**
   * %CCA: cuánto del valor base del CCA se cobra. 100 deja el factor en
   * 1.000.000, que es la fórmula original; es el ajuste que el equipo cambia a
   * discreción desde el panel y viaja guardado con los precios.
   */
  ccaPct: number;
  profiles: ProfilePlan[];
  /** Precio de cada plan del catálogo; es de donde sale la propuesta. */
  plans: PlanPrice[];
  captacion: CaptacionPlans;
}

/**
 * Los perfiles, en el orden en que se muestran.
 *
 * Va del plan más barato al más caro y no en el orden de `PARTNER_KINDS` porque
 * la pantalla se lee como una escalera de precios.
 */
export const PRICING_PROFILES: readonly PartnerKind[] = [
  'agente',
  'corredora',
  'inmobiliaria',
];

/** Tope de precio: más que esto no es un plan de portal, es un error de dedo. */
export const MAX_PRICE_CLP = 50_000_000;

/** Un plan incluye al menos un usuario; el tope evita un 999999 de tipeo. */
export const MIN_USERS = 1;
export const MAX_USERS = 500;

/** Nombre visible del perfil. «Profesional» es la forma corta de «profesional independiente». */
export function profileLabel(profile: PartnerKind): string {
  return profile === 'agente' ? 'Profesional' : PARTNER_KIND_LABELS[profile];
}

/**
 * Divisor base de la fórmula del CCA: el «factor» de referencia.
 *
 * No es un número suelto en la pantalla ni una constante intocable: es el punto
 * donde el %CCA vale 100. Con otro porcentaje el factor efectivo se mueve
 * (`ccaFactor`) y el monto cobrado, con él.
 */
export const CCA_DIVISOR = 1_000_000;

/**
 * %CCA de partida: 100, la fórmula original. El factor queda en 1.000.000, así
 * que el monto es el valor de la cartera en pesos (CCA en UF × valor de la UF)
 * y el equipo solo lo ajusta desde **Planes** si quiere cobrar una fracción.
 * Guardado con los precios, así el ajuste sobrevive al reinicio del proceso.
 */
export const DEFAULT_CCA_PCT = 100;

/**
 * %CCA que traía la versión 4 como valor de partida.
 *
 * Esa cifra dejaba el factor en 12.000 (0,1 % de la cartera al año). Una fila
 * guardada con ella se lee como 100: era el valor de la escala vieja, no una
 * decisión del equipo.
 */
const LEGACY_CCA_PCT = 8_333.33;

/**
 * Rango del %CCA. El piso en 1 evita dejar el concepto en cero por un campo
 * vacío que se interpretó como 0; el techo —0,6 % de la cartera al año— acota el
 * ajuste comercial y sigue cortando un 999999 de tipeo.
 */
export const MIN_CCA_PCT = 1;
export const MAX_CCA_PCT = 50_000;

/**
 * Suscripciones de captación de partida: lo que definió el equipo por perfil.
 *
 * Se llaman «Captación Activa» en la pantalla porque es lo que compran: estar
 * activos en el reparto de leads, antes de pagar ninguno.
 */
export const DEFAULT_CAPTACION_MONTHLY: readonly CaptacionMonthly[] = [
  { profile: 'agente', monthlyClp: 9990 },
  { profile: 'corredora', monthlyClp: 19990 },
  { profile: 'inmobiliaria', monthlyClp: 39990 },
];

/**
 * Tramo de acceso por lead, de partida.
 *
 * Ventas se mide en UF (lo que vale la propiedad) y arriendos en pesos (el
 * canon mensual), porque son las unidades en las que el equipo piensa cada
 * negocio. Los cortes son los que definió el equipo y los precios se editan en
 * el panel; los cortes, no: cambiarlos es cambiar el producto.
 */
export const DEFAULT_LEAD_BRACKETS: CaptacionPlans = {
  monthly: [...DEFAULT_CAPTACION_MONTHLY],
  ventas: [
    { from: 0, to: 5000, priceClp: 3000 },
    { from: 5001, to: 10000, priceClp: 5000 },
    { from: 10001, to: 20000, priceClp: 8000 },
    { from: 20001, to: 40000, priceClp: 12000 },
    { from: 40001, to: null, priceClp: 20000 },
  ],
  arriendos: [
    { from: 0, to: 500000, priceClp: 2000 },
    { from: 500001, to: 1500000, priceClp: 3000 },
    { from: 1500001, to: null, priceClp: 5000 },
  ],
};

/**
 * Precios de partida de cada plan del catálogo.
 *
 * Es la escalera que el equipo ya tenía por perfil, ahora atada al plan que el
 * candidato elige: Básico de entrada, Profesional el intermedio y Premium el
 * más completo. Los usuarios salen del catálogo (`plans.ts`), que es lo que el
 * plan promete.
 */
export const DEFAULT_PLAN_PRICES: readonly PlanPrice[] = [
  { plan: 'basico', altaInicialClp: 19990, mensualBaseClp: 14990, usuariosIncluidos: 1 },
  { plan: 'profesional', altaInicialClp: 49990, mensualBaseClp: 39990, usuariosIncluidos: 5 },
  { plan: 'premium', altaInicialClp: 99990, mensualBaseClp: 99990, usuariosIncluidos: 20 },
];

/** Perfil cuyo precio se usaba para cada plan antes de que existiera el precio propio. */
const PLAN_PROFILE_EQUIVALENT: Record<KybPlanId, PartnerKind> = {
  basico: 'agente',
  profesional: 'corredora',
  premium: 'inmobiliaria',
};

/** Precios de partida: los que definió el equipo para cada perfil. */
export const DEFAULT_PLAN_PRICING: PlanPricingConfig = {
  version: PLAN_PRICING_VERSION,
  ccaPct: DEFAULT_CCA_PCT,
  captacion: DEFAULT_LEAD_BRACKETS,
  plans: DEFAULT_PLAN_PRICES.map((price) => ({ ...price })),
  profiles: [
    {
      profile: 'agente',
      altaInicialClp: 19990,
      mensualBaseClp: 14990,
      usuariosIncluidos: 1,
    },
    {
      profile: 'corredora',
      altaInicialClp: 49990,
      mensualBaseClp: 39990,
      usuariosIncluidos: 5,
    },
    {
      profile: 'inmobiliaria',
      altaInicialClp: 99990,
      mensualBaseClp: 99990,
      usuariosIncluidos: 15,
    },
  ],
};

/** El plan de un perfil; `null` si la configuración no lo trae (no debería pasar: `normalize` completa). */
export function profilePlan(
  config: PlanPricingConfig,
  profile: PartnerKind
): ProfilePlan | null {
  return config.profiles.find((item) => item.profile === profile) ?? null;
}

/** El precio de un plan; `null` si la configuración no lo trae (no debería pasar: `normalize` completa). */
export function planPrice(config: PlanPricingConfig, plan: KybPlanId): PlanPrice | null {
  return config.plans.find((item) => item.plan === plan) ?? null;
}

/** Precio de un plan según los valores de partida. */
function defaultPlanPrice(plan: KybPlanId): PlanPrice {
  return (
    DEFAULT_PLAN_PRICES.find((item) => item.plan === plan) ?? {
      plan,
      altaInicialClp: 0,
      mensualBaseClp: 0,
      usuariosIncluidos: 1,
    }
  );
}

/**
 * La suscripción de captación de un perfil.
 *
 * Cae en el valor de partida si la configuración guardada no trae ese perfil
 * (una fila vieja, editada a mano): el panel y el cobro nunca se quedan sin
 * número.
 */
export function captacionMonthlyFor(config: PlanPricingConfig, profile: PartnerKind): number {
  const stored = config.captacion.monthly.find((item) => item.profile === profile);
  if (stored) return stored.monthlyClp;
  return DEFAULT_CAPTACION_MONTHLY.find((item) => item.profile === profile)?.monthlyClp ?? 0;
}

// ── CCA ──────────────────────────────────────────────────────────────────────

/** La fórmula, en una línea, para mostrar en el panel. */
export const CCA_FORMULA = '$CCA = CCA × valor de la UF ÷ 1.000.000 × %CCA';

/** Qué es el CCA, en una línea. */
export const CCA_DEFINITION =
  'CCA: suma de la cartera del socio (sus propiedades), en UF. Se cobra el CCA, no cada publicación.';

function validCca(ccaUf: number, ufValueClp: number): boolean {
  return (
    Number.isFinite(ccaUf) &&
    Number.isFinite(ufValueClp) &&
    ccaUf >= 0 &&
    ufValueClp >= 0
  );
}

/**
 * Convierte el CCA de un socio a pesos, con la fórmula acordada.
 *
 * Es la cuenta completa —multiplicar por la UF y dividir por un millón— y el
 * resultado es el monto a cobrar: 100.000 de CCA con una UF de $40.000 da
 * $4.000. No redondea acá; el formato decide cómo se muestra.
 */
export function ccaAmountClp(
  ccaUf: number,
  ufValueClp: number,
  ccaPct: number = DEFAULT_CCA_PCT
): number {
  if (!validCca(ccaUf, ufValueClp)) return 0;
  if (!Number.isFinite(ccaPct) || ccaPct <= 0 || ccaPct > MAX_CCA_PCT) return 0;
  return ((ccaUf * ufValueClp) / CCA_DIVISOR) * (ccaPct / 100);
}

/**
 * El factor —el divisor— que corresponde a un %CCA.
 *
 * Es la otra cara de la misma regla: `%CCA = 100` da 1.000.000, `50` da
 * 2.000.000 y `200` da 500.000. Se muestra en el panel para que el equipo vea
 * el divisor que está aplicando sin tener que despejarlo. Un valor fuera de
 * rango devuelve el factor base, que es lo mismo que no ajustar nada.
 */
export function ccaFactor(ccaPct: number = DEFAULT_CCA_PCT): number {
  if (!Number.isFinite(ccaPct) || ccaPct < MIN_CCA_PCT || ccaPct > MAX_CCA_PCT) {
    return CCA_DIVISOR;
  }
  return CCA_DIVISOR / (ccaPct / 100);
}

/** Monto en pesos para la calculadora del panel. */
export function formatCcaAmount(amountClp: number): string {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amountClp) ? amountClp : 0);
}

/**
 * Número con la convención de Chile: punto de miles y coma decimal.
 *
 * Existe porque la calculadora del panel escribe y lee en esa convención, y el
 * valor de la UF llega de `/api/indicators` como número de JavaScript (41242.32).
 * Poner ese número crudo en el campo era el error que inflaba el CCA cien veces:
 * el campo leía el punto como separador de miles. Todo lo que va a un input de
 * la calculadora pasa por acá.
 */
export function formatDecimalInput(value: number, maxDecimals = 2): string {
  if (!Number.isFinite(value)) return '';
  return new Intl.NumberFormat('es-CL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  }).format(value);
}

/**
 * Lee un número escrito por una persona en convención chilena.
 *
 * Reglas, en orden:
 *
 * 1. Si hay coma, es decimal y los puntos son de miles: `41.242,32` → 41242.32.
 * 2. Si no hay coma y los puntos agrupan de a tres, son de miles: `100.000` → 100000.
 * 3. Cualquier otro punto es decimal (`41242.32` → 41242.32), que es la forma en
 *    que otras fuentes —y el propio valor de la UF— escriben el número.
 *
 * Devuelve `null` cuando no hay ningún dígito, para que la pantalla distinga
 * «vacío» de cero.
 */
export function parseDecimalInput(value: string): number | null {
  const clean = String(value ?? '')
    .replace(/[^\d.,]/g, '')
    .trim();
  if (!/\d/.test(clean)) return null;

  let normalized: string;
  if (clean.includes(',')) {
    normalized = clean.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(clean)) {
    normalized = clean.replace(/\./g, '');
  } else {
    normalized = clean;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

// ── Validación ───────────────────────────────────────────────────────────────

export interface NormalizePricingResult {
  ok: boolean;
  config?: PlanPricingConfig;
  error?: string;
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function isProfile(value: unknown): value is PartnerKind {
  return typeof value === 'string' && (PRICING_PROFILES as readonly string[]).includes(value);
}

function defaultFor(profile: PartnerKind): ProfilePlan {
  return (
    DEFAULT_PLAN_PRICING.profiles.find((item) => item.profile === profile) ??
    DEFAULT_PLAN_PRICING.profiles[0]
  );
}

/** Tope de un corte de tramo: más que esto es un error de tipeo, no un mercado. */
export const MAX_BRACKET_VALUE = 10_000_000;

/**
 * Valida una tabla de tramos.
 *
 * Los tramos tienen que cubrir de punta a punta, sin huecos ni superposiciones:
 * un lead que no caiga en ninguno —o en dos— no tiene precio, y eso se descubre
 * al cobrar, no al guardar. El primero arranca en 0 y solo el último queda
 * abierto; el resto empieza donde termina el anterior + 1.
 */
function normalizeBrackets(
  input: unknown,
  defaults: readonly LeadBracket[],
  label: string,
  unit: string
): { ok: true; brackets: LeadBracket[] } | { ok: false; error: string } {
  if (input === undefined) {
    return { ok: true, brackets: defaults.map((bracket) => ({ ...bracket })) };
  }
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, error: `La tabla de ${label} necesita al menos un tramo.` };
  }

  const brackets: LeadBracket[] = [];

  for (let index = 0; index < input.length; index += 1) {
    const item = input[index];
    const position = index + 1;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, error: `El tramo ${position} de ${label} no tiene el formato esperado.` };
    }

    const candidate = item as Record<string, unknown>;
    if (!isIntegerInRange(candidate.from, 0, MAX_BRACKET_VALUE)) {
      return {
        ok: false,
        error: `El «desde» del tramo ${position} de ${label} tiene que ser un entero entre 0 y ${MAX_BRACKET_VALUE.toLocaleString('es-CL')} ${unit}.`,
      };
    }

    const last = index === input.length - 1;
    let to: number | null = null;
    if (candidate.to === null) {
      // Solo el último tramo puede quedar sin tope; si no, el siguiente nunca
      // recibiría un lead.
      if (!last) {
        return {
          ok: false,
          error: `Solo el último tramo de ${label} puede quedar sin tope.`,
        };
      }
    } else if (!isIntegerInRange(candidate.to, candidate.from, MAX_BRACKET_VALUE)) {
      return {
        ok: false,
        error: `El «hasta» del tramo ${position} de ${label} tiene que ser un entero mayor o igual que el «desde».`,
      };
    } else {
      to = candidate.to;
    }

    if (!isIntegerInRange(candidate.priceClp, 0, MAX_PRICE_CLP)) {
      return {
        ok: false,
        error: `El acceso del tramo ${position} de ${label} tiene que ser un entero entre 0 y ${MAX_PRICE_CLP.toLocaleString('es-CL')}.`,
      };
    }

    if (index === 0 && candidate.from !== 0) {
      return { ok: false, error: `El primer tramo de ${label} tiene que empezar en 0.` };
    }
    const previous = brackets[brackets.length - 1];
    if (previous && previous.to !== null && candidate.from !== previous.to + 1) {
      return {
        ok: false,
        error: `Los tramos de ${label} tienen que ser corridos: el tramo ${position} debe empezar en ${(previous.to + 1).toLocaleString('es-CL')}.`,
      };
    }

    brackets.push({ from: candidate.from, to, priceClp: candidate.priceClp });
  }

  return { ok: true, brackets };
}

/**
 * Valida lo que llega del panel y devuelve la configuración canónica.
 *
 * Acepta una configuración **parcial**: un perfil que no venga se completa con
 * los valores de partida, y los perfiles desconocidos se ignoran. Es la misma
 * regla que el resto de las entradas del panel: guardar un formulario no puede
 * borrar lo que no se estaba editando.
 */
export function normalizePlanPricing(input: unknown): NormalizePricingResult {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'La configuración de precios no tiene el formato esperado.' };
  }

  const raw = input as Record<string, unknown>;

  // Las filas guardadas con versiones anteriores se aceptan: los campos que no
  // existían entran con el valor de partida, así un guardado viejo no deja el
  // panel en «configuración de otra versión» ni pierde los precios que sí tenía.
  // La 2 no conocía el %CCA, la 3 los planes de captación y la 5 el precio por
  // plan (hasta la 5 el precio de la suscripción era el del perfil).
  const MIGRATABLE = new Set([2, 3, 4, 5]);
  const legacyRow = raw.version !== undefined && raw.version !== PLAN_PRICING_VERSION;
  if (legacyRow && !MIGRATABLE.has(raw.version as number)) {
    return {
      ok: false,
      error: `La configuración guardada es de otra versión (${String(raw.version)}).`,
    };
  }

  let ccaPct: number = DEFAULT_CCA_PCT;
  if (raw.ccaPct !== undefined) {
    const value = raw.ccaPct;
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < MIN_CCA_PCT ||
      value > MAX_CCA_PCT
    ) {
      return {
        ok: false,
        error: `El %CCA tiene que ser un número entre ${MIN_CCA_PCT} y ${MAX_CCA_PCT}.`,
      };
    }
    // Dos decimales alcanzan para un ajuste comercial y evitan guardar 33,33333.
    ccaPct = Math.round(value * 100) / 100;

    // La 4 guardaba 8.333,33 como valor de partida. No era un ajuste elegido:
    // se lee como 100 y la fila queda con el valor nuevo al próximo guardado.
    if (legacyRow && ccaPct === LEGACY_CCA_PCT) ccaPct = DEFAULT_CCA_PCT;
  }

  const profiles: ProfilePlan[] = [];
  const rawProfiles = Array.isArray(raw.profiles) ? raw.profiles : [];

  for (const item of rawProfiles) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Record<string, unknown>;
    if (!isProfile(candidate.profile)) continue;

    if (!isIntegerInRange(candidate.altaInicialClp, 0, MAX_PRICE_CLP)) {
      return {
        ok: false,
        error: `El alta inicial de «${profileLabel(candidate.profile)}» tiene que ser un entero entre 0 y ${MAX_PRICE_CLP.toLocaleString('es-CL')}.`,
      };
    }
    if (!isIntegerInRange(candidate.mensualBaseClp, 0, MAX_PRICE_CLP)) {
      return {
        ok: false,
        error: `La mensualidad de «${profileLabel(candidate.profile)}» tiene que ser un entero entre 0 y ${MAX_PRICE_CLP.toLocaleString('es-CL')}.`,
      };
    }
    if (!isIntegerInRange(candidate.usuariosIncluidos, MIN_USERS, MAX_USERS)) {
      return {
        ok: false,
        error: `Los usuarios de «${profileLabel(candidate.profile)}» tienen que ser un entero entre ${MIN_USERS} y ${MAX_USERS}.`,
      };
    }

    profiles.push({
      profile: candidate.profile,
      altaInicialClp: candidate.altaInicialClp,
      mensualBaseClp: candidate.mensualBaseClp,
      usuariosIncluidos: candidate.usuariosIncluidos,
    });
  }

  // ── Precios por plan ────────────────────────────────────────────────────────
  const rawPlans = Array.isArray(raw.plans) ? raw.plans : [];
  const plans: PlanPrice[] = [];

  for (const item of rawPlans) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Record<string, unknown>;
    if (!isKybPlanId(candidate.plan)) continue;
    const label = `«${getKybPlan(candidate.plan).name}»`;

    if (!isIntegerInRange(candidate.altaInicialClp, 0, MAX_PRICE_CLP)) {
      return {
        ok: false,
        error: `El alta inicial del plan ${label} tiene que ser un entero entre 0 y ${MAX_PRICE_CLP.toLocaleString('es-CL')}.`,
      };
    }
    if (!isIntegerInRange(candidate.mensualBaseClp, 0, MAX_PRICE_CLP)) {
      return {
        ok: false,
        error: `La mensualidad del plan ${label} tiene que ser un entero entre 0 y ${MAX_PRICE_CLP.toLocaleString('es-CL')}.`,
      };
    }
    if (!isIntegerInRange(candidate.usuariosIncluidos, MIN_USERS, MAX_USERS)) {
      return {
        ok: false,
        error: `Los usuarios del plan ${label} tienen que ser un entero entre ${MIN_USERS} y ${MAX_USERS}.`,
      };
    }

    plans.push({
      plan: candidate.plan,
      altaInicialClp: candidate.altaInicialClp,
      mensualBaseClp: candidate.mensualBaseClp,
      usuariosIncluidos: candidate.usuariosIncluidos,
    });
  }

  // ── Planes de captación ─────────────────────────────────────────────────────
  const rawCaptacion =
    raw.captacion && typeof raw.captacion === 'object' && !Array.isArray(raw.captacion)
      ? (raw.captacion as Record<string, unknown>)
      : {};

  const monthly: CaptacionMonthly[] = [];
  const rawMonthly = Array.isArray(rawCaptacion.monthly) ? rawCaptacion.monthly : [];

  for (const item of rawMonthly) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Record<string, unknown>;
    if (!isProfile(candidate.profile)) continue;

    if (!isIntegerInRange(candidate.monthlyClp, 0, MAX_PRICE_CLP)) {
      return {
        ok: false,
        error: `La suscripción de captación de «${profileLabel(candidate.profile)}» tiene que ser un entero entre 0 y ${MAX_PRICE_CLP.toLocaleString('es-CL')}.`,
      };
    }

    monthly.push({ profile: candidate.profile, monthlyClp: candidate.monthlyClp });
  }

  const ventas = normalizeBrackets(
    rawCaptacion.ventas,
    DEFAULT_LEAD_BRACKETS.ventas,
    'ventas',
    'UF'
  );
  if (!ventas.ok) return { ok: false, error: ventas.error };

  const arriendos = normalizeBrackets(
    rawCaptacion.arriendos,
    DEFAULT_LEAD_BRACKETS.arriendos,
    'arriendos',
    'pesos'
  );
  if (!arriendos.ok) return { ok: false, error: arriendos.error };

  // Orden canónico y valores faltantes del predeterminado: la tabla que ve el
  // panel es siempre la misma aunque la base tenga una fila vieja.
  const resolvedProfiles = PRICING_PROFILES.map(
    (profile) => profiles.find((item) => item.profile === profile) ?? defaultFor(profile)
  );

  // Una fila anterior a la 6 no tiene precios por plan: se derivan de los
  // perfiles —la escalera que el equipo ya tenía— en vez de los de partida, así
  // publicar esto no mueve ningún precio que ya estuviera cargado.
  const resolvedPlans = KYB_PLAN_IDS.map((plan) => {
    const stored = plans.find((item) => item.plan === plan);
    if (stored) return stored;

    if (legacyRow) {
      const profile = resolvedProfiles.find(
        (item) => item.profile === PLAN_PROFILE_EQUIVALENT[plan]
      );
      if (profile) {
        return {
          plan,
          altaInicialClp: profile.altaInicialClp,
          mensualBaseClp: profile.mensualBaseClp,
          usuariosIncluidos: profile.usuariosIncluidos,
        };
      }
    }

    return defaultPlanPrice(plan);
  });

  return {
    ok: true,
    config: {
      version: PLAN_PRICING_VERSION,
      ccaPct,
      profiles: resolvedProfiles,
      plans: resolvedPlans,
      captacion: {
        monthly: PRICING_PROFILES.map(
          (profile) =>
            monthly.find((item) => item.profile === profile) ?? {
              profile,
              monthlyClp:
                DEFAULT_CAPTACION_MONTHLY.find((item) => item.profile === profile)?.monthlyClp ?? 0,
            }
        ),
        ventas: ventas.brackets,
        arriendos: arriendos.brackets,
      },
    },
  };
}
