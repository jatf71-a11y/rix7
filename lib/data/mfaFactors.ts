/**
 * Operaciones compartidas para quitar el segundo factor de una cuenta de Auth.
 *
 * Las usan el reset del socio (`partnerMfa.ts`), el reset del equipo y el canje
 * de códigos de recuperación (`adminMfa.ts`). Todas van con la clave de servicio.
 */

import { buildMfaResetEmail } from '@/lib/email/mfaResetEmail';
import { sendEmail } from '@/lib/email/sendEmail';
import { SITE_URL } from '@/lib/site';
import { createServiceRoleClient } from '@/lib/supabase/admin';

export type ServiceRoleClient = ReturnType<typeof createServiceRoleClient>;

export interface AuthUserLite {
  id: string;
  email?: string | null;
  app_metadata?: Record<string, unknown> | null;
}

/** Busca una cuenta por correo, página por página. `null` si no existe. */
export async function findUserByEmail(
  admin: ServiceRoleClient,
  email: string
): Promise<AuthUserLite | null> {
  const wanted = email.trim().toLowerCase();
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);

    const users = data?.users ?? [];
    const match = users.find((user) => (user.email ?? '').toLowerCase() === wanted);
    if (match) return match;
    if (users.length < 1000) return null;
  }
  return null;
}

/**
 * Borra todos los factores de la cuenta. Devuelve cuántos borró.
 *
 * Si no puede leer la cuenta o algún borrado falla, lanza el error: nunca
 * responde «sin factores» por un fallo de la API.
 */
export async function clearMfaFactors(admin: ServiceRoleClient, userId: string): Promise<number> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error) throw new Error(`No se pudo leer la cuenta: ${error.message}`);

  const factors = data?.user?.factors ?? [];
  if (factors.length === 0) return 0;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Falta la configuración de Supabase.');

  // GoTrue expone el borrado por factor en la API de administración; el SDK no
  // lo envuelve todavía, así que va por REST con la misma clave de servicio.
  for (const factor of factors) {
    const response = await fetch(
      `${url}/auth/v1/admin/users/${encodeURIComponent(userId)}/factors/${encodeURIComponent(factor.id)}`,
      { method: 'DELETE', headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!response.ok) {
      throw new Error(`No se pudo quitar el factor (HTTP ${response.status}). Intentá de nuevo.`);
    }
  }
  return factors.length;
}

/** Aviso por correo a la cuenta cuyo segundo factor fue quitado. Nunca lanza. */
export async function notifyMfaReset(
  email: string,
  panel: { companyName: string; panelPath: string }
): Promise<{ sent: boolean; skipped: boolean; error?: string }> {
  const sent = await sendEmail({
    to: email,
    template: 'mfa_reset',
    ...buildMfaResetEmail({
      companyName: panel.companyName,
      panelUrl: `${SITE_URL}${panel.panelPath}`,
      siteUrl: SITE_URL,
    }),
  });
  return { sent: sent.sent, skipped: sent.skipped, ...(sent.error ? { error: sent.error } : {}) };
}
