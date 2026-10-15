/**
 * ¿La base a la que apunta este despliegue es la de la **cuenta dueña** del
 * proyecto?
 *
 * Existe por el incidente del 2026-10-13: el proyecto en vivo quedó **sin dueño
 * accesible** porque su única puerta de entrada era una identidad externa que se
 * eliminó. No falló el código ni la base: falló la pertenencia. Y falló en
 * silencio, porque el portal seguía sirviendo el catálogo desde memoria como si
 * nada.
 *
 * Así que esta comprobación no pregunta «¿Supabase responde?» —eso lo contestan
 * `/api/auth` y `check:auth`— sino **«¿de quién es esta base?»**. Se responde sin
 * red y sin credenciales de administración, con lo que ya está en la URL y en las
 * claves clásicas:
 *
 * 1. **La URL** dice el proyecto: `https://<ref>.supabase.co`.
 * 2. **Las claves clásicas** son JWT y su cuerpo (sin firmar) lleva `ref` — el
 *    proyecto del que salieron. No se verifica la firma ni se pretende: acá
 *    alcanza para atajar el error real, que es una clave de **otro** proyecto.
 *
 * Las claves nuevas (`sb_publishable_…`, `sb_secret_…`) **no** llevan `ref`: con
 * ellas no se puede cotejar sin preguntarle a la base, y este módulo no hace
 * peticiones de red. Eso se informa como una nota, no como un aprobado: un
 * «no se pudo comprobar» que se muestra como verde es exactamente la clase de
 * mentira que el resto del proyecto evita.
 *
 * Es puro y neutral (no importa Supabase, ni React, ni Next) para poder probarlo
 * con cada combinación: lo usa `lib/utils/health`, que es lo que publican
 * `/api/health` y `npm run check:health`.
 */

/**
 * El proyecto de la **cuenta dueña**: `jatf71@gmail.com` (cuenta A del registro
 * de credenciales). Es la que puede emitir claves nuevas y la que ve este
 * proyecto en el panel de Supabase.
 *
 * El valor está literal y no en una variable porque es el dato que este chequeo
 * defiende: si se pudiera cambiar desde el entorno sin querer, no defendería
 * nada. Para un despliegue que usa otro proyecto **a propósito** existe
 * `SUPABASE_OWNER_PROJECT_REF` (ver `lib/utils/health`), que es explícito y
 * queda anotado en `/api/health`.
 */
export const DEFAULT_OWNER_PROJECT_REF = 'vsqkjimpssdvlvdwrtnh';

/** La cuenta dueña, para que el informe diga de quién tendría que ser la base. */
export const OWNER_ACCOUNT_EMAIL = 'jatf71@gmail.com';

export interface OwnershipInput {
  /** `NEXT_PUBLIC_SUPABASE_URL` del despliegue. */
  url: string | null;
  /** `NEXT_PUBLIC_SUPABASE_ANON_KEY` del despliegue. */
  anonKey: string | null;
  /** `SUPABASE_SERVICE_ROLE_KEY` del despliegue. */
  serviceRoleKey: string | null;
  /** La referencia esperada; `null` desactiva el cotejo (se informa como nota). */
  ownerProjectRef: string | null;
}

export interface OwnershipVerdict {
  /** `true` solo cuando la base es la de la cuenta dueña, o cuando no hay nada que cotejar. */
  ok: boolean;
  /** La referencia que declara la URL. */
  ref: string | null;
  /** Por qué no es la base de la cuenta dueña; `null` cuando está bien. */
  reason: string | null;
  /** Lo que no se pudo comprobar (claves que no llevan su proyecto). Nunca es un aprobado. */
  notes: string[];
}

/**
 * La referencia del proyecto a partir de la URL, o `null` si no es una URL de
 * Supabase. Acepta los dos dominios (`supabase.co` y `supabase.in`).
 */
export function projectRefFromUrl(url: string | null | undefined): string | null {
  const match = /^https?:\/\/([a-z0-9]+)\.supabase\.(?:co|in)(?:\/|$)/i.exec(String(url ?? '').trim());
  return match ? match[1].toLowerCase() : null;
}

