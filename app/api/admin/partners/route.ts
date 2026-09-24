import { NextRequest, NextResponse } from 'next/server';
import {
  createPartner,
  deletePartner,
  listPartners,
  updatePartner,
} from '@/lib/data/partners-store';
import { Partner } from '@/lib/data/partners';
import { slugify } from '@/lib/utils/text';
import { requireAdmin } from '@/lib/supabase/auth-guard';

// Todas las operaciones de este recurso dan de alta o modifican corredoras
// inscritas, así que exigen rol admin (en desarrollo se permite con el bypass
// documentado en `requireAdmin`).
//
// Las respuestas incluyen `persistent`: cuando es false, lo que se acaba de
// guardar vive solo en memoria (desarrollo sin Supabase). La UI lo avisa en vez
// de dar a entender que quedó registrado.

/** Motivo del store → estado HTTP. */
function statusFor(reason: 'not_found' | 'duplicate' | 'database' | undefined): number {
  switch (reason) {
    case 'not_found':
      return 404;
    case 'duplicate':
      return 409;
    default:
      return 500;
  }
}

// GET /api/admin/partners — list all partners
export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { partners, source, persistent, emptyTable } = await listPartners();

  return NextResponse.json({
    success: true,
    data: partners,
    // De dónde salieron y si las escrituras se guardarán de verdad.
    source,
    persistent,
    emptyTable,
  });
}

// POST /api/admin/partners — create a new partner
export async function POST(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json();
    const { name, slug, logo, description, website, color, contact } = body;

    if (!name || !slug) {
      return NextResponse.json(
        { success: false, error: 'name and slug are required' },
        { status: 400 }
      );
    }

    const newPartner: Partner = {
      id: slugify(slug),
      slug: slugify(slug),
      name,
      logo: logo || '',
      description: description || '',
      website: website || undefined,
      color: color || '#3B82F6',
      // Datos de contacto de la corredora: alimentan los botones Llamar /
      // WhatsApp / Mail de la ficha. Se normalizan a cadena vacía si faltan.
      contact: {
        phone: contact?.phone || '',
        whatsapp: contact?.whatsapp || '',
        email: contact?.email || '',
      },
    };

    const result = await createPartner(newPartner);
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error, persisted: result.persisted },
        { status: statusFor(result.reason) }
      );
    }

    return NextResponse.json(
      { success: true, data: result.partner, persisted: result.persisted },
      { status: 201 }
    );
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid request body' },
      { status: 400 }
    );
  }
}

// PUT /api/admin/partners — update a partner
export async function PUT(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id is required' },
        { status: 400 }
      );
    }

    const result = await updatePartner(id, updates);
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error, persisted: result.persisted },
        { status: statusFor(result.reason) }
      );
    }

    return NextResponse.json({
      success: true,
      data: result.partner,
      persisted: result.persisted,
    });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid request body' },
      { status: 400 }
    );
  }
}

// DELETE /api/admin/partners?id=xxx — delete a partner
export async function DELETE(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const id = request.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json(
      { success: false, error: 'id is required' },
      { status: 400 }
    );
  }

  const result = await deletePartner(id);
  if (!result.ok) {
    return NextResponse.json(
      { success: false, error: result.error, persisted: result.persisted },
      { status: statusFor(result.reason) }
    );
  }

  return NextResponse.json({ success: true, persisted: result.persisted });
}
