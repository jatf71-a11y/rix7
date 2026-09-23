import { NextResponse } from 'next/server';

// Route dinámico: la prerenderización estática intentaba fetch a mindicador.cl
// durante el build (rompiendo el incremental cache) y congelaba la UF/dólar
// hasta el próximo deploy.
//
// Rendimiento: `force-dynamic` obliga a ejecutar el handler en cada request y
// desactiva el caché de `fetch`, así que cada visita pagaba ~900 ms de ida y
// vuelta a mindicador.cl (medido: 882–1514 ms, sin caché de borde). Se corrige
// en dos capas, manteniendo el comportamiento dinámico:
//   1. memo por instancia (TTL 1 h) → aciertos en ~0 ms;
//   2. `Cache-Control: s-maxage=3600` → el CDN responde sin invocar la función.
// Los indicadores son valores diarios, así que 1 h de antigüedad es de sobra.
export const dynamic = 'force-dynamic';

const RATES_TTL_MS = 60 * 60 * 1000;
/** Tras una falla no se vuelve a consultar la API externa por este lapso. */
const FAILURE_BACKOFF_MS = 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 5000;

const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
} as const;

interface IndicatorPayload {
  success: true;
  source: string;
  date: string;
  uf: { code: string; name: string; value: number; date?: string };
  dolar: { code: string; name: string; value: number; date?: string };
  utm?: { code: string; name: string; value: number };
}

/** Último valor bueno por instancia: evita castigar a la API externa. */
let ratesCache: { at: number; payload: IndicatorPayload } | null = null;
/** Marca de la última falla, para no reintentar en cada request. */
let lastFailureAt = 0;

/** Reserva dura, solo si nunca se obtuvo un valor real en esta instancia. */
function hardcodedFallback(): IndicatorPayload {
  return {
    success: true,
    source: 'Banco Central de Chile (Caché local)',
    date: new Date().toISOString(),
    uf: { code: 'uf', name: 'Unidad de Fomento', value: 39500.0 },
    dolar: { code: 'dolar', name: 'Dólar Observado', value: 950.0 },
  };
}

export async function GET() {
  const now = Date.now();

  // ═══ Acierto de memoria ═══
  if (ratesCache && now - ratesCache.at < RATES_TTL_MS) {
    return NextResponse.json(ratesCache.payload, { headers: CACHE_HEADERS });
  }

  // ═══ Cortacircuitos: la API externa acaba de fallar ═══
  if (now - lastFailureAt < FAILURE_BACKOFF_MS) {
    if (ratesCache) {
      return NextResponse.json(ratesCache.payload, { headers: CACHE_HEADERS });
    }
    return NextResponse.json(hardcodedFallback());
  }

  try {
    const res = await fetch('https://mindicador.cl/api', {
      next: { revalidate: 3600 },
      headers: {
        'User-Agent': 'Rix7-Portal-Inmobiliario/1.0',
      },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    if (!res.ok) {
      throw new Error(`Error en API: ${res.status}`);
    }

    const data = await res.json();

    const payload: IndicatorPayload = {
      success: true,
      source: 'Banco Central de Chile',
      date: data.fecha || new Date().toISOString(),
      uf: {
        code: 'uf',
        name: 'Unidad de Fomento',
        value: Number(data.uf?.valor) || 39500.0,
        date: data.uf?.fecha,
      },
      dolar: {
        code: 'dolar',
        name: 'Dólar Observado',
        value: Number(data.dolar?.valor) || 950.0,
        date: data.dolar?.fecha,
      },
      utm: {
        code: 'utm',
        name: 'Unidad Tributaria Mensual',
        value: Number(data.utm?.valor) || 69000.0,
      },
    };

    ratesCache = { at: Date.now(), payload };
    return NextResponse.json(payload, { headers: CACHE_HEADERS });
  } catch {
    lastFailureAt = Date.now();

    // Con un valor previo se sirve (y se sigue cacheando en el borde) en lugar de
    // degradar a la reserva dura; sin él, se responde sin caché para que el
    // siguiente request vuelva a intentar en cuanto la API se recupere.
    if (ratesCache) {
      return NextResponse.json(ratesCache.payload, { headers: CACHE_HEADERS });
    }
    return NextResponse.json(hardcodedFallback());
  }
}
