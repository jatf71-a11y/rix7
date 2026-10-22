/**
 * ROL de una propiedad, buscado en el SII a partir de su dirección.
 *
 * Es la contraparte de `siiContribuciones`: aquel pide el monto con un ROL que
 * ya se conoce, este encuentra el ROL cuando la ficha todavía no lo tiene. Sin
 * esto, cargar las contribuciones obliga a salir al mapa del SII, escribir la
 * dirección, copiar un rol y volver al formulario.
 *
 * De dónde sale: la aplicación pública de **Mapas del SII** (`mapasui`) tiene
 * la misma búsqueda que una persona usa a mano —comuna, calle y número— y la
 * sirve por JSON sin sesión ni captcha. No es una API documentada, así que el
 * módulo está escrito para fallar con un mensaje legible y para que el ROL
 * siempre se pueda seguir escribiendo a mano.
 *
 * Dos cuidados que no son obvios:
 *
 * - **El SII no exige que la calle coincida.** Su búsqueda arrastra predios
 *   que solo comparten el número (`CALLE QUE NO EXISTE 123` devuelve casas de
 *   otras calles). Por eso cada fila se contrasta acá con la calle buscada y se
 *   descarta lo que no la menciona: mostrarle a la corredora una lista con
 *   calles ajenas sería peor que no mostrar nada.
 * - **Un edificio puede tener cientos de roles** (un estacionamiento por rol).
 *   La respuesta completa se recorta a `MAX_CANDIDATES` y se informa el total,
 *   para que el panel pueda pedir el departamento en vez de fingir que la lista
 *   está completa.
 *
 * Este módulo es de servidor: lo usan la ruta `/api/rol` y sus tests.
 */

import { dataArray, postSiiService } from './siiService';
import { siiKey } from './siiContribuciones';

/** Base de la aplicación de Mapas del SII. */
const MAPAS_BASE = 'https://www4.sii.cl/mapasui';

const NS_COMUNAS =
  'cl.sii.sdi.lob.bbrr.mapas.data.api.interfaces.MapasFacadeService/listComunas';
const NS_PREDIOS =
  'cl.sii.sdi.lob.bbrr.mapas.data.api.interfaces.MapasFacadeService/getPrediosDireccion';

/** Cuánto se reutiliza el catálogo de comunas de Mapas (cambia poco). */
const CATALOG_TTL_MS = 12 * 60 * 60 * 1000;

/** Tope de filas que se devuelven al panel; el resto solo se cuenta. */
const MAX_CANDIDATES = 12;

export type FetchLike = typeof fetch;

/** Una fila de la búsqueda: el ROL y la dirección tal como la escribe el SII. */
export interface RolCandidate {
  rol: string;
  address: string;
  comuna: string;
  /** Destino del predio (`HABITACIONAL`, `ESTACIONAMIENTO`…), si lo informa. */
  destino: string | null;
}

export type RolLookup =
  | {
      ok: true;
      candidates: RolCandidate[];
      /** Predios que coinciden con la dirección, no solo los devueltos. */
      total: number;
    }
  | {
      ok: false;
      error: string;
      /** `invalid`: falta o sobra un dato; `not_found`: el SII no tiene ese predio. */
      reason: 'invalid' | 'not_found' | 'upstream';
    };

export interface ParsedAddress {
  /** Calle sin número ni unidad (`Av. Providencia`). */
  street: string;
  /** Numeración de la calle, sin ceros a la izquierda. */
  number: string;
  /** Unidad dentro del predio, con el código de «detalle» que usa el SII. */
  unit: { code: number; number: string } | null;
}

/**
 * Códigos de «detalle» del SII. `null` son palabras que solo hay que sacar del
 * texto para no confundirlas con la numeración de la calle (`piso`), pero que
 * no son un detalle del predio.
 */
const UNIT_PATTERNS: Array<{ code: number | null; pattern: RegExp }> = [
  {
    code: 2,
    pattern: /\b(?:departamento|depto|dpto|dp)\b\.?\s*(?:n[°º]\s*)?([0-9]{1,6}[a-z]?)/i,
  },
  { code: 3, pattern: /\b(?:oficina|of)\b\.?\s*(?:n[°º]\s*)?([0-9]{1,6}[a-z]?)/i },
  { code: 9, pattern: /\b(?:local|lc)\b\.?\s*(?:n[°º]\s*)?([0-9]{1,6}[a-z]?)/i },
  { code: 4, pattern: /\b(?:box|bx)\b\.?\s*(?:n[°º]\s*)?([0-9]{1,6}[a-z]?)/i },
  { code: 5, pattern: /\b(?:bodega|bd)\b\.?\s*(?:n[°º]\s*)?([0-9]{1,6}[a-z]?)/i },
  { code: 1, pattern: /\bcasa\b\.?\s*(?:n[°º]\s*)?([0-9]{1,6}[a-z]?)/i },
  { code: null, pattern: /\bpiso\b\.?\s*(?:n[°º]\s*)?([0-9]{1,6}[a-z]?)/i },
];

