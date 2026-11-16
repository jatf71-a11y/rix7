/**
 * Segundo factor del equipo: códigos de recuperación y reset auditado.
 *
 * El socio tiene una salida cuando pierde su app: escribe al equipo y el equipo
 * le quita el factor (`resetPartnerMfa`, auditado y con aviso por correo). El
 * equipo **no tenía ninguna**: si alguien cambiaba de teléfono, quedaba afuera de
 * `/admin` y, si era el único admin, Rix7 quedaba sin administración.
 *
 * Dos salidas, en este orden:
 *
 * 1. **Código de recuperación** (autoservicio): diez códigos de un solo uso que
 *    la persona guarda fuera del teléfono. Canjear uno no «abre» la sesión: quita
 *    el factor TOTP de la cuenta para que pueda entrar con su enlace y volver a
 *    enrolar. Es la única forma honesta de hacerlo, porque el nivel `aal2` lo
 *    firma Supabase y no se puede fabricar desde acá. Cada canje queda en
 *    `admin_events`.
 *
 * 2. **Reset por otro admin** (acompañado): si no le quedan códigos, otro admin
 *    le quita el factor desde `/admin/cuenta`, con el mismo registro y el mismo
 *    correo de aviso que recibe un socio.
 *
 * El código **nunca se guarda**: se guarda su SHA-256. Quien lea la tabla no
 * puede usarla.
 */

import { createHash, randomInt, randomUUID } from 'node:crypto';

import { recordAdminEvent } from './adminEvents';
import { clearMfaFactors, findUserByEmail, notifyMfaReset } from './mfaFactors';

import { createServiceRoleClient, isServiceRoleConfigured } from '@/lib/supabase/admin';

/** Cuántos códigos trae cada lote. Diez es lo que se imprime en una hoja. */
export const RECOVERY_CODE_COUNT = 10;

/**
 * Alfabeto sin caracteres que se confunden al copiar a mano: sin `0/O`, `1/I/L`.
 * 32 símbolos, 8 por código.
 */
export const RECOVERY_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const RECOVERY_CODE_LENGTH = 8;

export const RECOVERY_REDEEM_ACTION = 'admin_mfa.recovery_code';
export const TEAM_RESET_ACTION = 'team_mfa.reset';

/** Un código `XXXX-XXXX`: se muestra con guion, se guarda sin él. */
export function formatRecoveryCode(raw: string): string {
  return `${raw.slice(0, 4)}-${raw.slice(4)}`.toUpperCase();
}

/** Normaliza lo que escribió la persona: mayúsculas, sin guiones ni espacios. */
export function normalizeRecoveryCode(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

/** Lo que se guarda. Nunca el código. */
export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}

/**
 * Genera un lote de códigos.
 *
 * `random` se inyecta para poder probar el formato y la unicidad sin depender
 * del azar: en producción usa `crypto.randomInt`, que es el generador correcto
 * para un secreto.
 */
export function generateRecoveryCodes(
  count = RECOVERY_CODE_COUNT,
  random: (max: number) => number = (max) => randomInt(max)
): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    let raw = '';
    for (let i = 0; i < RECOVERY_CODE_LENGTH; i += 1) {
      raw += RECOVERY_ALPHABET[random(RECOVERY_ALPHABET.length)];
    }
    codes.add(formatRecoveryCode(raw));
  }
  // `Array.from` y no spread: el target del proyecto es `es5` y un `Set` no es
  // iterable con esa configuración.
  return Array.from(codes);
}

/* ── Persistencia ─────────────────────────────────────────────────────────── */

/** Lote nuevo: descarta los códigos anteriores sin usar y guarda los hashes. */
export async function createRecoveryCodes(
  userId: string
): Promise<{ ok: true; codes: string[] } | { ok: false; error: string }> {
  if (!isServiceRoleConfigured()) {
    return { ok: false, error: 'Falta SUPABASE_SERVICE_ROLE_KEY: no se pueden generar códigos.' };
  }

  try {
    const supabase = createServiceRoleClient();

    const { error: clearError } = await supabase
      .from('admin_recovery_codes')
      .delete()
      .eq('user_id', userId)
      .is('used_at', null);
    if (clearError) return { ok: false, error: `No se pudo descartar el lote anterior: ${clearError.message}` };

    const codes = generateRecoveryCodes();
    const batchId = randomUUID();
    const { error } = await supabase.from('admin_recovery_codes').insert(
      codes.map((code) => ({ user_id: userId, code_hash: hashRecoveryCode(code), batch_id: batchId }))
    );
    if (error) return { ok: false, error: `No se pudieron guardar los códigos: ${error.message}` };

    return { ok: true, codes };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Error inesperado.' };
  }
}

/** Cuántos códigos le quedan sin usar a una cuenta. */
export async function countRecoveryCodes(userId: string): Promise<number> {
  if (!isServiceRoleConfigured()) return 0;
  try {
    const supabase = createServiceRoleClient();
    const { count } = await supabase
      .from('admin_recovery_codes')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('used_at', null);
    return count ?? 0;
  } catch {
    return 0;
  }
}

/* ── Canje y reset por otro admin ─────────────────────────────────────────── */

export interface RedeemResult {
  ok: boolean;
  code?: 'not_configured' | 'invalid' | 'failed';
  removed?: number;
  error?: string;
  audit?: { ok: boolean; error?: string };
  notified?: { sent: boolean; skipped: boolean; error?: string } | null;
}

