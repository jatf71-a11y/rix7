import { NextResponse } from 'next/server';

import { countSolicitudesNuevas } from '@/lib/data/solicitudesStore';
import { requireAdmin } from '@/lib/supabase/auth-guard';

/**
 * `GET /api/admin/solicitudes/count` — cuántas solicitudes siguen sin revisar.
 *
 * Es el número del badge «Solicitudes» en el panel. Solo cuenta `status =
 * 'Recibida'` —el estado con el que nace una solicitud—: una que ya pasó a
 * `En_Evaluacion` la está mirando alguien y no debe seguir empujando al equipo a
 * entrar.
 *
 * Es **del equipo**: el contador es pequeño, pero sale de datos personales, así
 * que pasa por el mismo guard que el listado. Sin sesión no se responde ni el
 * número. La respuesta no se cachea: el panel la pide en cada navegación para
 * que el badge no mienta después de revisar una solicitud.
 */
export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { count, source, persistent } = await countSolicitudesNuevas();

  return NextResponse.json(
    { success: true, count, source, persistent },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
