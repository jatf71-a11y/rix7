/**
 * Cuentas de socios: el vínculo entre una **cuenta** y una **corredora**.
 *
 * El panel de socios (`/socio`) exige tres cosas para abrirse: sesión, rol
 * `member` (o admin) y `app_metadata.partner_id` apuntando a una corredora
 * (ver `requireMember` en `lib/supabase/auth-guard.ts`). El rol y el vínculo
 * viven en `app_metadata`, que **solo el servidor** puede escribir.
 *
 * Hasta ahora nada del producto los escribía: el rol se reconocía en el código
 * pero no había forma de dárselo a una cuenta, así que el panel estaba
 * desplegado y era inalcanzable. Este módulo es la pieza que faltaba —y es puro
 * a propósito, para poder probar las cuatro reglas que deciden quién entra:
 *
 * 1. **Vincular es idempotente**: vincular dos veces la misma cuenta a la misma
 *    corredora no cambia nada; a otra corredora, la mueve.
 * 2. **Vincular no degrada a un admin**: si la cuenta ya es del equipo de Rix7,
 *    conserva su rol y solo se le agrega el vínculo. Ascender a alguien por
 *    accidente es peor que no poder vincularlo; degradar a un admin, también.
 * 3. **Desvincular devuelve a Visita**: el rol vuelve a `visitor` y el vínculo
 *    se borra, que es el estado por defecto de cualquier cuenta. El correo y el
 *    resto de `app_metadata` no se tocan.
 * 4. **La lectura no expone más de lo necesario**: de cada cuenta se publican
 *    id, correo, rol y corredora. Nada de `user_metadata`, tokens ni fechas de
 *    acceso.
 *
 * El emparejamiento por correo normaliza a minúsculas (los correos no
 * distinguen mayúsculas) y rechaza cualquier cosa que no sea una cadena con
 * forma de correo: un listado que empareje «a@b» con «A@B» a medias es peor que
 * uno que no empareje.
 */

import { resolvePartnerId, resolveRole, type AccountRole } from '@/lib/utils/roles';

/** Lo que el panel de administración necesita ver de una cuenta de socio. */
export interface SocioAccount {
  id: string;
  email: string;
  role: AccountRole;
  partnerId: string | null;
}

/** Tope de correo aceptado, el mismo criterio que el resto de las entradas. */
const MAX_EMAIL_LENGTH = 200;

/**
 * Normaliza un correo para comparar y para guardar: recorta, pasa a minúsculas
 * y exige una forma mínima (`algo@algo.algo`). Devuelve `null` si no sirve, en
 * vez de una cadena vacía, para que quien llame decida qué responder.
 */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > MAX_EMAIL_LENGTH) return null;
  // Forma mínima: no se pretende validar RFC 5322 — el correo tiene que poder
  // existir en el proveedor, y eso solo lo confirma el listado.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/** El correo de una cuenta de Supabase, ya normalizado (o `null`). */
function accountEmail(user: { email?: unknown }): string | null {
  return normalizeEmail(user?.email);
}

/**
 * Filtra el listado de cuentas y deja solo las que **tienen un rol** —es decir,
 * las que son socios o del equipo—, con el vínculo resuelto.
 *
 * Una cuenta sin rol es una Visita y no interesa acá: el panel administra
 * socios, no visitas. Las cuentas sin correo utilizable también se descartan:
 * sin correo no se las puede volver a encontrar para desvincular.
 *
 * @param {unknown[]} users cuentas crudas de la API de administración
 * @returns {SocioAccount[]} ordenadas por correo, para que el listado sea estable
 */
export function pickSocioAccounts(users: unknown): SocioAccount[] {
  if (!Array.isArray(users)) return [];

  const accounts: SocioAccount[] = [];
  for (const raw of users) {
    if (!raw || typeof raw !== 'object') continue;
    const user = raw as { id?: unknown; email?: unknown; app_metadata?: unknown };
    if (typeof user.id !== 'string' || !user.id) continue;

    const email = accountEmail(user);
    if (!email) continue;

    const role = resolveRole(user);
    if (role === 'visitor') continue;

    accounts.push({ id: user.id, email, role, partnerId: resolvePartnerId(user) });
  }

  return accounts.sort((a, b) => a.email.localeCompare(b.email));
}

/**
 * Busca una cuenta por correo en el listado crudo. Devuelve la cuenta cruda
 * (no la reducida) porque el `id` es lo que necesita `updateUserById`.
 */
export function findAccountByEmail(
  users: unknown,
  email: string
): { id: string; app_metadata?: unknown } | null {
  const wanted = normalizeEmail(email);
  if (!wanted || !Array.isArray(users)) return null;

  for (const raw of users) {
    if (!raw || typeof raw !== 'object') continue;
    const user = raw as { id?: unknown; email?: unknown; app_metadata?: unknown };
    if (typeof user.id !== 'string' || !user.id) continue;
    if (accountEmail(user) === wanted) return { id: user.id, app_metadata: user.app_metadata };
  }

  return null;
}

/**
 * `app_metadata` de una cuenta **vinculada** a una corredora.
 *
 * Conserva el resto de claves (hay metadata legítima ahí, como el rol del
 * equipo) y respeta el rol del equipo: si la cuenta ya es `admin`, se queda
 * como `admin` y solo gana el vínculo.
 */
export function linkMetadata(
  existing: unknown,
  partnerId: string
): Record<string, unknown> {
  const base =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};

  return {
    ...base,
    role: resolveRole({ app_metadata: base }) === 'admin' ? 'admin' : 'member',
    partner_id: partnerId,
  };
}

/**
 * `app_metadata` de una cuenta **desvinculada**: vuelve a Visita y pierde el
 * vínculo, sin tocar el resto (un admin sigue siendo admin).
 */
export function unlinkMetadata(existing: unknown): Record<string, unknown> {
  const base =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};

  return {
    ...base,
    role: resolveRole({ app_metadata: base }) === 'admin' ? 'admin' : 'visitor',
    partner_id: null,
  };
}

/**
 * El mensaje de error que ve quien administra, según lo que devolvió la API de
 * administración de Supabase.
 *
 * Se distinguen tres casos porque cada uno se arregla distinto: el correo no
 * existe (revisarlo), ya está vinculado a esa misma corredora (no hay nada que
 * hacer) y «la cuenta ya está lista» no es un error.
 */
export function describeLinkOutcome(
  email: string,
  partnerId: string,
  account: SocioAccount | null
): { status: number; error: string } | { ok: true; already: boolean } {
  if (!account) {
    return {
      status: 404,
      error: `No hay ninguna cuenta con el correo ${email}. La persona tiene que crear su cuenta primero (Google o enlace mágico) y después se vincula.`,
    };
  }
  if (account.role === 'member' && account.partnerId === partnerId) {
    return { ok: true, already: true };
  }
  return { ok: true, already: false };
}
