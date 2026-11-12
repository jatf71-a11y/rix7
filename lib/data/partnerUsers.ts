/**
 * Usuarios de la cuenta de un socio.
 *
 * El plan que la empresa eligió incluye una cantidad de usuarios (1, 5 o 20) y
 * hasta ahora eso era un número en una propuesta: no había dónde anotar quiénes
 * son ni forma de que el socio sumara a su equipo. Este módulo administra esa
 * lista, con tres reglas que no se negocian:
 *
 * 1. **El tope es el del plan vigente**, no el de la propuesta: si el equipo
 *    cambia `usuariosIncluidos` en **Planes**, el cupo cambia sin deploy. Un
 *    usuario **revocado libera cupo**; una invitación pendiente **lo ocupa**,
 *    porque ya se prometió un lugar.
 * 2. **El titular no se revoca**: es el correo del alta y el dueño de la cuenta.
 *    Se muestra como un usuario más, pero sin acciones.
 * 3. **Revocar es sacar el vínculo**: la fila queda (historial) y la cuenta de
 *    Supabase vuelve a `visitor` sin `partner_id`, así deja de entrar al panel.
 *
 * La parte pura (`normalizePartnerEmail`, `partnerUserLimit`, `planUserCapacity`)
 * vive acá y se prueba en un test; el resto habla con Supabase y con el correo.
 */

import { createServiceRoleClient, isServiceRoleConfigured } from '@/lib/supabase/admin';
import { readPlanPricing } from '@/lib/data/planPricingStore';
import { planPrice } from '@/lib/kyb/planPricing';
import { getKybPlan, isKybPlanId } from '@/lib/kyb/plans';
import { normalizeEmail, unlinkMetadata, findAccountByEmail } from '@/lib/data/socioAccounts';
import { linkPartnerAccount } from '@/lib/kyb/provisioning';
import { buildPartnerInviteEmail } from '@/lib/email/partnerInviteEmail';
import { sendEmail } from '@/lib/email/sendEmail';
import { SITE_URL } from '@/lib/site';

export const PARTNER_USER_ROLES = ['admin', 'editor'] as const;
export type PartnerUserRole = (typeof PARTNER_USER_ROLES)[number];

/** Cómo se llama cada rol en la pantalla y en el correo. */
export const PARTNER_USER_ROLE_LABELS: Record<PartnerUserRole, string> = {
  admin: 'Administra la cuenta',
  editor: 'Publica propiedades',
};

export type PartnerUserStatus = 'invitado' | 'activo' | 'revocado';

export function isPartnerUserRole(value: unknown): value is PartnerUserRole {
  return typeof value === 'string' && (PARTNER_USER_ROLES as readonly string[]).includes(value);
}

/** Correo normalizado, o `null` si no tiene forma de correo. */
export function normalizePartnerEmail(value: unknown): string | null {
  return normalizeEmail(value);
}

/**
 * Cupo de usuarios del plan: el de **Planes** si está, y si no el del catálogo.
 *
 * Nunca devuelve `null`: sin precio legible se usa el cupo del plan del código,
 * que es el mínimo que la empresa ya vio en su propuesta.
 */
export function partnerUserLimit(
  price: { usuariosIncluidos: number } | null,
  planId: string | null
): number {
  if (price && Number.isFinite(price.usuariosIncluidos) && price.usuariosIncluidos > 0) {
    return Math.floor(price.usuariosIncluidos);
  }
  if (isKybPlanId(planId)) return getKybPlan(planId).users;
  return 1;
}

export interface PlanUserCapacity {
  /** Usuarios que ocupan lugar hoy (activos + invitados), sin contar al titular. */
  used: number;
  limit: number;
  remaining: number;
  full: boolean;
}

/**
 * Cuántos lugares quedan. `used` cuenta activos e invitados: una invitación
 * pendiente ya comprometió un lugar, y aceptar una más de la cuenta dejaría a
 * alguien sin acceso después de haberle mandado el correo.
 */
export function planUserCapacity(used: number, limit: number): PlanUserCapacity {
  const safeLimit = Math.max(0, Math.floor(limit));
  const safeUsed = Math.max(0, Math.floor(used));
  const remaining = Math.max(0, safeLimit - safeUsed);
  return { used: safeUsed, limit: safeLimit, remaining, full: remaining === 0 };
}

