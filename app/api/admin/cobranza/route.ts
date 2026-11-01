import { NextRequest, NextResponse } from 'next/server';

import { listCobranza, registrarPago, setMorosidad } from '@/lib/data/cobranzaStore';
import { requireAdmin } from '@/lib/supabase/auth-guard';

/**
 * `/api/admin/cobranza` — control de pagos de la suscripción.
 *
 * GET devuelve todos los socios con su situación. POST hace una de las dos cosas
 * que el equipo necesita: registrar el pago de un período o confirmar/levantar la
 * morosidad.
 *
 * Solo admin: son datos comerciales y, cuando se confirma la morosidad, el socio
 * desaparece de la vidriera pública. Ese botón no puede estar en una sesión
 * cualquiera.
 */
export const dynamic = 'force-dynamic';

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const result = await listCobranza();

  return NextResponse.json(
    {
      success: true,
      socios: result.socios,
      persistent: result.persistent,
      ...(result.warning ? { warning: result.warning } : {}),
    },
    NO_STORE
  );
}

export async function POST(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: 'Cuerpo inválido' }, { status: 400 });
  }

  const action = body.action;

  if (action === 'pago') {
    const result = await registrarPago({
      partnerId: body.partnerId,
      period: body.period,
      amountClp: body.amountClp,
      note: body.note,
    });

    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      data: { situacion: result.situacion ?? null },
    });
  }

  if (action === 'morosidad') {
    const result = await setMorosidad({
      partnerId: body.partnerId,
      moroso: body.moroso,
      nota: body.nota,
    });

    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      data: { situacion: result.situacion ?? null },
    });
  }

  return NextResponse.json({ success: false, error: 'Acción desconocida' }, { status: 400 });
}
