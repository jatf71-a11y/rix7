import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient, isServiceRoleConfigured } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/supabase/auth-guard';
import { socioLinkSchema, socioUnlinkSchema } from '@/lib/api/schemas';
import { searchParamsToObject, validateInput } from '@/lib/api/validate';
import {
  describeLinkOutcome,
  findAccountByEmail,
  linkMetadata,
  pickSocioAccounts,
  unlinkMetadata,
} from '@/lib/data/socioAccounts';

/**
 * Cuentas de socios: vincular una **cuenta** del portal con una **corredora**.
 *
 * Es la pieza que faltaba entre dos cosas que ya existían por separado: el
 * panel `/socio` (que exige `app_metadata.role = member` y
 * `app_metadata.partner_id`) y `/admin/empresas` (que administra las filas de
 * `partners`). Sin esta ruta, el panel estaba desplegado y era inalcanzable:
 * nada del producto escribía ese `app_metadata`.
 *
 * Tres decisiones que conviene tener presentes:
 *
 * 1. **Solo admin.** El rol y el vínculo son claims que el usuario no puede
 *    editar por sí mismo; dárselos es exactamente el acto de administración que
 *    esta ruta protege (`requireAdmin`).
 * 2. **Necesita la clave de servicio.** `app_metadata` se escribe por la API de
 *    administración de Auth, que no acepta la clave anónima ni una sesión de
 *    usuario. Sin `SUPABASE_SERVICE_ROLE_KEY` la ruta responde 503 y **no**
 *    finge que vinculó nada — el detalle de qué falta vive en `/api/health`.
 * 3. **Vincular no degrada a un admin** y desvincular deja la cuenta como
 *    Visita, sin tocar el resto de su metadata (reglas en
 *    `lib/data/socioAccounts.ts`, probadas aparte).
 *
 * La ruta no expone nada más de una cuenta que id, correo, rol y corredora.
 */

/** Cuentas por página al listar. */
const ACCOUNTS_PER_PAGE = 200;

/**
 * Tope de páginas al buscar por correo (1000 cuentas). La API de administración
 * pagina y **no** sabe buscar por correo, así que hay un recorrido; el tope
 * evita que un listado enorme convierta un alta en una consulta sin fin. Si se
 * alcanza, se dice: un «no existe esa cuenta» falso es peor que un error.
 */
const MAX_PAGES = 5;

/**
 * Recorre el listado de cuentas hasta agotarlo (o hasta el tope).
 *
 * @param {{ auth: { admin: { listUsers: (options: { page: number, perPage: number }) => Promise<any> } } }} client
 */
async function listAccounts(client: any) {
  const users: unknown[] = [];
  let truncated = false;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({
      page,
      perPage: ACCOUNTS_PER_PAGE,
    });

    if (error) return { ok: false as const, error: error.message ?? 'error desconocido' };

    const batch: unknown[] = Array.isArray(data?.users) ? data.users : [];
    users.push(...batch);

    if (batch.length < ACCOUNTS_PER_PAGE) return { ok: true as const, users, truncated: false };
  }

  truncated = true;
  return { ok: true as const, users, truncated };
}

/** Respuesta cuando falta la clave de servicio: se dice qué falta y qué hacer. */
function serviceRoleMissing() {
  return NextResponse.json(
    {
      success: false,
      error:
        'Falta SUPABASE_SERVICE_ROLE_KEY en este despliegue: sin ella no se puede leer ni escribir el rol de las cuentas. El detalle está en /api/health.',
    },
    { status: 503 }
  );
}

// GET /api/admin/socios — cuentas que hoy son socias (o del equipo)
export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  if (!isServiceRoleConfigured()) return serviceRoleMissing();

  const listed = await listAccounts(createServiceRoleClient());
  if (!listed.ok) {
    return NextResponse.json(
      { success: false, error: `No se pudo leer las cuentas: ${listed.error}` },
      { status: 502 }
    );
  }

  return NextResponse.json({
    success: true,
    data: pickSocioAccounts(listed.users),
    truncated: listed.truncated,
  });
}

