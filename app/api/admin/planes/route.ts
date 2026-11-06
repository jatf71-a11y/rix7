import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/supabase/auth-guard';
import { readPlanPricing, writePlanPricing } from '@/lib/data/planPricingStore';
import { syncAllPartnerCca } from '@/lib/data/ccaLedger';

/**
 * `/api/admin/planes` — precios de los planes por perfil de socio.
 *
 * Es la configuración de negocio del portal: cuánto cuesta cada plan para una
 * corredora, una inmobiliaria y un profesional independiente. Vive acá y no en
 * el código para que cambiar un precio no dependa de un deploy.
 *
 * Solo admin: el precio es información comercial y editarlo es una decisión del
 * equipo. La validación (rangos, planes y perfiles conocidos) está en
 * `normalizePlanPricing` y se aplica igual al leer y al escribir.
 *
 * `persistent: false` en la respuesta es una advertencia real, no un detalle: en
 * ese caso el guardado se pierde al reiniciar el proceso y el panel lo dice en
 * pantalla.
 */

export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const result = await readPlanPricing();

  return NextResponse.json(
    {
      success: true,
      data: result.config,
      source: result.source,
      persistent: result.persistent,
      ...(result.warning ? { warning: result.warning } : {}),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function PUT(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Cuerpo inválido' }, { status: 400 });
  }

  // El panel manda `{ config }`; se acepta también la configuración suelta para
  // que una prueba con `curl` no tenga que envolverla.
  const payload =
    body && typeof body === 'object' && 'config' in body
      ? (body as { config: unknown }).config
      : body;

  // El `%CCA` multiplica la cartera de cada socio: si cambia, la facturación de
  // todos cambia ese mismo mes. Se lee antes de guardar para saber si de verdad
  // se movió, y solo entonces se recalculan las cuentas corrientes.
  const before = await readPlanPricing();

  const saved = await writePlanPricing(payload);
  if (!saved.ok) {
    return NextResponse.json({ success: false, error: saved.error }, { status: 400 });
  }

  const result = await readPlanPricing();

  // Recalcular es parte de guardar el `%CCA`, no un extra: cada socio con
  // cartera recibe su nuevo monto por correo y el movimiento queda en su
  // cuenta. Un fallo acá no revierte los precios ya guardados; se informa.
  const ccaPctChanged =
    Math.round(before.config.ccaPct * 100) !== Math.round(result.config.ccaPct * 100);
  const cca = ccaPctChanged
    ? await syncAllPartnerCca({ reason: 'planes' })
    : null;

  return NextResponse.json({
    success: true,
    data: result.config,
    persisted: saved.persistent,
    ...(cca ? { cca } : {}),
    ...(saved.persistent
      ? {}
      : { warning: 'Guardado en memoria: se pierde al reiniciar el proceso.' }),
  });
}
