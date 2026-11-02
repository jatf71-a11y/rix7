import { NextResponse } from 'next/server';

import { resendSolicitudLink } from '@/lib/data/solicitudAutopilot';
import { SOLICITUD_ID_MAX_LENGTH } from '@/lib/data/solicitudes';
import { requireAdmin } from '@/lib/supabase/auth-guard';

/**
 * `POST /api/admin/solicitudes/[id]/resend` — reenviar el enlace pendiente.
 *
 * El caso real: la persona dice «no me llegó» o «el enlace venció». El token en
 * claro no se guarda —solo su hash—, así que lo que se emite es un enlace nuevo
 * para el mismo paso; el anterior deja de servir, y eso es lo que se espera.
 *
 * Si el registro ya se convirtió en alta, delega en el reenvío del alta
 * (preguntas, propuesta o plan, según el estado), para que el panel no tenga que
 * saber de qué lado vive el trámite.
 *
 * Es **del equipo**: con la sesión del admin, como el resto de las acciones.
 */
const ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const id = params.id?.trim() ?? '';
  if (!id || id.length > SOLICITUD_ID_MAX_LENGTH || !ID_PATTERN.test(id)) {
    return NextResponse.json(
      { success: false, error: 'La solicitud indicada no es válida.' },
      { status: 400 }
    );
  }

  const result = await resendSolicitudLink(id);

  if (!result.ok) {
    const status = result.code === 'not_found' ? 404 : result.code === 'conflict' ? 409 : 500;
    return NextResponse.json(
      { success: false, error: result.error ?? 'No se pudo reenviar el enlace.' },
      { status }
    );
  }

  return NextResponse.json(
    {
      success: true,
      status: result.status,
      email: result.email ?? null,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
