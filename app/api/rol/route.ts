import { NextRequest, NextResponse } from 'next/server';
import { rolQuerySchema } from '@/lib/api/schemas';
import { searchParamsToObject, validateInput } from '@/lib/api/validate';
import { lookupRolSII } from '@/lib/data/siiRol';
import { requireMember } from '@/lib/supabase/auth-guard';
import { clientIpFrom, createRateLimiter } from '@/lib/utils/rateLimit';

/**
 * `/api/rol` — los roles que el SII asocia a una dirección, para el botón
 * «Buscar por dirección» del panel del socio.
 *
 * Es una consulta **del equipo**, no del público: va detrás de `requireMember`
 * porque cada llamada golpea el servicio del SII y solo tiene sentido para
 * quien está editando una publicación. La ficha pública nunca llama acá.
 *
 * La respuesta trae, por predio, el ROL, la dirección, la comuna y el destino.
 * El nombre del propietario y su RUT que devuelve el SII se descartan en
 * `lookupRolSII`.
 *
 * El estado HTTP distingue lo que el panel tiene que decirle a la persona:
 * 400 una dirección sin número o una comuna que el SII no conoce, 404 que no
 * hay predios en esa dirección y 502 que el SII no respondió.
 */

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutos

const rateLimiter = createRateLimiter({ max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS });

/** Sin caché: la lista depende de una dirección que se está editando. */
const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

export async function GET(request: NextRequest) {
  const guard = await requireMember();
  if (!guard.ok) return guard.response;

  if (rateLimiter.isLimited(clientIpFrom(request.headers))) {
    return NextResponse.json(
      { success: false, error: 'Demasiadas búsquedas en el SII. Intenta de nuevo en unos minutos.' },
      { status: 429, headers: { 'Retry-After': '600' } }
    );
  }

  const validation = validateInput(
    rolQuerySchema,
    searchParamsToObject(new URL(request.url).searchParams)
  );
  if (!validation.ok) {
    return NextResponse.json({ success: false, error: validation.error }, { status: 400 });
  }

  // La URL habla español (`direccion`); el módulo, la dirección de la ficha.
  const result = await lookupRolSII({
    address: validation.data.direccion,
    comuna: validation.data.comuna,
  });

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
      data: { candidates: result.candidates, total: result.total },
    },
    NO_STORE
  );
}
