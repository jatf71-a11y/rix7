/**
 * Reputación pública de la empresa: señales de fraude y reseñas negativas.
 *
 * Hay tres implementaciones y el entorno elige una:
 *
 * 1. **Búsqueda real con Exa** (`EXA_API_KEY`): consulta la API de búsqueda con
 *    varias consultas dirigidas —razón social, RUT, sitio propio, términos de
 *    fraude y términos de reclamo—, deduplica por URL y clasifica cada página
 *    por lo que dice. Es el único modo que trae **páginas reales** detrás del
 *    conteo: cada hallazgo queda con su URL y con el fragmento que lo sustenta.
 * 2. **Endpoint propio** (`KYB_SEARCH_URL` + `KYB_SEARCH_API_KEY`): un proxy
 *    intermedio que ya devuelve las señales masticadas. Sirve para conectar
 *    otro proveedor sin tocar el motor.
 * 3. **Simulada** (sin nada configurado): determinista a partir del dominio y
 *    el RUT, sin red. Los dominios con `fraude` u `quejas` en el nombre fuerzan
 *    el caso respectivo, para poder demostrar el flujo sin claves.
 *
 * Sobre el conteo real, que es donde es fácil exagerar: `negativeReviews`
 * cuenta **páginas que nombran a la empresa y traen un término de reclamo**, no
 * reseñas verificadas de una plataforma de opiniones. Por eso el número nunca
 * viaja solo: cada motivo lleva el fragmento de la página que lo sustenta
 * (`negativeTopics`) y la lista de páginas las URLs (`mentions`). Un término de
 * fraude, además, exige que la página nombre a la empresa por su razón social,
 * su dominio o su RUT: «estafa» o «denuncia» sueltos aparecen en cualquier
 * crónica policial y no dicen nada de esta empresa.
 *
 * Las dos consultas que **deciden** (fraude y reclamos) tienen que responder; si
 * una falla, la verificación no concluye y el motor lo reporta. Las tres de
 * contexto (razón social, RUT y sitio propio) solo aportan páginas a la ficha,
 * así que si una se cae la verificación sigue con las demás en vez de pedirle a
 * la empresa sus perfiles oficiales por un tropiezo de red.
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
  /** Motivo de cada reseña negativa, en una frase («cobros no informados»). */
  negativeTopics: string[];
  mentions: ReputationMention[];
}

export interface ReputationAdapter {
  check(input: ReputationInput): Promise<ReputationSignals>;
  readonly source: ReputationSignals['source'];
}

// ═════════════════════════════════════════════════════════════════════════════
// Simulación (sin claves)
// ═════════════════════════════════════════════════════════════════════════════

function seedOf(value: string): number {
  let seed = 11;
  for (let index = 0; index < value.length; index += 1) {
    seed = (seed * 37 + value.charCodeAt(index)) % 100_003;
  }
  return seed;
}

/**
 * Motivos que puede reportar la simulación: los reclamos típicos de una
 * corredora. Son texto de demostración, y viajan con `source: 'simulated'` para
 * que la ficha no los lea como un hallazgo real.
 */
const SIMULATED_TOPICS = [
  'demoras en la entrega de la propiedad',
  'cobros no informados en la comisión',
  'falta de respuesta después de la visita',
  'fotos que no coinciden con la propiedad',
  'problemas con la devolución de la reserva',
  'dificultad para dar con un ejecutivo por teléfono',
];

/**
 * Señales simuladas.
 *
 * `fraude`/`quejas` en el dominio son atajos explícitos para la demostración;
 * el resto sale del hash (1 de cada 19 con fraude, y entre 0 y 6 reseñas
 * negativas, de las cuales 3 o más son una advertencia). Los motivos se toman
 * del repertorio girando desde el mismo hash, para que la misma empresa reciba
 * siempre los mismos: un panel que cambia de motivo en cada corrida no sirve
 * para decidir.
 */