/**
 * Canjea un código de recuperación: lo marca usado **y** quita el segundo factor.
 *
 * Si el canje sale bien, la persona entra con su enlace y vuelve a enrolar. Un
 * código usado no sirve dos veces: la actualización exige `used_at` nulo, así que
 * dos canjes simultáneos del mismo código no pueden ganar los dos.
 */
export async function redeemRecoveryCode({
  userId,
  email,
  code,
  note,
}: {
  userId: string;
  email: string | null;
  code: string;
  note?: string;
}): Promise<RedeemResult> {
  if (!isServiceRoleConfigured()) {
    return { ok: false, code: 'not_configured', error: 'Falta SUPABASE_SERVICE_ROLE_KEY.' };
  }

  const clean = normalizeRecoveryCode(code);
  if (clean.length !== RECOVERY_CODE_LENGTH) {
    return { ok: false, code: 'invalid', error: 'El código tiene ocho caracteres.' };
  }

  try {
    const supabase = createServiceRoleClient();
    const { data: row, error: findError } = await supabase
      .from('admin_recovery_codes')
      .select('id')
      .eq('user_id', userId)
      .eq('code_hash', hashRecoveryCode(clean))
      .is('used_at', null)
      .maybeSingle();

    if (findError) return { ok: false, code: 'failed', error: findError.message };
    if (!row) return { ok: false, code: 'invalid', error: 'El código no sirve o ya fue usado.' };

    const { data: claimed, error: claimError } = await supabase
      .from('admin_recovery_codes')
      .update({ used_at: new Date().toISOString(), used_note: note ?? 'recuperación de acceso' })
      .eq('id', row.id)
      .is('used_at', null)
      .select('id');

    if (claimError) return { ok: false, code: 'failed', error: claimError.message };
    if (!claimed || claimed.length === 0) {
      return { ok: false, code: 'invalid', error: 'El código ya fue usado en otro intento.' };
    }

    const removed = await clearMfaFactors(supabase, userId).then(
      (count) => ({ ok: true as const, count }),
      (error: unknown) => ({ ok: false as const, count: 0, error: errorMessage(error) })
    );
    const audit = await recordAdminEvent({
      action: RECOVERY_REDEEM_ACTION,
      actorId: userId,
      actorEmail: email,
      partnerId: null,
      targetEmail: email,
      detail: { removed: removed.count, ok: removed.ok },
    });

    if (!removed.ok) {
      return { ok: false, code: 'failed', error: removed.error, removed: removed.count, audit };
    }
    // Si el canje tuvo éxito, el titular debe enterarse aunque no lo haya pedido él.
    // Un fallo de correo no revierte el canje: el segundo factor ya se quitó.
    const notified = email
      ? await notifyMfaReset(email, { companyName: 'Rix7', panelPath: '/admin/cuenta' })
      : null;
    return { ok: true, removed: removed.count, audit, notified };
  } catch (error) {
    return { ok: false, code: 'failed', error: errorMessage(error, 'Error inesperado al canjear el código.') };
  }
}

export interface TeamResetResult {
  ok: boolean;
  code?: 'not_configured' | 'not_found' | 'invalid' | 'no_factors' | 'failed';
  removed?: number;
  email?: string;
  notified?: { sent: boolean; skipped: boolean; error?: string } | null;
  audit?: { ok: boolean; error?: string };
  error?: string;
}

/**
 * Otro admin le quita el segundo factor a una cuenta del equipo.
 *
 * Es la misma operación que el panel del socio hace con un socio, pero sobre una
 * cuenta de equipo: registro en `admin_events` y aviso por correo a la cuenta
 * afectada, para que se entere de que alguien tocó su seguridad.
 */
export async function resetTeamMfa({
  email,
  actor,
}: {
  email: string;
  actor: { id: string | null; email: string | null };
}): Promise<TeamResetResult> {
  if (!isServiceRoleConfigured()) {
    return { ok: false, code: 'not_configured', error: 'Falta SUPABASE_SERVICE_ROLE_KEY.' };
  }

  const clean = email.trim().toLowerCase();
  if (!clean || !clean.includes('@')) {
    return { ok: false, code: 'invalid', error: 'El correo no es válido.' };
  }

  // Un admin no se resetea a sí mismo por esta vía: para eso están los códigos,
  // que existen justamente para no tener que pedirle a otro.
  if (actor.email && actor.email.toLowerCase() === clean) {
    return {
      ok: false,
      code: 'invalid',
      error: 'Para tu propia cuenta usá un código de recuperación; esta acción es para otra cuenta.',
    };
  }

  try {
    const admin = createServiceRoleClient();
    const user = await findUserByEmail(admin, clean);
    if (!user) return { ok: false, code: 'not_found', error: 'No existe una cuenta con ese correo.' };

    let removed: number;
    try {
      removed = await clearMfaFactors(admin, user.id);
    } catch (error) {
      return { ok: false, code: 'failed', error: errorMessage(error) };
    }
    if (removed === 0) {
      return { ok: false, code: 'no_factors', error: 'Esa cuenta no tiene segundo factor activo.' };
    }

    const audit = await recordAdminEvent({
      action: TEAM_RESET_ACTION,
      actorId: actor.id,
      actorEmail: actor.email,
      partnerId: null,
      targetEmail: clean,
      detail: { removed },
    });

    const notified = await notifyMfaReset(clean, { companyName: 'Rix7', panelPath: '/admin/cuenta' });

    return { ok: true, removed, email: clean, notified, audit };
  } catch (error) {
    return { ok: false, code: 'failed', error: errorMessage(error) };
  }
}

function errorMessage(error: unknown, fallback = 'Error inesperado.'): string {
  return error instanceof Error ? error.message : fallback;
}
