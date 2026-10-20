import { NextRequest, NextResponse } from 'next/server';
import { listShareEvents } from '@/lib/data/shareEventsStore';
import { requireAdmin } from '@/lib/supabase/auth-guard';

/**
 * `GET /api/admin/share-events` — quién compartió qué, para el panel.
 *
 * Es el registro de identidad de los compartidos: nombre, correo y teléfono de
 * la visita registrada, más el canal y el enlace que puso a circular. Exige rol
 * admin porque son datos de personas; nunca se sirve al público.
 */

/** Tope de filas para que un panel no baje años de historial de una vez. */
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

export async function GET(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const raw = Number(new URL(request.url).searchParams.get('limit'));
  const limit =
    Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), MAX_LIMIT) : DEFAULT_LIMIT;

  const { events, source, persistent } = await listShareEvents(limit);

  return NextResponse.json({ success: true, data: events, source, persistent });
}