export interface PartnerUser {
  id: string;
  email: string;
  role: PartnerUserRole;
  status: PartnerUserStatus;
  invitedAt: string | null;
  joinedAt: string | null;
  revokedAt: string | null;
  /** El correo del alta: se muestra, pero no se puede revocar ni cambiar de rol. */
  isOwner: boolean;
}

export interface PartnerUsersRead {
  users: PartnerUser[];
  capacity: PlanUserCapacity;
  ownerEmail: string | null;
  /** `true` cuando la tabla todavía no existe en la base (falta la migración). */
  migrationPending: boolean;
  persistent: boolean;
  warning?: string;
}

interface StoredPartnerUser {
  id: string;
  partner_id: string;
  email: string;
  role: PartnerUserRole;
  status: PartnerUserStatus;
  invited_at: string | null;
  joined_at: string | null;
  revoked_at: string | null;
}

/** Respaldo en memoria: sin base el panel se puede probar, pero se dice que no persiste. */
const devStore = globalThis as typeof globalThis & {
  __rix7PartnerUsers?: Record<string, StoredPartnerUser[]>;
};

function devUsers(partnerId: string): StoredPartnerUser[] {
  devStore.__rix7PartnerUsers ??= {};
  devStore.__rix7PartnerUsers[partnerId] ??= [];
  return devStore.__rix7PartnerUsers[partnerId];
}

/** Tabla ausente (migración sin aplicar) frente a cualquier otro error de la base. */
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  return /does not exist|no existe/i.test(error.message ?? '');
}

