import { NextRequest, NextResponse } from 'next/server';
import { SITE_URL } from '@/lib/site';
import { alertsJobConfigured, runPropertyAlerts } from '@/lib/data/alertsRunner';
import { isEmailConfigured } from '@/lib/email/sendEmail';

/**
 * `/api/alerts/run` — corre el job de alertas de búsquedas guardadas.
 *
 * Lo llama un cron (GitHub Actions), no una persona desde el navegador. Se
 * protege con un secreto compartido en la cabecera `x-alerts-secret`: sin él,
 * cualquiera podría disparar los envíos.
 *
 * `?dry=1` informa qué se enviaría sin enviar nada ni tocar fechas — es la forma
 * de comprobarlo antes de activarlo en producción.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const secret = process.env.ALERTS_CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { success: false, error: 'Falta configurar ALERTS_CRON_SECRET.' },
      { status: 503 }
    );
  }

  if (request.headers.get('x-alerts-secret') !== secret) {
    return NextResponse.json({ success: false, error: 'No autorizado.' }, { status: 401 });
  }

  if (!alertsJobConfigured()) {
    return NextResponse.json(
      {
        success: false,
        error:
          'El job necesita SUPABASE_SERVICE_ROLE_KEY para leer las búsquedas de todas las personas.',
      },
      { status: 503 }
    );
  }

  const dryRun = ['1', 'true', 'yes'].includes(
    (request.nextUrl.searchParams.get('dry') || '').toLowerCase()
  );

  const report = await runPropertyAlerts({ dryRun, siteUrl: SITE_URL });

  return NextResponse.json({
    success: true,
    // Se informa si el correo está configurado: con el job "corriendo" pero sin
    // proveedor, los avisos se acumulan sin salir, y eso hay que verlo.
    emailConfigured: isEmailConfigured(),
    dryRun,
    report,
  });
}

/** GET solo informa el estado: sirve para comprobar la configuración. */
export async function GET() {
  return NextResponse.json({
    success: true,
    configured: {
      cronSecret: !!process.env.ALERTS_CRON_SECRET,
      serviceRole: alertsJobConfigured(),
      email: isEmailConfigured(),
    },
  });
}
