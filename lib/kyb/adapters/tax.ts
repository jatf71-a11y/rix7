/**
 * Verificación fiscal del RUT y del registro comercial.
 *
 * Dos implementaciones detrás de la misma interfaz:
 *
 * 1. **Simulada** (por defecto): responde de forma determinista a partir del
 *    RUT, sin red. Es la que usan el desarrollo y los tests, y la que permite
 *    probar los tres caminos (existe, está inactivo, el nombre no coincide) sin
 *    depender de un servicio externo ni de una clave.
 * 2. **SII**: se activa al definir `KYB_TAX_URL` (y opcionalmente
 *    `KYB_TAX_TOKEN`). Espera un JSON con
 *    `{ exists, active, businessName, activity, workers, revenueClp, revenueYear }`.
 *    El contrato es deliberadamente pequeño: lo que cambie entre un proveedor y
 *    otro se resuelve en el mapper, no en el motor.
 *
 * `workers` es la **dotación** (número de trabajadores) que informa el registro.
 * Con ella el motor calcula el tramo de tamaño. `revenueClp` son las ventas
 * aproximadas del último ejercicio cerrado que publica el registro: viajan al
 * panel como **referencia** del tamaño, no deciden el tramo y no se le piden a
 * la empresa. Cuando el registro no las publica el dato queda en `null` y el
 * panel dice «sin dato», que es distinto de pedirle la facturación a la empresa.
 *
 * La simulación es honesta sobre serlo (`source: 'simulated'` viaja en la
 * verificación), así que el panel puede decir de dónde salió cada dato.
 */

export interface TaxVerificationInput {
  rut: string;
  legalName: string;
}

export interface TaxVerification {
  source: 'simulated' | 'sii';
  exists: boolean;
  active: boolean;
  /** Razón social que devuelve el registro, si existe. */
  businessName: string | null;
  activity: string | null;
  /**
   * Dotación del registro: cuántas personas trabajan en la empresa.
   *
   * `null` cuando el registro no la informa (no es lo mismo que cero: cero es
   * un dato, la ausencia es un hueco que el motor convierte en pregunta).
   */
  workers: number | null;
  /**
   * Ventas anuales aproximadas del último ejercicio cerrado, en pesos.
   *
   * `null` cuando el registro no las publica. Es una referencia para leer la
   * escala de la operación: **el tramo lo decide la dotación**, no este número.
   */
  revenueClp: number | null;
  /** Ejercicio al que corresponden esas ventas; `null` si no hay dato. */
  revenueYear: number | null;
  /** ¿El nombre declarado coincide con el del registro? */
  nameMatches: boolean;
}

export interface TaxAdapter {
  verify(input: TaxVerificationInput): Promise<TaxVerification>;
  /** Para el informe: qué implementación se usó. */
  readonly source: TaxVerification['source'];
}

/** Hash estable y barato: alcanza para repartir casos en la simulación. */
function seedOf(value: string): number {
  let seed = 7;
  for (let index = 0; index < value.length; index += 1) {
    seed = (seed * 31 + value.charCodeAt(index)) % 100_003;
  }
  return seed;
}

/** Redondeo al millón: las ventas del registro se leen en millones, no en pesos. */
function roundToMillions(value: number): number {
  return Math.round(value / 1_000_000) * 1_000_000;
}

/**
 * Último ejercicio cerrado. Las ventas de un año en curso todavía no están
 * publicadas, así que la referencia es siempre la del año anterior.
 */
function lastFiscalYear(): number {
  return new Date().getUTCFullYear() - 1;
}

/** Compara nombres sin depender de mayúsculas, tildes ni sufijos societarios. */
export function normalizeCompanyName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(spa|s\.a\.|sa|ltda\.?|limitada|eirl)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function companyNamesMatch(declared: string, registry: string | null): boolean {
  if (!registry) return false;
  const a = normalizeCompanyName(declared);
  const b = normalizeCompanyName(registry);
  if (!a || !b) return false;
  if (a === b) return true;
  // Un nombre puede venir con el giro agregado o abreviado: basta con que el
  // primero esté contenido en el segundo para considerarlo el mismo negocio.
  return a.includes(b) || b.includes(a);
}