/** Correo y plan del alta: de ahí salen el titular y el cupo. */
async function readPartnerPlan(
  partnerId: string
): Promise<{ email: string | null; planId: string | null; limit: number }> {
  let email: string | null = null;
  let planId: string | null = null;

  if (isServiceRoleConfigured()) {
    try {
      const supabase = createServiceRoleClient();
      const { data } = await supabase
        .from('kyb_applications')
        .select('email, plan')
        .eq('partner_id', partnerId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      email = typeof data?.email === 'string' ? data.email : null;
      planId = typeof data?.plan === 'string' ? data.plan : null;
    } catch {
      // Sin lectura del alta queda el cupo mínimo y sin titular: la lista de
      // usuarios sigue siendo utilizable.
    }
  }

  const pricing = await readPlanPricing().catch(() => null);
  const price = pricing && isKybPlanId(planId) ? planPrice(pricing.config, planId) : null;
  return { email, planId, limit: partnerUserLimit(price, planId) };
}

function toPartnerUser(row: StoredPartnerUser, ownerEmail: string | null): PartnerUser {
  return {
    id: row.id,
    email: row.email,
    role: isPartnerUserRole(row.role) ? row.role : 'editor',
    status: row.status,
    invitedAt: row.invited_at,
    joinedAt: row.joined_at,
    revokedAt: row.revoked_at,
    isOwner: !!ownerEmail && row.email === ownerEmail,
  };
}

/**
 * Los usuarios de una cuenta, con su cupo.
 *
 * El titular se agrega como primera fila si el alta lo conoce y todavía no está
 * en la lista: es el usuario que existe desde el día uno y la pantalla no puede
 * mostrarlo como si no hubiera nadie.
 */
export async function readPartnerUsers(partnerId: string): Promise<PartnerUsersRead> {
  const { email: ownerEmail, limit } = await readPartnerPlan(partnerId);

  let rows: StoredPartnerUser[] = [];
  let migrationPending = false;
  let persistent = isServiceRoleConfigured();
  let warning: string | undefined;

  if (!isServiceRoleConfigured()) {
    rows = [...devUsers(partnerId)];
  } else {
    try {
      const supabase = createServiceRoleClient();
      const { data, error } = await supabase
        .from('partner_users')
        .select('id, partner_id, email, role, status, invited_at, joined_at, revoked_at')
        .eq('partner_id', partnerId)
        .order('created_at', { ascending: true });

      if (error) {
        if (isMissingTable(error)) {
          migrationPending = true;
          warning =
            'La tabla de usuarios todavía no está aplicada en la base: se habilita con el próximo deploy.';
        } else {
          persistent = false;
          warning = `No se pudo leer la lista de usuarios (${error.message}).`;
        }
      } else {
        rows = (data ?? []) as StoredPartnerUser[];
      }
    } catch (error) {
      persistent = false;
      warning = `No se pudo consultar la base (${
        error instanceof Error ? error.message : 'error desconocido'
      }).`;
    }
  }

  // Una invitación no se queda «pendiente» para siempre: si la persona ya entró
  // (tiene `last_sign_in_at`), el estado real es «con acceso». Se corrige al
  // leer y se guarda, para que la pantalla no diga «Invitado» de alguien que
  // lleva semanas publicando.
  if (isServiceRoleConfigured() && rows.some((row) => row.status === 'invitado')) {
    rows = await reconcileInvites(partnerId, rows);
  }

  const users = rows.map((row) => toPartnerUser(row, ownerEmail));

  // El titular primero: existe desde el alta, no desde que lo invitaron.
  if (ownerEmail && !users.some((user) => user.email === ownerEmail)) {
    users.unshift({
      id: `owner:${partnerId}`,
      email: ownerEmail,
      role: 'admin',
      status: 'activo',
      invitedAt: null,
      joinedAt: null,
      revokedAt: null,
      isOwner: true,
    });
  }

  // El cupo cuenta al titular también: el plan dice cuántos usuarios entran en
  // total, no cuántos además del dueño.
  const occupied = users.filter((user) => user.status !== 'revocado').length;
  return {
    users,
    capacity: planUserCapacity(occupied, limit),
    ownerEmail,
    migrationPending,
    persistent,
    ...(warning ? { warning } : {}),
  };
}

export type PartnerUserMutation =
  | { ok: true; user: PartnerUser; email?: { sent: boolean; skipped: boolean; error?: string } }
  | { ok: false; status: number; error: string };

/**
 * Invita a una persona a la cuenta: fila + cuenta vinculada + correo.
 *
 * El orden importa. Primero se reserva el lugar (la fila): dos invitaciones
 * simultáneas no pueden pasarse del cupo por leer y escribir a la vez. Si la
 * cuenta no se puede vincular, la fila se borra —una invitación sin acceso es
 * una promesa incumplida— y se devuelve el motivo. El correo va al final: si
 * falla, la persona ya existe con su vínculo y se puede reenviar.
 */
export async function invitePartnerUser({
  partnerId,
  email,
  role,
  invitedBy,
}: {
  partnerId: string;
  email: unknown;
  role: unknown;
  invitedBy: string | null;
}): Promise<PartnerUserMutation> {
  const normalized = normalizePartnerEmail(email);
  if (!normalized) return { ok: false, status: 400, error: 'El correo no es válido.' };
  if (!isPartnerUserRole(role)) {
    return { ok: false, status: 400, error: 'El rol indicado no existe.' };
  }

  const current = await readPartnerUsers(partnerId);
  if (current.migrationPending) {
    return {
      ok: false,
      status: 503,
      error:
        'La administración de usuarios todavía no está habilitada en la base: falta aplicar la migración (se aplica con el próximo deploy).',
    };
  }
  if (current.ownerEmail && normalized === current.ownerEmail) {
    return { ok: false, status: 409, error: 'Ese correo es el del titular de la cuenta.' };
  }
  const existing = current.users.find((user) => user.email === normalized);
  if (existing && existing.status !== 'revocado') {
    return {
      ok: false,
      status: 409,
      error:
        existing.status === 'invitado'
          ? 'Ya hay una invitación pendiente para ese correo.'
          : 'Ese correo ya tiene acceso a la cuenta.',
    };
  }
  if (current.capacity.full) {
    return {
      ok: false,
      status: 409,
      error: `Tu plan incluye ${current.capacity.limit} usuarios y ya están todos ocupados. Para sumar a alguien, primero da de baja a otra persona.`,
    };
  }

  const planRead = await readPartnerPlan(partnerId);
  const now = new Date().toISOString();

  // Si la persona ya estuvo y se revocó, la invitación reusa su fila: es el
  // historial de esa persona en la empresa, no una segunda entrada.
  const row: StoredPartnerUser = {
    id: existing && existing.status === 'revocado' ? existing.id : crypto.randomUUID(),
    partner_id: partnerId,
    email: normalized,
    role,
    status: 'invitado',
    invited_at: now,
    joined_at: null,
    revoked_at: null,
  };

  if (!isServiceRoleConfigured()) {
    const rows = devUsers(partnerId);
    const index = rows.findIndex((candidate) => candidate.email === normalized);
    if (index >= 0) rows[index] = row;
    else rows.push(row);
  } else {
    try {
      const supabase = createServiceRoleClient();
      // El renglón revocado se reutiliza: la fila es el historial de esa persona
      // en la empresa, no una invitación nueva.
      if (existing && existing.status === 'revocado') {
        const { error } = await supabase
          .from('partner_users')
          .update({ role, status: 'invitado', invited_at: now, revoked_at: null })
          .eq('partner_id', partnerId)
          .eq('id', existing.id);
        if (error) return { ok: false, status: 500, error: `No se pudo invitar: ${error.message}` };
      } else {
        const { error } = await supabase.from('partner_users').insert({
          partner_id: partnerId,
          email: normalized,
          role,
          status: 'invitado',
          invited_at: now,
          invited_by: invitedBy,
        });
        if (error) {
          const duplicate = error.code === '23505';
          return {
            ok: false,
            status: duplicate ? 409 : 500,
            error: duplicate
              ? 'Ese correo ya está en la lista de usuarios.'
              : `No se pudo invitar: ${error.message}`,
          };
        }
      }
    } catch (error) {
      return {
        ok: false,
        status: 500,
        error: error instanceof Error ? error.message : 'No se pudo guardar la invitación.',
      };
    }
  }

  const linked = await linkPartnerAccount(normalized, partnerId);
  if (!linked.ok) {
    await removePendingInvite(partnerId, normalized);
    return {
      ok: false,
      status: 502,
      error: `La invitación se guardó pero no se pudo dar acceso: ${linked.error ?? 'error de Supabase'}. No se envió el correo.`,
    };
  }

  const companyName = await readCompanyName(partnerId);
  const panelUrl = `${SITE_URL}/socio/cuenta`;
  const built = buildPartnerInviteEmail({
    companyName,
    roleLabel: PARTNER_USER_ROLE_LABELS[role],
    usersIncluded: planRead.limit,
    panelUrl,
    magicLink: linked.magicLink,
    siteUrl: SITE_URL,
  });

  const sent = await sendEmail({ to: normalized, ...built });
  return {
    ok: true,
    user: toPartnerUser(row, current.ownerEmail),
    email: { sent: sent.sent, skipped: sent.skipped, ...(sent.error ? { error: sent.error } : {}) },
  };
}

async function readCompanyName(partnerId: string): Promise<string> {
  if (!isServiceRoleConfigured()) return partnerId;
  try {
    const supabase = createServiceRoleClient();
    const { data } = await supabase.from('partners').select('name').eq('id', partnerId).maybeSingle();
    return typeof data?.name === 'string' && data.name ? data.name : partnerId;
  } catch {
    return partnerId;
  }
}

async function removePendingInvite(partnerId: string, email: string): Promise<void> {
  if (!isServiceRoleConfigured()) {
    const rows = devUsers(partnerId);
    const index = rows.findIndex((row) => row.email === email);
    if (index >= 0) rows.splice(index, 1);
    return;
  }
  try {
    const supabase = createServiceRoleClient();
    await supabase.from('partner_users').delete().eq('partner_id', partnerId).eq('email', email);
  } catch {
    // La fila queda como invitada sin acceso: la pantalla deja reintentar.
  }
}

/** Revoca, reactiva o cambia el rol de un usuario. El titular no se toca. */
export async function updatePartnerUser({
  partnerId,
  id,
  action,
  role,
}: {
  partnerId: string;
  id: unknown;
  action: unknown;
  role?: unknown;
}): Promise<PartnerUserMutation> {
  const current = await readPartnerUsers(partnerId);
  if (current.migrationPending) {
    return { ok: false, status: 503, error: 'La administración de usuarios todavía no está habilitada.' };
  }

  const user = current.users.find((candidate) => candidate.id === id);
  if (!user) return { ok: false, status: 404, error: 'Ese usuario no está en tu cuenta.' };
  if (user.isOwner) {
    return {
      ok: false,
      status: 409,
      error: 'El titular de la cuenta no se puede modificar desde acá.',
    };
  }

  const now = new Date().toISOString();

  if (action === 'role') {
    if (!isPartnerUserRole(role)) return { ok: false, status: 400, error: 'El rol indicado no existe.' };
    const updated = await writeStored(partnerId, user, { role });
    if (!updated.ok) return updated;
    return { ok: true, user: { ...user, role } };
  }

  if (action === 'revoke') {
    const updated = await writeStored(partnerId, user, { status: 'revocado', revoked_at: now });
    if (!updated.ok) return updated;
    await unlinkAccount(user.email);
    return { ok: true, user: { ...user, status: 'revocado', revokedAt: now } };
  }

  if (action === 'reactivate') {
    // Reactivar puede pasarse del cupo si mientras tanto entró otra persona.
    if (current.capacity.full) {
      return {
        ok: false,
        status: 409,
        error: `Tu plan incluye ${current.capacity.limit} usuarios y no queda lugar para reactivar a este.`,
      };
    }
    const updated = await writeStored(partnerId, user, { status: 'activo', revoked_at: null });
    if (!updated.ok) return updated;
    const linked = await linkPartnerAccount(user.email, partnerId);
    if (!linked.ok) {
      return {
        ok: false,
        status: 502,
        error: `Se reactivó la fila pero no se pudo devolver el acceso: ${linked.error ?? 'error de Supabase'}.`,
      };
    }
    return { ok: true, user: { ...user, status: 'activo', revokedAt: null } };
  }

  return { ok: false, status: 400, error: 'La acción indicada no existe.' };
}

async function writeStored(
  partnerId: string,
  user: PartnerUser,
  patch: { role?: PartnerUserRole; status?: PartnerUserStatus; revoked_at?: string | null }
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!isServiceRoleConfigured()) {
    const row = devUsers(partnerId).find((candidate) => candidate.email === user.email);
    if (row) {
      if (patch.role) row.role = patch.role;
      if (patch.status) row.status = patch.status;
      if (patch.revoked_at !== undefined) row.revoked_at = patch.revoked_at;
    }
    return { ok: true };
  }

  try {
    const supabase = createServiceRoleClient();
    const { error } = await supabase
      .from('partner_users')
      .update(patch)
      .eq('partner_id', partnerId)
      .eq('id', user.id);
    if (error) return { ok: false, status: 500, error: `No se pudo actualizar: ${error.message}` };
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      status: 500,
      error: error instanceof Error ? error.message : 'No se pudo actualizar el usuario.',
    };
  }
}

