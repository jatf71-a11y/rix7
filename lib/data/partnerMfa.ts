/**
 * Quitar el segundo factor de una cuenta de socio.
 *
 * El caso real: la persona cambió de teléfono, perdió la app o se quedó sin los
 * códigos. Sin esta salida, su cuenta queda inutilizable: el panel exige el
 * código y nadie puede generarlo. El equipo lo resuelve desde la ficha del
 * socio, y la próxima vez que entre podrá volver a activarlo.
 *
 * Dos candados, porque esto debilita la seguridad de una cuenta:
 *
 * 1. Solo se toca una cuenta **vinculada a ese socio** (`app_metadata.partner_id`).
 *    Un correo mal escrito no puede apagar el 2FA de otra empresa.
 * 2. Se borran los factores, no la cuenta ni su sesión: al entrar de nuevo, el
 *    panel le vuelve a ofrecer activar la verificación.
 *
 * Necesita la clave de servicio: la API de administración de Auth solo la acepta
 * a ella. Sin esa clave se dice, en vez de devolver un «listo» falso.
 */

import { createServiceRoleClient, isServiceRoleConfigured } from '@/lib/supabase/admin';

export interface PartnerMfaResetResult {
  ok: boolean;
  /** Factores que se borraron. `0` = la cuenta no tenía ninguno. */
  removed?: number;
  email?: string;
  error?: string;
  code?: 'not_configured' | 'invalid' | 'not_found' | 'forbidden' | 'provider';
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Busca una cuenta por correo en la API de administración, página por página. */
async function findUserByEmail(
  admin: ReturnType<typeof createServiceRoleClient>,
  email: string
) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);

    const users = data?.users ?? [];
    const match = users.find((user) => (user.email ?? '').toLowerCase() === email);
    if (match) return match;
    if (users.length < 1000) return null;
  }
  return null;
}

/** Borra todos los factores de la cuenta con ese correo, si es de ese socio. */
export async function resetPartnerMfa({
  partnerId,
  email,
}: {
  partnerId: string;
  email: string;
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

    // El listado de cuentas no trae los factores; el detalle sí. Se pide para no
    // responder «no tenía verificación» cuando en realidad sí la tiene.
    const { data: detail, error: detailError } = await admin.auth.admin.getUserById(user.id);
    if (detailError) {
      return { ok: false, code: 'provider', error: `No se pudo leer la cuenta: ${detailError.message}` };
    }

    const factors = detail?.user?.factors ?? [];
    if (factors.length === 0) {
      return { ok: true, removed: 0, email: clean };
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      return { ok: false, code: 'not_configured', error: 'Falta la configuración de Supabase.' };
    }

    // La API de administración de GoTrue expone el borrado por factor; el SDK
    // todavía no lo envuelve, así que va por REST con la misma clave de servicio.
    for (const factor of factors) {
      const response = await fetch(
        `${url}/auth/v1/admin/users/${encodeURIComponent(user.id)}/factors/${encodeURIComponent(factor.id)}`,
        { method: 'DELETE', headers: { apikey: key, Authorization: `Bearer ${key}` } }
      );
      if (!response.ok) {
        return {
          ok: false,
          code: 'provider',
          error: `No se pudo quitar el factor (HTTP ${response.status}). Intentá de nuevo.`,
        };
      }
    }

    return { ok: true, removed: factors.length, email: clean };
  } catch (error) {
    return {
      ok: false,
      code: 'provider',
      error: error instanceof Error ? error.message : 'Error inesperado al quitar el segundo factor.',
    };
  }
}
