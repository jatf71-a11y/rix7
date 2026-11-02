import { NextResponse } from 'next/server';

import { resendKybLink } from '@/lib/kyb/onboarding';
import { requireAdmin } from '@/lib/supabase/auth-guard';

/**
 * `POST /api/kyb/[id]/resend` — reenviar el enlace del paso pendiente.
 *
 * Sirve para las preguntas de una evaluación, la propuesta comercial o la
 * confirmación del plan. Emite un token nuevo del propósito vigente: el anterior
 * muere, que es lo mismo que pasa cuando la persona responde.
 *
 * Solo admin: el enlace da acceso al trámite y lo pide el equipo cuando el
 * candidato dice que no le llegó.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const id = params.id?.trim() ?? '';
  if (!id) {
    return NextResponse.json({ success: false, error: 'Falta el id.' }, { status: 400 });
  }

  const result = await resendKybLink(id);

  if (!result.ok) {
    const status = result.code === 'not_found' ? 404 : result.code === 'conflict' ? 409 : 500;
    return NextResponse.json(
      { success: false, error: result.error ?? 'No se pudo reenviar el enlace.' },
      { status }
    );
  }

  return NextResponse.json(
    { success: true, status: result.status, email: result.email ?? null },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
