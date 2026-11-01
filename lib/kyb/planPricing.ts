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
 *   $CCA = CCA × valor de la UF ÷ 1.000.000 × %CCA
 *
 * El divisor —el **factor**— y el resultado **son pesos**: un socio cuyo CCA
 * suma 100.000 y una UF de $40.000 paga
 * `100.000 × 40.000 ÷ 1.000.000 = $4.000` por concepto de CCA.
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
 * hacer la cuenta mentalmente. La cuenta vive en `ccaAmountClp` para que la
 * pantalla y cualquier pieza futura usen la misma y no dos copias que se
 * despeguen.
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
export const PLAN_PRICING_VERSION = 3 as const;

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
  /**
   * %CCA: cuánto del valor base del CCA se cobra. 100 deja el factor en
   * 1.000.000, que es la fórmula original; es el ajuste que el equipo cambia a
   * discreción desde el panel y viaja guardado con los precios.
   */
  ccaPct: number;
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

/**
 * Divisor base de la fórmula del CCA: el «factor» de referencia.
 *
 * No es un número suelto en la pantalla ni una constante intocable: es el punto
 * donde el %CCA vale 100. Con otro porcentaje el factor efectivo se mueve
 * (`ccaFactor`) y el monto cobrado, con él.
 */
export const CCA_DIVISOR = 1_000_000;

/**
 * %CCA de partida: 100 deja el factor en 1.000.000, o sea la fórmula de siempre.
 * Guardado con los precios, así el ajuste sobrevive al reinicio del proceso.
 */
export const DEFAULT_CCA_PCT = 100;

/**
 * Rango del %CCA. El piso en 1 evita dejar el concepto en cero por un campo
 * vacío que se interpretó como 0; el techo corta un 999999 de tipeo.
 */
export const MIN_CCA_PCT = 1;
export const MAX_CCA_PCT = 1000;

/** Precios de partida: los que definió el equipo para cada perfil. */
export const DEFAULT_PLAN_PRICING: PlanPricingConfig = {
  version: PLAN_PRICING_VERSION,
  ccaPct: DEFAULT_CCA_PCT,
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

/** La fórmula, en una línea, para mostrar en el panel. */
export const CCA_FORMULA = '$CCA = CCA × valor de la UF ÷ 1.000.000 × %CCA';

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

  // La fila guardada con la versión anterior (2, sin %CCA) se acepta: el campo
  // que no existía entra con el valor de partida, así un guardado viejo no deja
  // el panel en «configuración de otra versión».
  const MIGRATABLE = 2;
  if (raw.version !== undefined && raw.version !== PLAN_PRICING_VERSION && raw.version !== MIGRATABLE) {
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
      ccaPct,
      // Orden canónico y valores faltantes del predeterminado: la tabla que ve
      // el panel es siempre la misma aunque la base tenga una fila vieja.
      profiles: PRICING_PROFILES.map(
        (profile) => profiles.find((item) => item.profile === profile) ?? defaultFor(profile)
      ),
    },
  };
}
