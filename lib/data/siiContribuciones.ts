/**
 * Contribuciones de una propiedad, consultadas en el SII a partir del ROL.
 *
 * El SII no publica una API documentada, pero la aplicación pública de pago de
 * contribuciones (`cuotaanualbienesraicespubinternetui`) usa un servicio JSON
 * sin sesión ni captcha para resolver comuna + ROL. Es el mismo que atiende el
 * formulario que una persona usa a mano; acá se consulta **una vez por clic**
 * desde el panel del socio, no se raspa el sitio ni se recorren listados.
 *
 * Lo que se hace y lo que no:
 *
 * - Se pide la comuna a partir del **nombre** (la base guarda `city`, no el
 *   código del SII), con la región como desambiguador: hay nombres repetidos.
 * - Se piden las cuotas del ROL y se devuelve **solo el monto anual** del año
 *   más reciente con las cuatro cuotas. Nada de la respuesta se guarda acá: el
 *   nombre del propietario y la dirección que trae el SII **se descartan** a
 *   propósito, porque el panel no los necesita y son datos personales.
 * - La fuente es frágil por definición: si el SII cambia el servicio, esto
 *   devuelve un error legible y el monto se sigue pudiendo cargar a mano. Por
 *   eso el campo del formulario nunca se pisa solo: la consulta rellena y la
 *   persona confirma.
 *
 * La TGR, que es la que cobra, exige reCAPTCHA v3 para consultar por ROL, así
 * que no es una alternativa automatizable. El SII sí da la cuota emitida.
 *
 * Este módulo es de servidor: lo usan la ruta `/api/contribuciones` y sus tests.
 */

import { dataArray, postSiiService } from './siiService';

/** Base del servicio público de cuotas del SII. */
const SII_BASE = 'https://www4.sii.cl/cuotaanualbienesraicespubinternetui';

const NS_COMUNAS =
  'cl.sii.sdi.lob.bbrr.cuotaanualbienesraices.data.impl.FacadeApplicationService/getComunas';
const NS_REGIONES =
  'cl.sii.sdi.lob.bbrr.cuotaanualbienesraices.data.impl.FacadeApplicationService/getRegiones';
const NS_BUSCAR =
  'cl.sii.sdi.lob.bbrr.cuotaanualbienesraices.data.impl.PropiedadesApplicationService/buscarPropiedades';

/** Cuánto se reutiliza el catálogo de comunas y regiones (cambia poco). */
const CATALOG_TTL_MS = 12 * 60 * 60 * 1000;

export interface SiiComuna {
  codigo: number;
  region: number;
  descripcion: string;
}

export interface SiiRegion {
  codigo: number;
  descripcion: string;
}

export type FetchLike = typeof fetch;

export type ContribucionesLookup =
  | {
      ok: true;
      /** Monto anual en CLP del último año con las cuatro cuotas, o `null`. */
      annual: number | null;
      /** Año al que corresponde ese monto. */
      year: number | null;
      /** De dónde salió el dato, para que el panel lo muestre. */
      source: 'sii';
      /** Cuándo se consultó (ISO), no cuándo se emitió la cuota. */
      checkedAt: string;
    }
  | {
      ok: false;
      error: string;
      /**
       * Para que la ruta elija el estado HTTP sin adivinar por el texto:
       * `invalid` es un dato mal ingresado, `not_found` es el SII diciendo que
       * no hay cuotas y `upstream` es que no se pudo consultar.
       */
      reason: 'invalid' | 'not_found' | 'upstream';
    };

/**
 * Clave de comparación de nombres: sin tildes, mayúsculas y sin separadores.
 *
 * El SII escribe «REGION DEL BIO BIO» y la base «Región del Biobío», o
 * «METROPOLITANA DE SANTIAGO» sin «Región de». Comparar la cadena cruda haría
 * fallar comunas que son la misma.
 */
export function siiKey(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
}

interface CatalogCache {
  at: number;
  comunas: SiiComuna[];
  regiones: SiiRegion[];
}

/** Catálogo en memoria del proceso: no cambia entre clics ni entre días. */
let catalogCache: CatalogCache | null = null;

