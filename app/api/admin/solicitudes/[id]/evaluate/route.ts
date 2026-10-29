import { NextResponse } from 'next/server';

import { reEvaluateSolicitud } from '@/lib/data/solicitudAutopilot';
import { SOLICITUD_ID_MAX_LENGTH } from '@/lib/data/solicitudes';
import { requireAdmin } from '@/lib/supabase/auth-guard';

/**
 * `POST /api/admin/solicitudes/[id]/evaluate` — volver a pasar el motor.
 *
 * El registro se evalúa solo al recibirse, pero el equipo necesita poder
 * repetirlo: alguien corrigió el RUT por teléfono, se vinculó la empresa que
 * faltaba, o se quiere ver si una regla nueva cambia el resultado. Es la misma
 * operación que hace el autómata, con el correo incluido, porque una
 * re-evaluación que no avisa deja al solicitante esperando.
 *
 * Es **del equipo**: con la sesión del admin, igual que el resto del panel.
 */
const ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const id = params.id?.trim() ?? '';
  if (!id || id.length > SOLICITUD_ID_MAX_LENGTH || !ID_PATTERN.test(id)) {
    return NextResponse.json(
      { success: false, error: 'La solicitud indicada no es válida.' },
      { status: 400 }
    );
  }

  const result = await reEvaluateSolicitud(id);

  if (!result.ok) {
    const status = result.code === 'not_found' ? 404 : result.code === 'conflict' ? 409 : 500;
    return NextResponse.json(
      { success: false, error: result.error ?? 'No se pudo evaluar la solicitud.' },
      { status }
    );
  }

  return NextResponse.json(
    {
      success: true,
      status: result.status,
      evaluation: result.evaluation,
      questions: result.questions ?? [],
      email: result.email ?? null,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
