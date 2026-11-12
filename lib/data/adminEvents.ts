/**
 * Libro de acciones del equipo.
 *
 * Cada acción del equipo que cambia algo en la cuenta de un socio deja un
 * renglón: quién, cuándo, sobre qué socio y sobre qué cuenta. No es estado (eso
 * ya lo guardan las tablas de cada flujo): es la respuesta a «¿quién quitó
 * esto?», que antes no existía para nada que no fuera una decisión de alta.
 *
 * Nunca bloquea la acción que registra: si el registro falla, el resultado dice
 * que falló y la pantalla lo muestra. Fingir que quedó anotado sería peor que
 * no anotarlo.
 */

import { createServiceRoleClient, isServiceRoleConfigured } from '@/lib/supabase/admin';

export interface AdminEventInput {
  /** Nombre estable: `partner_mfa.reset`, no una frase. */
  action: string;
  actorId: string | null;
  actorEmail: string | null;
  partnerId: string | null;
  targetEmail?: string | null;
  detail?: Record<string, unknown>;
}

export interface AdminEventResult {
  ok: boolean;
  error?: string;
}

export async function recordAdminEvent(event: AdminEventInput): Promise<AdminEventResult> {
  if (!isServiceRoleConfigured()) {
    return { ok: false, error: 'Falta SUPABASE_SERVICE_ROLE_KEY: la acción no quedó registrada.' };
  }

  try {
    const supabase = createServiceRoleClient();
    const { error } = await supabase.from('admin_events').insert({
      action: event.action,
      actor_id: event.actorId,
      actor_email: event.actorEmail,
      partner_id: event.partnerId,
      target_email: event.targetEmail ?? null,
      detail: event.detail ?? {},
    });

    if (error) {
      return { ok: false, error: `No se pudo registrar la acción: ${error.message}` };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `No se pudo registrar la acción: ${error.message}`
          : 'No se pudo registrar la acción.',
    };
  }
}
