import { NextRequest, NextResponse } from 'next/server';
import {
  getAllPartners,
  addPartner,
  updatePartner,
  deletePartner,
} from '@/lib/data/partners-store';
import { Partner } from '@/lib/data/partners';

// GET /api/admin/partners — list all partners
export async function GET() {
  const partners = getAllPartners();
  return NextResponse.json({ success: true, data: partners });
}

// POST /api/admin/partners — create a new partner
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, slug, logo, description, website, color } = body;

    if (!name || !slug) {
      return NextResponse.json(
        { success: false, error: 'name and slug are required' },
        { status: 400 }
      );
    }

    const id = slug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    const newPartner: Partner = {
      id,
      slug: slug.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name,
      logo: logo || '',
      description: description || '',
      website: website || undefined,
      color: color || '#3B82F6',
    };

    const created = addPartner(newPartner);
    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid request body' },
      { status: 400 }
    );
  }
}

// PUT /api/admin/partners — update a partner
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id is required' },
        { status: 400 }
      );
    }

    const updated = updatePartner(id, updates);
    if (!updated) {
      return NextResponse.json(
        { success: false, error: 'Partner not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: updated });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid request body' },
      { status: 400 }
    );
  }
}

// DELETE /api/admin/partners?id=xxx — delete a partner
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json(
      { success: false, error: 'id is required' },
      { status: 400 }
    );
  }

  const deleted = deletePartner(id);
  if (!deleted) {
    return NextResponse.json(
      { success: false, error: 'Partner not found' },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true });
}
