/**
 * Reputación pública de la empresa: señales de fraude y reseñas negativas.
 *
 * Igual que la verificación fiscal, hay dos implementaciones:
 *
 * 1. **Simulada** (por defecto): determinista a partir del dominio y el RUT, sin
 *    red. Los dominios con `fraude` u `quejas` en el nombre fuerzan el caso
 *    respectivo, para poder demostrar el flujo sin claves.
 * 2. **Búsqueda real**: se activa con `KYB_SEARCH_URL` y `KYB_SEARCH_API_KEY`.
 *    Espera `{ flags: string[], negativeReviews: number, mentions: [{title,url}] }`.
 *
 * El motor no navega ni interpreta texto libre: consume estas señales. Cambiar
 * de proveedor de búsqueda no toca el motor.
 */

export interface ReputationInput {
  legalName: string;
  rut: string;
  domain: string | null;
}

export interface ReputationMention {
  title: string;
  url: string;
}

export interface ReputationSignals {
  source: 'simulated' | 'search';
  /** Motivos concretos («denuncia por fraude», «suplantación»). */
  fraudFlags: string[];
  negativeReviews: number;
  mentions: ReputationMention[];
}

export interface ReputationAdapter {
  check(input: ReputationInput): Promise<ReputationSignals>;
  readonly source: ReputationSignals['source'];
}

function seedOf(value: string): number {
  let seed = 11;
  for (let index = 0; index < value.length; index += 1) {
    seed = (seed * 37 + value.charCodeAt(index)) % 100_003;
  }
  return seed;
}

/**
 * Señales simuladas.
 *
 * `fraude`/`quejas` en el dominio son atajos explícitos para la demostración;
 * el resto sale del hash (1 de cada 19 con fraude, y entre 0 y 6 reseñas
 * negativas, de las cuales 3 o más son una advertencia).
 */
export function simulatedReputation(input: ReputationInput): ReputationSignals {
  const domain = (input.domain ?? '').toLowerCase();
  const seed = seedOf(`${domain}|${input.rut.replace(/\D/g, '')}`);

  const flagged = domain.includes('fraude') || seed % 19 === 0;
  const negativeReviews = domain.includes('quejas') ? 5 : seed % 7;

  return {
    source: 'simulated',
    fraudFlags: flagged
      ? [
          domain.includes('fraude')
            ? 'El dominio aparece en un listado de fraude.'
            : 'Hay una mención pública que reporta impagos.',
        ]
      : [],
    negativeReviews,
    mentions: [],
  };
}

export const simulatedReputationAdapter: ReputationAdapter = {
  source: 'simulated',
  async check(input) {
    return simulatedReputation(input);
  },
};

interface SearchPayload {
  flags?: unknown;
  negativeReviews?: unknown;
  mentions?: unknown;
}

function mapper(raw: unknown): ReputationSignals {
  const payload = (raw && typeof raw === 'object' ? raw : {}) as SearchPayload;

  const flags = Array.isArray(payload.flags)
    ? payload.flags.filter((flag): flag is string => typeof flag === 'string').slice(0, 10)
    : [];

  const negativeReviews =
    typeof payload.negativeReviews === 'number' && Number.isFinite(payload.negativeReviews)
      ? Math.max(0, Math.round(payload.negativeReviews))
      : 0;

  const mentions = Array.isArray(payload.mentions)
    ? payload.mentions
        .map((mention) => {
          if (!mention || typeof mention !== 'object') return null;
          const { title, url } = mention as { title?: unknown; url?: unknown };
          if (typeof title !== 'string' || typeof url !== 'string') return null;
          return { title, url };
        })
        .filter((mention): mention is ReputationMention => mention !== null)
        .slice(0, 5)
    : [];

  return { source: 'search', fraudFlags: flags, negativeReviews, mentions };
}

export function createSearchReputationAdapter({
  url,
  apiKey,
  fetchImpl = fetch,
  timeoutMs = 6000,
}: {
  url: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): ReputationAdapter {
  return {
    source: 'search',
    async check(input) {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query: [input.legalName, input.rut, input.domain, 'fraude', 'reseñas']
            .filter(Boolean)
            .join(' '),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        throw new Error(`La búsqueda de reputación respondió ${response.status}.`);
      }

      return mapper(await response.json());
    },
  };
}

/** El adaptador que usa el motor: búsqueda real si hay clave, simulada si no. */
export function defaultReputationAdapter(): ReputationAdapter {
  const url = process.env.KYB_SEARCH_URL;
  const apiKey = process.env.KYB_SEARCH_API_KEY;
  if (!url || !apiKey) return simulatedReputationAdapter;
  return createSearchReputationAdapter({ url, apiKey });
}
