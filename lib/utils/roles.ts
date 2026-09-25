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
 * Estado actual: `member` se reconoce pero **todavía no habilita nada** — el
 * portal del cliente, el vínculo con su corredora y el flujo de publicar están
 * pendientes. Lo único que este módulo gobierna hoy es quién entra a las rutas
 * de administración, donde visita y miembro responden igual (403).
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
          error: 'Supabase no está configurado en este entorno.',
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
