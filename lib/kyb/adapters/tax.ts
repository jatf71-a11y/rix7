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
 *    `{ exists, active, businessName, activity }`. El contrato es deliberadamente
 *    pequeño: lo que cambie entre un proveedor y otro se resuelve en el mapper,
 *    no en el motor.
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
 * nombre coincide salvo 1 de cada 17.
 */
export function simulatedTaxRecord(input: TaxVerificationInput): TaxVerification {
  const seed = seedOf(input.rut.replace(/\D/g, ''));
  const exists = seed % 13 !== 0;
  const active = exists && seed % 9 !== 0;
  const nameMatches = exists && seed % 17 !== 0;

  return {
    source: 'simulated',
    exists,
    active,
    businessName: exists && !nameMatches ? 'Sociedad Comercial Registrada SpA' : input.legalName,
    activity: active ? 'Servicios inmobiliarios' : null,
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
