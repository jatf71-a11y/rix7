import { NextRequest, NextResponse } from 'next/server';
import { kybApplicationPostSchema } from '@/lib/api/schemas';
import { validateInput } from '@/lib/api/validate';
import { submitKybApplication } from '@/lib/kyb/onboarding';
import { kybSource, listApplications } from '@/lib/kyb/store';
import { requireAdmin } from '@/lib/supabase/auth-guard';
import { clientIpFrom, createRateLimiter } from '@/lib/utils/rateLimit';

/**
 * `/api/kyb` — alta de empresas y listado para el equipo.
 *
 * El POST es público (una empresa que quiere darse de alta no tiene cuenta) y
 * corre el flujo completo: guarda, manda el acuse y evalúa. El GET es del
 * equipo: las solicitudes tienen RUT, correo y reputación, así que no se listan
 * sin sesión.
 */

/** Un alta por empresa; el cupo corta scripts, no a quien corrige un dato. */
const rateLimiter = createRateLimiter({ max: 8, windowMs: 10 * 60 * 1000 });

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const result = await listApplications();
  if (!result.ok || !result.data) {
    return NextResponse.json(
      { success: false, error: result.error ?? 'No se pudieron listar las solicitudes.' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    data: result.data.applications,
    source: result.data.source,
    persistent: result.persisted,
  });
}

export async function POST(request: NextRequest) {
  if (rateLimiter.isLimited(clientIpFrom(request.headers))) {
    return NextResponse.json(
      { success: false, error: 'Demasiadas solicitudes' },
      { status: 429, headers: { 'Retry-After': '600' } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Cuerpo inválido' }, { status: 400 });
  }

  const shape = validateInput(kybApplicationPostSchema, body);
  if (!shape.ok) {
    return NextResponse.json({ success: false, error: shape.error }, { status: 400 });
  }

  const result = await submitKybApplication(shape.data);

  // Si la solicitud se guardó, el alta existe aunque la evaluación haya fallado:
  // se responde 201 y el aviso viaja en `warning`, en vez de perder el alta.
  if (result.applicationId) {
    return NextResponse.json(
      {
        success: true,
        data: {
          id: result.applicationId,
          status: result.status,
          score: result.score ?? null,
          questions: result.questions ?? [],
        },
        ...(result.ok ? {} : { warning: result.error }),
        email: result.email ?? null,
        persistent: result.persisted,
        source: kybSource(),
      },
      { status: 201 }
    );
  }

  return NextResponse.json(
    { success: false, error: result.error ?? 'No se pudo registrar la solicitud.' },
    { status: 500 }
  );
}
