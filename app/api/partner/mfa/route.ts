import { NextResponse } from 'next/server';

import { readMfaStatus } from '@/lib/supabase/mfa';
import { createClient } from '@/lib/supabase/server';
import { requireMember } from '@/lib/supabase/auth-guard';

/**
 * `GET /api/partner/mfa` — si esta cuenta tiene 2FA y si esta sesión ya lo pasó.
 *
 * Es la única ruta del panel que responde estando pendiente el segundo factor:
 * es la que le dice a la pantalla que tiene que pedir el código. El resto de
 * `/api/partner/*` devuelve 403 con `code: 'mfa_required'` mientras no se
 * verifique, así que esconder el formulario en el cliente no alcanzaría.
 */

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

export async function GET() {
  const guard = await requireMember({ allowPendingMfa: true });
  if (!guard.ok) return guard.response;

  // En desarrollo sin Supabase no hay sesión real ni factores: responder el
  // estado vacío evita salir a la red contra un proyecto que no existe.
  if (guard.devBypass) {
    return NextResponse.json(
      {
        success: true,
        data: {
          enrolled: false,
          requiresChallenge: false,
          factorId: null,
          currentLevel: null,
          nextLevel: null,
        },
      },
      NO_STORE
    );
  }

  const status = await readMfaStatus(createClient());

  return NextResponse.json({ success: true, data: status }, NO_STORE);
}
