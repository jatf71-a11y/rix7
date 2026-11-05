import { NextResponse } from 'next/server';

import { readCcaStocks } from '@/lib/data/ccaDetermination';
import { listPartners } from '@/lib/data/partners-store';
import { requireAdmin } from '@/lib/supabase/auth-guard';

/**
 * `/api/admin/partners/cca` — la cartera de cada socio y el `%CCA` vigente.
 *
 * El CCA es la determinación que se resuelve **después del alta**: la suma de la
 * cartera del socio, en UF. No se activa ni se contrata, así que esta ruta solo
 * lee; con esos pesos el panel calcula el CCA y el monto con la fórmula de
 * `lib/kyb/cca.ts` y la UF del día.
 *
 * Los ids salen de la lista real de socios, no del query: el panel no elige de
 * quién pide el número. Una sola consulta cubre el listado completo, en vez de
 * una por tarjeta.
 */

/** Sin caché: la cartera cambia con cada publicación y el `%CCA` se edita en Planes. */
const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

// GET /api/admin/partners/cca — cartera por socio y %CCA vigente
export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { partners, persistent } = await listPartners();
  const summary = await readCcaStocks(partners.map((partner) => partner.id));

  return NextResponse.json(
    {
      success: true,
      data: {
        stocks: summary.stocks,
        ccaPct: summary.ccaPct,
        // El panel lo usa para no presentar $0 como si fuera una cartera real
        // cuando el entorno no tiene base configurada.
        persistent: summary.persistent && persistent,
        warning: summary.warning,
      },
    },
    NO_STORE
  );
}