/** Vacía la caché. Solo para los tests. */
export function resetSiiCatalogCache(): void {
  catalogCache = null;
}

/** POST al servicio del SII, con el sobre común de `siiService`. */
function postSii(
  fetchImpl: FetchLike,
  path: string,
  namespace: string,
  data: unknown
): Promise<Record<string, unknown> | null> {
  return postSiiService(fetchImpl, `${SII_BASE}${path}`, namespace, data);
}

/**
 * Código SII de la comuna, con la región como desambiguador.
 *
 * `region` es el nombre que guarda la ficha (`state`), no el código. Si el
 * nombre de la comuna aparece en más de una región y la región no se pudo
 * reconocer, se devuelve un error en vez de elegir una al azar: consultar el
 * ROL en la comuna equivocada devuelve «sin datos» y parecería que la
 * propiedad no existe.
 */
async function resolveComunaCode(
  fetchImpl: FetchLike,
  comuna: string,
  region: string | undefined
): Promise<
  | { ok: true; codigo: number }
  | { ok: false; error: string; reason: 'invalid' | 'upstream' }
> {
  const cacheValid = catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS;

  if (!cacheValid) {
    const [comunasPayload, regionesPayload] = await Promise.all([
      postSii(fetchImpl, '/services/data/facadeService/getComunas', NS_COMUNAS, null),
      postSii(fetchImpl, '/services/data/facadeService/getRegiones', NS_REGIONES, null),
    ]);

    const comunasRaw = dataArray(comunasPayload);
    const regionesRaw = dataArray(regionesPayload);
    if (!comunasRaw || !regionesRaw) {
      return {
        ok: false,
        reason: 'upstream',
        error: 'No se pudo consultar el SII. Intenta de nuevo en unos minutos.',
      };
    }

    const comunas = comunasRaw
      .filter((item): item is SiiComuna => {
        const row = item as Partial<SiiComuna>;
        return typeof row.codigo === 'number' && typeof row.descripcion === 'string';
      })
      .map((row) => ({ codigo: row.codigo, region: row.region, descripcion: row.descripcion }));

    const regiones = regionesRaw
      .filter((item): item is SiiRegion => {
        const row = item as Partial<SiiRegion>;
        return typeof row.codigo === 'number' && typeof row.descripcion === 'string';
      })
      .map((row) => ({ codigo: row.codigo, descripcion: row.descripcion }));

    catalogCache = { at: Date.now(), comunas, regiones };
  }

  // Se guarda en una constante: `catalogCache` es mutable de módulo y TypeScript
  // no estrecha su tipo después del `if`, aunque acá ya esté cargado.
  const catalog = catalogCache;
  if (!catalog) {
    return {
      ok: false,
      reason: 'upstream',
      error: 'No se pudo consultar el SII. Intenta de nuevo en unos minutos.',
    };
  }

  const { comunas, regiones } = catalog;
  const target = siiKey(comuna);
  let matches = comunas.filter((row) => siiKey(row.descripcion) === target);

  // El nombre de la región que guarda la ficha puede venir como «Región de X»;
  // se compara por la clave sin tildes ni separadores, y si no coincide exacta
  // se acepta que una contenga a la otra («METROPOLITANA» vs el nombre largo).
  const regionKey = siiKey(region);
  if (regionKey && matches.length > 1) {
    const regionRow = regiones.find((row) => {
      const key = siiKey(row.descripcion);
      return key === regionKey || key.includes(regionKey) || regionKey.includes(key);
    });
    if (regionRow) matches = matches.filter((row) => row.region === regionRow.codigo);
  }

  if (matches.length === 0) {
    return {
      ok: false,
      reason: 'invalid',
      error: `El SII no reconoce la comuna «${comuna}». Revísala en la ficha antes de consultar.`,
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      reason: 'invalid',
      error: `Hay más de una comuna «${comuna}» en el SII: agrega la región para consultar.`,
    };
  }

  return { ok: true, codigo: matches[0].codigo };
}

/** ROL en el formato del SII: `manzana-predio`, ambos numéricos. */
export function splitRol(rol: string): { manzana: string; predio: string } | null {
  const match = rol.trim().match(/^(\d+)\s*-\s*(\d+)/);
  if (!match) return null;
  const predio = String(Number(match[2]));
  if (!predio || predio === '0') return null;
  return { manzana: String(Number(match[1])), predio };
}

