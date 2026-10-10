import { NextRequest, NextResponse } from 'next/server';
import { requireMember } from '@/lib/supabase/auth-guard';
import {
  publicationPostSchema,
  publicationPutSchema,
  propertyIdParamsSchema,
} from '@/lib/api/schemas';
import { searchParamsToObject, validateInput } from '@/lib/api/validate';
import {
  createPublication,
  deletePublication,
  listPartnerPublications,
  updatePublication,
} from '@/lib/data/propertiesStore';

// Panel del socio: las cuatro operaciones exigen rol member/admin **y** una
// corredora vinculada (el guard devuelve 401/403 con el motivo), y toda
// consulta/escritura va acotada por `guard.partnerId`. El filtro no depende de
// que la RLS esté aplicada: es la segunda cerradura (la primera es la
// migración 0014) y evita que un fallo de configuración convierta el panel en
// una ventana al portal entero.
//
// Las respuestas traen `persistent`: cuando es false, lo que se acaba de
// guardar vive solo en memoria (desarrollo sin Supabase) y la UI lo avisa.

/** Motivo del store → estado HTTP. */
function statusFor(reason: 'not_found' | 'database' | undefined): number {
  return reason === 'not_found' ? 404 : 500;
}

/** Sin caché: cada socio ve las suyas y el listado cambia con cada escritura. */
const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

// GET /api/partner/properties — publicaciones de la corredora vinculada
export async function GET() {
  const guard = await requireMember();
  if (!guard.ok) return guard.response;

  const { properties, source, persistent } = await listPartnerPublications(guard.partnerId);

  return NextResponse.json(
    { success: true, data: properties, source, persistent },
    NO_STORE
  );
}

// POST /api/partner/properties — alta de una publicación
export async function POST(request: NextRequest) {
  const guard = await requireMember();
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json();

    // La forma y los límites los declara `publicationPostSchema`; el store no
    // recibe nada que no haya pasado por Zod.
    const validation = validateInput(publicationPostSchema, body);
    if (!validation.ok) {
      return NextResponse.json({ success: false, error: validation.error }, { status: 400 });
    }

    const result = await createPublication(validation.data, {
      partnerId: guard.partnerId,
      userId: guard.userId,
    });

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error, persisted: result.persisted },
        { status: statusFor(result.reason) }
      );
    }

    return NextResponse.json(
      { success: true, data: result.property, persisted: result.persisted },
      { status: 201 }
    );
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
  }
}

// PUT /api/partner/properties — edición de una publicación propia
export async function PUT(request: NextRequest) {
  const guard = await requireMember();
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json();

    const validation = validateInput(publicationPutSchema, body);
    if (!validation.ok) {
      return NextResponse.json({ success: false, error: validation.error }, { status: 400 });
    }

    const { id, ...patch } = validation.data;
    const result = await updatePublication(id, guard.partnerId, patch);

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error, persisted: result.persisted },
        { status: statusFor(result.reason) }
      );
    }

    return NextResponse.json({
      success: true,
      data: result.property,
      persisted: result.persisted,
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
  }
}

// DELETE /api/partner/properties?id=xxx — baja de una publicación propia
export async function DELETE(request: NextRequest) {
  const guard = await requireMember();
  if (!guard.ok) return guard.response;

  const validation = validateInput(
    propertyIdParamsSchema,
    searchParamsToObject(new URL(request.url).searchParams)
  );
  if (!validation.ok) {
    return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });
  }

  const result = await deletePublication(validation.data.id, guard.partnerId);

  if (!result.ok) {
    return NextResponse.json(
      { success: false, error: result.error, persisted: result.persisted },
      { status: statusFor(result.reason) }
    );
  }

  return NextResponse.json({ success: true, persisted: result.persisted });
}
