import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { hasAuthSessionCookie } from '@/lib/utils/authCookie';

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  // Sin un proyecto Supabase real no hay sesión que refrescar: saltamos la
  // llamada de red (antes cada request del middleware esperaba en vano a
  // un host inexistente, sumando latencia a todas las rutas).
  if (!supabaseUrl || supabaseUrl.includes('placeholder')) {
    return supabaseResponse;
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
    return supabaseResponse;
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

  // Refresca la sesión del usuario si ha expirado
  await supabase.auth.getUser();

  return supabaseResponse;
}
