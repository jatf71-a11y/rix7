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
import { revalidatePublicationSurfaces } from '@/lib/data/publicSurfaces';
import { situacionDePartner } from '@/lib/data/cobranzaStore';
import { syncPartnerCca } from '@/lib/data/ccaLedger';

// Panel del socio: las cuatro operaciones exigen rol member/admin **y** una
// corredora vinculada (el guard devuelve 401/403 con el motivo), y toda
// consulta/escritura va acotada por `guard.partnerId`. El filtro no depende de
// que la RLS esté aplicada: es la segunda cerradura (la primera es la
// migración 0014) y evita que un fallo de configuración convierta el panel en
// una ventana al portal entero.
//
// Las respuestas traen `persistent`: cuando es false, lo que se acaba de
// guardar vive solo en memoria (desarrollo sin Supabase) y la UI lo avisa.
//
// Cada escritura que sale bien invalida lo público que cambió (la página de
// empresa de la corredora, su ficha y su landing compartible): las tres se
// sirven con ISR, así que sin esto la corredora publicaba y su propia página
// seguía con el listado anterior. Ver `lib/data/publicSurfaces.ts`.

/** Motivo del store → estado HTTP. */
function statusFor(reason: 'not_found' | 'database' | undefined): number {
  return reason === 'not_found' ? 404 : 500;
}

/**
 * Recalcula la cuenta corriente del CCA después de mover la cartera del socio.
 *
 * No es decorativo: es el aviso que promete la autorización del alta. Si el
 * monto mensual cambió, queda el movimiento y sale el correo al socio. Un fallo
 * acá **no** revierte la publicación —ya está guardada— así que se informa en la
 * respuesta (`cca.error`) y se sigue.
 */
async function syncCca(partnerId: string) {
  const result = await syncPartnerCca(partnerId, { reason: 'cartera' });
  if (!result.ok) console.error('[cca] no se pudo recalcular la cuenta del socio:', result.error);
  return result.ok
    ? {
        changed: result.changed,
        amountClp: result.amountClp,
        emailed: result.emailed,
      }
    : { changed: false, amountClp: result.amountClp, emailed: false, error: result.error };
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

  // Cuenta morosa: no se publica nada nuevo. Las fichas que ya tenía tampoco se
  // ven en el portal (0031 las filtra en los RPC), así que esto no es una traba
  // suelta: es la misma regla del otro lado.
  const situacion = await situacionDePartner(guard.partnerId);
  if (situacion?.estado === 'moroso') {
    return NextResponse.json(
      {
        success: false,
        error:
          'Tu cuenta está morosa: las publicaciones quedan en pausa hasta que regularices el pago.',
        code: 'moroso',
        deudaClp: situacion.deudaClp,
      },
      { status: 409, ...NO_STORE }
    );
  }

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

    await revalidatePublicationSurfaces(guard.partnerId, result.property?.id);
    const cca = await syncCca(guard.partnerId);

    return NextResponse.json(
      { success: true, data: result.property, persisted: result.persisted, cca },
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

    await revalidatePublicationSurfaces(guard.partnerId, result.property?.id ?? id);
    const cca = await syncCca(guard.partnerId);

    return NextResponse.json({
      success: true,
      data: result.property,
      persisted: result.persisted,
      cca,
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

  await revalidatePublicationSurfaces(guard.partnerId, validation.data.id);
  const cca = await syncCca(guard.partnerId);

  return NextResponse.json({ success: true, persisted: result.persisted, cca });
}
