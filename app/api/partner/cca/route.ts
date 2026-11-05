import { NextResponse } from 'next/server';

import { readCcaDetermination } from '@/lib/data/ccaDetermination';
import { requireMember } from '@/lib/supabase/auth-guard';

/**
 * `/api/partner/cca` — el CCA del socio, calculado con sus publicaciones.
 *
 * Es una lectura: el CCA no se activa, no se pausa y no se negocia. Se determina
 * después del alta con el stock real del socio y el `%CCA` de **Planes**, y se
 * factura junto a la mensualidad. El `partnerId` lo resuelve el guard desde la
 * sesión.
 */

/** Sin caché: cambia con cada publicación y con la UF del día. */
const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

// GET /api/partner/cca — publicaciones, suma en pesos y %CCA vigente
export async function GET() {
  const guard = await requireMember();
  if (!guard.ok) return guard.response;

  const determination = await readCcaDetermination(guard.partnerId);

  return NextResponse.json({ success: true, data: determination }, NO_STORE);
}
