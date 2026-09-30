import { isSupabaseConfigured } from '@/lib/supabase/config';
import type { NormalizedSignup } from '@/lib/utils/consents';
import { SIGNUP_COLUMNS, rowToSignup, toSignupInsert, type Signup, type SignupRow } from './signups';

/**
 * Escritura y lectura de los registros.
 *
 * - El **alta es pública**: quien se registra no tiene cuenta, así que se escribe
 *   con el cliente sin cookies y lo permite la política RLS de inserción (que
 *   además vuelve a exigir el mínimo legal).
 * - La **lectura es del equipo**: exige rol admin, por lo que usa el cliente con
 *   la sesión del usuario para que el JWT lleve su rol.
 * - Sin Supabase configurado hay respaldo en memoria, como en `leads`, para poder
 *   probar el panel. Pero acá el dato es una constancia de consentimiento, así
 *   que `persisted:false` no es un detalle: significa que ese registro se pierde
 *   al reiniciar el servidor, y el endpoint lo reporta en vez de callarlo.
 */

export interface SignupWriteResult {
  ok: boolean;
  persisted: boolean;
  error?: string;
}

export interface SignupListResult {
  signups: Signup[];
  source: 'supabase' | 'memory';
  /** false = desarrollo sin Supabase: lo guardado se pierde al reiniciar */
  persistent: boolean;
}

/**
 * Respaldo en memoria, solo para desarrollo sin Supabase.
 *
 * Vive en `globalThis` por el mismo motivo que el de `leads`: en Next cada ruta
 * del servidor compila su propio bundle, así que una variable de módulo dejaría
 * de ser un solo dato entre la ruta que escribe y la que lee.
 */
const devStore = globalThis as typeof globalThis & {
  __rix7DevSignups?: Signup[];
  __rix7DevSignupCounter?: number;
};

function readDevSignups(): Signup[] {
  devStore.__rix7DevSignups ??= [];
  return devStore.__rix7DevSignups;
}

async function publicClient() {
  const { createPublicClient } = await import('@/lib/supabase/server');
  return createPublicClient();
}

async function sessionClient() {
  const { createClient } = await import('@/lib/supabase/server');
  return createClient();
}

/** Alta de un registro ya validado por `normalizeSignup`. */
export async function createSignup(signup: NormalizedSignup): Promise<SignupWriteResult> {
  const insert = toSignupInsert(signup);

  if (!isSupabaseConfigured()) {
    devStore.__rix7DevSignupCounter = (devStore.__rix7DevSignupCounter ?? 0) + 1;
    devStore.__rix7DevSignups = [
      {
        id: `memoria-${devStore.__rix7DevSignupCounter}`,
        name: insert.name,
        email: insert.email,
        phone: insert.phone,
        consents: { ...signup.consents },
        consentVersion: insert.consent_version,
        createdAt: new Date().toISOString(),
      },
      ...readDevSignups(),
    ];

    return { ok: true, persisted: false };
  }

  try {
    const supabase = await publicClient();
    const { error } = await supabase.from('signups').insert(insert);

    if (error) return { ok: false, persisted: true, error: error.message };

    return { ok: true, persisted: true };
  } catch (error) {
    return {
      ok: false,
      persisted: true,
      error: error instanceof Error ? error.message : 'Error inesperado al guardar el registro.',
    };
  }
}

/** Listado para el panel, del más reciente al más antiguo (solo-anexa: es el historial). */
export async function listSignups(limit = 200): Promise<SignupListResult> {
  if (isSupabaseConfigured()) {
    try {
      const supabase = await sessionClient();
      const { data, error } = await supabase
        .from('signups')
        .select(SIGNUP_COLUMNS)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (!error && data) {
        return {
          signups: (data as SignupRow[]).map(rowToSignup),
          source: 'supabase',
          persistent: true,
        };
      }
    } catch {
      // Supabase caído: se muestra lo que haya en memoria, que será poco o nada.
    }
  }

  return { signups: readDevSignups().slice(0, limit), source: 'memory', persistent: false };
}
