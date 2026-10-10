/**
 * Modelo de roles de RIX7.
 *
 * Hay dos tipos de usuario y solo uno requiere cuenta con rol:
 *
 * - **Visita (`visitor`)** — cualquiera que navega el sitio. Ve todas las fichas
 *   y puede contactar a una corredora dejando sus datos. No necesita cuenta:
 *   es el rol por defecto de cualquier usuario, incluso autenticado.
 * - **Cliente / Miembro (`member`)** — empresas de corretaje de propiedades ya
 *   inscritas. Publican y administran sus propiedades.
 * - **Admin (`admin`)** — el equipo de RIX7: da de alta a las corredoras.
 *
 * El rol vive en `app_metadata.role`, que solo el servidor puede escribir (el
 * usuario no puede editarlo desde el cliente). Es el mismo mecanismo que ya
 * usaba el guard de admin, extendido para reconocer a los miembros.
 *
 * El vínculo con la corredora vive en `app_metadata.partner_id`: es lo que
 * permite que una cuenta administre el stock de su empresa en
 * `/socio` (ver `decideMemberAccess` y la migración 0014). Como el rol, solo
 * el servidor puede escribirlo, así que nadie se asigna una corredora a mano.
 *
 * Este módulo gobierna dos puertas: las rutas de administración (solo admin)
 * y las del panel del socio (admin o member vinculado).
 *
 * Este módulo es puro a propósito: lo consumen el `AuthProvider` (cliente),
 * las rutas de API (servidor) y los tests, sin arrastrar dependencias.
 */

export type AccountRole = 'visitor' | 'member' | 'admin';

/**
 * Forma mínima de un usuario de Supabase que necesitamos para resolver el rol.
 *
 * `app_metadata` se declara como `unknown` a propósito: el `UserAppMetadata` de
 * Supabase no tipa `role`, y restringirlo aquí rompía la asignación del usuario
 * real. La validación del valor se hace al leerlo.
 */
export interface RoleUserLike {
  app_metadata?: unknown;
}

/**
 * Alias aceptados al leer `app_metadata.role`.
 *
 * Se toleran las dos palabras que usa el negocio ("cliente" y "miembro") para
 * que un alta en el panel de admin no deje a la corredora como visitante por
 * haber escrito el rol en español.
 */
const ROLE_ALIASES: Record<string, AccountRole> = {
  admin: 'admin',
  administrator: 'admin',
  member: 'member',
  client: 'member',
  cliente: 'member',
  miembro: 'member',
};

/**
 * Resuelve el rol de una cuenta. Sin usuario, o con un rol desconocido, el
 * resultado es `visitor` (nunca se asciende por accidente).
 */
export function resolveRole(user: RoleUserLike | null | undefined): AccountRole {
  const metadata = user?.app_metadata;
  const raw =
    metadata && typeof metadata === 'object'
      ? (metadata as { role?: unknown }).role
      : undefined;

  if (typeof raw !== 'string') return 'visitor';
  return ROLE_ALIASES[raw.trim().toLowerCase()] ?? 'visitor';
}

/**
 * Longitud máxima aceptada para `app_metadata.partner_id`. Los ids del
 * catálogo caben holgadamente; el tope evita que un registro corrupto viaje
 * a las políticas RLS y a las consultas filtradas.
 */
const MAX_PARTNER_ID_LENGTH = 120;

/**
 * La corredora a la que está vinculada la cuenta, o `null`.
 *
 * Lee `app_metadata.partner_id` — el mismo claim que usa la función SQL
 * `rix7_partner_id()` de la migración 0014— con la misma desconfianza que
 * `resolveRole`: solo cadena limpia y con forma de id; cualquier otra cosa
 * (nulo, número, basura) es «sin corredora» y no abre puertas.
 */
