import { NextResponse } from 'next/server';

import { createRecoveryCodes } from '@/lib/data/adminMfa';
import { requireAdmin } from '@/lib/supabase/auth-guard';

/**
 * `POST /api/admin/mfa/recovery-codes` — generar (o regenerar) los códigos de
 * recuperación de la propia cuenta.
 *
 * Exige sesión **ya verificada** con el segundo factor: los códigos son la llave
 * de repuesto del 2FA, así que no se emiten desde una sesión que todavía no lo
 * pasó. Los códigos vuelven **una sola vez** en la respuesta y no se guardan en
 * ningún lado en claro; si se pierden, se generan de nuevo (y el lote anterior
 * deja de servir).
 */

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

export async function POST() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  if (!guard.userId) {
    return NextResponse.json(
      { success: false, error: 'Esta acción necesita una cuenta con sesión real.' },
      { status: 400 }
    );
  }

  const result = await createRecoveryCodes(guard.userId);
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: 503 });
  }

  return NextResponse.json({ success: true, codes: result.codes }, NO_STORE);
}