/**
 * Registro simulado.
 *
 * Reglas (deterministas, documentadas para que un test fijo no dependa de la
 * suerte): el RUT existe salvo 1 de cada 13, está activo salvo 1 de cada 9 y el
 * nombre coincide salvo 1 de cada 17. La dotación va de 1 a 180 trabajadores
 * cuando la empresa está activa, 0 cuando no lo está y `null` cuando el RUT no
 * figura: los cuatro tramos de tamaño quedan alcanzables sin claves.
 *
 * Las ventas simuladas se derivan de la dotación (entre $18M y $78M por
 * trabajador al año, redondeadas al millón) para que la referencia sea
 * coherente: un registro simulado que devolviera $3 millones para 120
 * trabajadores haría que el panel mostrara un imposible.
 */
export function simulatedTaxRecord(input: TaxVerificationInput): TaxVerification {
  const seed = seedOf(input.rut.replace(/\D/g, ''));
  const exists = seed % 13 !== 0;
  const active = exists && seed % 9 !== 0;
  const nameMatches = exists && seed % 17 !== 0;
  const workers = !exists ? null : active ? 1 + (seed % 180) : 0;
  const perWorker = 18_000_000 + (seed % 61) * 1_000_000;

  return {
    source: 'simulated',
    exists,
    active,
    businessName: exists && !nameMatches ? 'Sociedad Comercial Registrada SpA' : input.legalName,
    activity: active ? 'Servicios inmobiliarios' : null,
    workers,
    revenueClp: workers === null ? null : workers === 0 ? 0 : roundToMillions(workers * perWorker),
    revenueYear: exists ? lastFiscalYear() : null,
    nameMatches,
  };
}

export const simulatedTaxAdapter: TaxAdapter = {
  source: 'simulated',
  async verify(input) {
    return simulatedTaxRecord(input);
  },
};

interface SiiPayload {
  exists?: unknown;
  active?: unknown;
  businessName?: unknown;
  activity?: unknown;
  workers?: unknown;
  revenueClp?: unknown;
  revenueYear?: unknown;
}

/**
 * Dotación informada por el proveedor.
 *
 * Se exige un entero no negativo: un `workers: "12"` o un `-1` no se interpretan
 * a la buena, se tratan como «sin dato» y el motor pregunta. Un cero sí es un
 * dato (una empresa activa sin trabajadores es una inconsistencia que se advierte).
 */
function workersOf(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null;
  return Math.round(raw);
}

/**
 * Ventas informadas por el proveedor. Se exige un número no negativo: un
 * `revenueClp: "1.200"` no se interpreta a la buena, se trata como «sin dato».
 * Nunca se deduce del puntaje ni de la dotación: si el registro no las publica,
 * el panel lo dice.
 */
function revenueOf(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null;
  return Math.round(raw);
}

/** Ejercicio de las ventas: un año razonable o nada. */
function revenueYearOf(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return null;
  if (raw < 2000 || raw > 2100) return null;
  return raw;
}

function mapper(raw: unknown, input: TaxVerificationInput): TaxVerification {
  const payload = (raw && typeof raw === 'object' ? raw : {}) as SiiPayload;
  const exists = payload.exists === true;
  const active = exists && payload.active === true;
  const businessName = typeof payload.businessName === 'string' ? payload.businessName : null;

  return {
    source: 'sii',
    exists,
    active,
    businessName,
    activity: typeof payload.activity === 'string' ? payload.activity : null,
    workers: exists ? workersOf(payload.workers) : null,
    revenueClp: exists ? revenueOf(payload.revenueClp) : null,
    revenueYear: exists ? revenueYearOf(payload.revenueYear) : null,
    nameMatches: companyNamesMatch(input.legalName, businessName),
  };
}

/**
 * Adaptador HTTP. Un proveedor caído **no** se convierte en «RUT inválido»:
 * lanza, y el motor lo reporta como verificación no concluyente para que la
 * empresa reciba una pregunta en vez de un rechazo silencioso.
 */
export function createSiiTaxAdapter({
  url,
  token,
  fetchImpl = fetch,
  timeoutMs = 6000,
}: {
  url: string;
  token?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): TaxAdapter {
  return {
    source: 'sii',
    async verify(input) {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ rut: input.rut, legalName: input.legalName }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        throw new Error(`La verificación fiscal respondió ${response.status}.`);
      }

      return mapper(await response.json(), input);
    },
  };
}

/** El adaptador que usa el motor: SII si está configurado, simulado si no. */
export function defaultTaxAdapter(): TaxAdapter {
  const url = process.env.KYB_TAX_URL;
  if (!url) return simulatedTaxAdapter;
  return createSiiTaxAdapter({ url, token: process.env.KYB_TAX_TOKEN });
}
