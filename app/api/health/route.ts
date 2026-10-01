import { NextResponse } from 'next/server';
import { buildHealthReport, httpStatus, subsystemEnvFrom } from '@/lib/utils/health';

/**
 * `/api/health` — qué subsistemas están configurados en este despliegue.
 *
 * Nació de una molestia concreta: cuando faltaba algo, la respuesta era un `503`
 * genérico («Supabase no está configurado en este entorno») que no decía **qué**
 * faltaba. Acá se responde con la lista completa: el estado de Supabase, la clave
 * de servicio, Resend, el secreto del cron, Sentry y la URL canónica, cada uno con
 * qué deja de funcionar mientras falte y qué hacer para ponerlo.
 *
 * Es pública a propósito: no expone ningún valor (solo si está o no), y sirve
 * justamente cuando uno no tiene acceso al panel de Vercel.
 *
 * Responde `503` **solo** si falta algo crítico —sin proyecto Supabase real no se
 * guarda nada de lo que hace la gente, aunque el catálogo se siga sirviendo— para
 * que un monitor de disponibilidad lo note sin castigar que el portal funcione en
 * modo demo.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const report = buildHealthReport(subsystemEnvFrom(process.env));

  return NextResponse.json(
    {
      success: report.status !== 'broken',
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'desconocido',
      checkedAt: new Date().toISOString(),
      status: report.status,
      summary: report.summary,
      missing: {
        broken: report.broken,
        degraded: report.degraded,
        optional: report.optional,
      },
      subsystems: report.subsystems,
    },
    {
      status: httpStatus(report),
      // La respuesta depende del entorno de este proceso, no de un recurso
      // compartido: que no la guarde ningún caché intermedio.
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}
