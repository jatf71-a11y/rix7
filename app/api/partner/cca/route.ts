import { NextResponse } from 'next/server';

import { readCcaDetermination } from '@/lib/data/ccaDetermination';
import { readCcaAuthorization, readCcaMovements } from '@/lib/data/ccaLedger';
import { requireMember } from '@/lib/supabase/auth-guard';

/**
 * `/api/partner/cca` — el CCA del socio, su cuenta corriente y su autorización.
 *
 * Es una lectura: el CCA no se activa, no se pausa y no se negocia. Se determina
 * después del alta con el stock real del socio y el `%CCA` de **Planes**, y se
 * factura junto a la mensualidad. Como el monto depende de la cartera, lo que el
 * socio necesita no es solo el número de hoy: es el historial de cómo llegó a
 * ese número, que es lo que respalda cada factura.
 *
 * El `partnerId` lo resuelve el guard desde la sesión.
 */

/** Sin caché: cambia con cada publicación y con la UF del día. */
const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

// GET /api/partner/cca — determinación, cuenta corriente y fecha de autorización
export async function GET() {
  const guard = await requireMember();
  if (!guard.ok) return guard.response;

  const [determination, ledger, authorizedAt] = await Promise.all([
    readCcaDetermination(guard.partnerId),
    readCcaMovements(guard.partnerId),
    readCcaAuthorization(guard.partnerId),
  ]);

  return NextResponse.json(
    {
      success: true,
      data: {
        ...determination,
        movements: ledger.movements,
        authorizedAt,
        ...(ledger.warning ? { warning: ledger.warning } : {}),
      },
    },
    NO_STORE
  );
}
