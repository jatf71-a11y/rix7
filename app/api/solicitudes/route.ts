import { NextRequest, NextResponse } from 'next/server';
import { solicitudPatchSchema, solicitudPostSchema } from '@/lib/api/schemas';
import { validateInput } from '@/lib/api/validate';
import {
  createSolicitud,
  getSolicitud,
  listSolicitudes,
  updateSolicitudStatus,
} from '@/lib/data/solicitudesStore';
import {
  autopilotSolicitud,
  isSocioRegistro,
  notifyManualDecision,
} from '@/lib/data/solicitudAutopilot';
import {
  isSolicitudKind,
  normalizeSolicitud,
  normalizeSolicitudPatch,
} from '@/lib/data/solicitudes';
import { requireAdmin } from '@/lib/supabase/auth-guard';
import { clientIpFrom, createRateLimiter } from '@/lib/utils/rateLimit';
import { buildSolicitudEmail, notifyOnSolicitud, type NotifiableSolicitud } from '@/lib/email/solicitudEmail';
import { sendEmail } from '@/lib/email/sendEmail';
import { SITE_URL } from '@/lib/site';

/**
 * `/api/solicitudes` — el otro extremo del botón «Publicar».
 *
 * POST es **público**: un propietario o una empresa que quiere registrarse no
 * tiene cuenta todavía, y es justamente quien deja sus datos. Se protege con
 * rate limit por IP y validando el cuerpo en dos capas: la forma (Zod) y la
 * semántica de cada camino (`normalizeSolicitud`). La política RLS vuelve a
 * exigir lo mínimo —tipo válido, contacto y consentimiento—.
 *
 * GET es **del equipo**: las solicitudes tienen datos personales y solo se
 * listan con rol admin. El filtro `?kind=` es para las pestañas del panel; un
 * tipo desconocido se rechaza en vez de devolver todo como si nada.
 *
 * PATCH es **del equipo**: el estado (`Recibida`, `En_Evaluacion`,
 * `Pendiente_Informacion`, `Aceptada`, `En_Alta`, `Rechazada` — los mismos del
 * alta de empresas) solo lo mueve quien revisa las solicitudes. La RLS de
 * UPDATE exige `is_rix7_admin()`, así que además del guard la base vuelve a
 * negar el cambio a cualquier otra cuenta.
 *
 * La respuesta no finge persistencia: `persisted:false` significa que se guardó
 * solo en memoria (desarrollo sin Supabase) y el panel lo muestra.
 *
 * Además, un registro de corredora, inmobiliaria o agente dispara un aviso por
 * correo a la bandeja del equipo (`SOLICITUDES_EMAIL_TO`) con los datos que se
 * acaban de guardar. Es **después** del alta y nunca la condiciona: si falta el
 * correo o Resend falla, la solicitud sigue guardada y el panel la muestra; el
 * fallo queda en el log. Una solicitud de propietario no manda aviso.
 *
 * Un registro de socio, además, se **evalúa y se mueve solo** en la misma
 * corrida (`lib/data/solicitudAutopilot.ts`): el sistema lo deja en `Aceptada` o
 * en `Pendiente_Informacion` y le escribe al solicitante. Si el autómata no
 * puede correr, la solicitud queda en `Recibida` —que es su estado real— y el
 * panel la sigue mostrando para que alguien la mire.
 */

const RATE_LIMIT_MAX = 12;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutos

const rateLimiter = createRateLimiter({ max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS });

