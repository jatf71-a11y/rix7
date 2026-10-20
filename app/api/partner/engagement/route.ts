import { NextRequest, NextResponse } from 'next/server';
import { requireMember } from '@/lib/supabase/auth-guard';
import { listPartnerShareViews } from '@/lib/data/shareViewsStore';
import { listPartnerShareEvents } from '@/lib/data/shareEventsStore';
import { listPartnerLeads } from '@/lib/data/leads-store';
import { buildPartnerEngagement } from '@/lib/data/partnerEngagement';

/**
 * `GET /api/partner/engagement` — actividad de los enlaces de la corredora.
 *
 * Devuelve lo que el panel `/socio` necesita para responder «¿qué enlace me
 * trae interesados y por qué canal?»: compartidos, aperturas y contactos de la
 * corredora de la sesión, agrupados por enlace y por canal, más los últimos
 * movimientos con nombre y contacto.
 *
 * Tres reglas que no se negocian acá:
 *
 * 1. **La corredora sale del guard**, nunca de la query string. Un socio no
 *    puede pedir la actividad de otra corredora cambiando un parámetro.
 * 2. Las tres lecturas van filtradas por ese `partnerId` en la consulta,
 *    además de la RLS (`0017_socio_actividad`): defensa en profundidad, igual
 *    que `/api/partner/properties`.
 * 3. Sin caché: son datos de personas que cambian con cada envío.
 *
 * En desarrollo sin Supabase las tres fuentes caen al respaldo en memoria y la
 * respuesta lo declara con `persistent: false`, para que la UI avise en vez de
 * mostrar un informe que parece real.
 */

/** Ventana por defecto y tope: más de un año deja de ser «actividad actual». */
const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

function parseDays(raw: string | null): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_DAYS;
  return Math.min(Math.floor(value), MAX_DAYS);
}

export async function GET(request: NextRequest) {
  const guard = await requireMember();
  if (!guard.ok) return guard.response;

  const days = parseDays(new URL(request.url).searchParams.get('days'));

  // En paralelo: son tres consultas independientes y el panel las necesita
  // todas para armar el informe.
  const [viewsResult, eventsResult, leadsResult] = await Promise.all([
    listPartnerShareViews(guard.partnerId, Math.max(days, 180)),
    listPartnerShareEvents(guard.partnerId),
    listPartnerLeads(guard.partnerId),
  ]);

  const data = buildPartnerEngagement(
    {
      views: viewsResult.views,
      leads: leadsResult.leads,
      events: eventsResult.events,
    },
    { days }
  );

  return NextResponse.json(
    {
      success: true,
      data,
      persistent:
        viewsResult.persistent && eventsResult.persistent && leadsResult.persistent,
    },
    NO_STORE
  );
}
