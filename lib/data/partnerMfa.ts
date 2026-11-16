/**
 * Quitar el segundo factor de una cuenta de socio.
 *
 * El caso real: la persona cambió de teléfono, perdió la app o se quedó sin los
 * códigos. Sin esta salida, su cuenta queda inutilizable: el panel exige el
 * código y nadie puede generarlo. El equipo lo resuelve desde la ficha del
 * socio, y la próxima vez que entre podrá volver a activarlo.
 *
 * Tres candados, porque esto debilita la seguridad de una cuenta:
 *
 * 1. Solo se toca una cuenta **vinculada a ese socio** (`app_metadata.partner_id`).
 *    Un correo mal escrito no puede apagar el 2FA de otra empresa.
 * 2. Se borran los factores, no la cuenta ni su sesión: al entrar de nuevo, el
 *    panel le vuelve a ofrecer activar la verificación.
 * 3. Queda **registro** de quién lo hizo (`admin_events`) y se le **avisa por
 *    correo** a la persona cuya cuenta quedó sin segundo factor.
 *
 * Necesita la clave de servicio: la API de administración de Auth solo la acepta
 * a ella. Sin esa clave se dice, en vez de devolver un «listo» falso.
 */

import { recordAdminEvent } from '@/lib/data/adminEvents';
import { getPartnerById } from '@/lib/data/partners-store';
import { clearMfaFactors, findUserByEmail, notifyMfaReset } from '@/lib/data/mfaFactors';
import { createServiceRoleClient, isServiceRoleConfigured } from '@/lib/supabase/admin';

/** Quién ejecuta la acción. Sale de la sesión del admin, no del cuerpo del pedido. */
export interface PartnerMfaResetActor {
  id?: string | null;
  email?: string | null;
}

export interface PartnerMfaResetResult {
  ok: boolean;
  /** Factores que se borraron. `0` = la cuenta no tenía ninguno. */
  removed?: number;
  email?: string;
  error?: string;
  code?: 'not_configured' | 'invalid' | 'not_found' | 'forbidden' | 'provider';
  /** Cómo terminó el aviso al socio. Solo aparece si se borró algo. */
  notified?: { sent: boolean; skipped: boolean; error?: string };
  /** Cómo terminó el registro de la acción. Solo aparece si se borró algo. */
  audit?: { ok: boolean; error?: string };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PARTNER_MFA_RESET_ACTION = 'partner_mfa.reset';

/** Borra todos los factores de la cuenta con ese correo, si es de ese socio. */
export async function resetPartnerMfa({
  partnerId,
  email,
  actor,
}: {
  partnerId: string;
  email: string;
  actor?: PartnerMfaResetActor;
}): Promise<PartnerMfaResetResult> {
  if (!isServiceRoleConfigured()) {
    return {
      ok: false,
      code: 'not_configured',
      error: 'Falta SUPABASE_SERVICE_ROLE_KEY: no se puede quitar el segundo factor.',
    };
  }

  const clean = email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(clean)) {
    return { ok: false, code: 'invalid', error: 'Escribí el correo de la cuenta a la que hay que quitarle el 2FA.' };
  }

  try {
    const admin = createServiceRoleClient();
    const user = await findUserByEmail(admin, clean);
    if (!user) {
      return { ok: false, code: 'not_found', error: 'No hay una cuenta con ese correo.' };
    }

    const linkedTo =
      typeof user.app_metadata?.partner_id === 'string' ? user.app_metadata.partner_id : null;
    if (linkedTo !== partnerId) {
      return {
        ok: false,
        code: 'forbidden',
        error: 'Esa cuenta no está vinculada a este socio: no se le puede tocar el segundo factor.',
      };
    }

    const removed = await clearMfaFactors(admin, user.id);
    if (removed === 0) {
      return { ok: true, removed: 0, email: clean };
    }

    // El registro va antes del correo: si el envío falla, la acción ya quedó
    // anotada con quién la hizo.
    const audit = await recordAdminEvent({
      action: PARTNER_MFA_RESET_ACTION,
      actorId: actor?.id ?? null,
      actorEmail: actor?.email ?? null,
      partnerId,
      targetEmail: clean,
      detail: { factors: removed },
    });

    const partner = await getPartnerById(partnerId).catch(() => undefined);
    const notified = await notifyMfaReset(clean, {
      companyName: partner?.name ?? partnerId,
      panelPath: '/socio/cuenta',
    });

    return {
      ok: true,
      removed,
      email: clean,
      notified,
      audit: { ok: audit.ok, ...(audit.error ? { error: audit.error } : {}) },
    };
  } catch (error) {
    return {
      ok: false,
      code: 'provider',
      error: error instanceof Error ? error.message : 'Error inesperado al quitar el segundo factor.',
    };
  }
}
