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
 * El CCA es la **suma de todas las publicaciones activas de un socio, en UF**.
 * No es un precio fijo de catálogo —depende del stock que tenga publicado cada
 * socio en cada momento— así que no se guarda con los precios: se calcula.
 * La fórmula que definió el equipo es
 *
 *   $CCA = CCA × valor de la UF ÷ 1.000.000
 *
 * El divisor forma parte de la regla y el resultado **son pesos**: un socio
 * cuyo CCA suma 100.000 y una UF de $40.000 paga
 * `100.000 × 40.000 ÷ 1.000.000 = $4.000` por concepto de CCA. La cuenta vive
 * en `ccaAmountClp` para que la pantalla y cualquier pieza futura usen la misma
 * y no dos copias que se despeguen.
 *
 * El módulo es puro (sin React, sin red, sin base): acá está lo que hay que
 * poder probar, y la pantalla solo dibuja lo que esto calcula.
 */

import { PARTNER_KIND_LABELS, type PartnerKind } from '@/lib/data/partners';

/** Clave con la que la configuración se guarda en `plan_settings`. */
export const PLAN_PRICING_KEY = 'planes';

/**
 * Versión del formato. Subió a 2 cuando el precio pasó de ser «por plan» a
 * «por perfil» (alta inicial, mensual y usuarios). Una fila guardada con otra
 * versión se descarta y vuelven los valores de partida, en vez de leerse con la
 * forma equivocada.
 */
export const PLAN_PRICING_VERSION = 2 as const;

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

export interface PlanPricingConfig {
  version: typeof PLAN_PRICING_VERSION;
  profiles: ProfilePlan[];
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

/** Precios de partida: los que definió el equipo para cada perfil. */
export const DEFAULT_PLAN_PRICING: PlanPricingConfig = {
  version: PLAN_PRICING_VERSION,
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

// ── CCA ──────────────────────────────────────────────────────────────────────

/**
 * Divisor de la fórmula del CCA, tal como la definió el equipo.
 *
 * Va como constante y no como número suelto en la pantalla para que el cálculo
 * y el texto que lo explica no puedan separarse.
 */
export const CCA_DIVISOR = 1_000_000;

/** La fórmula, en una línea, para mostrar en el panel. */
export const CCA_FORMULA = '$CCA = CCA × valor de la UF ÷ 1.000.000';

/** Qué es el CCA, en una línea. */
export const CCA_DEFINITION = 'CCA: suma total de todas las publicaciones de un socio, en UF.';

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
export function ccaAmountClp(ccaUf: number, ufValueClp: number): number {
  if (!validCca(ccaUf, ufValueClp)) return 0;
  return (ccaUf * ufValueClp) / CCA_DIVISOR;
}

/** Monto en pesos para la calculadora del panel. */
export function formatCcaAmount(amountClp: number): string {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amountClp) ? amountClp : 0);
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

  if (raw.version !== undefined && raw.version !== PLAN_PRICING_VERSION) {
    return {
      ok: false,
      error: `La configuración guardada es de otra versión (${String(raw.version)}).`,
    };
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

  return {
    ok: true,
    config: {
      version: PLAN_PRICING_VERSION,
      // Orden canónico y valores faltantes del predeterminado: la tabla que ve
      // el panel es siempre la misma aunque la base tenga una fila vieja.
      profiles: PRICING_PROFILES.map(
        (profile) => profiles.find((item) => item.profile === profile) ?? defaultFor(profile)
      ),
    },
  };
}