export function resolvePartnerId(user: RoleUserLike | null | undefined): string | null {
  const metadata = user?.app_metadata;
  const raw =
    metadata && typeof metadata === 'object'
      ? (metadata as { partner_id?: unknown }).partner_id
      : undefined;

  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_PARTNER_ID_LENGTH) return null;
  // Mismo alfabeto que `idSchema` (lib/api/schemas.ts): los ids de
  // `partners.id` son legibles y acotados.
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) return null;
  return trimmed;
}

export interface AdminAccessInput {
  /** ¿Hay un proyecto Supabase real configurado? */
  configured: boolean;
  /** ¿La petición trae una sesión válida? */
  authenticated: boolean;
  /** Rol resuelto del usuario autenticado. */
  role: AccountRole;
  /** Bypass de desarrollo (ver `requireAdmin`). */
  devBypass: boolean;
}

export interface AccessDecision {
  allow: boolean;
  /** Estado HTTP para la respuesta de error; `null` cuando se permite. */
  status: 401 | 403 | 503 | null;
  /** Mensaje de error para el cliente; `null` cuando se permite. */
  error: string | null;
}

/**
 * Decide el acceso a una ruta de administración.
 *
 * Se separa de la lectura de la sesión para poder probar las cuatro ramas sin
 * montar un Supabase falso. El orden importa: sin proyecto configurado el único
 * camino es el bypass de desarrollo; con proyecto configurado, la sesión y el
 * rol se exigen siempre.
 */
export function decideAdminAccess({
  configured,
  authenticated,
  role,
  devBypass,
}: AdminAccessInput): AccessDecision {
  if (!configured) {
    // Sin Supabase real no hay forma de autenticarse: en local se permite para
    // poder usar el panel, en producción se falla cerrado.
    return devBypass
      ? { allow: true, status: null, error: null }
      : {
          allow: false,
          status: 503,
          // El detalle —qué falta exactamente y qué deja de funcionar— vive en
          // `/api/health`: acá, un mensaje genérico obligaba a leer el código.
          error: 'Supabase no está configurado en este entorno. El detalle está en /api/health.',
        };
  }

  if (!authenticated) {
    return { allow: false, status: 401, error: 'Inicia sesión para continuar.' };
  }

  if (role !== 'admin') {
    return { allow: false, status: 403, error: 'Se requiere rol admin.' };
  }

  return { allow: true, status: null, error: null };
}

export interface MemberAccessInput {
  /** ¿Hay un proyecto Supabase real configurado (no el placeholder)? */
  configured: boolean;
  /** ¿La petición trae una sesión válida? */
  authenticated: boolean;
  /** Rol resuelto del usuario autenticado. */
  role: AccountRole;
  /** Bypass de desarrollo (mismo criterio que `requireAdmin`). */
  devBypass: boolean;
}

/**
 * Decide el acceso al panel del socio (`/socio` y `/api/partner/*`).
 *
 * Misma estructura y semántica que `decideAdminAccess` —el orden de las
 * ramas importa igual: sin proyecto configurado solo entra el bypass de
 * desarrollo—, con dos diferencias:
 *
 * - Admin **y** member entran: el equipo de Rix7 administra las mismas
 *   publicaciones que un socio, así que no hace falta vincular una corredora
 *   a la cuenta del equipo para poder entrar.
 * - La vinculación con la corredora (tener `partner_id`) **no** se juzga acá:
 *   es un dato, no un rol. La resuelve `requireMember`, que es quien sabe
 *   si la petición vino del bypass (sin sesión real) o de una cuenta.
 */
export function decideMemberAccess({
  configured,
  authenticated,
  role,
  devBypass,
}: MemberAccessInput): AccessDecision {
  if (!configured) {
    return devBypass
      ? { allow: true, status: null, error: null }
      : {
          allow: false,
          status: 503,
          error: 'Supabase no está configurado en este entorno. El detalle está en /api/health.',
        };
  }

  if (!authenticated) {
    return { allow: false, status: 401, error: 'Inicia sesión para continuar.' };
  }

  if (role !== 'admin' && role !== 'member') {
    return { allow: false, status: 403, error: 'Se requiere rol de socio.' };
  }

  return { allow: true, status: null, error: null };
}
