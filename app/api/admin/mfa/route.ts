import { NextResponse } from 'next/server';

import { countRecoveryCodes } from '@/lib/data/adminMfa';
import { requireAdmin } from '@/lib/supabase/auth-guard';
import { readMfaStatus } from '@/lib/supabase/mfa';
import { createClient } from '@/lib/supabase/server';

/**
 * `GET /api/admin/mfa` — estado del segundo factor de la cuenta del equipo.
 *
 * Es una de las dos rutas que responden con el segundo factor pendiente: es la
 * que le dice a la pantalla que tiene que pedirlo (la otra es la del canje de un
 * código de recuperación). El resto de `/api/admin/*` devuelve 403 con
 * `code: 'mfa_required'` hasta que la sesión pase a `aal2`.
 */

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

export async function GET() {
  const guard = await requireAdmin({ allowPendingMfa: true });
  if (!guard.ok) return guard.response;

  if (guard.devBypass && !guard.userId) {
    return NextResponse.json(
      {
        success: true,
        data: { enrolled: false, requiresChallenge: false, factorId: null, codesLeft: 0 },
      },
      NO_STORE
    );
  }

  const status = await readMfaStatus(createClient());
  const codesLeft = guard.userId ? await countRecoveryCodes(guard.userId) : 0;

  return NextResponse.json({ success: true, data: { ...status, codesLeft } }, NO_STORE);
}
