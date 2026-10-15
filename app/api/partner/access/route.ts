import { NextResponse } from 'next/server';
import { requireMember } from '@/lib/supabase/auth-guard';

/**
 * ¿Esta sesión puede usar el panel de socios?
 *
 * Existe para que `/socio` y `/socio/publicar` puedan decir **antes** de mostrar
 * un formulario si la cuenta no está lista, en vez de dejar que alguien cargue
 * una propiedad entera y recién al guardar descubra que no tenía permiso. La
 * decisión no se duplica: es exactamente el mismo guard (`requireMember`) que
 * protege `/api/partner/properties`, así que no hay dos verdades posibles.
 *
 * No devuelve más que lo necesario para explicar la situación: la corredora
 * vinculada y el rol. Los estados de error (401 sin sesión, 403 sin rol o sin
 * corredora vinculada, 503 sin Supabase) son los del guard, con su mensaje.
 */
export async function GET() {
  const guard = await requireMember();
  if (!guard.ok) {
    // La respuesta del guard ya trae el estado y el motivo exacto («Inicia sesión
    // para continuar.», «Se requiere rol de socio.», «Tu cuenta no está vinculada
    // a una corredora…»), así que la UI puede explicar qué pasa y qué hacer.
    return guard.response;
  }

  return NextResponse.json({
    success: true,
    data: { role: guard.role, partnerId: guard.partnerId },
  });
}
