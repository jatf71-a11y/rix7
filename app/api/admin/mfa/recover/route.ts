import { NextResponse } from 'next/server';

import { redeemRecoveryCode } from '@/lib/data/adminMfa';
import { requireAdmin } from '@/lib/supabase/auth-guard';

/**
 * `POST /api/admin/mfa/recover` — canjear un código de recuperación.
 *
 * Es la salida cuando la persona perdió el teléfono: no puede pasar el desafío
 * `aal2`, así que esta ruta **sí** acepta una sesión en `aal1` (si no, sería
 * inalcanzable justo cuando se necesita). El código se verifica en el servidor,
 * se marca usado y recién ahí se quita el factor TOTP de la cuenta; el aviso
 * queda en `admin_events` con la acción `admin_mfa.recovery_code`.
 */

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

export async function POST(request: Request) {
  const guard = await requireAdmin({ allowPendingMfa: true });
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const code = typeof body?.code === 'string' ? body.code : '';

  if (!guard.userId) {
    return NextResponse.json(
      { success: false, error: 'Esta acción necesita una cuenta con sesión real.' },
      { status: 400 }
    );
  }

  const result = await redeemRecoveryCode({
    userId: guard.userId,
    email: guard.email,
    code,
    note: 'canje desde /admin/cuenta',
  });

  if (!result.ok) {
    const status = result.code === 'not_configured' ? 503 : result.code === 'invalid' ? 400 : 500;
    return NextResponse.json(
      { success: false, error: result.error ?? 'No se pudo usar el código.', audit: result.audit },
      { status }
    );
  }

  return NextResponse.json(
    {
      success: true,
      removed: result.removed ?? 0,
      audit: result.audit,
      // El factor ya no existe: la sesión deja de exigir `aal2` al recargar.
      message: 'Listo: quitamos el segundo factor de tu cuenta. Entrá y volvé a activarlo.',
    },
    NO_STORE
  );
}
