import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { hasAuthSessionCookie } from '@/lib/utils/authCookie';

/**
 * Lo que el middleware necesita saber de la sesión para decidir antes de
 * renderizar: quién es y a qué corredora está vinculado.
 *
 * Sale del `getUser()` que ya se hacía para refrescar el token —una llamada a
 * Auth que no agrega red—, no de decodificar la cookie a mano: el token se
 * firma en el servidor y esos metadatos solo los escribe el servidor.
 */
export interface SessionSnapshot {
  id: string;
  email: string | null;
  role: string | null;
  partnerId: string | null;
}

export interface UpdateSessionResult {
  response: NextResponse;
  /** `null` sin sesión (o sin proyecto Supabase configurado). */
  user: SessionSnapshot | null;
}

export async function updateSession(request: NextRequest): Promise<UpdateSessionResult> {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  // Sin un proyecto Supabase real no hay sesión que refrescar: saltamos la
  // llamada de red (antes cada request del middleware esperaba en vano a
  // un host inexistente, sumando latencia a todas las rutas).
  if (!supabaseUrl || supabaseUrl.includes('placeholder')) {
    return { response: supabaseResponse, user: null };
  }

  // Sin cookie de sesión no hay nada que refrescar: se evita construir el
  // cliente SSR y su fontanería de cookies en cada request anónimo, que es la
  // mayoría del tráfico (home, fichas, listado y APIs públicas). Medido en
  // local: ~3 ms → ~2 ms por request. El caso con sesión no cambia —sigue
  // refrescando igual— porque la señal es la misma que ya usa el portal
  // (`hasAuthSessionCookie`) y una cookie partida (`…auth-token.0`) también
  // cuenta.
  const cookieHeader = request.cookies
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
  if (!hasAuthSessionCookie(cookieHeader)) {
    return { response: supabaseResponse, user: null };
  }

  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // Refresca la sesión del usuario si ha expirado, y de paso devuelve quién es:
  // el middleware usa ese dato para rechazar el panel de otra corredora antes
  // de que el layout empiece a transmitir (ver `lib/utils/socioSlug.ts`).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const snapshot: SessionSnapshot | null = user
    ? {
        id: user.id,
        email: user.email ?? null,
        role: typeof user.app_metadata?.role === 'string' ? user.app_metadata.role : null,
        partnerId:
          typeof user.app_metadata?.partner_id === 'string' ? user.app_metadata.partner_id : null,
      }
    : null;

  return { response: supabaseResponse, user: snapshot };
}
