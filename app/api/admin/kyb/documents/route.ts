import { NextRequest, NextResponse } from 'next/server';

import { listDebtReports, type DebtReportOwner } from '@/lib/kyb/documents';
import { requireAdmin } from '@/lib/supabase/auth-guard';

/**
 * `GET /api/admin/kyb/documents?owner_kind=alta|solicitud&owner_id=…`
 *
 * Los informes de deudas de una ficha, con la URL firmada para abrir el PDF.
 * Es **del equipo**: la RLS no deja leer la tabla con la clave anónima, y el
 * archivo vive en un bucket privado, así que la única puerta es esta ruta con
 * sesión de administración.
 */
export async function GET(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const ownerKind = request.nextUrl.searchParams.get('owner_kind');
  const ownerId = (request.nextUrl.searchParams.get('owner_id') ?? '').trim();

  if (ownerKind !== 'alta' && ownerKind !== 'solicitud') {
    return NextResponse.json(
      { success: false, error: 'Indica si el informe es de un alta o de un registro.' },
      { status: 400 }
    );
  }
  if (!ownerId || ownerId.length > 120 || !/^[A-Za-z0-9._-]+$/.test(ownerId)) {
    return NextResponse.json(
      { success: false, error: 'La ficha indicada no es válida.' },
      { status: 400 }
    );
  }

  const documents = await listDebtReports(ownerKind as DebtReportOwner, ownerId);

  return NextResponse.json(
    { success: true, data: { documents } },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