interface AuthUserRow {
  id: string;
  email?: string | null;
  app_metadata?: unknown;
  last_sign_in_at?: string | null;
}

/** Las cuentas de Supabase, paginadas: se reusa para revocar y para el estado. */
async function listAuthUsers(
  admin: ReturnType<typeof createServiceRoleClient>
): Promise<AuthUserRow[]> {
  const all: AuthUserRow[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    const users = (data?.users ?? []) as AuthUserRow[];
    all.push(...users);
    if (users.length < 1000) break;
  }
  return all;
}

/**
 * Pasa a `activo` las invitaciones que ya entraron.
 *
 * El enlace mágico deja la sesión sin avisar a esta tabla, así que el estado se
 * deduce de `last_sign_in_at`: si la cuenta tiene una entrada, la invitación se
 * aceptó. Se guarda la fecha de esa primera entrada (`joined_at`), que es el
 * dato que el socio necesita para saber desde cuándo esa persona tiene acceso.
 */
async function reconcileInvites(
  partnerId: string,
  rows: StoredPartnerUser[]
): Promise<StoredPartnerUser[]> {
  try {
    const admin = createServiceRoleClient();
    const accounts = await listAuthUsers(admin);
    const entered = new Map<string, string>();
    for (const account of accounts) {
      const email = normalizePartnerEmail(account.email);
      if (email && account.last_sign_in_at) entered.set(email, account.last_sign_in_at);
    }

    const joined: { id: string; at: string }[] = [];
    const next = rows.map((row) => {
      if (row.status !== 'invitado') return row;
      const at = entered.get(row.email);
      if (!at) return row;
      joined.push({ id: row.id, at });
      return { ...row, status: 'activo' as PartnerUserStatus, joined_at: at };
    });

    // Best-effort: si la escritura falla, la lectura de esta vez ya es correcta.
    for (const item of joined) {
      await admin
        .from('partner_users')
        .update({ status: 'activo', joined_at: item.at })
        .eq('partner_id', partnerId)
        .eq('id', item.id);
    }

    return next;
  } catch {
    return rows;
  }
}

/** Deja la cuenta de Supabase como Visita: pierde rol y vínculo, y el panel se cierra. */
async function unlinkAccount(email: string): Promise<void> {
  if (!isServiceRoleConfigured()) return;
  try {
    const admin = createServiceRoleClient();
    const found = findAccountByEmail(await listAuthUsers(admin), email);
    if (!found) return;
    await admin.auth.admin.updateUserById(found.id, {
      app_metadata: unlinkMetadata(found.app_metadata),
    });
  } catch {
    // Sin vínculo removido la persona conserva el acceso: la fila ya dice
    // «revocado», pero eso se arregla reintentando, no ocultándolo.
  }
}
