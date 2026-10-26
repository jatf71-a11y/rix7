import { NextResponse } from 'next/server';
import { getApplication, latestEvaluation, listDecisions } from '@/lib/kyb/store';
import { requireAdmin } from '@/lib/supabase/auth-guard';

/**
 * `/api/kyb/[id]` — detalle de una solicitud para el equipo.
 *
 * Incluye la última evaluación con sus verificaciones y el historial de
 * decisiones del equipo: lo primero explica por qué la solicitud está donde
 * está, lo segundo quién la puso ahí. Sin eso el panel solo tendría un estado.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const application = await getApplication(params.id);
  if (!application.ok || !application.data) {
    return NextResponse.json(
      { success: false, error: application.error ?? 'Solicitud no encontrada.' },
      { status: application.found === false ? 404 : 500 }
    );
  }

  const evaluation = await latestEvaluation(params.id);
  const decisions = await listDecisions(params.id);

  return NextResponse.json({
    success: true,
    data: {
      application: application.data,
      evaluation: evaluation.ok ? evaluation.data : null,
      decisions,
    },
  });
}
