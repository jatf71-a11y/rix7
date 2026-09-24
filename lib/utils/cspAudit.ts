/**
 * Cruce de recursos externos contra la Content Security Policy.
 *
 * Existe por un error concreto: el CSP listaba los tiles de OpenStreetMap en
 * `img-src`, pero MapLibre los pide con `fetch()` — y eso cae en `connect-src`.
 * Resultado: el mapa del home se quedó sin calles **solo en producción**,
 * porque los headers de `vercel.json` no existen en local.
 *
 * La regla que implementa este módulo es la que faltaba: no basta con que el
 * host esté en *alguna* directiva del CSP, tiene que estar en la que le
 * corresponde según **cómo** se pide el recurso. El mismo host puede pasar por
 * `img-src` y ser rechazado por `connect-src`.
 */

export type ResourceKind =
  | 'connect'
  | 'image'
  | 'media'
  | 'script'
  | 'style'
  | 'font'
  | 'worker'
  | 'frame'
  | 'manifest';

/** Directiva que decide cada tipo de recurso. */
export const DIRECTIVE_FOR_KIND: Record<ResourceKind, string> = {
  connect: 'connect-src',
  image: 'img-src',
  media: 'media-src',
  script: 'script-src',
  style: 'style-src',
  font: 'font-src',
  worker: 'worker-src',
  frame: 'frame-src',
  manifest: 'manifest-src',
};

/**
 * Cadena de respaldo real: cuando la directiva no está declarada, el CSP no
 * bloquea por defecto — baja por estas directivas hasta encontrar una.
 * `worker-src` y `frame-src` son las dos que no caen directo en `default-src`.
 */
const FALLBACK_CHAIN: Partial<Record<string, string[]>> = {
  'frame-src': ['child-src', 'default-src'],
  'worker-src': ['child-src', 'script-src', 'default-src'],
};

export interface CspPolicy {
  directives: Record<string, string[]>;
}

/** Convierte la cabecera en directivas. Ojo: un `directive` sin valores es válido. */
export function parseCsp(header: string): CspPolicy {
  const directives: Record<string, string[]> = {};
  for (const part of header.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (!name) continue;
    directives[name.toLowerCase()] = values;
  }
  return { directives };
}

export interface EffectiveDirective {
  /** La directiva que decide de verdad (puede ser `default-src` por respaldo). */
  directive: string;
  sources: string[];
}

/** Directiva que decide un tipo de recurso, siguiendo la cadena de respaldo. */
export function effectiveDirective(policy: CspPolicy, kind: ResourceKind): EffectiveDirective {
  const wanted = DIRECTIVE_FOR_KIND[kind];
  const chain = [wanted, ...(FALLBACK_CHAIN[wanted] ?? ['default-src'])];
  for (const name of chain) {
    const sources = policy.directives[name];
    if (sources && sources.length > 0) return { directive: name, sources };
  }
  // Sin `default-src` ni la directiva: nada autorizado.
  return { directive: wanted, sources: [] };
}

export interface ResourceCheck {
  allowed: boolean;
  /** Directiva que decidió, para poder decir *por qué* se bloqueó. */
  decidedBy: string;
  /** La fuente del CSP que autorizó, si autorizó. */
  matched: string | null;
}

/** ¿El CSP deja cargar `url` como un recurso de este tipo? */
export function checkResource(
  policy: CspPolicy,
  url: string,
  kind: ResourceKind,
  selfOrigin: string,
): ResourceCheck {
  const { directive, sources } = effectiveDirective(policy, kind);
  const target = safeUrl(url, selfOrigin);
  if (!target) return { allowed: false, decidedBy: directive, matched: null };
  const matched = sources.find((source) => sourceMatches(source, target, selfOrigin)) ?? null;
  return { allowed: matched !== null, decidedBy: directive, matched };
}

interface ParsedUrl {
  scheme: string;
  host: string;
  port: string;
  path: string;
  origin: string;
}

function safeUrl(url: string, selfOrigin: string): ParsedUrl | null {
  try {
    const parsed = new URL(url, selfOrigin);
    const scheme = parsed.protocol.replace(':', '').toLowerCase();
    return {
      scheme,
      host: parsed.hostname.toLowerCase(),
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      origin: `${scheme}://${parsed.host}`.toLowerCase(),
    };
  } catch {
    return null;
  }
}

/**
 * ¿Esta fuente del CSP autoriza esta URL?
 *
 * Las reglas que importan en la práctica:
 * - `'self'` exige mismo origen (esquema, host y puerto).
 * - `*` autoriza la red, no otros esquemas.
 * - `https://*.ejemplo.cl` autoriza **solo subdominios**: el dominio raíz queda
 *   fuera. No es una lectura de la especificación sino una medición hecha en
 *   Chrome contra este CSP: `*.tile.openstreetmap.org` rechaza
 *   `tile.openstreetmap.org`. Si hace falta el raíz, se lista aparte.
 */
export function sourceMatches(source: string, target: ParsedUrl, selfOrigin: string): boolean {
  const value = source.trim().toLowerCase();
  if (!value) return false;
  if (value === "'none'") return false;

  if (value === "'self'") {
    const self = safeUrl(selfOrigin, selfOrigin);
    return self !== null && self.origin === target.origin;
  }

  if (value === '*') {
    return ['http', 'https', 'ws', 'wss'].includes(target.scheme);
  }

  // Fuente de esquema: `https:`, `data:`, `blob:`.
  if (/^[a-z][a-z0-9+.-]*:$/.test(value)) {
    const scheme = value.slice(0, -1);
    // `http:` autoriza también `https:` (mejora de esquema).
    if (scheme === 'http') return target.scheme === 'http' || target.scheme === 'https';
    return scheme === target.scheme;
  }

  const match = /^(?:([a-z][a-z0-9+.-]*):\/\/)?([^/]+)(\/.*)?$/.exec(value);
  if (!match) return false;
  const [, rawScheme, rawAuthority, rawPath] = match;

  if (rawScheme) {
    if (rawScheme === 'http') {
      if (target.scheme !== 'http' && target.scheme !== 'https') return false;
    } else if (rawScheme !== target.scheme) {
      return false;
    }
  } else if (!['http', 'https'].includes(target.scheme)) {
    return false;
  }

  const [rawHost, rawPort] = splitAuthority(rawAuthority);
  if (rawPort && rawPort !== target.port) return false;

  if (rawHost !== '*') {
    const host = rawHost.startsWith('*.') ? rawHost.slice(2) : rawHost;
    const isWildcard = rawHost.startsWith('*.');
    // El comodín cubre subdominios; el dominio raíz solo si se lista sin `*.`.
    const matchesHost = isWildcard
      ? target.host !== host && target.host.endsWith(`.${host}`)
      : target.host === host;
    if (!matchesHost) return false;
  }

  if (rawPath && rawPath !== '/') return target.path.startsWith(rawPath);
  return true;
}

function splitAuthority(authority: string): [string, string] {
  const separator = authority.lastIndexOf(':');
  if (separator === -1) return [authority, ''];
  return [authority.slice(0, separator), authority.slice(separator + 1)];
}
