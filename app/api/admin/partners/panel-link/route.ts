import { NextResponse } from 'next/server';

import { getPartnerById } from '@/lib/data/partners-store';
import { buildPanelLinkEmail } from '@/lib/email/panelLinkEmail';
import { sendEmail } from '@/lib/email/sendEmail';
import { SITE_URL } from '@/lib/site';
import { requireAdmin } from '@/lib/supabase/auth-guard';

/**
 * `POST /api/admin/partners/panel-link` — mandar al socio el enlace de su panel.
 *
 * El destinatario sale de la ficha (`contact.email`), nunca del cuerpo: el
 * equipo decide **a quién** le manda su propio enlace, no a qué dirección. Si la
 * ficha no tiene correo, se dice en vez de inventar uno.
 *
 * Un `skipped` (falta `RESEND_API_KEY`) no es un envío: responde 503, igual que
 * el resto de los correos del proyecto.
 */

const PARTNER_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const partnerId = typeof body?.partnerId === 'string' ? body.partnerId.trim() : '';

  if (!partnerId || partnerId.length > 120 || !PARTNER_ID_PATTERN.test(partnerId)) {
    return NextResponse.json(
      { success: false, error: 'El socio indicado no es válido.' },
      { status: 400 }
    );
  }

  const partner = await getPartnerById(partnerId).catch(() => undefined);
  if (!partner) {
    return NextResponse.json(
      { success: false, error: 'Ese socio no existe.' },
      { status: 404 }
    );
  }

  const to = partner.contact?.email?.trim();
  if (!to) {
    return NextResponse.json(
      { success: false, error: 'La ficha no tiene correo de contacto: agrégalo y vuelve a intentar.' },
      { status: 400 }
    );
  }

  const panelUrl = `${SITE_URL}/socio/${partner.slug || partner.id}`;
  const email = buildPanelLinkEmail({ companyName: partner.name, panelUrl, siteUrl: SITE_URL });
  const result = await sendEmail({ to, template: 'panel_link', ...email });

  if (result.skipped) {
    return NextResponse.json(
      {
        success: false,
        skipped: true,
        error: 'Falta RESEND_API_KEY: el correo no se envió. Copia el enlace y mándalo a mano.',
      },
      { status: 503 }
    );
  }

  if (!result.sent) {
    return NextResponse.json(
      { success: false, error: result.error ?? 'No se pudo enviar el correo.' },
      { status: 502 }
    );
  }

  return NextResponse.json(
    { success: true, sent: true, to, panelUrl, outboxId: result.outboxId ?? null },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
