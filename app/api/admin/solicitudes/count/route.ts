import { NextResponse } from 'next/server';

import { countSolicitudesNuevas } from '@/lib/data/solicitudesStore';
import { countApplicationsByStatus } from '@/lib/kyb/store';
import { requireAdmin } from '@/lib/supabase/auth-guard';

/**
 * `GET /api/admin/solicitudes/count` — cuántas solicitudes siguen sin revisar.
 *
 * Es el número del badge «Solicitudes» en el panel, y suma las dos fuentes que
 * la bandeja muestra juntas:
 *
 * - las solicitudes de «Publicar» de socios (`corredora`, `inmobiliaria`,
 *   `agente`); el propietario que pide propuestas se atiende en leads y no cuenta;
 * - las altas KYB, que nacen en `kyb_applications` y también en `Recibida`.
 *
 * Solo `Recibida` —el estado con el que nace una solicitud—: una que ya pasó a
 * `En_Evaluacion` la está mirando alguien y no debe seguir empujando al equipo a
 * entrar. Contar una tabla y no la otra dejaría el aviso apagado con altas
 * esperando decisión, que es justo lo que el badge tiene que evitar.
 *
 * Es **del equipo**: el contador es pequeño, pero sale de datos personales, así
 * que pasa por el mismo guard que el listado. Sin sesión no se responde ni el
 * número. La respuesta no se cachea: el panel la pide en cada navegación para
 * que el badge no mienta después de revisar una solicitud.
 */
export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const [solicitudes, altas] = await Promise.all([
    countSolicitudesNuevas(),
    countApplicationsByStatus('Recibida'),
  ]);

  return NextResponse.json(
    {
      success: true,
      count: solicitudes.count + altas.count,
      // La base respalda el número solo si **las dos** fuentes salieron de ella:
      // si una es la copia en memoria de desarrollo, el total no sobrevive un
      // reinicio y el panel tiene que poder decirlo.
      source: solicitudes.source === 'supabase' && altas.source === 'supabase' ? 'supabase' : 'memory',
      persistent: solicitudes.persistent && altas.persistent,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