export function simulatedReputation(input: ReputationInput): ReputationSignals {
  const domain = (input.domain ?? '').toLowerCase();
  const seed = seedOf(`${domain}|${input.rut.replace(/\D/g, '')}`);

  const flagged = domain.includes('fraude') || seed % 19 === 0;
  const negativeReviews = domain.includes('quejas') ? 5 : seed % 7;
  const negativeTopics = Array.from(
    { length: Math.min(negativeReviews, SIMULATED_TOPICS.length) },
    (_, index) => SIMULATED_TOPICS[(seed + index) % SIMULATED_TOPICS.length]
  );

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
    negativeTopics,
    mentions: [],
  };
}

export const simulatedReputationAdapter: ReputationAdapter = {
  source: 'simulated',
  async check(input) {
    return simulatedReputation(input);
  },
};

// ═════════════════════════════════════════════════════════════════════════════
// Endpoint propio (KYB_SEARCH_URL)
// ═════════════════════════════════════════════════════════════════════════════

interface SearchPayload {
  flags?: unknown;
  negativeReviews?: unknown;
  mentions?: unknown;
  topics?: unknown;
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

  const negativeTopics = Array.isArray(payload.topics)
    ? payload.topics
        .filter((topic): topic is string => typeof topic === 'string')
        .map((topic) => topic.trim())
        .filter(Boolean)
        .slice(0, 5)
    : [];

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

