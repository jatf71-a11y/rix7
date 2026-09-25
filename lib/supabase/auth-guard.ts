import { NextResponse } from 'next/server';
import { createClient } from './server';
import { decideAdminAccess, resolveRole, type AccountRole } from '@/lib/utils/roles';

export type GuardResult =
  | { ok: true; role: AccountRole; devBypass: boolean }
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