export async function GET(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const kindParam = request.nextUrl.searchParams.get('kind');
  if (kindParam && !isSolicitudKind(kindParam)) {
    return NextResponse.json({ success: false, error: 'Tipo de solicitud inválido.' }, { status: 400 });
  }

  const { solicitudes, source, persistent } = await listSolicitudes(
    kindParam && isSolicitudKind(kindParam) ? kindParam : undefined
  );

  return NextResponse.json(
    { success: true, data: solicitudes, source, persistent },
    // Son datos personales del equipo: ningún caché intermedio debe guardarlos.
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function PATCH(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Cuerpo inválido' }, { status: 400 });
  }

  const shape = validateInput(solicitudPatchSchema, body);
  if (!shape.ok) {
    return NextResponse.json({ success: false, error: shape.error }, { status: 400 });
  }

  const patch = normalizeSolicitudPatch(body as { id?: unknown; status?: unknown });
  if (!patch.ok) {
    return NextResponse.json({ success: false, error: patch.error }, { status: 400 });
  }

  // Se lee el estado anterior para no volver a mandar el correo de una decisión
  // que ya se había tomado (un doble clic en el selector no es una etapa nueva).
  const previous = await getSolicitud(patch.id);
  const updated = await updateSolicitudStatus(patch.id, patch.status);

  if (!updated.ok) {
    // Un id que no existe es 404; un fallo de la base es 500. El panel necesita
    // distinguirlos para no mandar a recargar cuando el problema es otro.
    if (!updated.found) {
      return NextResponse.json(
        { success: false, error: updated.error ?? 'No encontramos esa solicitud.' },
        { status: 404 }
      );
    }

    console.error('[solicitudes] no se pudo actualizar el estado:', updated.error);
    return NextResponse.json(
      { success: false, error: 'No se pudo actualizar la solicitud.', persisted: updated.persisted },
      { status: 500 }
    );
  }

  // El selector manual sigue existiendo para las excepciones. Cuando esa
  // decisión deja el registro aprobado o rechazado, el solicitante se entera
  // igual que si la hubiera tomado el autómata.
  if (
    updated.solicitud &&
    previous?.status !== updated.solicitud.status &&
    (updated.solicitud.status === 'Aceptada' ||
      updated.solicitud.status === 'En_Alta' ||
      updated.solicitud.status === 'Rechazada')
  ) {
    try {
      await notifyManualDecision(updated.solicitud, updated.solicitud.status);
    } catch (error) {
      console.error('[solicitudes] no se pudo avisar la decisión manual:', error);
    }
  }

  return NextResponse.json(
    { success: true, solicitud: updated.solicitud ?? null, persisted: updated.persisted },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST(request: NextRequest) {
  if (rateLimiter.isLimited(clientIpFrom(request.headers))) {
    return NextResponse.json(
      { success: false, error: 'Demasiadas solicitudes. Intenta de nuevo en unos minutos.' },
      { status: 429, headers: { 'Retry-After': '600' } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Cuerpo inválido' }, { status: 400 });
  }

  // Primero la forma: objeto con los campos que el formulario puede mandar.
  const shape = validateInput(solicitudPostSchema, body);
  if (!shape.ok) {
    return NextResponse.json({ success: false, error: shape.error }, { status: 400 });
  }

  // Después la semántica: qué exige cada camino y con qué límites.
  const validation = normalizeSolicitud(body as Record<string, unknown>);
  if (!validation.ok) {
    return NextResponse.json({ success: false, error: validation.error }, { status: 400 });
  }

  const stored = await createSolicitud(validation.solicitud);

  if (!stored.ok) {
    console.error('[solicitudes] no se pudo guardar:', stored.error);
    return NextResponse.json(
      {
        success: false,
        error: 'No se pudo guardar la solicitud. Intenta de nuevo o escríbenos.',
        persisted: stored.persisted,
      },
      { status: 500 }
    );
  }

  if (notifyOnSolicitud(validation.solicitud)) {
    await notifyTeam(validation.solicitud, stored.id ?? null);
  }

  // Registro de socio: se evalúa y avanza (o pide datos) sin esperar a una
  // persona. Nunca hace fallar el alta: la solicitud ya está guardada y lo peor
  // que puede pasar es que quede en `Recibida` para que el equipo la mire.
  let autopilot: { status?: string; decision?: string; questions?: unknown } | null = null;
  if (isSocioRegistro(validation.solicitud.kind) && typeof stored.id === 'string') {
    try {
      const saved = await getSolicitud(stored.id);
      if (saved) {
        const result = await autopilotSolicitud(saved);
        if (result.ok) {
          autopilot = {
            status: result.status,
            decision: result.evaluation?.decision,
            questions: result.questions ?? [],
          };
        } else {
          console.warn('[solicitudes] el autómata no pudo evaluar:', result.error);
        }
      }
    } catch (error) {
      console.error('[solicitudes] error del autómata:', error);
    }
  }

  return NextResponse.json(
    {
      success: true,
      id: stored.id ?? null,
      persisted: stored.persisted,
      ...(autopilot ? { autopilot } : {}),
    },
    { status: 201 }
  );
}

/**
 * Avisa al equipo de una solicitud ya guardada.
 *
 * No lanza: la solicitud es lo importante y ya está en la base, así que un
 * problema con el correo se anota y se sigue. Sin destinatario configurado se
 * dice en el log en vez de inventar un envío, igual que el resto del correo del
 * sitio.
 */
async function notifyTeam(solicitud: NotifiableSolicitud, id: string | null): Promise<void> {
  const to = process.env.SOLICITUDES_EMAIL_TO?.trim();
  if (!to) {
    console.info('[solicitudes] aviso sin enviar: falta SOLICITUDES_EMAIL_TO.');
    return;
  }

  try {
    const email = buildSolicitudEmail({ solicitud, id, siteUrl: SITE_URL });
    const result = await sendEmail({ to, ...email });

    if (result.sent) {
      console.info('[solicitudes] aviso enviado:', solicitud.kind, id ?? 'sin folio');
    } else {
      console.warn(
        '[solicitudes] aviso no enviado:',
        result.skipped ? 'falta RESEND_API_KEY' : result.error
      );
    }
  } catch (error) {
    console.error('[solicitudes] error al avisar por correo:', error);
  }
}
