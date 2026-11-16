/**
 * Quién puede abrir la URL propia de una corredora: `/socio/<slug>`.
 *
 * El slug identifica la entrada, **no autoriza** —lo que se lee y escribe sigue
 * saliendo del `partner_id` de la sesión en las APIs—, pero abrir el panel de
 * otra empresa tiene que responder **403**, no una pantalla con un aviso.
 *
 * Y esa diferencia no se puede hacer desde la página: el layout del panel es un
 * componente de servidor que se transmite en streaming, así que cuando la
 * página alcanza a rechazar la cuenta los encabezados ya salieron con 200 y el
 * navegador no tiene forma de saber que fue un rechazo. La decisión vive acá,
 * en una función pura que el `middleware` corre **antes** de renderizar nada.
 *
 * `slug` es el id de la ficha: `partnerIdFor` crea el socio con
 * `slug: partnerId` (`lib/kyb/provisioning.ts`), así que comparar el slug con el
 * `partner_id` del token es comparar dos veces el mismo valor, sin consultar la
 * base en el borde.
 */

/** El slug de `/socio/<slug>` y de sus rutas hijas, o `null` si no es una de ellas. */
export function socioSlugFromPath(pathname: string): string | null {
  const match = /^\/socio\/([^/]+)(?:\/.*)?$/.exec(pathname);
  if (!match) return null;

  let slug = match[1];
  try {
    slug = decodeURIComponent(slug);
  } catch {
    // Un `%` suelto no es una URL válida: se usa tal cual y el socio no existirá.
  }
  return slug || null;
}

export type SlugAccess = 'owner' | 'admin' | 'foreign';

/**
 * Dueño, equipo, o ajeno.
 *
 * - `admin`: el equipo entra a cualquier ficha desde el panel de administración.
 * - `owner`: la cuenta está vinculada a esa corredora.
 * - `foreign`: cualquier otra cuenta con sesión —incluida una sin corredora—.
 *   Sin sesión no se llega acá: esa pantalla la resuelve la página, que ofrece
 *   entrar.
 */
export function decideSlugAccess({
  slug,
  role,
  partnerId,
}: {
  slug: string;
  role?: string | null;
  partnerId?: string | null;
}): SlugAccess {
  if (role === 'admin') return 'admin';
  if (partnerId && partnerId === slug) return 'owner';
  return 'foreign';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * La respuesta 403, con la marca del portal y sin cargar la aplicación.
 *
 * Devuelve HTML y no una pantalla de Next a propósito: el middleware corre antes
 * del render, que es justo la razón por la que el estado puede ser un 403 de
 * verdad. Es autosuficiente —sin hojas de estilo del sitio— para no depender de
 * nada que se sirva después.
 */
export function socioForbiddenHtml(slug: string): string {
  const safe = escapeHtml(slug);
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>403 · Este panel es de otra corredora | Rix7</title>
</head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;padding:24px">
  <main style="max-width:520px;width:100%;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:32px">
    <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#2563eb">Rix7 · Panel Socios</p>
    <h1 style="margin:0 0 12px;font-size:22px;line-height:1.25;font-weight:800">Este panel es de otra corredora</h1>
    <p style="margin:0 0 8px;font-size:14px;line-height:1.7;color:#334155">
      La dirección que abriste pertenece a la cuenta <strong>${safe}</strong>, y tu sesión está
      vinculada a otra empresa. Por eso no se muestra nada de esta corredora.
    </p>
    <p style="margin:0 0 24px;font-size:14px;line-height:1.7;color:#334155">
      Si te pasaron este enlace por error, entrá a tu propio panel y vas a ver tus publicaciones.
    </p>
    <a href="/socio" style="display:inline-block;background:#2563eb;color:#ffffff;font-size:14px;font-weight:700;padding:12px 22px;border-radius:12px;text-decoration:none">Ir a mi panel</a>
    <p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:#64748b">
      Si crees que tu cuenta debería ser la de <strong>${safe}</strong>, escríbenos y lo revisamos.
    </p>
  </main>
</body>
</html>`;
}