/**
 * El cuerpo de un JWT **sin verificar la firma**: alcanza para leer `ref`, que es
 * lo único que se usa acá. Devuelve `null` cuando el valor no es un JWT (por
 * ejemplo, una clave nueva `sb_publishable_…`) o no se puede leer.
 */
export function decodeJwtBody(token: string | null | undefined): Record<string, unknown> | null {
  const parts = String(token ?? '').trim().split('.');
  if (parts.length !== 3) return null;

  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    // `atob` existe en Node y en el navegador: el módulo no necesita ninguna de
    // las dos plataformas para esta comprobación.
    const decoded = atob(padded);
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * El veredicto. **No lanza y no hace red**: recibe lo que hay en el entorno y
 * contesta.
 *
 * Tres estados, y la diferencia importa:
 *
 * - **Es la base de la cuenta dueña** → `ok: true`, sin motivo.
 * - **No lo es** → `ok: false` con el motivo (y el arreglo lo pone el informe de
 *   salud, que es quien tiene el «qué hacer»).
 * - **No se puede saber** (no hay URL, es el placeholder, o el cotejo está
 *   desactivado) → `ok: true` con la nota correspondiente. No se marca rojo por
 *   lo que no se puede afirmar, pero tampoco se calla que no se comprobó.
 */
export function judgeProjectOwnership({
  url,
  anonKey,
  serviceRoleKey,
  ownerProjectRef,
}: OwnershipInput): OwnershipVerdict {
  const notes: string[] = [];
  const value = String(url ?? '').trim();

  if (!value) {
    // Sin URL no hay proyecto que cotejar, y quien lo dice es el subsistema
    // `supabase` (crítico): repetirlo acá sería contar dos veces la misma falla.
    return { ok: true, ref: null, reason: null, notes: ['Sin NEXT_PUBLIC_SUPABASE_URL no hay proyecto que cotejar.'] };
  }

  if (/placeholder/i.test(value)) {
    return { ok: true, ref: null, reason: null, notes: ['La URL sigue siendo el placeholder de ejemplo: no hay proyecto que cotejar.'] };
  }

  const ref = projectRefFromUrl(value);
  if (!ref) {
    return {
      ok: false,
      ref: null,
      reason: `NEXT_PUBLIC_SUPABASE_URL no apunta a un proyecto de Supabase (${value.slice(0, 80)}).`,
      notes,
    };
  }

  if (!ownerProjectRef) {
    return {
      ok: true,
      ref,
      reason: null,
      notes: ['Sin referencia de la cuenta dueña (SUPABASE_OWNER_PROJECT_REF) no se coteja de quién es la base.'],
    };
  }

  if (ref !== ownerProjectRef) {
    return {
      ok: false,
      ref,
      reason: `La base es del proyecto ${ref}, y el de la cuenta dueña (${OWNER_ACCOUNT_EMAIL}) es ${ownerProjectRef}.`,
      notes,
    };
  }

  // La URL es la correcta; falta comprobar que las claves salieron de ella — el
  // error de copiar y pegar una clave de otro proyecto, que este cotejo ataja sin
  // red y antes de que la base conteste 401.
  const keys: [string, string | null][] = [
    ['NEXT_PUBLIC_SUPABASE_ANON_KEY', anonKey],
    ['SUPABASE_SERVICE_ROLE_KEY', serviceRoleKey],
  ];
  const uncotejables: string[] = [];

  for (const [name, key] of keys) {
    if (!key) continue; // Ausente: lo reporta el subsistema que le corresponde.
    const body = decodeJwtBody(key);
    const keyRef = typeof body?.ref === 'string' && body.ref ? body.ref : null;

    if (!keyRef) {
      uncotejables.push(name);
      continue;
    }
    if (keyRef !== ownerProjectRef) {
      return {
        ok: false,
        ref,
        reason: `${name} es de otro proyecto (ref ${keyRef}, la URL dice ${ref}).`,
        notes,
      };
    }
  }

  if (uncotejables.length) {
    notes.push(
      `No se pudo cotejar el proyecto de ${uncotejables.join(' y ')}: no lleva la referencia en su cuerpo (claves nuevas). Se comprueba con \`npm run check:auth\`, que sí le pregunta a la base.`,
    );
  }

  return { ok: true, ref, reason: null, notes };
}