// POST /api/admin/socios — vincula una cuenta a una corredora
export async function POST(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  if (!isServiceRoleConfigured()) return serviceRoleMissing();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
  }

  const validation = validateInput(socioLinkSchema, body);
  if (!validation.ok) {
    return NextResponse.json({ success: false, error: validation.error }, { status: 400 });
  }

  const { email, partner_id: partnerId } = validation.data;
  const client = createServiceRoleClient();

  // La corredora tiene que existir en la base: el vínculo se valida contra la
  // tabla (no contra el catálogo en memoria), porque es la tabla la que usan
  // las políticas RLS y la que ve el panel.
  const partner = await client.from('partners').select('id').eq('id', partnerId).maybeSingle();
  if (partner.error) {
    return NextResponse.json(
      { success: false, error: `No se pudo verificar la corredora: ${partner.error.message}` },
      { status: 502 }
    );
  }
  if (!partner.data) {
    return NextResponse.json(
      { success: false, error: `No existe la corredora «${partnerId}» en la base.` },
      { status: 404 }
    );
  }

  const listed = await listAccounts(client);
  if (!listed.ok) {
    return NextResponse.json(
      { success: false, error: `No se pudo leer las cuentas: ${listed.error}` },
      { status: 502 }
    );
  }

  const account = findAccountByEmail(listed.users, email);
  if (!account) {
    const outcome = describeLinkOutcome(email, partnerId, null);
    return NextResponse.json(
      {
        success: false,
        error: 'error' in outcome ? outcome.error : 'No se encontró la cuenta.',
        truncated: listed.truncated,
      },
      { status: 'status' in outcome ? outcome.status : 404 }
    );
  }

  // Si ya estaba vinculada a esa misma corredora no se toca nada: reescribir la
  // metadata solo para dejarla igual haría rotar el JWT sin motivo.
  const current = pickSocioAccounts([{ id: account.id, email, app_metadata: account.app_metadata }])[0] ?? null;
  const outcome = describeLinkOutcome(email, partnerId, current);
  if ('ok' in outcome && outcome.already) {
    return NextResponse.json({ success: true, data: current, already: true });
  }

  const { data, error } = await client.auth.admin.updateUserById(account.id, {
    app_metadata: linkMetadata(account.app_metadata, partnerId),
  });

  if (error) {
    return NextResponse.json(
      { success: false, error: `No se pudo vincular la cuenta: ${error.message}` },
      { status: 502 }
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      id: account.id,
      email,
      role: linkMetadata(data?.user?.app_metadata, partnerId).role,
      partnerId,
    },
    // El cambio vive en el token: hasta que la cuenta vuelva a iniciar sesión
    // (o se refresque su sesión), su navegador sigue con el rol viejo.
    note: 'La cuenta tiene que volver a iniciar sesión para que el panel le aparezca.',
  });
}

// DELETE /api/admin/socios?email=... — quita el vínculo y devuelve la cuenta a Visita
export async function DELETE(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  if (!isServiceRoleConfigured()) return serviceRoleMissing();

  const validation = validateInput(
    socioUnlinkSchema,
    searchParamsToObject(new URL(request.url).searchParams)
  );
  if (!validation.ok) {
    return NextResponse.json({ success: false, error: validation.error }, { status: 400 });
  }

  const { email } = validation.data;
  const client = createServiceRoleClient();

  const listed = await listAccounts(client);
  if (!listed.ok) {
    return NextResponse.json(
      { success: false, error: `No se pudo leer las cuentas: ${listed.error}` },
      { status: 502 }
    );
  }

  const account = findAccountByEmail(listed.users, email);
  if (!account) {
    return NextResponse.json(
      {
        success: false,
        error: `No hay ninguna cuenta con el correo ${email}.`,
        truncated: listed.truncated,
      },
      { status: 404 }
    );
  }

  const { error } = await client.auth.admin.updateUserById(account.id, {
    app_metadata: unlinkMetadata(account.app_metadata),
  });

  if (error) {
    return NextResponse.json(
      { success: false, error: `No se pudo desvincular la cuenta: ${error.message}` },
      { status: 502 }
    );
  }

  return NextResponse.json({ success: true, data: { id: account.id, email } });
}
