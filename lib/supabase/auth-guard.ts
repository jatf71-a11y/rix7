import { NextResponse } from 'next/server';
import { createClient } from './server';
import {
  decideAdminAccess,
  decideMemberAccess,
  resolvePartnerId,
  resolveRole,
  type AccountRole,
} from '@/lib/utils/roles';

export type GuardResult =
  | { ok: true; role: AccountRole; devBypass: boolean }
  | { ok: false; response: NextResponse };

/**
 * Resultado de `requireMember`: además del rol trae la corredora vinculada,
 * que es con lo que el llamador acota cada lectura y cada escritura.
 */
export type MemberGuardResult =
  | { ok: true; role: AccountRole; partnerId: string; userId: string | null; devBypass: boolean }
  | { ok: false; response: NextResponse };

/** ¿Hay un proyecto Supabase real configurado (y no el placeholder de desarrollo)? */
export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return !!url && !url.includes('placeholder');
}

/**
 * Exige rol admin para ejecutar una ruta de administración.
 *
 * Devuelve una respuesta lista para retornar cuando no se autoriza, así que en
 * cada handler basta con:
 *
 * ```ts
 * const guard = await requireAdmin();
 * if (!guard.ok) return guard.response;
 * ```
 *
 * El bypass de desarrollo replica el que ya usa `AuthProvider`: en local no hay
 * proyecto Supabase real y el login es imposible, así que el panel quedaría
 * inaccesible para probarlo. En producción (`NODE_ENV === 'production'`, lo que
 * hace Vercel) siempre se exige la sesión y el rol.
 */
export async function requireAdmin(): Promise<GuardResult> {
  const configured = isSupabaseConfigured();
  const devBypass =
    process.env.NEXT_PUBLIC_SHOW_ADMIN_ENV === '1' || process.env.NODE_ENV !== 'production';

  let authenticated = false;
  let role: AccountRole = 'visitor';

  if (configured) {
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      authenticated = !!user;
      role = resolveRole(user);
    } catch {
      // Sin poder verificar la sesión no se autoriza nada.
      return {
        ok: false,
        response: NextResponse.json(
          { success: false, error: 'No se pudo verificar la sesión.' },
          { status: 503 }
        ),
      };
    }
  }

  const decision = decideAdminAccess({ configured, authenticated, role, devBypass });

  if (!decision.allow) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: decision.error },
        { status: decision.status ?? 403 }
      ),
    };
  }

  // Sin proyecto configurado el acceso vino del bypass, que equivale a admin.
  return { ok: true, role: configured ? role : 'admin', devBypass };
}

/**
 * Exige rol de socio (member o admin) **y** una corredora vinculada para
 * operar el panel de publicaciones (`/socio`, `/api/partner/*`).
 *
 * Mismo patrón que `requireAdmin`:
 *
 * ```ts
 * const guard = await requireMember();
 * if (!guard.ok) return guard.response;
 * // guard.partnerId acota la consulta y la escritura
 * ```
 *
 * El vínculo (`app_metadata.partner_id`) es lo que hace que el panel sea de
 * *cada* corredora: sin él, un socio autenticado no tiene stock que administrar
 * y una consulta sin filtrar devolvería el portal entero. Por eso una cuenta
 * con rol pero sin vincular recibe 403 con mensaje explícito — no 401 (sí
 * tiene sesión) ni una lista vacía (que parecería «no tienes publicaciones»
 * cuando en realidad es «tu cuenta no está lista»).
 *
 * Sin Supabase configurado manda el mismo bypass de desarrollo que
 * `requireAdmin` (en local el login es imposible): el panel se puede usar con
 * una corredora de desarrollo (`DEV_PARTNER_ID`, por defecto `dev-socio`) y
 * las escrituras quedan en memoria, marcadas como no persistentes.
 */
export async function requireMember(): Promise<MemberGuardResult> {
  const configured = isSupabaseConfigured();
  const devBypass =
    process.env.NEXT_PUBLIC_SHOW_ADMIN_ENV === '1' || process.env.NODE_ENV !== 'production';

  let authenticated = false;
  let role: AccountRole = 'visitor';
  let partnerId: string | null = null;
  let userId: string | null = null;

  if (configured) {
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      authenticated = !!user;
      role = resolveRole(user);
      partnerId = resolvePartnerId(user);
      // El creador de la fila: con él, las fichas siguen siendo editables por
      // la política de creador aunque la corredora se desvincule después.
      userId = user?.id ?? null;
    } catch {
      // Sin poder verificar la sesión no se autoriza nada.
      return {
        ok: false,
        response: NextResponse.json(
          { success: false, error: 'No se pudo verificar la sesión.' },
          { status: 503 }
        ),
      };
    }
  }

  const decision = decideMemberAccess({ configured, authenticated, role, devBypass });

  if (!decision.allow) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: decision.error },
        { status: decision.status ?? 403 }
      ),
    };
  }

  // Sin proyecto configurado el acceso vino del bypass: no hay sesión real,
  // así que la corredora es la de desarrollo y las escrituras quedarán en
  // memoria (el store las marca `persisted: false` para que la UI lo diga).
  if (!configured) {
    return {
      ok: true,
      role: 'admin',
      partnerId: process.env.DEV_PARTNER_ID?.trim() || 'dev-socio',
      userId: null,
      devBypass: true,
    };
  }

  if (!partnerId) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          success: false,
          error:
            'Tu cuenta no está vinculada a una corredora. Pide al equipo que la vincule desde el panel de administración.',
        },
        { status: 403 }
      ),
    };
  }

  return { ok: true, role, partnerId, userId, devBypass: false };
}
