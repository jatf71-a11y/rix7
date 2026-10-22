import { NextRequest, NextResponse } from 'next/server';
import { contribucionesQuerySchema } from '@/lib/api/schemas';
import { searchParamsToObject, validateInput } from '@/lib/api/validate';
import { lookupContribucionesSII } from '@/lib/data/siiContribuciones';
import { requireMember } from '@/lib/supabase/auth-guard';
import { clientIpFrom, createRateLimiter } from '@/lib/utils/rateLimit';

/**
 * `/api/contribuciones` — el monto real de contribuciones de un ROL, para el
 * botón «Consultar SII» del panel del socio.
 *
 * Es una consulta **del equipo**, no del público: va detrás de `requireMember`
 * porque cada llamada golpea el servicio del SII y solo tiene sentido para
 * quien está editando una publicación. La ficha pública nunca llama acá: lee el
 * número que quedó guardado en `properties.property_taxes`.
 *
 * La respuesta trae solo el monto anual, el año y la fecha de la consulta. El
 * nombre del propietario y la dirección que devuelve el SII se descartan en
 * `lookupContribucionesSII`: el panel no los necesita y son datos personales.
 *
 * El estado HTTP distingue lo que el panel tiene que decirle a la persona:
 * 400 un ROL o una comuna mal puestos, 404 el SII sin cuotas para ese ROL
 * (típico de un inmueble exento) y 502 que el SII no respondió.
 */

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutos

const rateLimiter = createRateLimiter({ max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS });

/** Sin caché: es una consulta puntual, con su propia fecha. */
const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

export async function GET(request: NextRequest) {
  const guard = await requireMember();
  if (!guard.ok) return guard.response;

  if (rateLimiter.isLimited(clientIpFrom(request.headers))) {
    return NextResponse.json(
      { success: false, error: 'Demasiadas consultas al SII. Intenta de nuevo en unos minutos.' },
      { status: 429, headers: { 'Retry-After': '600' } }
    );
  }

  const validation = validateInput(
    contribucionesQuerySchema,
    searchParamsToObject(new URL(request.url).searchParams)
  );
  if (!validation.ok) {
    return NextResponse.json({ success: false, error: validation.error }, { status: 400 });
  }

  const result = await lookupContribucionesSII(validation.data);

  if (!result.ok) {
    const status = result.reason === 'invalid' ? 400 : result.reason === 'not_found' ? 404 : 502;
    return NextResponse.json(
      { success: false, error: result.error, reason: result.reason },
      { status, ...NO_STORE }
    );
  }

  return NextResponse.json(
    {
      success: true,
      data: {
        annual: result.annual,
        year: result.year,
        source: result.source,
        checkedAt: result.checkedAt,
      },
    },
    NO_STORE
  );
}