  return { source: 'search', fraudFlags: flags, negativeReviews, negativeTopics, mentions };
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

// ═════════════════════════════════════════════════════════════════════════════
// Búsqueda real (Exa)
// ═════════════════════════════════════════════════════════════════════════════

/** Endpoint de búsqueda de Exa. `createExaReputationAdapter` acepta otro para probar. */
const EXA_SEARCH_URL = 'https://api.exa.ai/search';

/** Páginas por consulta. Cinco por cinco consultas es una corrida por alta. */
const EXA_RESULTS_PER_QUERY = 5;

/**
 * Términos que convierten una página en señal, ya normalizados —sin acentos y en
 * minúsculas— porque el texto se normaliza antes de comparar.
 *
 * La lista es corta a propósito. `denuncia` y `demanda` quedan afuera: la
 * empresa también denuncia, y una crónica donde ella es la denunciante no es un
 * hallazgo sobre ella. Lo que sí entra son términos que no se usan para otra
 * cosa que para hablar mal de alguien.
 */
const FRAUD_TERMS = [
  'estafa',
  'estafador',
  'fraude',
  'fraudulent',
  'suplantacion',
  'phishing',
  'impago',
  'impagos',
  'no paga',
  'no pagaron',
];

/** Términos de reclamo: advertencia, no fallo. */
const COMPLAINT_TERMS = [
  'reclamo',
  'reclamos',
  'queja',
  'quejas',
  'resena negativa',
  'resenas negativas',
  'opinion negativa',
  'opiniones negativas',
  'malas resenas',
  'mala experiencia',
  'incumplimiento',
  'no cumplio',
  'demoras',
  'problemas con',
  'devolucion de la reserva',
  'cobros',
];

const MAX_FLAGS = 3;
const MAX_TOPICS = 5;
const MAX_MENTIONS = 5;
const TITLE_MAX_CHARS = 70;
const QUOTE_MAX_CHARS = 110;

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncate(value: string, max: number): string {
  const clean = collapse(value);
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/**
 * Cómo se nombra a la empresa en la web.
 *
 * La razón social completa no alcanza —las páginas escriben «Comercial Los
 * Aromos» sin el «SpA»— y el nombre suelto tampoco —«Comercial» aparece en
 * cualquier parte—, así que se prueban las formas con las que de verdad
 * aparece: el nombre completo, el nombre sin el sufijo societario, el dominio y
 * el RUT (con puntos o solo dígitos). Cada token tiene que tener largo
 * suficiente para no coincidir por casualidad.
 */
function companyTokens(input: ReputationInput): string[] {
  const name = normalizeText(input.legalName);
  const withoutSuffix = name.replace(
    /\b(spa|s\.a\.|sa|ltda|limitada|eirl|sociedad por acciones)\b/g,
    ' '
  );

  const host = (input.domain ?? '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');

  const tokens = [name, withoutSuffix];
  if (host) tokens.push(host, host.split('.')[0]);
  tokens.push(input.rut.toLowerCase());
  tokens.push(input.rut.replace(/\D/g, ''));

  return Array.from(new Set(tokens.map(collapse).filter((token) => token.length >= 4)));
}

interface ExaHit {
  url: string;
  title: string;
  /** Fragmentos que devolvió el proveedor, o su texto si lo trajo. */
  text: string;
}

function mentionsCompany(hit: ExaHit, tokens: string[]): boolean {
  const haystack = normalizeText(`${hit.title} ${hit.text} ${hit.url}`);
  return tokens.some((token) => haystack.includes(token));
}

function signalOf(hit: ExaHit): { kind: 'fraud' | 'complaint'; term: string } | null {
  const haystack = normalizeText(`${hit.title} ${hit.text}`);

  const fraud = FRAUD_TERMS.find((term) => haystack.includes(term));
  if (fraud) return { kind: 'fraud', term: fraud };

  const complaint = COMPLAINT_TERMS.find((term) => haystack.includes(term));
  if (complaint) return { kind: 'complaint', term: complaint };

  return null;
}

interface ExaQuery {
  query: string;
  includeDomains?: string[];
  /** `true` en las consultas cuyo resultado decide la verificación. */
  decides: boolean;
}

/**
 * Las consultas que se mandan, en orden.
 *
 * Las dos últimas son las que deciden y van separadas de las de contexto: una
 * consulta con «estafa» y otra con «reclamos» traen las páginas que importan, y
 * las tres primeras traen las páginas donde la empresa existe (que es lo que la
 * ficha muestra como menciones). El filtro por dominio va por `includeDomains`
 * y no con `site:` en el texto: la API lo documenta así y no ensucia la
 * consulta.
 */
function exaQueries(input: ReputationInput): ExaQuery[] {
  const name = input.legalName;

  const queries: ExaQuery[] = [
    { query: `"${name}"`, decides: false },
    { query: `"${input.rut}"`, decides: false },
  ];

  const host = (input.domain ?? '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (host) queries.push({ query: `"${name}"`, includeDomains: [host], decides: false });

  queries.push({ query: `"${name}" estafa fraude suplantación impagos`, decides: true });
  queries.push({ query: `"${name}" reclamos quejas reseñas de clientes`, decides: true });

  return queries;
}

/**
 * Mensajes de los estados que sí se pueden explicar.
 *
 * El cuerpo del error no se copia al mensaje: termina en la ficha del panel, y
 * lo que el equipo necesita saber es si la clave está mal, si se acabaron los
 * créditos o si el proveedor cortó por volumen.
 */
const EXA_STATUS_REASONS: Record<number, string> = {
  401: 'la clave de búsqueda no fue aceptada',
  402: 'la cuenta de búsqueda se quedó sin créditos',
  403: 'la clave de búsqueda no tiene permiso para buscar',
  429: 'el proveedor de búsqueda cortó por demasiadas consultas',
};

function parseExaResults(raw: unknown): ExaHit[] {
  const results = (raw as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];

  return results
    .map((entry): ExaHit | null => {
      if (!entry || typeof entry !== 'object') return null;
      const { url, title, highlights, text } = entry as {
        url?: unknown;
        title?: unknown;
        highlights?: unknown;
        text?: unknown;
      };
      if (typeof url !== 'string' || url.length === 0) return null;

      const fragments = Array.isArray(highlights)
        ? highlights.filter((fragment): fragment is string => typeof fragment === 'string')
        : [];
      const body = fragments.length
        ? fragments.join(' … ')
        : typeof text === 'string'
          ? text
          : '';

      return {
        url,
        title: typeof title === 'string' ? collapse(title) : '',
        text: collapse(body).slice(0, 1200),
      };
    })
    .filter((hit): hit is ExaHit => hit !== null);
}

/**
 * Adaptador de búsqueda real.
 *
 * Pide en paralelo, deduplica por URL —la misma página aparece en varias
 * consultas— y clasifica. Falla cerrado en lo que decide: si una consulta de
 * fraude o de reclamos no responde, lanza y el motor reporta la verificación
 * como no concluyente, en vez de afirmar «sin señales» habiendo buscado la
 * mitad.
 */
export function createExaReputationAdapter({
  apiKey,
  url = EXA_SEARCH_URL,
  fetchImpl = fetch,
  timeoutMs = 8000,
  numResults = EXA_RESULTS_PER_QUERY,
}: {
  apiKey: string;
  url?: string;
  fetchImpl?: typeof fetch;
  /** Más alto que el del registro fiscal: son cinco consultas en paralelo. */
  timeoutMs?: number;
  numResults?: number;
}): ReputationAdapter {
  async function search(query: ExaQuery): Promise<ExaHit[]> {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({
          query: query.query,
          type: 'auto',
          numResults,
          contents: { highlights: true },
          ...(query.includeDomains ? { includeDomains: query.includeDomains } : {}),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const name = (error as { name?: unknown } | null)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new Error(`La búsqueda web no respondió en ${timeoutMs} ms.`);
      }
      throw error;
    }

    if (!response.ok) {
      const reason = EXA_STATUS_REASONS[response.status] ?? `el proveedor respondió ${response.status}`;
      throw new Error(`La búsqueda web no se pudo completar: ${reason}.`);
    }

    return parseExaResults(await response.json());
  }

  return {
    source: 'search',
    async check(input) {
      const queries = exaQueries(input);
      const deciding = queries.filter((query) => query.decides);
      const context = queries.filter((query) => !query.decides);

      const decided = (await Promise.all(deciding.map(search))).flat();
      // Las de contexto no pueden hacer fracasar la verificación: si una se cae,
      // se pierden páginas para mostrar, no una señal para decidir.
      const contextResults = await Promise.allSettled(context.map(search));
      const extra = contextResults
        .filter(
          (result): result is PromiseFulfilledResult<ExaHit[]> => result.status === 'fulfilled'
        )
        .flatMap((result) => result.value);

      // Se recorren en el orden de las consultas y se queda la primera aparición
      // de cada URL: así lo que decide queda delante de lo que solo ilustra.
      const byUrl = new Map<string, ExaHit>();
      for (const hit of [...decided, ...extra]) {
        if (!byUrl.has(hit.url)) byUrl.set(hit.url, hit);
      }

      const tokens = companyTokens(input);
      const hits = Array.from(byUrl.values()).filter((hit) => mentionsCompany(hit, tokens));

      const classified = hits.map((hit) => ({ hit, signal: signalOf(hit) }));
      const fraud = classified.filter((entry) => entry.signal?.kind === 'fraud');
      const complaints = classified.filter((entry) => entry.signal?.kind === 'complaint');
      const plain = classified.filter((entry) => entry.signal === null);

      const label = (hit: ExaHit) => truncate(hit.title || hostOf(hit.url) || hit.url, TITLE_MAX_CHARS);

      return {
        source: 'search',
        fraudFlags: fraud
          .slice(0, MAX_FLAGS)
          .map(({ hit, signal }) => `«${signal?.term}» en “${label(hit)}”`),
        negativeReviews: complaints.length,
        // El motivo real: el término que la clasificó y las palabras de la
        // página. Sin esto el conteo sería una acusación sin prueba.
        negativeTopics: complaints.slice(0, MAX_TOPICS).map(({ hit, signal }) => {
          const quote = hit.text ? truncate(hit.text, QUOTE_MAX_CHARS) : label(hit);
          return `«${signal?.term}»: “${quote}”`;
        }),
        mentions: [...fraud, ...complaints, ...plain].slice(0, MAX_MENTIONS).map(({ hit }) => ({
          title: label(hit),
          url: hit.url,
        })),
      };
    },
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Selección
// ═════════════════════════════════════════════════════════════════════════════

/**
 * El adaptador que usa el motor.
 *
 * Un endpoint propio manda sobre la clave de Exa: quien lo configura lo hizo a
 * propósito para conectar otro proveedor. Sin ninguno de los dos, simulación.
 */
export function defaultReputationAdapter(): ReputationAdapter {
  const url = process.env.KYB_SEARCH_URL;
  const apiKey = process.env.KYB_SEARCH_API_KEY;
  if (url && apiKey) return createSearchReputationAdapter({ url, apiKey });

  const exaKey = process.env.EXA_API_KEY;
  if (exaKey) return createExaReputationAdapter({ apiKey: exaKey });

  return simulatedReputationAdapter;
}
