import { NextRequest, NextResponse } from 'next/server';

import { runSocioNudges } from '@/lib/data/socioNudges';
import { isEmailConfigured } from '@/lib/email/sendEmail';

/**
 * `/api/socios/nudges/run` — recordatorios y cierre por abandono.
 *
 * Lo llama un cron (GitHub Actions), no una persona desde el navegador, y usa el
 * mismo secreto que el job de alertas (`ALERTS_CRON_SECRET`): ya está
 * configurado en Vercel y en los secretos de GitHub, y su alcance es el mismo
 * —disparar un job interno—. No hay un permiso nuevo que repartir.
 *
 * `?dry=1` informa qué se haría sin enviar ni escribir nada. Es la forma de
 * revisar el cron antes de agendarlo, y la que se usa cuando hay dudas sobre una
 * fila vieja.
 *
 * GET devuelve si el job está configurado, como `/api/alerts/run`: un cron que
 * corre sin correo configurado acumula avisos que nunca salen.
 */

export const dynamic = 'force-dynamic';

function authorized(request: NextRequest): NextResponse | null {
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
  return null;
}

export async function GET(request: NextRequest) {
  const denied = authorized(request);
  if (denied) return denied;

  return NextResponse.json({
    success: true,
    job: 'socios-nudges',
    emailConfigured: isEmailConfigured(),
  });
}

export async function POST(request: NextRequest) {
  const denied = authorized(request);
  if (denied) return denied;

  const dryRun = ['1', 'true', 'yes'].includes(
    (request.nextUrl.searchParams.get('dry') ?? '').toLowerCase()
  );

  const report = await runSocioNudges({ dryRun });

  return NextResponse.json({
    success: true,
    emailConfigured: isEmailConfigured(),
    ...report,
  });
}
