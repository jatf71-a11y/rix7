import { NextRequest, NextResponse } from 'next/server';
import { recordShareView } from '@/lib/data/shareViewsStore';
import { getCatalogPropertyById } from '@/lib/data/propertyCatalog';
import { clientIpFrom, createRateLimiter } from '@/lib/utils/rateLimit';

/**
 * `POST /api/share/view` — una apertura de un enlace compartido.
 *
 * Es la contraparte pública de `/compartir/[id]`: la landing se sirve cacheada y
 * no podría contar nada sin volverse dinámica, así que el navegador avisa con un
 * `fetch` en segundo plano al montar.
 *
 * Cuenta **enlaces abiertos**, no personas: no se guarda IP, ni user agent, ni
 * ningún identificador. Por eso la respuesta no puede llevar ningún dato del
 * visitante, y por eso el cliente no espera nada de acá.
 *
 * Un bot sin JS no ejecuta el aviso, así que no infla el contador; a los que sí
 * lo ejecutan los frena el rate limit por IP.
 */

/**
 * Una misma persona puede recargar o reabrir el enlace varias veces, así que el
 * cupo es holgado. La ventana es larga porque lo que hay que frenar es un script
 * que infle un enlace propio, no el uso normal.
 */
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

const rateLimiter = createRateLimiter({ max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS });

const MAX_PROPERTY_ID_LENGTH = 120;
const MAX_PARTNER_ID_LENGTH = 120;

/**
 * Corredora a la que se atribuye la apertura.
 *
 * Se prefiere lo que informa la página, y el catálogo queda como respaldo. No
 * es confianza en el cliente: ese id lo puso el **servidor** al renderizar la
 * landing, a partir del `partner_id` de la propiedad, que es el dato más al día
 * — el catálogo estático puede haber quedado atrás cuando una propiedad
 * publicada en Supabase cambia de corredora. Preferir el catálogo atribuía la
 * apertura a quien ya no la publica.
 *
 * Si alguien manipulara el aviso desde el navegador, lo único que logra es
 * mover una apertura de una corredora a otra en un informe interno: no hay
 * ningún dato del visitante ni acceso a otra cosa. Cuando el id viene vacío o
 * absurdo, se cae al catálogo y, si tampoco está, la apertura queda sin
 * atribuir (se cuenta, pero bajo «sin corredora»), que es mejor que perderla.
 */
function resolvePartnerId(propertyId: string, claimed: unknown): string | null {
  if (typeof claimed === 'string') {
    const value = claimed.trim();
    if (value && value.length <= MAX_PARTNER_ID_LENGTH) return value;
  }

  return getCatalogPropertyById(propertyId)?.partner_id ?? null;
}

export async function POST(request: NextRequest) {
  if (rateLimiter.isLimited(clientIpFrom(request.headers))) {
    return NextResponse.json(
      { success: false, error: 'Demasiadas aperturas seguidas.' },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Cuerpo inválido.' }, { status: 400 });
  }

  const payload = (body ?? {}) as { propertyId?: unknown; partnerId?: unknown };
  const propertyId = typeof payload.propertyId === 'string' ? payload.propertyId.trim() : '';

  if (!propertyId || propertyId.length > MAX_PROPERTY_ID_LENGTH) {
    return NextResponse.json({ success: false, error: 'Falta la propiedad.' }, { status: 400 });
  }

  const partnerId = resolvePartnerId(propertyId, payload.partnerId);
  const result = await recordShareView(propertyId, partnerId);

  if (!result.ok) {
    // El aviso es un extra: si no se pudo contar, la landing ya se mostró y no
    // hay nada que el visitante deba hacer al respecto.
    return NextResponse.json(
      { success: false, error: result.error ?? 'No se pudo registrar la apertura.' },
      { status: 503 }
    );
  }

  return NextResponse.json({ success: true, persisted: result.persisted }, { status: 202 });
}
