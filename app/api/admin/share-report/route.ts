import { NextRequest, NextResponse } from 'next/server';
import { listShareViews } from '@/lib/data/shareViewsStore';
import { listLeads } from '@/lib/data/leads-store';
import { buildShareReport } from '@/lib/data/shareViews';
import { requireAdmin } from '@/lib/supabase/auth-guard';
import { shareReportQuerySchema } from '@/lib/api/schemas';
import { searchParamsToObject, validateInput } from '@/lib/api/validate';

/**
 * `GET /api/admin/share-report` — aperturas y contactos por corredora.
 *
 * El informe se arma **en el servidor** por dos razones concretas:
 *
 * - Los contactos nunca son públicos (RLS exige rol admin), así que el cruce no
 *   puede hacerse en el navegador sin bajar la lista completa de contactos a
 *   cada visita del panel.
 * - Las reglas de la ventana y de la tasa viven en `buildShareReport`, que es un
 *   módulo puro y testeado. La página queda como presentación.
 */

/** Días de la ventana que se muestra y se cuenta. */
const DEFAULT_WINDOW_DAYS = 30;

export async function GET(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const validation = validateInput(
    shareReportQuerySchema,
    searchParamsToObject(new URL(request.url).searchParams)
  );
  const days = validation.ok ? validation.data.days : DEFAULT_WINDOW_DAYS;

  // La ventana que se pide a la base es más ancha que la que se muestra: el
  // informe necesita el histórico para calcular los totales de cada corredora.
  const [{ views, persistent: viewsPersistent }, { leads, persistent: leadsPersistent }] = await Promise.all([
    listShareViews(180),
    listLeads(500),
  ]);

  const report = buildShareReport(views, leads, { days });

  return NextResponse.json({
    success: true,
    data: report,
    // Si algo se está guardando solo en memoria, el panel lo tiene que decir en
    // pantalla: un informe que parece real y se pierde al reiniciar es peor que
    // no tener informe.
    persistent: viewsPersistent && leadsPersistent,
    windowDays: days,
  });
}