interface SiiCuota {
  valor?: number;
  agno?: number;
  cuota?: number;
}

/**
 * Monto anual a partir de la lista de cuotas del SII.
 *
 * Se prefiere el año más reciente que tenga **las cuatro** cuotas: un año a
 * medio emitir (o con cuotas ya pagadas que el SII deja de listar) sumaría
 * menos de lo que la propiedad paga. Si ningún año tiene cuatro, se devuelve el
 * más reciente con lo que haya, porque es mejor un dato parcial y dicho que
 * ninguno.
 */
export function annualFromCuotas(cuotas: SiiCuota[]): { annual: number | null; year: number | null } {
  const byYear = new Map<number, number[]>();
  for (const cuota of cuotas) {
    const year = Number(cuota.agno);
    const value = Number(cuota.valor);
    if (!Number.isFinite(year) || !Number.isFinite(value) || value <= 0) continue;
    const list = byYear.get(year) ?? [];
    list.push(value);
    byYear.set(year, list);
  }

  const years = Array.from(byYear.keys()).sort((a, b) => b - a);
  if (years.length === 0) return { annual: null, year: null };

  const complete = years.find((year) => (byYear.get(year) ?? []).length >= 4);
  const chosen = complete ?? years[0];
  const total = (byYear.get(chosen) ?? []).reduce((sum, value) => sum + value, 0);

  return { annual: total > 0 ? Math.round(total) : null, year: chosen };
}

/**
 * Consulta las contribuciones de un ROL en el SII.
 *
 * `comuna` y `region` son los de la ficha (`city` y `state`). La respuesta no
 * incluye nombre del propietario, dirección ni detalle de deuda: solo el monto
 * anual, el año y la fecha de la consulta.
 */
export async function lookupContribucionesSII(
  input: { rol: string; comuna: string; region?: string | null },
  fetchImpl: FetchLike = fetch
): Promise<ContribucionesLookup> {
  const parts = splitRol(input.rol);
  if (!parts) {
    return {
      ok: false,
      reason: 'invalid',
      error: 'El ROL debe tener la forma manzana-predio (ej: 15234-67).',
    };
  }

  const comuna = (input.comuna ?? '').trim();
  if (comuna.length < 2) {
    return {
      ok: false,
      reason: 'invalid',
      error: 'Falta la comuna: es lo que permite ubicar el ROL en el SII.',
    };
  }

  const codigo = await resolveComunaCode(fetchImpl, comuna, input.region ?? undefined);
  if (!codigo.ok) return codigo;

  const payload = await postSii(fetchImpl, '/services/data/propiedadesService/buscarPropiedades', NS_BUSCAR, {
    codigoComuna: String(codigo.codigo),
    manzana: parts.manzana,
    predio: parts.predio,
  });

  if (!payload) {
    return {
      ok: false,
      reason: 'upstream',
      error: 'No se pudo consultar el SII. Intenta de nuevo en unos minutos.',
    };
  }

  const rows = dataArray(payload);
  if (!rows) {
    return {
      ok: false,
      reason: 'upstream',
      error: 'El SII respondió algo inesperado. Intenta de nuevo en unos minutos.',
    };
  }

  const row = rows[0] as { cuotas?: Record<string, SiiCuota> } | undefined;
  if (!row) {
    return {
      ok: false,
      reason: 'not_found',
      error: 'El SII no encontró ese ROL en la comuna. Revisa el ROL o cárgalo a mano.',
    };
  }

  const cuotas = row.cuotas && typeof row.cuotas === 'object' ? Object.values(row.cuotas) : [];
  const { annual, year } = annualFromCuotas(cuotas);

  if (annual === null) {
    return {
      ok: false,
      reason: 'not_found',
      error: 'El SII no registra cuotas para ese ROL (puede estar exento o sin cuotas emitidas).',
    };
  }

  return {
    ok: true,
    annual,
    year,
    source: 'sii',
    checkedAt: new Date().toISOString(),
  };
}
