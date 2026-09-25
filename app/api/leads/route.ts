import { NextRequest, NextResponse } from 'next/server';
import { createLead, listLeads } from '@/lib/data/leads-store';
import { normalizeLead } from '@/lib/data/leads';
import { requireAdmin } from '@/lib/supabase/auth-guard';
import { clientIpFrom, createRateLimiter } from '@/lib/utils/rateLimit';

/**
 * `/api/leads` — contactos de visitas interesadas.
 *
 * POST es **público**: la visita no tiene cuenta y es justamente ella quien deja
 * sus datos. Se protege con rate limit por IP y validando el cuerpo; la política
 * RLS de la tabla vuelve a validar la forma del dato.
 *
 * GET es **del equipo**: exige rol admin, porque los contactos nunca son
 * públicos.
 */

/**
 * Una misma persona puede tocar varios canales de la misma ficha, así que el
 * cupo es generoso pero no infinito. La ventana es larga a propósito: un script
 * que llene la tabla no se frena con una ventana corta.
 */
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutos

const rateLimiter = createRateLimiter({ max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS });

// GET /api/leads — listado para el panel (solo admin)
export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { leads, source, persistent } = await listLeads();

  return NextResponse.json({ success: true, data: leads, source, persistent });
}

// POST /api/leads — alta de un contacto (público)
export async function POST(request: NextRequest) {
  if (rateLimiter.isLimited(clientIpFrom(request.headers))) {
    return NextResponse.json(
      { success: false, error: 'Demasiadas solicitudes' },
      { status: 429, headers: { 'Retry-After': '600' } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Cuerpo inválido' }, { status: 400 });
  }

  const validation = normalizeLead(body);
  if (!validation.ok) {
    return NextResponse.json({ success: false, error: validation.error }, { status: 400 });
  }

  const result = await createLead(validation.lead);

  if (!result.ok) {
    // El contacto es importante: si no se pudo guardar, el cliente lo ve en el
    // log y el visitante no se queda con un falso "listo".
    return NextResponse.json(
      { success: false, error: 'No se pudo registrar el contacto', persisted: result.persisted },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { success: true, persisted: result.persisted },
    { status: 201 }
  );
}
