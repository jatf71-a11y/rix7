import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from './lib/supabase/middleware';
import { adminHostRedirect, adminRedirectUrl } from './lib/utils/adminHost';

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

  return await updateSession(request);
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
