/**
 * El admin vive fuera del sitio público.
 *
 * El portal se publica en `rix7.cl`; el panel en `admin.rix7.cl`. La ruta
 * `/admin` del dominio público ya no muestra el panel: redirige al subdominio.
 * Así el enlace no existe en la web pública, el crawler no lo encuentra y quien
 * llegue por un enlace viejo termina en el host correcto, donde además se exige
 * sesión con rol admin.
 *
 * `ADMIN_HOST` permite cambiar el host sin tocar código (por ejemplo, un dominio
 * distinto en una migración). Si no está, el valor por defecto es
 * `admin.rix7.cl`.
 *
 * Este módulo es puro: el middleware lo usa y los tests lo ejercitan sin
 * levantar Next.
 */

/** Host del panel cuando `ADMIN_HOST` no está definido. */
export const DEFAULT_ADMIN_HOST = 'admin.rix7.cl';

/**
 * Normaliza un host de encabezado HTTP o de variable de entorno.
 *
 * - Toma la primera entrada de `x-forwarded-for`/`x-forwarded-host` (puede venir
 *   una cadena con proxies).
 * - Quita el puerto y el punto final.
 * - Acepta una URL completa en `ADMIN_HOST` y se queda con su host.
 */
export function normalizeHost(raw: string | null | undefined): string {
  if (!raw) return '';

  const first = raw.split(',')[0].trim().toLowerCase();
  if (!first) return '';

  // `ADMIN_HOST` debería ser un host, pero aceptar `https://…` evita que un
  // valor pegado de la barra del navegador redirija a `https://https`.
  const withoutScheme = first.replace(/^https?:\/\//, '').replace(/\/.*$/, '');

  if (withoutScheme.startsWith('[')) {
    const end = withoutScheme.indexOf(']');
    return end === -1 ? withoutScheme : withoutScheme.slice(1, end);
  }

  return withoutScheme.split(':')[0].replace(/\.$/, '');
}

/** ¿Es un host local? En desarrollo el panel se sigue abriendo en `/admin`. */
export function isLoopbackHost(host: string): boolean {
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.localhost')
  );
}

/** ¿La ruta pertenece al panel? `/administracion` no cuenta. */
export function isAdminPath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

export interface AdminHostRedirectInput {
  pathname: string;
  /** Encabezado `host` o `x-forwarded-host`, tal como llega. */
  host: string;
  /** Valor de `ADMIN_HOST`; si falta, se usa el host por defecto. */
  adminHost?: string | null;
  /** Solo se redirige en el despliegue de producción (ver middleware). */
  production: boolean;
}

/**
 * Decide si una petición al admin debe irse al host del panel.
 *
 * Devuelve el host destino, o `null` si no hay que redirigir. Se redirige solo:
 *
 * - en producción (en local y preview se puede probar `/admin` sin DNS);
 * - para rutas del panel;
 * - cuando el host no es ya el del panel ni uno local.
 */
export function adminHostRedirect({
  pathname,
  host,
  adminHost,
  production,
}: AdminHostRedirectInput): string | null {
  if (!production) return null;
  if (!isAdminPath(pathname)) return null;

  const target = normalizeHost(adminHost) || DEFAULT_ADMIN_HOST;
  const current = normalizeHost(host);

  if (!current || current === target || isLoopbackHost(current)) return null;
  return target;
}

/**
 * URL de destino conservando ruta y query.
 *
 * Se fuerza `https` porque el panel va por HTTPS; en producción el host público
 * ya viene por HTTPS y `admin.rix7.cl` también.
 */
export function adminRedirectUrl(requestUrl: string, adminHost: string): string {
  const url = new URL(requestUrl);
  url.protocol = 'https:';
  url.host = adminHost;
  // `host` conserva el puerto de la URL de origen en algunos runtimes; el panel
  // vive en el host sin puerto (443 por HTTPS).
  url.port = '';
  return url.toString();
}
