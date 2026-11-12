import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Verificación en dos pasos (TOTP) del panel del socio.
 *
 * Supabase Auth lleva el segundo factor en el JWT: una sesión puede estar en
 * `aal1` (solo correo/enlace) o `aal2` (con el código de la app). La regla del
 * panel es simple y no depende de leer la tabla de factores: si la cuenta tiene
 * un factor verificado, Supabase informa `nextLevel = 'aal2'`, y mientras la
 * sesión siga en `aal1` hay que pedir el código.
 *
 * Esa es la razón para no decidir con `listFactors` en el guard: el nivel de
 * garantía viaja en el token de la sesión y no se puede «inducir un error» para
 * saltearlo.
 */

export interface AssuranceLevel {
  /** `aal1` o `aal2` según cómo entró la sesión actual. */
  currentLevel: string | null;
  /** `aal2` si la cuenta tiene un factor verificado. */
  nextLevel: string | null;
  /** La cuenta tiene 2FA y esta sesión todavía no lo pasó. */
  requiresChallenge: boolean;
}

export interface FactorLike {
  id: string;
  status?: string | null;
  factor_type?: string | null;
  friendly_name?: string | null;
}

export interface AalLike {
  currentLevel?: string | null;
  nextLevel?: string | null;
}

export interface MfaAssessment extends AssuranceLevel {
  /** Hay al menos un factor TOTP verificado. */
  enrolled: boolean;
  factorId: string | null;
}

/**
 * Traduce factores + nivel de garantía a lo que la UI necesita.
 *
 * Sin factores verificados no hay nada que pedir, aunque la sesión sea `aal1`:
 * el socio que no activó el 2FA entra con su enlace como siempre.
 */
export function assessMfa(
  factors: readonly FactorLike[] | null | undefined,
  aal: AalLike | null | undefined
): MfaAssessment {
  const verified = (factors ?? []).filter(
    (factor) => factor.status === 'verified' && (!factor.factor_type || factor.factor_type === 'totp')
  );
  const enrolled = verified.length > 0;
  const currentLevel = aal?.currentLevel ?? null;
  const nextLevel = aal?.nextLevel ?? null;

  return {
    currentLevel,
    nextLevel,
    enrolled,
    factorId: verified[0]?.id ?? null,
    requiresChallenge: enrolled && currentLevel === 'aal1' && nextLevel === 'aal2',
  };
}

/**
 * Nivel de garantía de la sesión, sin consultar la lista de factores.
 *
 * Es lo que usa el guard de `/api/partner/*`: una sola lectura del token. Si la
 * lectura falla se responde «no hay segundo factor pendiente» en vez de tumbar
 * el panel entero por un error de red — el guard ya exigió sesión válida antes
 * de llegar acá, y la lectura que falla es local (claims del JWT).
 */
export async function readAssuranceLevel(
  supabase: SupabaseClient
): Promise<AssuranceLevel> {
  try {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error || !data) {
      return { currentLevel: null, nextLevel: null, requiresChallenge: false };
    }
    const currentLevel = data.currentLevel ?? null;
    const nextLevel = data.nextLevel ?? null;
    return {
      currentLevel,
      nextLevel,
      requiresChallenge: currentLevel === 'aal1' && nextLevel === 'aal2',
    };
  } catch {
    return { currentLevel: null, nextLevel: null, requiresChallenge: false };
  }
}

/** Estado completo para la pantalla de seguridad y la puerta del panel. */
export async function readMfaStatus(supabase: SupabaseClient): Promise<MfaAssessment> {
  let factors: readonly FactorLike[] = [];
  try {
    const { data } = await supabase.auth.mfa.listFactors();
    factors = (data?.totp ?? []) as readonly FactorLike[];
  } catch {
    factors = [];
  }

  let aal: AalLike | null = null;
  try {
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    aal = data ?? null;
  } catch {
    aal = null;
  }

  return assessMfa(factors, aal);
}
