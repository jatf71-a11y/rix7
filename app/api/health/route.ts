import { NextResponse } from 'next/server';
import { BUILD_ID_ENV, parseBuildIdValue } from '@/lib/utils/buildId';
import { buildHealthReport, httpStatus, subsystemEnvFrom } from '@/lib/utils/health';

/**
 * `/api/health` — qué subsistemas están configurados en este despliegue.
 *
 * Nació de una molestia concreta: cuando faltaba algo, la respuesta era un `503`
 * genérico («Supabase no está configurado en este entorno») que no decía **qué**
 * faltaba. Acá se responde con la lista completa: el estado de Supabase, **de
 * quién es la base** (`supabase_owner`: un despliegue puede estar entero sobre
 * una base de otra cuenta, que es como pasó inadvertido el incidente del
 * 2026-10-13), la clave de servicio, Resend, el secreto del cron, Sentry y la URL
 * canónica, cada uno con qué deja de funcionar mientras falte y qué hacer para
 * ponerlo.
 *
 * Es pública a propósito: no expone ningún valor (solo si está o no), y sirve
 * justamente cuando uno no tiene acceso al panel de Vercel.
 *
 * `build` es lo otro que informa: **cuál de todas las builds está publicada**.
 * El release la calcula (un hash del árbol de trabajo) y la publica como
 * variable del deployment (`RIX7_BUILD`), así que acá solo se traduce. Es lo que
 * permite comparar «lo que está en vivo» con «el árbol del repositorio» sin
 * entrar al panel de Vercel, y lo usa tanto la verificación del release como la
 * sonda que corre cada 6 horas (`scripts/check-health.mjs`). Un despliegue viejo
 * —o uno publicado sin el comando del repositorio— responde `build: null`, y eso
 * significa «no se puede afirmar que sea este árbol», no «está todo bien».
 *
 * Responde `503` **solo** si falta algo crítico —sin proyecto Supabase real no se
 * guarda nada de lo que hace la gente, aunque el catálogo se siga sirviendo— para
 * que un monitor de disponibilidad lo note sin castigar que el portal funcione en
 * modo demo. Que la build no coincida con el árbol **no** cambia el código de
 * estado: es una pregunta de sincronización, no una caída.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const report = buildHealthReport(subsystemEnvFrom(process.env));

  return NextResponse.json(
    {
      success: report.status !== 'broken',
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'desconocido',
      build: parseBuildIdValue(process.env[BUILD_ID_ENV]),
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
