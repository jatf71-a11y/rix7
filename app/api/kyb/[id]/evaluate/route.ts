import { NextResponse } from 'next/server';
import { evaluateById } from '@/lib/kyb/onboarding';
import { getApplication } from '@/lib/kyb/store';
import { requireAdmin } from '@/lib/supabase/auth-guard';

/**
 * `/api/kyb/[id]/evaluate` — nueva corrida del motor desde el panel.
 *
 * La evaluación normal es automática (al recibir el alta y al responder las
 * preguntas). Este endpoint existe para dos casos concretos: reintentar una
 * verificación externa que había fallado y re-evaluar una ficha histórica.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const current = await getApplication(params.id);
  if (!current.ok || !current.data) {
    return NextResponse.json(
      { success: false, error: current.error ?? 'Solicitud no encontrada.' },
      { status: current.found === false ? 404 : 500 }
    );
  }

  const result = await evaluateById(params.id);
  if (!result.ok || !result.application) {
    // Una solicitud en un estado terminal no es un error del servidor.
    const status = result.error?.includes('no se puede evaluar') ? 409 : 500;
    return NextResponse.json({ success: false, error: result.error }, { status });
  }

  return NextResponse.json({
    success: true,
    data: {
      id: result.application.id,
      status: result.application.status,
      score: result.evaluation?.score ?? result.application.score,
      questions: result.questions ?? [],
    },
    email: result.email ?? null,
  });
}
