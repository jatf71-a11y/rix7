import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from './lib/supabase/middleware';
import { adminHostRedirect, adminRedirectUrl } from './lib/utils/adminHost';
import { decideSlugAccess, socioForbiddenHtml, socioSlugFromPath } from './lib/utils/socioSlug';

export async function middleware(request: NextRequest) {
  // El panel se sirve en el mismo dominio (`rix7.cl/admin`) y se protege en el
  // servidor por rol. La redirección a un host propio solo existe si alguien
  // define `ADMIN_HOST` con otro host (ver `lib/utils/adminHost.ts`); así no
  // queda un 307 colgado hacia un subdominio que no resuelve. En local y en
  // preview no se aplica, para poder probar el panel sin DNS.
  const production = process.env.VERCEL_ENV
    ? process.env.VERCEL_ENV === 'production'
    : process.env.NODE_ENV === 'production';

  const adminHost = adminHostRedirect({
    pathname: request.nextUrl.pathname,
    host: request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '',
    adminHost: process.env.ADMIN_HOST,
    production,
  });

  if (adminHost) {
    return NextResponse.redirect(adminRedirectUrl(request.url, adminHost), 307);
  }

  const { response, user } = await updateSession(request);

  // El panel de otra corredora responde **403 de verdad**, y solo se puede hacer
  // acá: el layout del panel se transmite en streaming, así que cuando la
  // página alcanza a rechazar la cuenta los encabezados ya salieron con 200 y el
  // navegador nunca ve un rechazo. Sin sesión no se decide nada: la página
  // ofrece entrar y el socio sigue su enlace desde el correo.
  const slug = socioSlugFromPath(request.nextUrl.pathname);
  if (slug && user) {
    const access = decideSlugAccess({ slug, role: user.role, partnerId: user.partnerId });
    if (access === 'foreign') {
      const forbidden = new NextResponse(socioForbiddenHtml(slug), {
        status: 403,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      });
      // La respuesta de sesión puede traer cookies renovadas: se conservan para
      // que el rechazo no obligue a volver a iniciar sesión.
      for (const cookie of response.cookies.getAll()) {
        forbidden.cookies.set(cookie);
      }
      return forbidden;
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Coincide con todas las rutas de solicitud excepto:
     * - _next/static (archivos estáticos)
     * - _next/image (archivos de optimización de imágenes)
     * - favicon.ico (archivo favicon)
     * - extensiones de imagen (.svg, .png, .jpg, .jpeg, .gif, .webp)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