/**
 * Separa una dirección escrita a mano en calle, número y unidad.
 *
 * La numeración es el **último** número del texto, no el primero: «11 de
 * Septiembre 2231» tiene dos y solo el segundo es la altura de la calle. Si no
 * hay número, se devuelve `null`: el SII no busca por calle sola.
 */
export function parseAddress(input: string): ParsedAddress | null {
  const raw = String(input ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return null;

  let rest = raw;
  let unit: ParsedAddress['unit'] = null;
  for (const { code, pattern } of UNIT_PATTERNS) {
    const match = rest.match(pattern);
    if (!match) continue;
    const start = match.index ?? 0;
    rest = `${rest.slice(0, start)} ${rest.slice(start + match[0].length)}`;
    if (code !== null) unit = { code, number: match[1].toUpperCase() };
    break;
  }

  // `\b` y no lookbehind: el proyecto compila a es5 y el lookbehind no aporta
  // nada que un límite de palabra no resuelva acá.
  const numbers = Array.from(rest.matchAll(/\b\d{1,5}\b/g));
  if (numbers.length === 0) return null;

  const last = numbers[numbers.length - 1];
  const number = last[0].replace(/^0+/, '');
  if (!number) return null;

  const street = rest
    .slice(0, last.index ?? 0)
    .replace(/[\s,.;:#-]+$/, '')
    .trim();
  // Al menos tres letras: «- 1234» o «# 1234» no son una calle.
  const letters = street.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g)?.length ?? 0;
  if (letters < 3) return null;

  return { street, number, unit };
}

/**
 * Palabras que no distinguen una calle de otra. Se excluyen del contraste para
 * que «Av. Providencia» y «Providencia» busquen lo mismo.
 */
const STREET_STOPWORDS = new Set([
  'CALLE',
  'AV',
  'AVENIDA',
  'PJE',
  'PSJE',
  'PASAJE',
  'PASEO',
  'CAMINO',
  'RUTA',
  'KM',
  'DE',
  'DEL',
  'LA',
  'LAS',
  'LOS',
  'EL',
  'Y',
]);

/** Palabras significativas de una calle, sin tildes ni signos, sin repetir. */
export function streetTokens(street: string): string[] {
  const tokens = String(street ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((token) => token.length >= 3 && !STREET_STOPWORDS.has(token));
  return Array.from(new Set(tokens));
}

export interface MapasComuna {
  codigo: string;
  nombre: string;
}

/**
 * Nombres de comuna que la ficha escribe distinto que el SII. Son las únicas
 * diferencias entre el catálogo de la app y el de Mapas; sin esto, esas comunas
 * no se podrían buscar nunca.
 */
const COMUNA_ALIASES: Record<string, string> = {
  PAIGUANO: 'PAIHUANO',
  LLAILLAY: 'LLAYLLAY',
  MOSTAZAL: 'SANFRANCISCOMOSTAZAL',
  TREGUACO: 'TREHUACO',
};

let comunaCache: { at: number; rows: MapasComuna[] } | null = null;

/** Vacía la caché del catálogo. Solo para los tests. */
export function resetSiiRolCache(): void {
  comunaCache = null;
}

/**
 * Código de comuna que usa Mapas. Los códigos de este servicio **no** son los
 * mismos que los de la aplicación de cuotas, así que no se reutiliza aquel
 * catálogo: cada servicio se resuelve con el suyo.
 */
async function resolveComunaCode(
  fetchImpl: FetchLike,
  comuna: string
): Promise<{ ok: true; codigo: string } | { ok: false; error: string; reason: 'invalid' | 'upstream' }> {
  const cacheValid = comunaCache && Date.now() - comunaCache.at < CATALOG_TTL_MS;

  if (!cacheValid) {
    const payload = await postSiiService(
      fetchImpl,
      `${MAPAS_BASE}/services/data/mapasFacadeService/listComunas`,
      NS_COMUNAS,
      null
    );
    const rows = dataArray(payload);
    if (!rows) {
      return {
        ok: false,
        reason: 'upstream',
        error: 'No se pudo consultar el SII. Intenta de nuevo en unos minutos.',
      };
    }

    const comunas = rows
      .filter((item): item is MapasComuna => {
        const row = item as Partial<MapasComuna>;
        return typeof row.codigo === 'string' && typeof row.nombre === 'string';
      })
      .map((row) => ({ codigo: row.codigo, nombre: row.nombre }));

    comunaCache = { at: Date.now(), rows: comunas };
  }

  // Constante local: TypeScript no estrecha un mutable de módulo tras el `if`.
  const catalog = comunaCache;
  if (!catalog) {
    return {
      ok: false,
      reason: 'upstream',
      error: 'No se pudo consultar el SII. Intenta de nuevo en unos minutos.',
    };
  }

  const key = siiKey(comuna);
  const target = COMUNA_ALIASES[key] ?? key;
  const match = catalog.rows.find((row) => siiKey(row.nombre) === target);

  if (!match) {
    return {
      ok: false,
      reason: 'invalid',
      error: `El SII no reconoce la comuna «${comuna}». Revísala en la ficha antes de buscar.`,
    };
  }

  return { ok: true, codigo: match.codigo };
}

interface MapasPredio {
  rol?: unknown;
  direccion?: unknown;
  nombreComuna?: unknown;
  destinoDescripcion?: unknown;
}

/**
 * Cuántas palabras de la calle buscada aparecen en la dirección del SII, y `0`
 * si la fila no sirve.
 *
 * La fila tiene que traer el número como token propio: el SII busca por
 * coincidencia de texto y devuelve «… OF 100» cuando se pidió la altura 100.
 */
export function addressScore(rowAddress: string, tokens: string[], number: string): number {
  if (!rowAddress) return 0;
  if (!new RegExp(`(^|\\D)${number}(\\D|$)`).test(rowAddress)) return 0;
  if (tokens.length === 0) return 1;
  const key = siiKey(rowAddress);
  return tokens.filter((token) => key.includes(token)).length;
}

function cleanAddress(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Predios que el SII asocia a la dirección. `null` es que no se pudo consultar;
 * un arreglo vacío es que el SII no tiene nada con esos datos.
 */
async function queryPredios(
  fetchImpl: FetchLike,
  codigoComuna: string,
  comuna: string,
  parsed: ParsedAddress,
  withUnit: boolean
): Promise<unknown[] | null> {
  const payload = await postSiiService(
    fetchImpl,
    `${MAPAS_BASE}/services/data/mapasFacadeService/getPrediosDireccion`,
    NS_PREDIOS,
    {
      rolDireccion: {
        comuna: codigoComuna,
        nombreComuna: comuna.toUpperCase(),
        calle: parsed.street,
        numeroCalleStr: parsed.number,
        detalle: withUnit ? parsed.unit?.code ?? 0 : 0,
        numeroDetalleStr: withUnit ? parsed.unit?.number ?? null : null,
        lugar: null,
      },
      servicios: [],
      tokenARSII: null,
    }
  );

  if (!payload) return null;
  return dataArray(payload);
}

/**
 * Busca los roles de una dirección en el SII.
 *
 * `address` es la dirección de la ficha (texto libre) y `comuna` su `city`. La
 * respuesta trae solo ROL, dirección, comuna y destino: nada del propietario.
 */
export async function lookupRolSII(
  input: { address: string; comuna: string },
  fetchImpl: FetchLike = fetch
): Promise<RolLookup> {
  const parsed = parseAddress(input.address);
  if (!parsed) {
    return {
      ok: false,
      reason: 'invalid',
      error:
        'Escribe la dirección con su número (ej: Av. Providencia 1234, depto 901) para buscar el ROL.',
    };
  }

  const comuna = String(input.comuna ?? '').trim();
  if (comuna.length < 2) {
    return {
      ok: false,
      reason: 'invalid',
      error: 'Falta la comuna: es lo que permite ubicar la dirección en el SII.',
    };
  }

  const resolved = await resolveComunaCode(fetchImpl, comuna);
  if (!resolved.ok) return resolved;

  const upstreamError: RolLookup = {
    ok: false,
    reason: 'upstream',
    error: 'No se pudo consultar el SII. Intenta de nuevo en unos minutos.',
  };

  // Primero con la unidad (depto/oficina) y, si el SII no la tiene anotada
  // con esa notación, de nuevo sin ella: es mejor mostrar los roles del
  // edificio que decir que la dirección no existe por un «901» de más.
  let rows = await queryPredios(fetchImpl, resolved.codigo, comuna, parsed, true);
  if (rows === null) return upstreamError;
  if (rows.length === 0 && parsed.unit) {
    rows = await queryPredios(fetchImpl, resolved.codigo, comuna, parsed, false);
    if (rows === null) return upstreamError;
  }

  const tokens = streetTokens(parsed.street);
  const seen = new Set<string>();
  const matched: Array<RolCandidate & { score: number }> = [];

  for (const item of rows) {
    const row = item as MapasPredio;
    const rol = typeof row.rol === 'string' ? row.rol.trim() : '';
    const address = typeof row.direccion === 'string' ? cleanAddress(row.direccion) : '';
    if (!rol || seen.has(rol)) continue;

    const score = addressScore(address, tokens, parsed.number);
    if (score === 0) continue;

    seen.add(rol);
    matched.push({
      rol,
      address,
      comuna:
        typeof row.nombreComuna === 'string' && row.nombreComuna.trim()
          ? row.nombreComuna.trim()
          : comuna,
      destino:
        typeof row.destinoDescripcion === 'string' && row.destinoDescripcion.trim()
          ? row.destinoDescripcion.trim()
          : null,
      score,
    });
  }

  if (matched.length === 0) {
    return {
      ok: false,
      reason: 'not_found',
      error: `El SII no encontró predios en «${parsed.street} ${parsed.number}» (${comuna}). Revisa la dirección o escribe el ROL a mano.`,
    };
  }

  matched.sort((a, b) => b.score - a.score || a.address.localeCompare(b.address, 'es'));

  return {
    ok: true,
    total: matched.length,
    candidates: matched.slice(0, MAX_CANDIDATES).map(({ score: _score, ...candidate }) => candidate),
  };
}
